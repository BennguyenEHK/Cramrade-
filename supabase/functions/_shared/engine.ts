// The one place that says where the schedule engine comes from.
// Path B: a generated copy of packages/shared/src (see scripts/sync-engine.mjs).
// Never edit _shared/schedule by hand; change packages/shared and run
// `npm run sync-engine`.
export { buildSchedule, PACES } from './schedule/index.ts';
export type {
  BusyDay,
  ChunkHistory,
  DateOnly,
  Id,
  Pace,
  PlannedSession,
  ScheduleChunk,
  ScheduleExam,
  ScheduleInput,
  ScheduleOutput,
  ScheduleTopic,
  ScheduleWarning,
  ScheduleWarningCode,
  StudySettings,
} from './schedule/index.ts';
