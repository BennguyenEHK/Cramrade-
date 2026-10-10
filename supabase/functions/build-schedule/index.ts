// supabase/functions/build-schedule/index.ts
// Turns the student's exams, notes and answers into a dated plan and saves
// it. Thin on purpose: the rules live in the schedule engine
// (packages/shared), the row mapping in _shared/schedule-input.ts, and the
// load and save in two database functions (see the build_schedule migration).
import { askGemini } from '../_shared/ai.ts';
import { isServiceCall, requireFullUser } from '../_shared/auth.ts';
import { db } from '../_shared/db.ts';
import { handle, HttpError, json } from '../_shared/http.ts';
import { buildSchedule } from '../_shared/engine.ts';
import {
  localDateOf,
  normalizeSettings,
  parseDifficulty,
  toScheduleInput,
  toSessionRows,
  topicsToRate,
  zonedToUtcIso,
  type ScheduleRows,
  type SessionRowInput,
} from '../_shared/schedule-input.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RATE_SCHEMA = {
  type: 'OBJECT',
  properties: { difficulty: { type: 'INTEGER', minimum: 1, maximum: 5 } },
  required: ['difficulty'],
};
const MAX_TOPICS_PER_RUN = 10;
// Rating stops after this long so the whole call stays far inside 150 s.
// Topics left unrated are rated on the next run. One rating call has at most
// two attempts of RATING_TIMEOUT_MS each, so a call only starts while the
// budget left covers both attempts plus a margin.
const RATING_BUDGET_MS = 60_000;
const RATING_TIMEOUT_MS = 20_000;
const RATING_MIN_REMAINING_MS = 45_000;
const SAMPLE_CHARS = 1500;

type SavedSession = SessionRowInput & { id: string };

function internal(step: string, cause: unknown): HttpError {
  console.error(`build-schedule: ${step}`, cause);
  return new HttpError(500, 'internal', `Could not ${step}. Try again in a moment.`);
}

/** Ask the AI for a starting difficulty. Never fails the plan: an unrated topic counts as 3. */
async function rateTopics(rows: ScheduleRows): Promise<number> {
  const picks = topicsToRate(rows, MAX_TOPICS_PER_RUN);
  if (picks.length === 0) return 0;

  const { data: chunkTexts, error: loadError } = await db
    .from('chunks')
    .select('id, text')
    .in('id', picks.flatMap((p) => p.chunkIds));
  if (loadError || !chunkTexts) {
    console.error('build-schedule: load sample chunks', loadError);
    return 0;
  }
  const textOf = new Map(chunkTexts.map((c: { id: string; text: string }) => [c.id, c.text]));

  const started = Date.now();
  let rated = 0;
  for (const pick of picks) {
    if (RATING_BUDGET_MS - (Date.now() - started) < RATING_MIN_REMAINING_MS) break;
    try {
      const sampleChunks = pick.chunkIds
        .map((id) => (textOf.get(id) ?? '').slice(0, SAMPLE_CHARS))
        .join('\n\n---\n\n');
      const answer = await askGemini<{ difficulty: number }>(
        'rate-difficulty',
        { topicTitle: pick.title, sampleChunks },
        RATE_SCHEMA,
        { temperature: 0.2, timeoutMs: RATING_TIMEOUT_MS },
      );
      const difficulty = parseDifficulty(answer);
      if (difficulty === null) continue;
      // "is null" so a rating another run already saved is not overwritten.
      const { error: saveError } = await db
        .from('topics')
        .update({ difficulty })
        .eq('id', pick.topicId)
        .is('difficulty', null);
      if (saveError) {
        console.error('build-schedule: save difficulty', saveError);
        continue;
      }
      const topic = rows.topics.find((t) => t.id === pick.topicId);
      if (topic) topic.difficulty = difficulty;
      rated++;
    } catch (cause) {
      // An AiError here must not become a 502: the plan works without the rating.
      console.error(`build-schedule: rate topic ${pick.topicId}`, cause);
    }
  }
  return rated;
}

