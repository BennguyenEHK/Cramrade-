import type { DateOnly, Id } from '../types';
import {
  compareDue,
  compareFinal,
  compareSeen,
  dueGroup,
  hasHistory,
  isDue,
  isSecure,
  takeQuestion,
  topicKey,
  type WorkingChunk,
} from './chunk-state';
import { daysBetween } from './dates';

export const SESSION_MIN = 5;
export const SESSION_MAX = 7;
export const MAX_TOPICS = 3;
/** Rule 5: slots every normal session keeps for never-seen chunks while any remain. */
export const NEW_SLOTS = 2;

/** One session's content. chunks lists each chunk once, in the order first asked. */
export interface PickedSession {
  questionIds: Id[];
  topicIds: Id[];
  chunks: WorkingChunk[];
}

/** The first `max` distinct topics in the order given. */
function firstTopics(chunks: WorkingChunk[], max: number): string[] {
  const keys: string[] = [];
  for (const c of chunks) {
    if (keys.length === max) break;
    if (!keys.includes(topicKey(c))) keys.push(topicKey(c));
  }
  return keys;
}

function topicIdsOf(chunks: WorkingChunk[]): Id[] {
  const ids: Id[] = [];
  for (const c of chunks) if (c.topicId !== null && !ids.includes(c.topicId)) ids.push(c.topicId);
  return ids;
}

/** Brings a session up to 5 with further questions from chunks already in it, one round at a time. */
function topUpWithRepeats(questionIds: Id[], chunks: WorkingChunk[]): void {
  for (let round = 1; questionIds.length < SESSION_MIN; round++) {
    const more = chunks.filter((c) => c.questionIds.length > round);
    if (more.length === 0) return;
    for (const c of more) {
      if (questionIds.length >= SESSION_MIN) return;
      questionIds.push(takeQuestion(c));
    }
  }
}

/**
 * Rule 5: one normal session for one exam on one day, or null when nothing is due.
 *
 * 1. Put the first 2 never-seen chunks (hardest topic first) at the front, so far
 *    exams keep reaching new material; then the other due chunks in rule 5 order
 *    (wrong last time, due again, more new). The session uses the first 3 topics
 *    that appear in that list.
 * 2. Take up to 7 in that order with a per-topic cap, so topics mix. A topic rated
 *    4 or 5 gets one extra slot for a never-seen chunk (rule 4).
 * 3. Fill any room left from the same topics without the cap.
 * 4. Under 5: one secure chunk (least recently seen), then chunks not due yet
 *    (least recently seen), then further questions from chunks already in.
 */
export function pickSession(all: WorkingChunk[], day: DateOnly, examDate: DateOnly): PickedSession | null {
  const daysLeft = daysBetween(day, examDate);
  const due = all.filter((c) => isDue(c.history, day, daysLeft)).sort(compareDue);
  if (due.length === 0) return null;
  const reserved = due.filter((c) => dueGroup(c) === 2).slice(0, NEW_SLOTS);
  const ranked = [...reserved, ...due.filter((c) => !reserved.includes(c))];

  const topics = firstTopics(ranked, MAX_TOPICS);
  const pool = ranked.filter((c) => topics.includes(topicKey(c)));
  const cap = Math.ceil(SESSION_MAX / topics.length);
  const perTopic = new Map<string, number>();
  const chosen: WorkingChunk[] = [];
  for (const c of pool) {
    if (chosen.length === SESSION_MAX) break;
    const n = perTopic.get(topicKey(c)) ?? 0;
    const extra = c.difficulty >= 4 && !hasHistory(c) ? 1 : 0;
    if (n < cap + extra) {
      chosen.push(c);
      perTopic.set(topicKey(c), n + 1);
    }
  }
  for (const c of pool) {
    if (chosen.length === SESSION_MAX) break;
    if (!chosen.includes(c)) chosen.push(c);
  }
  chosen.sort(compareDue);

  const used = new Set<string>(topics);
  const fits = (c: WorkingChunk) => used.has(topicKey(c)) || used.size < MAX_TOPICS;
  const add = (c: WorkingChunk) => {
    chosen.push(c);
    used.add(topicKey(c));
  };
  if (chosen.length < SESSION_MIN) {
    const secure = all.filter((c) => isSecure(c) && fits(c)).sort(compareSeen)[0];
    if (secure) add(secure);
  }
  for (const c of all.filter((c) => !isSecure(c) && !chosen.includes(c)).sort(compareSeen)) {
    if (chosen.length >= SESSION_MIN) break;
    if (fits(c)) add(c);
  }

  const questionIds = chosen.map(takeQuestion);
  topUpWithRepeats(questionIds, chosen);
  return { questionIds, topicIds: topicIdsOf(chosen), chunks: chosen };
}

/**
 * Rule 8: the final pass. One question per chunk, hardest and most missed
 * first, every topic at least once, at most 7. Null when the exam has no
 * chunk with questions.
 */
export function pickFinalPass(all: WorkingChunk[]): PickedSession | null {
  if (all.length === 0) return null;
  const ordered = [...all].sort(compareFinal);
  const chosen: WorkingChunk[] = [];
  const topics = new Set<string>();
  for (const c of ordered) {
    if (chosen.length === SESSION_MAX) break;
    if (!topics.has(topicKey(c))) {
      chosen.push(c);
      topics.add(topicKey(c));
    }
  }
  for (const c of ordered) {
    if (chosen.length === SESSION_MAX) break;
    if (!chosen.includes(c)) chosen.push(c);
  }
  chosen.sort(compareFinal);
  const questionIds = chosen.map(takeQuestion);
  topUpWithRepeats(questionIds, chosen);
  return { questionIds, topicIds: topicIdsOf(chosen), chunks: chosen };
}
