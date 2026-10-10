// Turns database rows into the schedule engine's input, and the engine's
// output back into rows to save. Pure: no Deno APIs and no network, so
// vitest tests it. Every "which day is it" question is answered in the
// student's own time zone, because a session at 18:00 in Hanoi is 11:00 UTC.
import { PACES } from './engine.ts';
import type {
  BusyDay,
  ChunkHistory,
  DateOnly,
  Id,
  ScheduleChunk,
  ScheduleExam,
  ScheduleInput,
  ScheduleOutput,
  ScheduleTopic,
  StudySettings,
} from './engine.ts';

export type ScheduleSettings = Pick<StudySettings, 'pace' | 'daysOff' | 'sessionTime' | 'timeZone'>;
export type BusyRange = Pick<BusyDay, 'fromDate' | 'toDate'>;

export const DEFAULT_SETTINGS: ScheduleSettings = {
  pace: 'normal',
  daysOff: [],
  sessionTime: '18:00',
  timeZone: 'UTC',
};

const DAY_MS = 86_400_000;

/** Days since 1970-01-01 for a YYYY-MM-DD date. Plain integers make ranges easy. */
export function dayNumber(date: DateOnly): number {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / DAY_MS;
}

export function fromDayNumber(n: number): DateOnly {
  return new Date(n * DAY_MS).toISOString().slice(0, 10);
}

export function addDays(date: DateOnly, days: number): DateOnly {
  return fromDayNumber(dayNumber(date) + days);
}

/** 0 = Sunday ... 6 = Saturday, the same numbering as study_settings.days_off. */
export function weekdayOf(date: DateOnly): number {
  return new Date(dayNumber(date) * DAY_MS).getUTCDay();
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

interface WallClock {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
  s: number;
}

/** What a wall clock in `timeZone` shows at this instant. No library: Intl knows every zone. */
function wallClock(instantMs: number, timeZone: string): WallClock {
  const parts: Record<string, string> = {};
  const format = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23', // avoids "24:00" at midnight
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  for (const part of format.formatToParts(new Date(instantMs))) parts[part.type] = part.value;
  return { y: +parts.year, mo: +parts.month, d: +parts.day, h: +parts.hour, mi: +parts.minute, s: +parts.second };
}

export function localDateOf(instant: string | Date, timeZone: string): DateOnly {
  const ms = typeof instant === 'string' ? Date.parse(instant) : instant.getTime();
  const c = wallClock(ms, timeZone);
  return `${c.y}-${String(c.mo).padStart(2, '0')}-${String(c.d).padStart(2, '0')}`;
}

/** How far the zone's wall clock is ahead of UTC at this instant, in ms. */
function offsetMs(utcMs: number, timeZone: string): number {
  const c = wallClock(utcMs, timeZone);
  return Date.UTC(c.y, c.mo - 1, c.d, c.h, c.mi, c.s) - utcMs;
}

/**
 * The UTC instant at which the wall clock in `timeZone` shows `date time`.
 * Two passes, because the offset itself can change on a daylight saving day.
 */
export function zonedToUtcIso(date: DateOnly, time: string, timeZone: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm, ss = 0] = time.split(':').map(Number);
  const wall = Date.UTC(y, m - 1, d, hh, mm, ss);
  let utc = wall - offsetMs(wall, timeZone);
  utc = wall - offsetMs(utc, timeZone);
  return new Date(utc).toISOString();
}

/**
 * Settings as stored, made safe. A bad value never stops the plan: it falls
 * back to the default, because a plan with a default is better than no plan.
 */
export function normalizeSettings(stored: Partial<ScheduleSettings> | null): ScheduleSettings {
  const pace =
    stored?.pace && (PACES as readonly string[]).includes(stored.pace) ? stored.pace : DEFAULT_SETTINGS.pace;
  const daysOff = [...new Set((stored?.daysOff ?? []).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))];
  const sessionTime =
    stored?.sessionTime && /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(stored.sessionTime)
      ? stored.sessionTime
      : DEFAULT_SETTINGS.sessionTime;
  const timeZone =
    stored?.timeZone && isValidTimeZone(stored.timeZone) ? stored.timeZone : DEFAULT_SETTINGS.timeZone;
  return { pace, daysOff, sessionTime, timeZone };
}

// ---- Rows as public.schedule_rows returns them (snake_case, like the tables) ----