Deno.serve(
  handle(async (req) => {
    if (req.method !== 'POST') throw new HttpError(400, 'bad_input', 'Use POST.');

    // Input: {} or { examId }. An empty body counts as {}.
    const text = await req.text();
    let body: unknown;
    try {
      body = text.trim() ? JSON.parse(text) : {};
    } catch {
      throw new HttpError(400, 'bad_input', 'Send {} or { "examId": "<exam id>" }.');
    }
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      throw new HttpError(400, 'bad_input', 'Send {} or { "examId": "<exam id>" }.');
    }
    const rawExamId = (body as { examId?: unknown }).examId;
    let examId: string | null = null;
    if (rawExamId !== undefined && rawExamId !== null) {
      if (typeof rawExamId !== 'string' || !UUID.test(rawExamId)) {
        throw new HttpError(400, 'bad_input', 'examId must be an exam id.');
      }
      examId = rawExamId;
    }

    // 1. Whose plan is this?
    // - A student: the logged-in full user. A named exam must be theirs.
    // - The question maker (make-questions), calling with the service key and
    //   no user: the owner of the named exam. examId is required then.
    // Check the login before touching the exam, so a stranger cannot learn which exam ids exist.
    const service = isServiceCall(req);
    const user = service ? null : await requireFullUser(req); // throws 401 no login, 403 guest

    let examOwner: string | null = null;
    if (examId) {
      const { data: exam, error: examError } = await db
        .from('exams')
        .select('owner_id')
        .eq('id', examId)
        .maybeSingle();
      if (examError) throw internal('load the exam', examError);
      if (!exam) throw new HttpError(404, 'exam_not_found', 'That exam could not be found.');
      examOwner = exam.owner_id as string;
    }

    let ownerId: string;
    if (!user) {
      if (!examOwner) throw new HttpError(400, 'bad_input', 'A service call must send { "examId": "<exam id>" }.');
      ownerId = examOwner;
    } else {
      if (examOwner && examOwner !== user.id) {
        throw new HttpError(403, 'not_yours', 'That exam belongs to someone else.');
      }
      ownerId = user.id;
    }

    // 2. Settings decide what "today" is for this student.
    const { data: settingsRow, error: settingsError } = await db
      .from('study_settings')
      .select('pace, days_off, session_time, time_zone')
      .eq('user_id', ownerId)
      .maybeSingle();
    if (settingsError) throw internal('load your study settings', settingsError);
    const settings = normalizeSettings(
      settingsRow && {
        pace: settingsRow.pace,
        daysOff: settingsRow.days_off,
        sessionTime: settingsRow.session_time,
        timeZone: settingsRow.time_zone,
      },
    );
    const today = localDateOf(new Date(), settings.timeZone);

    // 3. Everything the engine reads, in one database call, plus busy days.
    const { data: rowsData, error: rowsError } = await db.rpc('schedule_rows', {
      p_owner: ownerId,
      p_today: today,
      p_exam_id: examId,
    });
    if (rowsError) throw internal('load your exams and notes', rowsError);
    const rows = rowsData as ScheduleRows;

    const { data: busyData, error: busyError } = await db
      .from('busy_days')
      .select('from_date, to_date')
      .eq('user_id', ownerId)
      .gte('to_date', today);
    if (busyError) throw internal('load your busy days', busyError);
    const busyRanges = (busyData ?? []).map((b: { from_date: string; to_date: string }) => ({
      fromDate: b.from_date,
      toDate: b.to_date,
    }));

    // 4. Starting difficulty for new topics (AI), then the plan (plain code).
    const rated = await rateTopics(rows);
    const output = buildSchedule(toScheduleInput(rows, today, settings, busyRanges));

    if (rows.exams.length === 0) return json({ sessions: [], warnings: output.warnings, rated });

    // 5. Swap the planned sessions from the start of today, in one transaction.
    const { data: saved, error: saveError } = await db.rpc('replace_planned_sessions', {
      p_owner: ownerId,
      p_exam_ids: rows.exams.map((e) => e.id),
      p_from: zonedToUtcIso(today, '00:00', settings.timeZone),
      p_sessions: toSessionRows(output, settings),
    });
    if (saveError) throw internal('save your plan', saveError);

    // The database function returns sessions in the order it was given them.
    const sessions = (saved as SavedSession[]).map((s, i) => ({
      id: s.id,
      examId: s.exam_id,
      scheduledFor: s.scheduled_for,
      isFinalPass: s.is_final_pass,
      questionIds: s.question_ids,
      topicIds: output.sessions[i].topicIds,
    }));
    return json({ sessions, warnings: output.warnings, rated });
  }),
);
