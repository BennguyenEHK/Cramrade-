// make-questions (A6): turns a note's chunks into questions, 6 chunks per run.
// Every question names its chunk and quotes it; questions that fail a check
// are dropped, never repaired. Runs chain themselves until every chunk has
// been tried once, then the study plan is refreshed when the note belongs to
// an exam.
//
// Two callers:
// - another function, with the service key: answer 202 at once, work in the
//   background (keeps each link of the chain short);
// - the app, with the student's login: do the batch, answer the counts.
import { AiError, askGemini } from '../_shared/ai.ts';
import { isServiceCall, requireFullUser } from '../_shared/auth.ts';
import { db } from '../_shared/db.ts';
import { handle, HttpError, json } from '../_shared/http.ts';
import { invokeInBackground } from '../_shared/invoke.ts';
import {
  BATCH_SIZE,
  type DropReason,
  filterMadeQuestions,
  formatChunksForPrompt,
  formatTopicsForPrompt,
  MADE_QUESTIONS_SCHEMA,
  type MadeQuestionsAnswer,
  pickBatch,
  QUESTIONS_PER_CHUNK,
} from '../_shared/questions.ts';

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface NoteRow {
  id: string;
  owner_id: string;
  exam_id: string | null;
  status: string;
}

interface BatchResult {
  made: number;
  dropped: DropReason[];
  remaining: number;
}

/** Log the real database error; the client only sees a generic 500. */
function serverError(what: string, cause: unknown): never {
  console.error(`make-questions: ${what} failed`, cause);
  throw new HttpError(500, 'internal', 'Something went wrong on the server');
}

function readInput(body: unknown): { noteId: string; batchStart: number } {
  const input = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  const noteId = input.noteId;
  const batchStart = input.batchStart ?? 0;
  if (typeof noteId !== 'string' || !UUID.test(noteId)) {
    throw new HttpError(400, 'bad_input', 'Send { "noteId": "<note id>" }.');
  }
  if (typeof batchStart !== 'number' || !Number.isInteger(batchStart) || batchStart < 0) {
    throw new HttpError(400, 'bad_input', 'batchStart must be a whole number, 0 or more.');
  }
  return { noteId, batchStart };
}

async function loadNote(noteId: string): Promise<NoteRow> {
  const { data, error: e } = await db
    .from('notes')
    .select('id, owner_id, exam_id, status')
    .eq('id', noteId)
    .maybeSingle();
  if (e) serverError('loading the note', e);
  if (!data) throw new HttpError(404, 'not_found', 'That note could not be found.');
  return data as NoteRow;
}