export interface ExamRow {
  id: Id;
  title: string;
  exam_date: DateOnly;
}
export interface TopicRow {
  id: Id;
  exam_id: Id;
  title: string;
  position: number;
  difficulty: number | null;
}
export interface ChunkRow {
  id: Id;
  note_id: Id;
  /** The exam of the chunk's note (notes.exam_id). */
  exam_id: Id;
  position: number;
}
/** Verified questions only. */
export interface QuestionRow {
  id: Id;
  chunk_id: Id;
  topic_id: Id | null;
  created_at: string;
}
export interface AttemptRow {
  id: Id;
  question_id: Id;
  session_id: Id | null;
  is_correct: boolean;
  answered_at: string;
}
export interface SessionRow {
  id: Id;
  exam_id: Id;
  scheduled_for: string;
  status: 'planned' | 'done' | 'skipped';
  /** True when the student already answered something in it. */
  has_attempts: boolean;
}
export interface ScheduleRows {
  exams: ExamRow[];
  topics: TopicRow[];
  chunks: ChunkRow[];
  questions: QuestionRow[];
  attempts: AttemptRow[];
  sessions: SessionRow[];
}

/** One planned session in the shape public.replace_planned_sessions takes. */
export interface SessionRowInput {
  exam_id: Id;
  scheduled_for: string;
  is_final_pass: boolean;
  question_ids: Id[];
}

export interface TopicToRate {
  topicId: Id;
  title: string;
  chunkIds: Id[];
}

const cmp = (a: string | number, b: string | number): number => (a < b ? -1 : a > b ? 1 : 0);

function toDifficulty(n: number | null): ScheduleTopic['difficulty'] {
  return n !== null && Number.isInteger(n) && n >= 1 && n <= 5 ? (n as 1 | 2 | 3 | 4 | 5) : null;
}

/** The topic most of the chunk's questions point at, within the exam. Ties: smaller id. */
function majorityTopic(questions: QuestionRow[], examTopics: Set<Id>): Id | null {
  const counts = new Map<Id, number>();
  for (const q of questions) {
    if (q.topic_id && examTopics.has(q.topic_id)) counts.set(q.topic_id, (counts.get(q.topic_id) ?? 0) + 1);
  }
  let best: Id | null = null;
  let bestCount = 0;
  for (const [id, count] of [...counts].sort((a, b) => cmp(a[0], b[0]))) {
    if (count > bestCount) {
      best = id;
      bestCount = count;
    }
  }
  return best;
}

