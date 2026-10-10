// read-syllabus (A4): finds exam, quiz and competition dates in a syllabus
// note and returns them for the student to confirm. Saves nothing: the
// confirm screen saves exams and topics itself once the student agrees.
import { AiError, askGemini } from '../_shared/ai.ts';
import { requireFullUser } from '../_shared/auth.ts';
import { db } from '../_shared/db.ts';
import { handle, HttpError, json } from '../_shared/http.ts';
import { SYLLABUS_SCHEMA, type SyllabusResult, todayIn, validateProposals } from '../_shared/proposals.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_CHUNKS = 40; // a syllabus is short; this is far more than any real one

Deno.serve(
  handle(async (req) => {
    if (req.method !== 'POST') throw new HttpError(400, 'bad_input', 'Use POST.');
    const user = await requireFullUser(req);

    const body = await req.json().catch(() => null);
    const noteId = body?.noteId;
    if (typeof noteId !== 'string' || !UUID.test(noteId)) {
      throw new HttpError(400, 'bad_input', 'Send { "noteId": "<note id>" }.');
    }

    const { data: note, error: noteError } = await db
      .from('notes')
      .select('id, owner_id, is_syllabus, status')
      .eq('id', noteId)
      .maybeSingle();
    if (noteError) throw new HttpError(500, 'internal', noteError.message);
    if (!note) throw new HttpError(404, 'not_found', 'That syllabus could not be found.');
    if (note.owner_id !== user.id) throw new HttpError(403, 'not_yours', 'That syllabus belongs to someone else.');
    if (!note.is_syllabus) throw new HttpError(400, 'not_a_syllabus', 'That note was not uploaded as a syllabus.');
    if (note.status !== 'ready') {
      throw new HttpError(409, 'note_not_ready', 'The syllabus text is not ready yet. Try again in a moment.');
    }

    const { data: chunks, error: chunksError } = await db
      .from('chunks')
      .select('text')
      .eq('note_id', noteId)
      .order('position')
      .limit(MAX_CHUNKS);
    if (chunksError) throw new HttpError(500, 'internal', chunksError.message);
    // No text means no dates. Say so rather than asking the AI to guess.
    if (!chunks || chunks.length === 0) return json({ found: false, proposals: [] });

    const text = chunks.map((c) => c.text).join('\n\n');

    // "past" is judged by the student's own calendar day, not the server's.
    const { data: settings } = await db
      .from('study_settings')
      .select('time_zone')
      .eq('user_id', user.id)
      .maybeSingle();
    const today = todayIn(settings?.time_zone ?? 'UTC');

    let answer: SyllabusResult;
    try {
      answer = await askGemini<SyllabusResult>('read-syllabus', { text, today }, SYLLABUS_SCHEMA, { temperature: 0.2 });
    } catch (e) {
      if (e instanceof AiError) {
        console.error('read-syllabus: AI failed', e);
        throw new HttpError(502, 'ai_failed', 'Reading the syllabus failed. Try again in a minute, or enter the dates by hand.');
      }
      throw e;
    }

    return json(validateProposals(answer, text, today));
  }),
);
