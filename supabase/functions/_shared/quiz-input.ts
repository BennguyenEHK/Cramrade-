// Request body parsing for the quiz functions. Pure code, tested with vitest.
// Every parser returns a message the 400 answer can show, instead of
// throwing, so index.ts stays a few lines long.

/**
 * Copy of QUIZ_MODES in packages/shared/src/types/quiz.ts. Deployed Edge
 * Functions only see the supabase/functions folder, so they cannot import
 * the shared package. quiz-input.test.ts fails if the copies differ.
 */
export const QUIZ_MODES = ['group', 'solo'] as const;
export type QuizMode = (typeof QUIZ_MODES)[number];

export type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };

export type QuizSource = { kind: 'exam'; examId: string } | { kind: 'note'; noteId: string };

export interface CreateInput {
  source: QuizSource;
  count: number;
  secondsPerQuestion: number;
  mode: QuizMode;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isId(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

function intInRange(value: unknown, fallback: number, min: number, max: number): number | null {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) return null;
  return value;
}

function fail(message: string): { ok: false; message: string } {
  return { ok: false, message };
}

export function parseCreateInput(body: unknown): Parsed<CreateInput> {
  if (!isRecord(body)) return fail('body must be a JSON object');
  const source = body.source;
  if (!isRecord(source)) return fail('source must be { examId } or { noteId }');
  const hasExam = source.examId !== undefined;
  const hasNote = source.noteId !== undefined;
  if (hasExam === hasNote) return fail('source must have exactly one of examId or noteId');
  let parsedSource: QuizSource;
  if (hasExam) {
    if (!isId(source.examId)) return fail('source.examId must be a UUID');
    parsedSource = { kind: 'exam', examId: source.examId };
  } else {
    if (!isId(source.noteId)) return fail('source.noteId must be a UUID');
    parsedSource = { kind: 'note', noteId: source.noteId };
  }
  if (!QUIZ_MODES.includes(body.mode as QuizMode)) return fail(`mode must be one of ${QUIZ_MODES.join(', ')}`);
  const count = intInRange(body.count, 10, 1, 50);
  if (count === null) return fail('count must be a whole number from 1 to 50');
  const secondsPerQuestion = intInRange(body.secondsPerQuestion, 20, 5, 300);
  if (secondsPerQuestion === null) return fail('secondsPerQuestion must be a whole number from 5 to 300');
  return { ok: true, value: { source: parsedSource, count, secondsPerQuestion, mode: body.mode as QuizMode } };
}

export function parseRoomInput(body: unknown): Parsed<{ roomId: string }> {
  if (!isRecord(body) || !isId(body.roomId)) return fail('roomId must be a UUID');
  return { ok: true, value: { roomId: body.roomId } };
}

export function parseAnswerInput(
  body: unknown,
): Parsed<{ roomId: string; questionId: string; answer: string }> {
  if (!isRecord(body) || !isId(body.roomId)) return fail('roomId must be a UUID');
  if (!isId(body.questionId)) return fail('questionId must be a UUID');
  const answer = body.answer;
  if (typeof answer !== 'string' || answer.trim() === '') return fail('answer must be non-empty text');
  if (answer.length > 500) return fail('answer must be at most 500 characters');
  return { ok: true, value: { roomId: body.roomId, questionId: body.questionId, answer } };
}

export function parseAdvanceInput(body: unknown): Parsed<{ roomId: string; expectedIndex: number }> {
  if (!isRecord(body) || !isId(body.roomId)) return fail('roomId must be a UUID');
  const expectedIndex = body.expectedIndex;
  if (typeof expectedIndex !== 'number' || !Number.isInteger(expectedIndex) || expectedIndex < 0) {
    return fail('expectedIndex must be a whole number, 0 or more');
  }
  return { ok: true, value: { roomId: body.roomId, expectedIndex } };
}
