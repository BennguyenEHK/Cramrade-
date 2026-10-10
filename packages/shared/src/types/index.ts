// The data shapes agreed in task T1. One file per area, all re-exported here.
// Each shape matches one database table in supabase/migrations.
export type { Id, Timestamp, DateOnly } from './common';
export type { Profile } from './profile';
export type { Group, GroupMember, GroupRole } from './group';
export type { Exam, ExamKind, ExamSource, Topic } from './exam';
export type { Note, NoteSource, NoteStatus, Chunk } from './note';
export type { Question, QuestionKind } from './question';
export type { StudySession, StudySessionStatus, SessionQuestion, Attempt } from './session';
export type {
  QuizRoom,
  QuizRoomStatus,
  QuizRoomQuestion,
  QuizPlayer,
  QuizAnswer,
} from './quiz';
export type { CalendarFeed } from './calendar';

// The allowed-value lists behind the union types, for pickers and checks.
// Agreed in T1 (2026-10-10): screens read these instead of typing the values again.
export { EXAM_KINDS, EXAM_SOURCES } from './exam';
export { GROUP_ROLES } from './group';
export { NOTE_SOURCES, NOTE_STATUSES } from './note';
export { QUESTION_KINDS } from './question';
export { QUIZ_ROOM_STATUSES } from './quiz';
export { STUDY_SESSION_STATUSES } from './session';