async function runBatch(note: NoteRow, batchStart: number): Promise<BatchResult> {
  const [chunksRes, askedRes] = await Promise.all([
    db.from('chunks').select('id, position, text').eq('note_id', note.id).gte('position', batchStart).order('position'),
    db.from('questions').select('chunk_id').eq('note_id', note.id),
  ]);
  if (chunksRes.error) serverError('loading chunks', chunksRes.error);
  if (askedRes.error) serverError('loading questions', askedRes.error);

  const done = new Set((askedRes.data ?? []).map((r) => r.chunk_id as string));
  const { batch, nextStart, remaining } = pickBatch(chunksRes.data ?? [], done, batchStart, BATCH_SIZE);
  if (batch.length === 0) return { made: 0, dropped: [], remaining: 0 };

  let topics: { id: string; title: string }[] = [];
  if (note.exam_id) {
    const { data, error: e } = await db.from('topics').select('id, title').eq('exam_id', note.exam_id).order('position');
    if (e) serverError('loading topics', e);
    topics = data ?? [];
  }

  let answer: MadeQuestionsAnswer;
  try {
    answer = await askGemini<MadeQuestionsAnswer>(
      'make-questions',
      {
        chunks: formatChunksForPrompt(batch),
        topics: formatTopicsForPrompt(topics),
        questionsPerChunk: String(QUESTIONS_PER_CHUNK),
      },
      MADE_QUESTIONS_SCHEMA,
      { temperature: 0.7 },
    );
  } catch (e) {
    if (e instanceof AiError) {
      // Stop the chain here. The note keeps the questions made so far and the
      // app can call again; chunks without questions are picked up then.
      console.error(`make-questions: AI failed for note ${note.id} at ${batchStart}`, e);
      throw new HttpError(502, 'ai_failed', 'Making questions failed for now. Try again in a minute.');
    }
    throw e;
  }

  const { keep, dropped } = filterMadeQuestions(answer?.questions, batch, topics);
  const positionOf = new Map(batch.map((c) => [c.id, c.position]));

  // A parallel run may have filled some of these chunks while the AI was busy.
  const { data: nowAsked, error: nowAskedError } = await db
    .from('questions')
    .select('chunk_id')
    .in('chunk_id', batch.map((c) => c.id));
  if (nowAskedError) serverError('re-checking questions', nowAskedError);
  const taken = new Set((nowAsked ?? []).map((r) => r.chunk_id as string));

  const rows = [];
  for (const q of keep) {
    if (taken.has(q.chunkId)) {
      dropped.push({ index: null, chunkPosition: positionOf.get(q.chunkId) ?? null, reason: 'chunk_already_has_questions' });
      continue;
    }
    rows.push({
      note_id: note.id,
      chunk_id: q.chunkId,
      exam_id: note.exam_id,
      topic_id: q.topicId,
      kind: q.kind,
      prompt: q.prompt,
      choices: q.choices,
      answer: q.answer,
      source_quote: q.sourceQuote,
    });
  }

  let made = 0;
  if (rows.length > 0) {
    const { data: inserted, error: insertError } = await db.from('questions').insert(rows).select('id, chunk_id, verified');
    if (insertError) serverError('inserting questions', insertError);
    const unverified = (inserted ?? []).filter((r) => !r.verified);
    made = (inserted ?? []).length - unverified.length;
    if (unverified.length > 0) {
      const { error: deleteError } = await db.from('questions').delete().in('id', unverified.map((r) => r.id));
      if (deleteError) console.error('make-questions: deleting unverified questions failed', deleteError);
      for (const r of unverified) {
        dropped.push({ index: null, chunkPosition: positionOf.get(r.chunk_id) ?? null, reason: 'not_verified_by_database' });
      }
    }
  }

  console.log(
    JSON.stringify({ fn: 'make-questions', noteId: note.id, batchStart, chunks: batch.length, made, dropped: dropped.length, remaining }),
  );

  if (remaining > 0) {
    invokeInBackground('make-questions', { noteId: note.id, batchStart: nextStart });
  } else if (note.exam_id) {
    // build-schedule may not exist yet; invokeInBackground logs the 404 and moves on.
    invokeInBackground('build-schedule', { examId: note.exam_id });
  }

  return { made, dropped, remaining };
}

Deno.serve(
  handle(async (req) => {
    if (req.method !== 'POST') throw new HttpError(400, 'bad_input', 'Use POST.');

    if (isServiceCall(req)) {
      const { noteId, batchStart } = readInput(await req.json().catch(() => null));
      EdgeRuntime.waitUntil(
        (async () => {
          try {
            const note = await loadNote(noteId);
            if (note.status !== 'ready') {
              console.warn(`make-questions: note ${noteId} is ${note.status}, nothing to do`);
              return;
            }
            await runBatch(note, batchStart);
          } catch (e) {
            console.error(`make-questions: background batch failed for note ${noteId} at ${batchStart}`, e);
          }
        })(),
      );
      return json({ accepted: true }, 202);
    }

    const user = await requireFullUser(req);
    const { noteId, batchStart } = readInput(await req.json().catch(() => null));
    const note = await loadNote(noteId);
    if (note.owner_id !== user.id) throw new HttpError(403, 'not_yours', 'That note belongs to someone else.');
    if (note.status !== 'ready') {
      throw new HttpError(409, 'note_not_ready', 'The note text is not ready yet. Try again in a moment.');
    }
    return json(await runBatch(note, batchStart));
  }),
);
