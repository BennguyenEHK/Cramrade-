import type { DateOnly, Id } from './common';

/**
 * How much the student wants to study. It caps the number of sessions on one
 * day, across all exams: light 1, normal 2, heavy 3.
 */
export const PACES = ['light', 'normal', 'heavy'] as const;
export type Pace = (typeof PACES)[number];

/** Most sessions on one day, across all exams, for each pace. */
export const SESSIONS_PER_DAY: Record<Pace, number> = { light: 1, normal: 2, heavy: 3 };

/**
 * Things the plan wants the student to know:
 * - exam_past: an exam date has passed, so it gets no sessions.
 * - no_questions: a topic or a piece of notes has no checked questions yet, so it cannot be studied.
 * - load_increased: the material did not fit the normal rhythm, so extra sessions were added.
 * - not_enough_days: some material will not be learned three times before the exam, or no day is free for the final pass.
 */
export const SCHEDULE_WARNING_CODES = ['exam_past', 'no_questions', 'load_increased', 'not_enough_days'] as const;
export type ScheduleWarningCode = (typeof SCHEDULE_WARNING_CODES)[number];

/** One warning, naming the exam so the screen can say which one it is about. */
export interface ScheduleWarning {
  code: ScheduleWarningCode;
  /** The exam the warning is about. Null is allowed for a warning about the whole plan; the engine has none today. */
  examId: Id | null;
  /** Only on no_questions: the chunk that has no questions. Absent when the warning is about a topic or the whole exam. */
  chunkId?: Id;
}

/** What the student has done with one chunk so far. Built by the server from attempts. */
export interface ChunkHistory {
  /** Distinct sessions with at least one correct answer on this chunk. */
  correctSessions: number;
  /** The last day a question from this chunk was answered. Null when never. */
  lastSeen: DateOnly | null;
  /** Whether the most recent answer on this chunk was right. Null when never answered. */
  lastCorrect: boolean | null;
}

/** One chunk of notes as the engine sees it. */
export interface ScheduleChunk {
  id: Id;
  topicId: Id | null;
  /** Checked (verified) questions made from this chunk, least recently asked first. */
  questionIds: Id[];
  history: ChunkHistory;
}

/** One topic of an exam. difficulty is the AI's starting guess, 1 (easy) to 5 (hard), null when not rated. */
export interface ScheduleTopic {
  id: Id;
  difficulty: 1 | 2 | 3 | 4 | 5 | null;
}

/** One upcoming exam with everything the engine needs to plan it. */
export interface ScheduleExam {
  id: Id;
  examDate: DateOnly;
  topics: ScheduleTopic[];
  chunks: ScheduleChunk[];
}

/** Everything buildSchedule needs. The engine reads nothing else, not even the clock. */
export interface ScheduleInput {
  /** The first day that may get a session. */
  today: DateOnly;
  /** All upcoming exams of the student, so the daily cap is shared. */
  exams: ScheduleExam[];
  pace: Pace;
  /** Days with no sessions at all, already expanded from days off and busy ranges. */
  busyDays: DateOnly[];
  /** Sessions already done or skipped. Their exam gets no other session that day, and they count toward the daily cap. */
  keep: { examId: Id; scheduledFor: DateOnly }[];
}

/** One session the engine wants saved. The server turns it into a study_sessions row. */
export interface PlannedSession {
  examId: Id;
  scheduledFor: DateOnly;
  /** 5 to 7 question ids, in the order they are asked. Fewer only when the exam has fewer than 5 questions. */
  questionIds: Id[];
  /** True for the last session before the exam, which touches every topic once. */
  isFinalPass: boolean;
  /** The topics in this session: 1 to 3 for a normal session, every topic (up to 7) for the final pass. */
  topicIds: Id[];
}

/** What buildSchedule returns. */
export interface ScheduleOutput {
  /** Sorted by day, then by exam date. */
  sessions: PlannedSession[];
  /** Each warning at most once, sorted by code (in SCHEDULE_WARNING_CODES order), then exam id, then chunk id. */
  warnings: ScheduleWarning[];
}
