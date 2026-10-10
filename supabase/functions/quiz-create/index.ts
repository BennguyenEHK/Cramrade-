// quiz-create: a full user makes a quiz room from an exam or a note they
// can see. Group mode waits in the lobby for players; solo mode joins the
// caller and starts at once (spec 9.1).

import { requireFullUser } from '../_shared/auth.ts';
import { db } from '../_shared/db.ts';
import { HttpError, handle, json } from '../_shared/http.ts';
import { parseCreateInput, type QuizSource } from '../_shared/quiz-input.ts';
import { pickQuestions, visibleQuestions } from '../_shared/quiz-pick.ts';
import { groupIdsOf, loadRoom, startRoom } from '../_shared/quiz-db.ts';

interface SourceRow {
  id: string;
  owner_id: string;
  group_id: string | null;
  title: string;
}

async function loadSource(source: QuizSource): Promise<SourceRow> {
  const table = source.kind === 'exam' ? 'exams' : 'notes';
  const id = source.kind === 'exam' ? source.examId : source.noteId;
  const { data, error } = await db.from(table).select('id, owner_id, group_id, title').eq('id', id).maybeSingle();
  if (error) throw new HttpError(500, 'internal', error.message);
  if (!data) throw new HttpError(404, 'source_not_found', `No ${source.kind} with that id.`);
  return data as SourceRow;
}

interface QuestionRow {
  id: string;
  chunk_id: string;
  notes: { owner_id: string; group_id: string | null };
}

async function loadQuestions(source: QuizSource) {
  const column = source.kind === 'exam' ? 'exam_id' : 'note_id';
  const id = source.kind === 'exam' ? source.examId : source.noteId;
  const { data, error } = await db
    .from('questions')
    .select('id, chunk_id, notes!inner(owner_id, group_id)')
    .eq(column, id)
    .eq('verified', true);
  if (error) throw new HttpError(500, 'internal', error.message);
  return ((data ?? []) as unknown as QuestionRow[]).map((row) => ({
    id: row.id,
    chunkId: row.chunk_id,
    noteOwnerId: row.notes.owner_id,
    noteGroupId: row.notes.group_id,
  }));
}

async function insertRoom(fields: Record<string, unknown>): Promise<{ id: string; code: string }> {
  // The join code is random (6 characters). On the rare clash with an
  // existing room, the unique index refuses it and we try again.
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data, error } = await db.from('quiz_rooms').insert(fields).select('id, code').single();
    if (!error) return data as { id: string; code: string };
    if (error.code !== '23505') throw new HttpError(500, 'internal', error.message);
  }
  throw new HttpError(500, 'code_clash', 'Could not make a unique room code. Try again.');
}

Deno.serve(
  handle(async (req) => {
    if (req.method !== 'POST') throw new HttpError(400, 'bad_input', 'Use POST.');
    const user = await requireFullUser(req);
    const parsed = parseCreateInput(await req.json().catch(() => null));
    if (!parsed.ok) throw new HttpError(400, 'bad_input', parsed.message);
    const input = parsed.value;

    const source = await loadSource(input.source);
    const groupIds = await groupIdsOf(user.id);
    const canSee = source.owner_id === user.id || (source.group_id !== null && groupIds.has(source.group_id));
    if (!canSee) throw new HttpError(403, 'not_yours', `You cannot use this ${input.source.kind}.`);

    const pool = visibleQuestions(await loadQuestions(input.source), user.id, groupIds);
    const questionIds = pickQuestions(pool, input.count);
    if (questionIds.length === 0) {
      throw new HttpError(409, 'no_questions', 'There are no checked questions for this yet.');
    }

    const room = await insertRoom({
      host_id: user.id, // the service role has no auth.uid(), so the default would be null
      group_id: source.group_id,
      title: source.title.slice(0, 120),
      mode: input.mode,
      seconds_per_question: input.secondsPerQuestion,
    });

    const { error: listError } = await db
      .from('quiz_room_questions')
      .insert(questionIds.map((questionId, position) => ({ room_id: room.id, question_id: questionId, position })));
    if (listError) {
      await db.from('quiz_rooms').delete().eq('id', room.id);
      throw new HttpError(500, 'internal', listError.message);
    }

    if (input.mode === 'solo') {
      const { data: profile } = await db.from('profiles').select('display_name').eq('id', user.id).maybeSingle();
      const nickname = ((profile?.display_name as string | null) ?? 'Player').trim().slice(0, 24) || 'Player';
      const { error: playerError } = await db
        .from('quiz_players')
        .insert({ room_id: room.id, user_id: user.id, nickname });
      if (playerError) throw new HttpError(500, 'internal', playerError.message);
      const { room: started } = await startRoom(room.id);
      return json({
        roomId: room.id,
        code: room.code,
        questionCount: started.questionCount,
        status: started.status,
        room: started,
      });
    }

    const state = await loadRoom(room.id);
    return json({ roomId: room.id, code: room.code, questionCount: state.questionCount, status: state.status, room: state });
  }),
);
