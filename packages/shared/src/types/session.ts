import type { Id, Timestamp } from './common';

/** Whether the student has played the session yet. */
export const STUDY_SESSION_STATUSES = ['planned', 'done', 'skipped'] as const;
export type StudySessionStatus = (typeof STUDY_SESSION_STATUSES)[number];

/**
 * One short study session (5 to 7 questions) on the plan for one exam. The
 * schedule engine creates these and the server saves them, so the web app and
 * the phone app show the same plan. Reminders on the phone are set from
 * scheduledFor.
 *
 * Table: study_sessions. Visible to and editable by the owner only.
 */
export interface StudySession {
  id: Id;
  ownerId: Id;
  examId: Id;
  /** When the session is due. */
  scheduledFor: Timestamp;
  status: StudySessionStatus;
  /** True for the last session before the exam, which touches every topic once. */
  isFinalPass: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/**
 * Which questions a session asks, in order.
 *
 * Table: session_questions. Same visibility as its session.
 */
export interface SessionQuestion {
  sessionId: Id;
  questionId: Id;
  /** Order inside the session, starting at 0. */
  position: number;
}

/**
 * One answer the student gave while studying alone (a scheduled session or an
 * on-demand review). Written once, never edited.
 *
 * Table: attempts. Visible to the student only.
 */
export interface Attempt {
  id: Id;
  /** The session this answer belongs to. Null for an on-demand review outside the plan. */
  sessionId: Id | null;
  questionId: Id;
  userId: Id;
  /** What the student answered. Null when they skipped or flipped a flashcard without answering. */
  answer: string | null;
  isCorrect: boolean;
  answeredAt: Timestamp;
}
