import type { Id, Timestamp } from './common';

/** Where the live quiz is: waiting for players, playing, or over. */
export const QUIZ_ROOM_STATUSES = ['lobby', 'running', 'finished'] as const;
export type QuizRoomStatus = (typeof QUIZ_ROOM_STATUSES)[number];

/** group: a live room with a lobby and a join code. solo: one player, starts at once. */
export const QUIZ_MODES = ['group', 'solo'] as const;
export type QuizMode = (typeof QUIZ_MODES)[number];

/**
 * One live group quiz. The host opens it on the web, players join with the
 * code from a browser or the phone app.
 *
 * The server owns time and score: currentQuestionIndex and questionStartedAt
 * are written only by server code, and every answer is judged against them.
 * The host can only change status (for example to finish early) and delete
 * the room.
 *
 * Table: quiz_rooms. Visible to the host and to the players in it.
 */
export interface QuizRoom {
  id: Id;
  hostId: Id;
  /** The study group whose notes the questions come from, if any. */
  groupId: Id | null;
  title: string;
  /** Short code (6 letters and digits) players type to join. Made by the database. */
  code: string;
  status: QuizRoomStatus;
  /** How long players get for each question. */
  secondsPerQuestion: number;
  /** Group or solo. Set by the server when the room is made. */
  mode: QuizMode;
  /** How long the right answer and scores show before the next question. Default 5. */
  resultsSeconds: number;
  /** Which question is showing: a position in quiz_room_questions. -1 before the quiz starts. */
  currentQuestionIndex: number;
  /** When the current question was sent out, set by the server. Null before the first question. */
  questionStartedAt: Timestamp | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/**
 * Which questions the room asks, in order. Only the host can see this list,
 * so players cannot read ahead. Questions reach players through the live
 * channel, one at a time.
 *
 * Table: quiz_room_questions.
 */
export interface QuizRoomQuestion {
  roomId: Id;
  questionId: Id;
  /** Order inside the quiz, starting at 0. */
  position: number;
}

/**
 * One player in one room. Created by the join_quiz_room() database function.
 * Guests sign in anonymously, so they have a user id too, which is how a
 * player who drops out can rejoin and keep their score.
 *
 * Table: quiz_players. Visible to everyone in the room. Score is written only
 * by server code.
 */
export interface QuizPlayer {
  id: Id;
  roomId: Id;
  /** Null only if the account was deleted after the quiz. */
  userId: Id | null;
  nickname: string;
  score: number;
  joinedAt: Timestamp;
}

/**
 * One player's answer to one question in a live quiz. The player can write
 * roomId, playerId, questionId and answer, and only while that question is the
 * current one. The database stamps answeredAt with its own clock. The server
 * fills in isCorrect and updates the player's score.
 *
 * Table: quiz_answers. A player sees their own answers; the host sees all.
 */
export interface QuizAnswer {
  id: Id;
  roomId: Id;
  playerId: Id;
  questionId: Id;
  answer: string;
  /** Null until the server has scored it. */
  isCorrect: boolean | null;
  /** Points for this answer: 0 when wrong, 500 to 1000 when right, faster is more. Set by the server. */
  points: number;
  answeredAt: Timestamp;
}
