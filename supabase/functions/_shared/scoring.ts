// Quiz scoring (spec 9.2) and answer matching (spec 9.1). Pure code: no Deno
// API, no npm: import, so vitest can test it.
//
// The database has a twin of points() (private.quiz_points in the
// quiz_answer_fn migration), because the score is written in the same SQL
// statement that checks the deadline. Change both together; the number
// table in scoring.test.ts is the one the SQL twin is checked against.

export type QuestionKind = 'multiple_choice' | 'short_answer' | 'flashcard';

/**
 * Kahoot-style points: 1000 at an instant answer, 500 at the last moment,
 * 0 when wrong. msTaken is answered_at minus question_started_at, both
 * database timestamps.
 *
 * Written as 1000 - 500 * ms / allowed, which is the spec's
 * 1000 * (1 - frac / 2) rearranged: the spec form multiplies a rounded
 * fraction and can land on 999.4999... where the database gets 999.5.
 */
export function points(correct: boolean, msTaken: number, msAllowed: number): number {
  if (!(msAllowed > 0)) throw new RangeError('msAllowed must be greater than 0');
  if (!correct) return 0;
  const ms = Math.min(Math.max(msTaken, 0), msAllowed);
  return Math.round(1000 - (500 * ms) / msAllowed);
}

function collapse(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

/**
 * Multiple choice and flashcard: the exact answer text, ignoring only
 * leading and trailing spaces (a tapped choice is sent verbatim).
 * Short answer: typed by hand, so case and runs of spaces do not matter.
 */
export function isCorrectAnswer(kind: QuestionKind, given: string, expected: string): boolean {
  if (given.trim() === '') return false;
  if (kind === 'short_answer') {
    return collapse(given).toLowerCase() === collapse(expected).toLowerCase();
  }
  return given.trim() === expected.trim();
}