export function toScheduleInput(
  rows: ScheduleRows,
  today: DateOnly,
  settings: ScheduleSettings,
  busyRanges: BusyRange[],
): ScheduleInput {
  const tz = settings.timeZone;

  // Questions grouped by chunk; only chunks we were given.
  const chunkIds = new Set(rows.chunks.map((c) => c.id));
  const questionsByChunk = new Map<Id, QuestionRow[]>();
  const chunkOfQuestion = new Map<Id, Id>();
  for (const q of rows.questions) {
    if (!chunkIds.has(q.chunk_id)) continue;
    chunkOfQuestion.set(q.id, q.chunk_id);
    const list = questionsByChunk.get(q.chunk_id) ?? [];
    list.push(q);
    questionsByChunk.set(q.chunk_id, list);
  }

  // Attempts oldest first, so the last one seen per chunk is the latest.
  const attempts = rows.attempts
    .filter((a) => chunkOfQuestion.has(a.question_id))
    .sort((a, b) => cmp(Date.parse(a.answered_at), Date.parse(b.answered_at)) || cmp(a.id, b.id));

  const lastAskedMs = new Map<Id, number>(); // per question
  const correctKeys = new Map<Id, Set<string>>(); // per chunk
  const latest = new Map<Id, AttemptRow>(); // per chunk
  for (const a of attempts) {
    const chunkId = chunkOfQuestion.get(a.question_id)!;
    lastAskedMs.set(a.question_id, Date.parse(a.answered_at));
    latest.set(chunkId, a);
    if (a.is_correct) {
      // A review outside the plan has no session id; one review day counts as one session.
      const key = a.session_id ?? `review:${localDateOf(a.answered_at, tz)}`;
      const keys = correctKeys.get(chunkId) ?? new Set<string>();
      keys.add(key);
      correctKeys.set(chunkId, keys);
    }
  }

  const historyOf = (chunkId: Id): ChunkHistory => {
    const last = latest.get(chunkId);
    return {
      correctSessions: correctKeys.get(chunkId)?.size ?? 0,
      lastSeen: last ? localDateOf(last.answered_at, tz) : null,
      lastCorrect: last ? last.is_correct : null,
    };
  };

  // Never asked first (oldest made first), then least recently asked.
  const orderQuestions = (questions: QuestionRow[]): Id[] =>
    [...questions]
      .sort((a, b) => {
        const la = lastAskedMs.get(a.id) ?? Number.NEGATIVE_INFINITY;
        const lb = lastAskedMs.get(b.id) ?? Number.NEGATIVE_INFINITY;
        if (la !== lb) return la < lb ? -1 : 1;
        return cmp(Date.parse(a.created_at), Date.parse(b.created_at)) || cmp(a.id, b.id);
      })
      .map((q) => q.id);

  const exams: ScheduleExam[] = [...rows.exams]
    .sort((a, b) => cmp(a.exam_date, b.exam_date) || cmp(a.id, b.id))
    .map((exam) => {
      const topicRows = rows.topics
        .filter((t) => t.exam_id === exam.id)
        .sort((a, b) => a.position - b.position || cmp(a.id, b.id));
      const examTopics = new Set(topicRows.map((t) => t.id));
      const topics: ScheduleTopic[] = topicRows.map((t) => ({ id: t.id, difficulty: toDifficulty(t.difficulty) }));
      const chunks: ScheduleChunk[] = rows.chunks
        .filter((c) => c.exam_id === exam.id)
        .sort((a, b) => cmp(a.note_id, b.note_id) || a.position - b.position || cmp(a.id, b.id))
        .map((c) => {
          const questions = questionsByChunk.get(c.id) ?? [];
          return {
            id: c.id,
            topicId: majorityTopic(questions, examTopics),
            questionIds: orderQuestions(questions),
            history: historyOf(c.id),
          };
        });
      return { id: exam.id, examDate: exam.exam_date, topics, chunks };
    });

  // Busy days between today and the latest exam.
  const start = dayNumber(today);
  const end = rows.exams.reduce((max, e) => Math.max(max, dayNumber(e.exam_date)), start);
  const off = new Set(settings.daysOff);
  const busy = new Set<DateOnly>();
  for (let n = start; n <= end; n++) {
    const date = fromDayNumber(n);
    if (off.has(weekdayOf(date))) busy.add(date);
  }
  for (const range of busyRanges) {
    const from = Math.max(dayNumber(range.fromDate), start);
    const to = Math.min(dayNumber(range.toDate), end);
    for (let n = from; n <= to; n++) busy.add(fromDayNumber(n)); // a backwards range adds nothing
  }

  // Days already taken by sessions the student finished, skipped or started.
  const examIds = new Set(rows.exams.map((e) => e.id));
  const keep = rows.sessions
    .filter((s) => examIds.has(s.exam_id) && (s.status !== 'planned' || s.has_attempts))
    .map((s) => ({ examId: s.exam_id, scheduledFor: localDateOf(s.scheduled_for, tz) }))
    .filter((k) => k.scheduledFor >= today)
    .sort((a, b) => cmp(a.scheduledFor, b.scheduledFor) || cmp(a.examId, b.examId));

  return { today, exams, pace: settings.pace, busyDays: [...busy].sort(), keep };
}

export function toSessionRows(output: ScheduleOutput, settings: ScheduleSettings): SessionRowInput[] {
  return output.sessions.map((s) => ({
    exam_id: s.examId,
    scheduled_for: zonedToUtcIso(s.scheduledFor, settings.sessionTime, settings.timeZone),
    is_final_pass: s.isFinalPass,
    question_ids: [...s.questionIds],
  }));
}

/**
 * Topics with no difficulty yet that have at least one verified question,
 * closest exam first. A topic reaches its chunks only through questions.topic_id.
 */
export function topicsToRate(rows: ScheduleRows, limit = 10): TopicToRate[] {
  const examDate = new Map(rows.exams.map((e) => [e.id, e.exam_date]));
  const chunksByTopic = new Map<Id, Set<Id>>();
  for (const q of rows.questions) {
    if (!q.topic_id) continue;
    const set = chunksByTopic.get(q.topic_id) ?? new Set<Id>();
    set.add(q.chunk_id);
    chunksByTopic.set(q.topic_id, set);
  }
  return rows.topics
    .filter((t) => t.difficulty === null && chunksByTopic.has(t.id))
    .sort(
      (a, b) =>
        cmp(examDate.get(a.exam_id) ?? '', examDate.get(b.exam_id) ?? '') ||
        a.position - b.position ||
        cmp(a.id, b.id),
    )
    .slice(0, limit)
    .map((t) => ({ topicId: t.id, title: t.title, chunkIds: [...chunksByTopic.get(t.id)!].sort().slice(0, 3) }));
}

/** The AI's answer, checked. Anything but a whole number 1 to 5 is thrown away. */
export function parseDifficulty(answer: unknown): 1 | 2 | 3 | 4 | 5 | null {
  if (typeof answer !== 'object' || answer === null) return null;
  const value = (answer as { difficulty?: unknown }).difficulty;
  return typeof value === 'number' ? toDifficulty(value) : null;
}
