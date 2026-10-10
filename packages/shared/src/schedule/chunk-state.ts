import type { ChunkHistory, DateOnly, Id, ScheduleExam } from '../types';
import { daysBetween } from './dates';
import { gapDays } from './gap';

/** Rule 3: correct recalls in separate sessions after which a chunk is learned. */
export const SECURE_AFTER = 3;

/** A chunk while the plan is being built. The engine's own copy: the input is never changed. */
export interface WorkingChunk {
  id: Id;
  topicId: Id | null;
  questionIds: Id[];
  /** Starts as the real history. Each planned visit is then assumed correct; rule 9 fixes that on the next run. */
  history: ChunkHistory;
  /** The topic's rating, null counted as 3. */
  difficulty: number;
  /** Position in the input list, the last tie-break, which keeps the engine deterministic. */
  index: number;
  /** Questions of this chunk the plan has used so far, for rotation. */
  uses: number;
}

/** Copies the exam's chunks that have at least one question. Chunks with none cannot be studied (see no_questions). */
export function toWorkingChunks(exam: ScheduleExam): WorkingChunk[] {
  const rating = new Map(exam.topics.map((t) => [t.id, t.difficulty ?? 3]));
  return exam.chunks
    .map((c, index) => ({
      id: c.id,
      topicId: c.topicId,
      questionIds: [...c.questionIds],
      history: { ...c.history },
      difficulty: c.topicId === null ? 3 : (rating.get(c.topicId) ?? 3),
      index,
      uses: 0,
    }))
    .filter((c) => c.questionIds.length > 0);
}

/** Chunks with no topic form one group of their own. */
export function topicKey(c: WorkingChunk): string {
  return c.topicId ?? '';
}

/** True once the student has answered anything from this chunk, or the plan has visited it. */
export function hasHistory(c: WorkingChunk): boolean {
  const h = c.history;
  return h.lastSeen !== null || h.lastCorrect !== null || h.correctSessions > 0;
}

/** Rule 3. */
export function isSecure(c: WorkingChunk): boolean {
  return c.history.correctSessions >= SECURE_AFTER;
}

/**
 * Rules 2 and 3: not secure, and never seen, wrong last time, or the gap has
 * passed. daysLeft is the days from `today` to the exam. Takes the plain
 * history so build-schedule can ask the same question about real data.
 */
export function isDue(history: ChunkHistory, today: DateOnly, daysLeft: number): boolean {
  if (history.correctSessions >= SECURE_AFTER) return false;
  if (history.lastSeen === null || history.lastCorrect === false) return true;
  return daysBetween(history.lastSeen, today) >= gapDays(daysLeft);
}

/** Rule 5 groups: 0 wrong last time, 1 seen before and due again, 2 never seen. */
export function dueGroup(c: WorkingChunk): 0 | 1 | 2 {
  if (c.history.lastCorrect === false) return 0;
  return hasHistory(c) ? 1 : 2;
}

/** Least recently seen first, never seen counting as oldest, then input order. */
export function compareSeen(a: WorkingChunk, b: WorkingChunk): number {
  const x = a.history.lastSeen ?? '';
  const y = b.history.lastSeen ?? '';
  if (x !== y) return x < y ? -1 : 1;
  return a.index - b.index;
}

/**
 * Rule 5 order, with rule 4 inside the never-seen group: wrong last time, then
 * due again (oldest first), then never seen (hardest topic first, null as 3).
 */
export function compareDue(a: WorkingChunk, b: WorkingChunk): number {
  const ga = dueGroup(a);
  const gb = dueGroup(b);
  if (ga !== gb) return ga - gb;
  if (ga === 2 && a.difficulty !== b.difficulty) return b.difficulty - a.difficulty;
  return compareSeen(a, b);
}

/** Rule 8 order: wrong last time, then fewest correct sessions, then hardest topic, then input order. */
export function compareFinal(a: WorkingChunk, b: WorkingChunk): number {
  const wa = a.history.lastCorrect === false ? 0 : 1;
  const wb = b.history.lastCorrect === false ? 0 : 1;
  if (wa !== wb) return wa - wb;
  if (a.history.correctSessions !== b.history.correctSessions) {
    return a.history.correctSessions - b.history.correctSessions;
  }
  if (a.difficulty !== b.difficulty) return b.difficulty - a.difficulty;
  return a.index - b.index;
}

/**
 * The chunk's next question. questionIds come least recently asked first, so
 * the first use takes the first id and later uses rotate through the rest.
 */
export function takeQuestion(c: WorkingChunk): Id {
  const id = c.questionIds[c.uses % c.questionIds.length];
  c.uses += 1;
  return id;
}

/** What the plan assumes after a planned visit: answered correctly on that day. */
export function recordVisit(c: WorkingChunk, day: DateOnly): void {
  c.history = { correctSessions: c.history.correctSessions + 1, lastSeen: day, lastCorrect: true };
}

/** Correct sessions still needed before every chunk of the exam is secure. */
export function recallsNeeded(chunks: WorkingChunk[]): number {
  return chunks.reduce((n, c) => n + Math.max(0, SECURE_AFTER - c.history.correctSessions), 0);
}
