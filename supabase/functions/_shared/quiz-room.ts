// What the quiz functions send back about a room, and how a refused answer
// is reported. Pure code, tested with vitest.

import type { QuizMode } from './quiz-input.ts';

/**
 * The room as every quiz function returns it. serverNow is the database
 * clock at the moment of the answer, so a client can work out how far its
 * own clock is off before it shows a countdown.
 */
export interface QuizRoomState {
  id: string;
  code: string;
  title: string;
  hostId: string;
  mode: QuizMode;
  status: 'lobby' | 'running' | 'finished';
  secondsPerQuestion: number;
  resultsSeconds: number;
  /** Position of the current question, from 0. -1 in the lobby. */
  currentQuestionIndex: number;
  questionStartedAt: string | null;
  questionCount: number;
  serverNow: string;
}

/** Input: the JSON built by public.quiz_room_state(): { room, questionCount, serverNow }. */
export function roomState(raw: unknown): QuizRoomState {
  const value = raw as { room?: Record<string, unknown> | null; questionCount?: number; serverNow?: string } | null;
  const room = value?.room;
  if (!value || !room) throw new Error('room not found');
  return {
    id: room.id as string,
    code: room.code as string,
    title: room.title as string,
    hostId: room.host_id as string,
    mode: room.mode as QuizMode,
    status: room.status as QuizRoomState['status'],
    secondsPerQuestion: room.seconds_per_question as number,
    resultsSeconds: room.results_seconds as number,
    currentQuestionIndex: room.current_question_index as number,
    questionStartedAt: (room.question_started_at as string | null) ?? null,
    questionCount: Number(value.questionCount),
    serverNow: value.serverNow as string,
  };
}

/** The outcomes public.submit_quiz_answer() can report. */
export const ANSWER_OUTCOMES = ['ok', 'no_room', 'not_player', 'not_current', 'too_late', 'duplicate'] as const;
export type AnswerOutcome = (typeof ANSWER_OUTCOMES)[number];

/** null means the answer was scored. Anything else is the error to send. */
export function answerOutcomeError(
  outcome: AnswerOutcome,
): { status: number; code: string; message: string } | null {
  switch (outcome) {
    case 'ok':
      return null;
    case 'no_room':
      return { status: 404, code: 'room_not_found', message: 'No quiz room with that id.' };
    case 'not_player':
      return { status: 403, code: 'not_a_player', message: 'Join the room before answering.' };
    case 'not_current':
      return { status: 409, code: 'not_current_question', message: 'That is not the question being asked now.' };
    case 'too_late':
      return { status: 409, code: 'too_late', message: 'Time is up for this question.' };
    case 'duplicate':
      return { status: 409, code: 'already_answered', message: 'You already answered this question.' };
  }
}
