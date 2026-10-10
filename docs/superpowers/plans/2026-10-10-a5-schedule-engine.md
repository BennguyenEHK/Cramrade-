# A5 Schedule Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the schedule engine in `packages/shared`: one pure function, `buildSchedule(input)`, that turns exams, notes, answers and the student's free days into planned study sessions, following rules 1 to 11 of the spec.

**Architecture:** Plain TypeScript with no network, no clock and no randomness. Small single-purpose files under `packages/shared/src/schedule/`: date helpers, the gap formula, chunk state (due, secure, ordering), picking one session's questions, placing sessions on days, and `build.ts` which walks the days and ties it together. Types live in `packages/shared/src/types/schedule.ts`. Tests use vitest with a small fixture builder.

**Tech Stack:** TypeScript 6 (strict), vitest 5, npm workspaces.

**Spec:** `docs/superpowers/specs/2026-10-10-server-side-design.md`, sections 6.1 to 6.3 and section 13 "Engine". Read both before starting. This plan does NOT build the `build-schedule` Edge Function (spec 6.4) or the migration (spec 11).

## Global Constraints

- Shared names fixed across all server plans, used verbatim: `buildSchedule(input: ScheduleInput): ScheduleOutput`, `gapDays(daysLeft)`, `isDue(history, today, daysLeft)`, and the types `ScheduleInput`, `ScheduleOutput`, `ScheduleExam`, `ScheduleChunk`, `ScheduleTopic`, `ChunkHistory`, `PlannedSession`, `ScheduleWarning`, `ScheduleWarningCode`, `SCHEDULE_WARNING_CODES`, `Pace`, `PACES`. `Pace` and `PACES` are owned by this plan; the foundation plan's `settings.ts` imports `Pace` from `'./schedule'`.
- Relative imports stay extensionless (`'./dates'`, `'../types'`), like the rest of `packages/shared`. The build-schedule plan handles Deno's import rules on its side.
- Do not install Deno or any global tool. Keep downloads on D:.
- Branch: `a5-schedule-engine`, made from `main`. Never push to `main`. One pull request, reviewed by Dev B.
- "The schedule is plain code, never AI." The engine is a deterministic function with unit tests (spec rule 11: "Same input, same output, no randomness, no clock reads inside the engine. `today` is an input.").
- `packages/shared` holds "no screen code and no network code, so it can be tested alone". No new dependencies in `packages/shared`.
- Types as spec 6.2, with one agreed change: `ScheduleWarning` is an object `{ code: ScheduleWarningCode; examId: Id | null; chunkId?: Id }`, and `ScheduleWarningCode` is derived from `SCHEDULE_WARNING_CODES = ['exam_past','no_questions','load_increased','not_enough_days'] as const`. `Pace` comes from `PACES = ['light','normal','heavy'] as const`. Pace cap: light 1, normal 2, heavy 3 sessions per day across all exams.
- T1 rule (packages/shared/README.md): allowed-value lists are exported constants next to each type, and the type is derived from the list. Any change to `src/types/` needs a yes from both developers. The pull request must say so and ask Dev B to approve the new types.
- Field names are camelCase in TypeScript (`examDate`) and snake_case in the database (`exam_date`), as agreed in T1. The engine only sees camelCase; mapping rows is build-schedule's job.
- Dates are `DateOnly` strings `"YYYY-MM-DD"`, read as midnight UTC.
- Sessions hold 5 to 7 questions (`SESSION_MIN = 5`, `SESSION_MAX = 7`), from at most 3 topics (`MAX_TOPICS = 3`) of one exam.
- A chunk is secure after 3 correct sessions (`SECURE_AFTER = 3`).
- `gapDays(daysLeft) = daysLeft <= 7 ? 1 : clamp(round(daysLeft * 0.2), 1, 14)`.
- Team documents use plain words a non-expert can follow, with tasks as lists rather than tables.
- Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Stage only the files each step names. `docs/` and `founder/` are untracked on `main` and are not part of this branch.

## Decisions this plan makes where the spec is open

These are written into the code and the README. The pull request lists them so Dev A and Dev B can disagree before merge.

1. **The plan assumes planned questions are answered correctly.** After placing a chunk in a session, the engine counts it as one more correct session on that day. That is how later sessions are planned and how a chunk leaves the plan after 3. When the student actually gets it wrong, the next `build-schedule` run (rule 9) brings it back.
2. **"Sessions every gapDays from today" and "add sessions on free days" (rule 7).** Each exam has a next on-rhythm day, starting today. On that day or later, the exam gets a session if the day is free and something is due, and the next on-rhythm day becomes `day + gapDays(daysLeft)`. If the day is not free (busy, kept, or full), the exam tries again the next day. On an off-rhythm day the exam gets an extra session only when it is behind: the correct recalls still needed (3 minus correct sessions, summed over chunks) exceed 6 times the on-rhythm days left. Any extra session adds the warning `load_increased`.
3. **Daily cap across exams (rule 6).** Exams are sorted by exam date, then by id. Final passes are booked first, closest exam first. Then the engine walks day by day from today, and on each day offers the slot to exams in that order, so the closer exam wins and the other one moves to its next free day.
4. **Kept sessions (`keep`).** A kept session blocks its own exam for that day and counts toward the daily cap. Kept sessions before today are ignored. Other exams may still use the day if the cap allows.
5. **Final pass day.** The latest free day before the exam: the day before, or earlier when that day is busy, kept or full. No free day at all adds `not_enough_days`. Normal sessions stop before the final pass day. The final pass may touch more than 3 topics (it touches every topic once, up to 7 questions).
6. **Topping up a short session.** Rule 5 allows one question from a secure chunk only to reach 5. If the session is still under 5, chunks not due yet (least recently seen) fill in, then further questions from chunks already in the session. A session has fewer than 5 questions only when the exam has fewer than 5 questions in total.
7. **Least recently asked question.** The engine has no per-question history in its input, so `ScheduleChunk.questionIds` must be ordered least recently asked first by the caller (`build-schedule`). The engine takes the first one and rotates through the rest when a chunk comes back within one plan.
8. **Warnings** name the exam they are about (`examId`), so the screen can say which exam. Each one appears once. They are sorted by code in `SCHEDULE_WARNING_CODES` order, then by exam id, then by chunk id. `examId` is never null today; null is kept in the type for a future whole-plan warning.
   - `exam_past`: that exam's date is before today.
   - `no_questions`: one warning with `chunkId` for each chunk that has no questions. One more without `chunkId` when the exam has no chunks at all or a topic has no chunk with questions.
   - `load_increased`: at least one extra off-rhythm session was added for that exam.
   - `not_enough_days`: no free day for that exam's final pass, or some of its chunks are still not secure when its normal sessions end. This includes an exam tomorrow or today.
9. **Chunks with no topic** form one group of their own for mixing, and never appear in `topicIds`. A chunk whose topic is missing from the exam's topic list counts as difficulty 3.
10. **Bad dates throw.** Every date in the input is checked first. A date that is not a real `YYYY-MM-DD` day throws an error naming it, instead of planning around it.

Rule 5 reserves 2 slots in every normal session for never-seen chunks, hardest topic first, shrinking to what exists when fewer remain. Without that, a far exam would repeat its first chunks for weeks before reaching later ones. Three tests pin this: the two reserve tests in `pick.test.ts` and "far exam: new material keeps arriving" in `build.test.ts`.

## Review Focus

1. **Two exams on the same day.** Both must be planned with their own final pass; with pace light the second final pass must move one day earlier, not vanish. Test in Task 6.
2. **Chunks with no topic** (notes not linked to a topic). They must still be planned and must never put `null` into `topicIds`. Test in Task 6.
3. **A chunk pointing at a topic that is not in the exam's list** (topic deleted). It must count as difficulty 3, not crash. Test in Task 3.
4. **An exam a year away.** The walk must stay fast, sessions must be sparse (14-day gaps) and a final pass must still be present. Test in Task 6.
5. **A malformed date from the server** (`"2026-11-2"`, `"2026-13-01"`). Dates are compared as text, so a bad one would silently produce a wrong plan; the engine must throw instead. Test in Task 6.

## File map

- Create `vitest.config.mts` (repo root): one test run for `packages/shared` and, later, `supabase/functions/_shared`.
- Modify `package.json` (repo root): `test` runs vitest from the root; vitest becomes a root dev dependency.
- Create `packages/shared/src/types/schedule.ts`: the engine's input and output types, `PACES`, `SESSIONS_PER_DAY`, `SCHEDULE_WARNING_CODES`.
- Modify `packages/shared/src/types/index.ts`: re-export them.
- Create `packages/shared/src/schedule/dates.ts`: `dayToMs`, `isoDate`, `addDays`, `daysBetween`.
- Create `packages/shared/src/schedule/gap.ts`: `gapDays`.
- Create `packages/shared/src/schedule/chunk-state.ts`: the engine's working copy of a chunk; due, secure, ordering, question rotation.
- Create `packages/shared/src/schedule/fixtures.ts`: test builders and the invariant check. Test-only, not exported.
- Create `packages/shared/src/schedule/pick.ts`: one normal session's questions, and the final pass.
- Create `packages/shared/src/schedule/place.ts`: the calendar (busy days, kept sessions, daily cap), final pass booking, rhythm counting.
- Create `packages/shared/src/schedule/warnings.ts`: collects warnings once each and sorts them.
- Create `packages/shared/src/schedule/build.ts`: `buildSchedule`, the single entry point.
- Create `packages/shared/src/schedule/index.ts`: public exports of the engine.
- Modify `packages/shared/src/index.ts`: `export * from './schedule'`.
- Tests: `dates.test.ts`, `gap.test.ts`, `chunk-state.test.ts`, `pick.test.ts`, `place.test.ts`, `build.test.ts` next to the code.
- Modify `packages/shared/README.md`: a "Schedule engine" section.

---

### Task 1: Branch, root test setup and the schedule types

**Files:**
- Create: `vitest.config.mts`
- Modify: `package.json` (root)
- Create: `packages/shared/src/types/schedule.ts`
- Modify: `packages/shared/src/types/index.ts`

**Interfaces:**
- Consumes: `DateOnly`, `Id` from `packages/shared/src/types/common.ts`.
- Produces: types `Pace`, `ScheduleWarning` (`{ code: ScheduleWarningCode; examId: Id | null; chunkId?: Id }`), `ScheduleWarningCode`, `ChunkHistory`, `ScheduleChunk`, `ScheduleTopic`, `ScheduleExam`, `ScheduleInput`, `PlannedSession`, `ScheduleOutput`; constants `PACES`, `SESSIONS_PER_DAY: Record<Pace, number>`, `SCHEDULE_WARNING_CODES`. All importable from `'../types'` inside the package.

- [ ] **Step 1: Make the branch**

```bash
git checkout main
git pull
git checkout -b a5-schedule-engine
```

- [ ] **Step 2: Add the root vitest config**

Create `vitest.config.mts`. This is the agreed layout for every server plan: this file, with exactly this include list, and the root `test` script `vitest run`. The `.mts` ending matters: the root `package.json` has no `"type": "module"`, and a `.ts` config makes Vite print a CommonJS warning.

```ts
import { defineConfig } from 'vitest/config';

// One test run for the whole repo: the shared package and the pure server code.
export default defineConfig({
  test: {
    include: ['packages/shared/src/**/*.test.ts', 'supabase/functions/_shared/**/*.test.ts'],
    passWithNoTests: true,
  },
});
```

- [ ] **Step 3: Run tests from the root**

Install vitest as a root dev dependency, the same version the shared package uses:

```bash
npm install --save-dev vitest@^5.0.3
```

Then in the root `package.json`, change the `test` script from `"npm test -w @cramrade/shared"` to:

```json
    "test": "vitest run",
```

Leave the `test` script in `packages/shared/package.json` as it is.

- [ ] **Step 4: Write the types**

Create `packages/shared/src/types/schedule.ts`:

```ts
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
```

- [ ] **Step 5: Re-export the types**

In `packages/shared/src/types/index.ts`, add after the line `export type { CalendarFeed } from './calendar';`:

```ts
export type {
  Pace,
  ScheduleWarning,
  ScheduleWarningCode,
  ChunkHistory,
  ScheduleChunk,
  ScheduleTopic,
  ScheduleExam,
  ScheduleInput,
  PlannedSession,
  ScheduleOutput,
} from './schedule';
```

and add as the last line of the file:

```ts
export { PACES, SESSIONS_PER_DAY, SCHEDULE_WARNING_CODES } from './schedule';
```

- [ ] **Step 6: Check it**

Run: `npm run typecheck`
Expected: no errors. (On a fresh clone this fails until `npm run web` has run once; see CLAUDE.md.)

Run: `npm test`
Expected: vitest starts from the root, finds no test files and exits 0 ("No test files found" is fine because of `passWithNoTests`).

- [ ] **Step 7: Commit**

```bash
git add vitest.config.mts package.json package-lock.json packages/shared/src/types/schedule.ts packages/shared/src/types/index.ts
git commit -m "A5: schedule engine types and root vitest config

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Date helpers

**Files:**
- Create: `packages/shared/src/schedule/dates.ts`
- Test: `packages/shared/src/schedule/dates.test.ts`

**Interfaces:**
- Consumes: `DateOnly` from `'../types'`.
- Produces: `dayToMs(day: DateOnly): number` (throws on a bad date, message contains the date), `isoDate(ms: number): DateOnly`, `addDays(day: DateOnly, n: number): DateOnly`, `daysBetween(from: DateOnly, to: DateOnly): number` (to minus from).

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/schedule/dates.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { addDays, dayToMs, daysBetween, isoDate } from './dates';

describe('dates', () => {
  it('adds days across month, year and leap day', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-11-02', -2)).toBe('2026-10-31');
  });

  it('ignores daylight saving changes', () => {
    expect(addDays('2026-03-28', 1)).toBe('2026-03-29');
    expect(addDays('2026-10-24', 1)).toBe('2026-10-25');
    expect(daysBetween('2026-03-01', '2026-04-01')).toBe(31);
  });

  it('counts whole days, negative when going back', () => {
    expect(daysBetween('2026-11-02', '2026-11-03')).toBe(1);
    expect(daysBetween('2026-11-02', '2026-11-02')).toBe(0);
    expect(daysBetween('2026-11-03', '2026-11-02')).toBe(-1);
  });

  it('round-trips through milliseconds', () => {
    expect(isoDate(dayToMs('2026-11-02'))).toBe('2026-11-02');
  });

  it('refuses text that is not a real YYYY-MM-DD date', () => {
    expect(() => dayToMs('2026-02-30')).toThrow();
    expect(() => dayToMs('2026-11-2')).toThrow();
    expect(() => dayToMs('2026-11-02T00:00:00Z')).toThrow();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run packages/shared/src/schedule/dates.test.ts`
Expected: FAIL, cannot resolve `./dates`.

- [ ] **Step 3: Write the helpers**

Create `packages/shared/src/schedule/dates.ts`:

```ts
import type { DateOnly } from '../types';

// Dates are "YYYY-MM-DD" strings, read as midnight UTC, so the engine gives the
// same answer in every time zone and across daylight saving changes.
// Two such strings also compare correctly with < and >.

const DAY_MS = 86_400_000;
const PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** "YYYY-MM-DD" to milliseconds at midnight UTC. Throws on anything else, including 2026-02-30. */
export function dayToMs(day: DateOnly): number {
  const match = PATTERN.exec(day);
  if (!match) throw new Error(`Not a YYYY-MM-DD date: ${day}`);
  const ms = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (isoDate(ms) !== day) throw new Error(`Not a real calendar date: ${day}`);
  return ms;
}

/** Milliseconds to "YYYY-MM-DD", read in UTC. */
export function isoDate(ms: number): DateOnly {
  return new Date(ms).toISOString().slice(0, 10);
}

/** The day `n` days after `day` (before it when n is negative). */
export function addDays(day: DateOnly, n: number): DateOnly {
  return isoDate(dayToMs(day) + n * DAY_MS);
}

/** Whole days from `from` to `to`: 1 when `to` is the next day, negative when `to` is earlier. */
export function daysBetween(from: DateOnly, to: DateOnly): number {
  return Math.round((dayToMs(to) - dayToMs(from)) / DAY_MS);
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `npx vitest run packages/shared/src/schedule/dates.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/schedule/dates.ts packages/shared/src/schedule/dates.test.ts
git commit -m "A5: date helpers on YYYY-MM-DD strings, read as UTC

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Gap formula, chunk state and the test fixtures

**Files:**
- Create: `packages/shared/src/schedule/gap.ts`
- Create: `packages/shared/src/schedule/chunk-state.ts`
- Create: `packages/shared/src/schedule/fixtures.ts`
- Test: `packages/shared/src/schedule/gap.test.ts`, `packages/shared/src/schedule/chunk-state.test.ts`

**Interfaces:**
- Consumes: `daysBetween`, `addDays` (Task 2); the types and `SESSIONS_PER_DAY` (Task 1).
- Produces:
  - `gapDays(daysLeft: number): number`
  - `SECURE_AFTER = 3`
  - `interface WorkingChunk { id; topicId: Id | null; questionIds: Id[]; history: ChunkHistory; difficulty: number; index: number; uses: number }`
  - `toWorkingChunks(exam: ScheduleExam): WorkingChunk[]` (copies, drops chunks with no questions)
  - `topicKey(c): string`, `hasHistory(c): boolean`, `isSecure(c): boolean`, `dueGroup(c): 0 | 1 | 2`
  - `isDue(history: ChunkHistory, today: DateOnly, daysLeft: number): boolean`. This signature is shared with the other server plans and must not change. `daysLeft` is the days from `today` to the exam.
  - comparators `compareSeen`, `compareDue`, `compareFinal` of type `(a: WorkingChunk, b: WorkingChunk) => number`
  - `takeQuestion(c): Id` (rotates, mutates `c.uses`), `recordVisit(c, day): void`, `recallsNeeded(chunks): number`
  - fixtures: `TODAY = '2026-11-02'`, `day(n)`, `chunk(id, topicId, options?)`, `topic(id, difficulty?)`, `exam(id, examDate, topics = 3, perTopic = 2)`, `input(overrides)`, `working(exam)`, `daysOf(out, examId)`, `chunksIn(session)`, `assertInvariants(input, output)`

- [ ] **Step 1: Write the fixture builder**

Create `packages/shared/src/schedule/fixtures.ts`. It is test-only and is never exported from `index.ts`. Question ids are `"<chunkId>-q1"`, `"<chunkId>-q2"`, ..., which is how `chunksIn` reads chunk ids back from a session.

```ts
// Small builders for schedule tests, so each test shows only what matters to it.
// Test-only: not exported from index.ts.
import type {
  ChunkHistory,
  DateOnly,
  PlannedSession,
  ScheduleChunk,
  ScheduleExam,
  ScheduleInput,
  ScheduleOutput,
  ScheduleTopic,
} from '../types';
import { SESSIONS_PER_DAY } from '../types';
import { toWorkingChunks, type WorkingChunk } from './chunk-state';
import { addDays } from './dates';

/** A fixed Monday, so tests never depend on the real date. */
export const TODAY: DateOnly = '2026-11-02';

/** The day `n` days after TODAY. */
export const day = (n: number): DateOnly => addDays(TODAY, n);

/** A chunk with `questions` questions named "<id>-q1", "<id>-q2", ..., and no history unless given. */
export function chunk(
  id: string,
  topicId: string | null,
  options: Partial<ChunkHistory> & { questions?: number } = {},
): ScheduleChunk {
  const { questions = 3, ...history } = options;
  return {
    id,
    topicId,
    questionIds: Array.from({ length: questions }, (_, i) => `${id}-q${i + 1}`),
    history: { correctSessions: 0, lastSeen: null, lastCorrect: null, ...history },
  };
}

export function topic(id: string, difficulty: ScheduleTopic['difficulty'] = null): ScheduleTopic {
  return { id, difficulty };
}

/**
 * An exam with `topics` topics ("<id>-t1", ...) and `perTopic` fresh chunks
 * each ("<id>-t1-c1", ...), every chunk with 3 questions.
 */
export function exam(id: string, examDate: DateOnly, topics = 3, perTopic = 2): ScheduleExam {
  const topicList = Array.from({ length: topics }, (_, i) => topic(`${id}-t${i + 1}`));
  const chunks = topicList.flatMap((t) =>
    Array.from({ length: perTopic }, (_, j) => chunk(`${t.id}-c${j + 1}`, t.id)),
  );
  return { id, examDate, topics: topicList, chunks };
}

/** A full input with pace normal, no busy days and nothing kept, unless overridden. */
export function input(overrides: Partial<ScheduleInput> & Pick<ScheduleInput, 'exams'>): ScheduleInput {
  return { today: TODAY, pace: 'normal', busyDays: [], keep: [], ...overrides };
}

/** Working chunks of an exam, for testing pick.ts and chunk-state.ts directly. */
export function working(e: ScheduleExam): WorkingChunk[] {
  return toWorkingChunks(e);
}

/** The days that have a session for one exam, in order. */
export function daysOf(out: ScheduleOutput, examId: string): DateOnly[] {
  return out.sessions.filter((s) => s.examId === examId).map((s) => s.scheduledFor);
}

/** Every chunk id a session touches, read back from the "<chunk>-qN" question ids. */
export function chunksIn(session: PlannedSession): string[] {
  return [...new Set(session.questionIds.map((q) => q.replace(/-q\d+$/, '')))];
}

/**
 * Rules that must hold for every output. Throws with a readable message on the
 * first one broken, so a scenario test can call it after its own checks.
 */
export function assertInvariants(inp: ScheduleInput, out: ScheduleOutput): void {
  const cap = SESSIONS_PER_DAY[inp.pace];
  const examDate = new Map(inp.exams.map((e) => [e.id, e.examDate]));
  const perDay = new Map<DateOnly, number>();
  const examDay = new Set<string>();
  for (const k of inp.keep) {
    if (k.scheduledFor < inp.today) continue;
    perDay.set(k.scheduledFor, (perDay.get(k.scheduledFor) ?? 0) + 1);
    examDay.add(`${k.examId}|${k.scheduledFor}`);
  }
  let previous = '';
  for (const s of out.sessions) {
    const where = `${s.examId} on ${s.scheduledFor}`;
    if (s.scheduledFor < previous) throw new Error(`sessions not sorted by day at ${where}`);
    previous = s.scheduledFor;
    if (s.scheduledFor < inp.today) throw new Error(`session before today: ${where}`);
    if (s.scheduledFor >= examDate.get(s.examId)!) throw new Error(`session on or after the exam: ${where}`);
    if (inp.busyDays.includes(s.scheduledFor)) throw new Error(`session on a busy day: ${where}`);
    const key = `${s.examId}|${s.scheduledFor}`;
    if (examDay.has(key)) throw new Error(`two sessions for one exam on one day: ${where}`);
    examDay.add(key);
    const load = (perDay.get(s.scheduledFor) ?? 0) + 1;
    if (load > cap) throw new Error(`more than ${cap} sessions on ${s.scheduledFor}`);
    perDay.set(s.scheduledFor, load);
    if (s.questionIds.length < 1 || s.questionIds.length > 7) throw new Error(`${s.questionIds.length} questions: ${where}`);
    if (!s.isFinalPass && s.topicIds.length > 3) throw new Error(`more than 3 topics: ${where}`);
    if (new Set(s.questionIds).size !== s.questionIds.length) throw new Error(`a question twice in one session: ${where}`);
  }
}
```

- [ ] **Step 2: Write the failing tests**

Create `packages/shared/src/schedule/gap.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { gapDays } from './gap';

describe('gapDays (rule 2)', () => {
  it('is 1 day in the last week', () => {
    for (const left of [0, 1, 3, 7]) expect(gapDays(left)).toBe(1);
  });

  it('is about a fifth of the days left after that', () => {
    expect(gapDays(8)).toBe(2);
    expect(gapDays(14)).toBe(3);
    expect(gapDays(30)).toBe(6);
    expect(gapDays(60)).toBe(12);
  });

  it('never goes above 14 days', () => {
    expect(gapDays(70)).toBe(14);
    expect(gapDays(90)).toBe(14);
    expect(gapDays(365)).toBe(14);
  });
});
```

Create `packages/shared/src/schedule/chunk-state.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { compareDue, isDue, isSecure, recordVisit, takeQuestion } from './chunk-state';
import { chunk, day, topic, working } from './fixtures';

/** Working chunks for one exam on day(30) with the given topics and chunks. */
function chunks(topics = [topic('t1')], list = [chunk('c1', 't1')]) {
  return working({ id: 'e', examDate: day(30), topics, chunks: list });
}

describe('isDue (rules 2 and 3)', () => {
  // The exam is on day(30), so from day(0) there are 30 days left.

  it('is due when never seen', () => {
    const [c] = chunks();
    expect(isDue(c.history, day(0), 30)).toBe(true);
  });

  it('is due when the last answer was wrong, even if seen yesterday', () => {
    const [c] = chunks(undefined, [chunk('c1', 't1', { correctSessions: 1, lastSeen: day(-1), lastCorrect: false })]);
    expect(isDue(c.history, day(0), 30)).toBe(true);
  });

  it('waits gapDays after a correct answer', () => {
    // 30 days left: gap is 6.
    const [c] = chunks(undefined, [chunk('c1', 't1', { correctSessions: 1, lastSeen: day(-5), lastCorrect: true })]);
    expect(isDue(c.history, day(0), 30)).toBe(false);
    expect(isDue(c.history, day(1), 29)).toBe(true);
  });

  it('is never due once secure (3 correct sessions)', () => {
    const [c] = chunks(undefined, [chunk('c1', 't1', { correctSessions: 3, lastSeen: day(-60), lastCorrect: true })]);
    expect(isSecure(c)).toBe(true);
    expect(isDue(c.history, day(0), 30)).toBe(false);
  });
});

describe('compareDue (rules 4 and 5)', () => {
  it('orders wrong last time, then due again, then never seen', () => {
    const list = chunks(
      [topic('t1')],
      [
        chunk('new', 't1'),
        chunk('again', 't1', { correctSessions: 1, lastSeen: day(-20), lastCorrect: true }),
        chunk('wrong', 't1', { correctSessions: 1, lastSeen: day(-1), lastCorrect: false }),
      ],
    );
    expect(list.sort(compareDue).map((c) => c.id)).toEqual(['wrong', 'again', 'new']);
  });

  it('puts never-seen chunks of hard topics first and easy last, null as 3', () => {
    const list = chunks(
      [topic('easy', 1), topic('unrated', null), topic('hard', 5), topic('mid', 3)],
      [chunk('e1', 'easy'), chunk('u1', 'unrated'), chunk('h1', 'hard'), chunk('m1', 'mid')],
    );
    expect(list.sort(compareDue).map((c) => c.id)).toEqual(['h1', 'u1', 'm1', 'e1']);
  });

  it('counts a chunk whose topic is not in the exam as difficulty 3', () => {
    const list = chunks([topic('hard', 5), topic('easy', 1)], [chunk('e1', 'easy'), chunk('x1', 'gone'), chunk('h1', 'hard')]);
    expect(list.sort(compareDue).map((c) => c.id)).toEqual(['h1', 'x1', 'e1']);
  });

  it('ignores the rating once a chunk has history', () => {
    const list = chunks(
      [topic('easy', 1), topic('hard', 5)],
      [chunk('h1', 'hard'), chunk('e1', 'easy', { correctSessions: 1, lastSeen: day(-20), lastCorrect: true })],
    );
    expect(list.sort(compareDue).map((c) => c.id)).toEqual(['e1', 'h1']);
  });
});

describe('takeQuestion and recordVisit', () => {
  it('starts with the least recently asked question and rotates', () => {
    const [c] = chunks(undefined, [chunk('c1', 't1', { questions: 2 })]);
    expect([takeQuestion(c), takeQuestion(c), takeQuestion(c)]).toEqual(['c1-q1', 'c1-q2', 'c1-q1']);
  });

  it('assumes a planned visit is answered correctly', () => {
    const [c] = chunks();
    recordVisit(c, day(0));
    expect(c.history).toEqual({ correctSessions: 1, lastSeen: day(0), lastCorrect: true });
  });
});
```

- [ ] **Step 3: Run them to see them fail**

Run: `npx vitest run packages/shared/src/schedule/gap.test.ts packages/shared/src/schedule/chunk-state.test.ts`
Expected: FAIL, cannot resolve `./gap` and `./chunk-state`.

- [ ] **Step 4: Write the gap formula**

Create `packages/shared/src/schedule/gap.ts`:

```ts
/**
 * Rule 2: days to wait before the same chunk comes back, given the days left
 * until the exam. About a fifth of the time left (Cepeda et al. 2008), daily in
 * the last week, never more than two weeks.
 */
export function gapDays(daysLeft: number): number {
  if (daysLeft <= 7) return 1;
  return Math.min(14, Math.max(1, Math.round(daysLeft * 0.2)));
}
```

- [ ] **Step 5: Write the chunk state**

Create `packages/shared/src/schedule/chunk-state.ts`:

```ts
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
```

- [ ] **Step 6: Run them to see them pass**

Run: `npx vitest run packages/shared/src/schedule/gap.test.ts packages/shared/src/schedule/chunk-state.test.ts`
Expected: PASS, 3 + 10 tests.

Run: `npm run typecheck`
Expected: no errors (this also checks `fixtures.ts`).

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/schedule/gap.ts packages/shared/src/schedule/gap.test.ts packages/shared/src/schedule/chunk-state.ts packages/shared/src/schedule/chunk-state.test.ts packages/shared/src/schedule/fixtures.ts
git commit -m "A5: gap formula, chunk state and test fixtures

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Picking a session's questions

**Files:**
- Create: `packages/shared/src/schedule/pick.ts`
- Test: `packages/shared/src/schedule/pick.test.ts`

**Interfaces:**
- Consumes: everything from `chunk-state.ts` (Task 3); fixtures `chunk`, `day`, `exam`, `topic`, `working`.
- Produces:
  - `SESSION_MIN = 5`, `SESSION_MAX = 7`, `MAX_TOPICS = 3`, `NEW_SLOTS = 2`
  - `interface PickedSession { questionIds: Id[]; topicIds: Id[]; chunks: WorkingChunk[] }` (`chunks`: each chunk once, the ones the session visits)
  - `pickSession(all: WorkingChunk[], day: DateOnly, examDate: DateOnly): PickedSession | null` (null when nothing is due; mutates `uses` on the chunks it takes)
  - `pickFinalPass(all: WorkingChunk[]): PickedSession | null` (null when `all` is empty)

How `pickSession` chooses, in plain words:

1. Take the due chunks in `compareDue` order. Move the first 2 never-seen chunks (`NEW_SLOTS`, hardest topic first) to the front: rule 5 reserves 2 slots for new material while any remains. The rest follow in order: wrong last time, due again, more new. The session uses the first 3 topics that appear in this list.
2. Walk those chunks and take up to 7, at most `ceil(7 / number of topics)` per topic, so topics mix. A topic rated 4 or 5 may take one more for a never-seen chunk (rule 4's extra slot).
3. If there is room, fill it from the same topics without the per-topic limit.
4. Sort what was taken with `compareDue`: this is the order the student sees.
5. Under 5: add one secure chunk (least recently seen), then chunks that are not due yet (least recently seen), never adding a 4th topic. Still under 5: ask further questions of chunks already in the session, round by round.

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/schedule/pick.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { pickFinalPass, pickSession } from './pick';
import { chunk, day, exam, topic, working } from './fixtures';

const examDate = day(30);

describe('pickSession (rule 5)', () => {
  it('returns null when nothing is due', () => {
    const e = exam('e', examDate, 1, 2);
    e.chunks = e.chunks.map((c) => ({ ...c, history: { correctSessions: 3, lastSeen: day(-1), lastCorrect: true } }));
    expect(pickSession(working(e), day(0), examDate)).toBeNull();
  });

  it('takes 5 to 7 questions from at most 3 topics', () => {
    const picked = pickSession(working(exam('e', examDate, 5, 4)), day(0), examDate)!;
    expect(picked.questionIds).toHaveLength(7);
    expect(picked.topicIds).toEqual(['e-t1', 'e-t2', 'e-t3']);
  });

  it('mixes topics: one topic cannot fill the session when another has due chunks', () => {
    const e = {
      id: 'e',
      examDate,
      topics: [topic('a'), topic('b')],
      chunks: [...['a1', 'a2', 'a3', 'a4', 'a5', 'a6'].map((id) => chunk(id, 'a')), chunk('b1', 'b'), chunk('b2', 'b')],
    };
    const picked = pickSession(working(e), day(0), examDate)!;
    expect(picked.topicIds).toEqual(['a', 'b']);
    expect(picked.questionIds).toEqual(['a1-q1', 'a2-q1', 'a3-q1', 'a4-q1', 'a5-q1', 'b1-q1', 'b2-q1']);
  });

  it('gives a hard topic one extra slot for never-seen chunks (rule 4)', () => {
    const e = {
      id: 'e',
      examDate,
      topics: [topic('hard', 5), topic('mid'), topic('easy', 1)],
      chunks: [
        ...['h1', 'h2', 'h3', 'h4', 'h5'].map((id) => chunk(id, 'hard')),
        ...['m1', 'm2', 'm3', 'm4'].map((id) => chunk(id, 'mid')),
        chunk('e1', 'easy'),
      ],
    };
    const picked = pickSession(working(e), day(0), examDate)!;
    // Cap is 3 per topic with 3 topics; hard gets a 4th slot; mid fills the rest.
    expect(picked.questionIds).toEqual(['h1-q1', 'h2-q1', 'h3-q1', 'h4-q1', 'm1-q1', 'm2-q1', 'm3-q1']);
  });

  it('asks wrong-last-time chunks first, then due again, then new', () => {
    const e = {
      id: 'e',
      examDate,
      topics: [topic('a'), topic('b')],
      chunks: [
        chunk('new1', 'a'),
        chunk('again', 'b', { correctSessions: 1, lastSeen: day(-20), lastCorrect: true }),
        chunk('wrong', 'a', { correctSessions: 0, lastSeen: day(-1), lastCorrect: false }),
        chunk('new2', 'b'),
        chunk('new3', 'a'),
      ],
    };
    const picked = pickSession(working(e), day(0), examDate)!;
    expect(picked.questionIds).toEqual(['wrong-q1', 'again-q1', 'new1-q1', 'new2-q1', 'new3-q1']);
  });

  it('keeps 2 slots for never-seen chunks even when many chunks are due again', () => {
    const seen = { correctSessions: 1, lastSeen: day(-20), lastCorrect: true };
    const e = {
      id: 'e',
      examDate,
      topics: [topic('a'), topic('b')],
      chunks: [
        ...['a1', 'a2', 'a3', 'a4', 'b1', 'b2', 'b3', 'b4'].map((id) => chunk(id, id[0], seen)),
        chunk('newA', 'a'),
        chunk('newB', 'b'),
        chunk('newC', 'b'),
      ],
    };
    const picked = pickSession(working(e), day(0), examDate)!;
    expect(picked.questionIds).toHaveLength(7);
    expect(picked.questionIds.slice(-2)).toEqual(['newA-q1', 'newB-q1']);
  });

  it('with 20 unseen and 10 overdue chunks, a 7-question session holds at least 2 unseen', () => {
    const seen = { correctSessions: 1, lastSeen: day(-20), lastCorrect: true };
    const e = {
      id: 'e',
      examDate,
      topics: [topic('a'), topic('b')],
      chunks: [
        ...Array.from({ length: 10 }, (_, i) => chunk(`old${i}`, i % 2 ? 'a' : 'b', seen)),
        ...Array.from({ length: 20 }, (_, i) => chunk(`new${i}`, i % 2 ? 'a' : 'b')),
      ],
    };
    const picked = pickSession(working(e), day(0), examDate)!;
    expect(picked.questionIds).toHaveLength(7);
    expect(picked.questionIds.filter((q) => q.startsWith('new')).length).toBeGreaterThanOrEqual(2);
  });

  it('shrinks the new-chunk reserve to what exists', () => {
    const seen = { correctSessions: 1, lastSeen: day(-20), lastCorrect: true };
    const e = {
      id: 'e',
      examDate,
      topics: [topic('a')],
      chunks: [...['o1', 'o2', 'o3', 'o4', 'o5', 'o6', 'o7'].map((id) => chunk(id, 'a', seen)), chunk('only', 'a')],
    };
    const picked = pickSession(working(e), day(0), examDate)!;
    expect(picked.questionIds).toHaveLength(7);
    expect(picked.questionIds.filter((q) => q.startsWith('only'))).toEqual(['only-q1']);
  });

  it('tops a small session up to 5 with a secure chunk, then repeats', () => {
    const e = {
      id: 'e',
      examDate,
      topics: [topic('a')],
      chunks: [chunk('due', 'a'), chunk('safe', 'a', { correctSessions: 3, lastSeen: day(-9), lastCorrect: true })],
    };
    const picked = pickSession(working(e), day(0), examDate)!;
    expect(picked.questionIds).toEqual(['due-q1', 'safe-q1', 'due-q2', 'safe-q2', 'due-q3']);
  });

  it('stays under 5 only when the exam has fewer than 5 questions', () => {
    const e = { id: 'e', examDate, topics: [topic('a')], chunks: [chunk('c1', 'a', { questions: 2 }), chunk('c2', 'a', { questions: 1 })] };
    const picked = pickSession(working(e), day(0), examDate)!;
    expect(picked.questionIds).toEqual(['c1-q1', 'c2-q1', 'c1-q2']);
  });
});

describe('pickFinalPass (rule 8)', () => {
  it('touches every topic once, missed and hardest first, at most 7', () => {
    const e = {
      id: 'e',
      examDate,
      topics: [topic('t1', 2), topic('t2', 5), topic('t3'), topic('t4')],
      chunks: [
        chunk('a1', 't1', { correctSessions: 3, lastSeen: day(-2), lastCorrect: true }),
        chunk('a2', 't1', { correctSessions: 3, lastSeen: day(-2), lastCorrect: true }),
        chunk('b1', 't2', { correctSessions: 3, lastSeen: day(-2), lastCorrect: true }),
        chunk('c1', 't3', { correctSessions: 1, lastSeen: day(-2), lastCorrect: false }),
        chunk('d1', 't4', { correctSessions: 2, lastSeen: day(-2), lastCorrect: true }),
        ...['d2', 'd3', 'd4', 'd5'].map((id) => chunk(id, 't4', { correctSessions: 3, lastSeen: day(-2), lastCorrect: true })),
      ],
    };
    const picked = pickFinalPass(working(e))!;
    expect(picked.questionIds).toHaveLength(7);
    expect(picked.questionIds.slice(0, 3)).toEqual(['c1-q1', 'd1-q1', 'b1-q1']);
    expect(new Set(picked.topicIds)).toEqual(new Set(['t1', 't2', 't3', 't4']));
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run packages/shared/src/schedule/pick.test.ts`
Expected: FAIL, cannot resolve `./pick`.

- [ ] **Step 3: Write the picker**

Create `packages/shared/src/schedule/pick.ts`:

```ts
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
```

- [ ] **Step 4: Run it to see it pass**

Run: `npx vitest run packages/shared/src/schedule/pick.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/schedule/pick.ts packages/shared/src/schedule/pick.test.ts
git commit -m "A5: pick 5 to 7 questions from 2 to 3 topics, and the final pass

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Placing sessions on days

**Files:**
- Create: `packages/shared/src/schedule/place.ts`
- Test: `packages/shared/src/schedule/place.test.ts`

**Interfaces:**
- Consumes: `addDays`, `daysBetween` (Task 2), `gapDays` (Task 3), `SESSIONS_PER_DAY` and `ScheduleInput` (Task 1); fixtures `day`, `input`.
- Produces:
  - `SESSION_TARGET = 6`
  - `interface Calendar { cap: number; busy: Set<DateOnly>; load: Map<DateOnly, number>; examDays: Set<string> }`
  - `makeCalendar(input: ScheduleInput): Calendar` (books kept sessions from today on)
  - `canPlace(calendar, examId, day): boolean`, `take(calendar, examId, day): void`
  - `reserveFinalPass(calendar, examId, today, examDate): DateOnly | null`
  - `nextRhythmDay(day, examDate): DateOnly`, `rhythmDaysLeft(from, end, examDate): number`, `isBehind(recallsNeeded: number, rhythmDays: number): boolean`

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/schedule/place.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { canPlace, isBehind, makeCalendar, reserveFinalPass, rhythmDaysLeft, take } from './place';
import { day, input } from './fixtures';

describe('calendar (rule 6)', () => {
  it('refuses busy days', () => {
    const cal = makeCalendar(input({ exams: [], busyDays: [day(1)] }));
    expect(canPlace(cal, 'a', day(1))).toBe(false);
    expect(canPlace(cal, 'a', day(2))).toBe(true);
  });

  it('allows one session per exam per day and counts kept sessions toward the cap', () => {
    const cal = makeCalendar(input({ exams: [], pace: 'normal', keep: [{ examId: 'a', scheduledFor: day(0) }] }));
    expect(canPlace(cal, 'a', day(0))).toBe(false);
    expect(canPlace(cal, 'b', day(0))).toBe(true);
    take(cal, 'b', day(0));
    expect(canPlace(cal, 'c', day(0))).toBe(false);
  });

  it('ignores kept sessions before today', () => {
    const cal = makeCalendar(input({ exams: [], pace: 'light', keep: [{ examId: 'a', scheduledFor: day(-1) }] }));
    expect(cal.load.size).toBe(0);
  });
});

describe('reserveFinalPass (rule 8)', () => {
  it('books the day before the exam', () => {
    const cal = makeCalendar(input({ exams: [] }));
    expect(reserveFinalPass(cal, 'a', day(0), day(10))).toBe(day(9));
  });

  it('moves earlier when the day before is busy', () => {
    const cal = makeCalendar(input({ exams: [], busyDays: [day(9)] }));
    expect(reserveFinalPass(cal, 'a', day(0), day(10))).toBe(day(8));
  });

  it('returns null when no day is left before the exam', () => {
    const cal = makeCalendar(input({ exams: [] }));
    expect(reserveFinalPass(cal, 'a', day(0), day(0))).toBeNull();
  });
});

describe('rhythm (rule 7)', () => {
  it('counts on-rhythm days: sparse far out, daily in the last week', () => {
    // Exam on day 14: rhythm days 0, 3, 5, 7, 8, ..., 13 before the exam.
    expect(rhythmDaysLeft(day(0), day(14), day(14))).toBe(10);
    expect(rhythmDaysLeft(day(7), day(14), day(14))).toBe(7);
    expect(rhythmDaysLeft(day(14), day(14), day(14))).toBe(0);
  });

  it('is behind when the recalls needed exceed 6 per session left', () => {
    expect(isBehind(18, 3)).toBe(false);
    expect(isBehind(19, 3)).toBe(true);
    expect(isBehind(1, 0)).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run packages/shared/src/schedule/place.test.ts`
Expected: FAIL, cannot resolve `./place`.

- [ ] **Step 3: Write the calendar code**

Create `packages/shared/src/schedule/place.ts`:

```ts
import { SESSIONS_PER_DAY, type DateOnly, type Id, type ScheduleInput } from '../types';
import { addDays, daysBetween } from './dates';
import { gapDays } from './gap';

/** Questions a normal session is counted as holding when judging whether the rhythm is enough (rule 7). */
export const SESSION_TARGET = 6;

/** Which days are taken: busy days, kept sessions and sessions placed so far. */
export interface Calendar {
  /** Most sessions on one day across all exams (rule 6, from the pace). */
  cap: number;
  busy: Set<DateOnly>;
  /** Sessions on each day, all exams, kept ones included. */
  load: Map<DateOnly, number>;
  /** "examId|day" for every exam that already has a session that day. */
  examDays: Set<string>;
}

export function makeCalendar(input: ScheduleInput): Calendar {
  const calendar: Calendar = {
    cap: SESSIONS_PER_DAY[input.pace],
    busy: new Set(input.busyDays),
    load: new Map(),
    examDays: new Set(),
  };
  for (const k of input.keep) {
    if (k.scheduledFor >= input.today) take(calendar, k.examId, k.scheduledFor);
  }
  return calendar;
}

/** Rule 6: not busy, no session for this exam yet that day, and under the daily cap. */
export function canPlace(calendar: Calendar, examId: Id, day: DateOnly): boolean {
  return (
    !calendar.busy.has(day) &&
    !calendar.examDays.has(`${examId}|${day}`) &&
    (calendar.load.get(day) ?? 0) < calendar.cap
  );
}

/** Books one session for the exam on that day. */
export function take(calendar: Calendar, examId: Id, day: DateOnly): void {
  calendar.load.set(day, (calendar.load.get(day) ?? 0) + 1);
  calendar.examDays.add(`${examId}|${day}`);
}

/**
 * Rule 8: book the final pass on the latest free day before the exam (the day
 * before, unless that day is busy, kept or full). Called closest exam first,
 * before any normal session, so final passes win their day. Null when no day
 * from today to the day before the exam is free.
 */
export function reserveFinalPass(
  calendar: Calendar,
  examId: Id,
  today: DateOnly,
  examDate: DateOnly,
): DateOnly | null {
  for (let day = addDays(examDate, -1); day >= today; day = addDays(day, -1)) {
    if (canPlace(calendar, examId, day)) {
      take(calendar, examId, day);
      return day;
    }
  }
  return null;
}

/** Rule 7: the next on-rhythm day after a session on `day`. */
export function nextRhythmDay(day: DateOnly, examDate: DateOnly): DateOnly {
  return addDays(day, gapDays(daysBetween(day, examDate)));
}

/** On-rhythm days from `from` up to, not including, `end`. Busy days are not subtracted: an estimate. */
export function rhythmDaysLeft(from: DateOnly, end: DateOnly, examDate: DateOnly): number {
  let n = 0;
  for (let day = from; day < end; day = nextRhythmDay(day, examDate)) n++;
  return n;
}

/** Rule 7: the recalls still needed do not fit in the on-rhythm sessions left. */
export function isBehind(recallsNeeded: number, rhythmDays: number): boolean {
  return recallsNeeded > rhythmDays * SESSION_TARGET;
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `npx vitest run packages/shared/src/schedule/place.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/schedule/place.ts packages/shared/src/schedule/place.test.ts
git commit -m "A5: calendar with busy days, kept sessions, pace cap and final pass booking

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: buildSchedule, the single entry point

**Files:**
- Create: `packages/shared/src/schedule/warnings.ts`
- Create: `packages/shared/src/schedule/build.ts`
- Create: `packages/shared/src/schedule/index.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/schedule/build.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1 to 5.
- Produces: `class WarningList { add(code: ScheduleWarningCode, examId: Id | null, chunkId?: Id): void; list(): ScheduleWarning[] }` (internal), and `buildSchedule(input: ScheduleInput): ScheduleOutput`, exported from `@cramrade/shared` together with `addDays`, `daysBetween`, `isoDate`, `gapDays`, `isDue`, `SECURE_AFTER`, `SESSION_MIN`, `SESSION_MAX`, `MAX_TOPICS`. The `build-schedule` Edge Function (a later task) calls only `buildSchedule`.

How `buildSchedule` works, in plain words:

1. Check every date in the input; a bad one throws.
2. Sort exams by exam date, then id. Skip past exams with `exam_past`. Add `no_questions` warnings. Copy each exam's chunks that have questions; an exam with none gets no sessions.
3. Book each exam's final pass, closest exam first (`reserveFinalPass`). Normal sessions for that exam stop before that day.
4. Walk day by day from today to the day before the last exam. On each day, offer it to each exam in order: its final pass if this is the day; otherwise a normal session when the day is free and either the exam is on rhythm or it is behind; and only when something is due. After a normal session, count each visited chunk as one more correct session, and move the exam's next on-rhythm day by `gapDays`.
5. For each exam with a chunk still not secure when the walk ends, add `not_enough_days` for that exam. Every warning carries the exam's id.

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/schedule/build.test.ts`. Each scenario test calls `run`, which also checks the rules every output must keep (`assertInvariants` in `fixtures.ts`: sorted, nothing before today or on/after the exam, nothing on busy days, one session per exam per day, kept sessions respected, never over the pace cap, 1 to 7 questions, at most 3 topics outside the final pass, no question twice in a session).

```ts
import { describe, expect, it } from 'vitest';
import type { ScheduleInput } from '../types';
import { buildSchedule } from './build';
import { assertInvariants, chunk, chunksIn, day, daysOf, exam, input, topic } from './fixtures';

/** Runs the engine and checks the rules every output must keep. */
function run(inp: ScheduleInput) {
  const out = buildSchedule(inp);
  assertInvariants(inp, out);
  return out;
}

describe('buildSchedule: one exam', () => {
  it('exam tomorrow: only a final pass today', () => {
    const out = run(input({ exams: [exam('e', day(1))] }));
    expect(out.sessions).toHaveLength(1);
    expect(out.sessions[0]).toMatchObject({ scheduledFor: day(0), isFinalPass: true });
    expect(out.warnings).toEqual([{ code: 'not_enough_days', examId: 'e' }]);
  });

  it('exam today: nothing, and a warning', () => {
    const out = run(input({ exams: [exam('e', day(0))] }));
    expect(out.sessions).toEqual([]);
    expect(out.warnings).toEqual([{ code: 'not_enough_days', examId: 'e' }]);
  });

  it('exam in 14 days: sessions every gapDays until secure, final pass the day before', () => {
    const out = run(input({ exams: [exam('e', day(14))] }));
    expect(daysOf(out, 'e')).toEqual([day(0), day(3), day(5), day(13)]);
    expect(out.sessions.map((s) => s.isFinalPass)).toEqual([false, false, false, true]);
    expect(out.warnings).toEqual([]);
  });

  it('exam in 3 months: sparse far out, final pass the day before', () => {
    const out = run(input({ exams: [exam('e', day(90), 4, 5)] }));
    const days = daysOf(out, 'e');
    expect(days.slice(0, 3)).toEqual([day(0), day(14), day(28)]);
    expect(days.filter((d) => d < day(30))).toHaveLength(3);
    expect(days.at(-1)).toBe(day(89));
    expect(out.sessions.at(-1)!.isFinalPass).toBe(true);
    expect(out.warnings).toEqual([]);
  });

  it('exam past: no sessions for it, a warning, other exams still planned', () => {
    const out = run(input({ exams: [exam('old', day(-1)), exam('e', day(14))] }));
    expect(daysOf(out, 'old')).toEqual([]);
    expect(daysOf(out, 'e').length).toBeGreaterThan(0);
    expect(out.warnings).toEqual([{ code: 'exam_past', examId: 'old' }]);
  });

  it('final pass is present and the exam day is empty', () => {
    const out = run(input({ exams: [exam('e', day(20))] }));
    const finals = out.sessions.filter((s) => s.isFinalPass);
    expect(finals).toHaveLength(1);
    expect(finals[0].scheduledFor).toBe(day(19));
    expect(finals[0].topicIds).toEqual(['e-t1', 'e-t2', 'e-t3']);
    expect(out.sessions.some((s) => s.scheduledFor >= day(20))).toBe(false);
  });

  it('more material than the rhythm holds: extra sessions every day, load_increased', () => {
    const out = run(input({ exams: [exam('e', day(14), 3, 10)] }));
    expect(daysOf(out, 'e')).toHaveLength(14);
    expect(out.warnings).toEqual([{ code: 'load_increased', examId: 'e' }]);
  });

  it('more material than the days hold: not_enough_days as well', () => {
    const out = run(input({ exams: [exam('e', day(14), 3, 15)] }));
    expect(daysOf(out, 'e')).toHaveLength(14);
    expect(out.warnings).toEqual([
      { code: 'load_increased', examId: 'e' },
      { code: 'not_enough_days', examId: 'e' },
    ]);
  });

  it('far exam: new material keeps arriving, every chunk first seen at least 3 weeks before the exam', () => {
    const out = run(input({ exams: [exam('e', day(90), 4, 5)] }));
    const firstSeen = new Map<string, string>();
    for (const s of out.sessions) for (const c of chunksIn(s)) if (!firstSeen.has(c)) firstSeen.set(c, s.scheduledFor);
    expect(firstSeen.size).toBe(20);
    for (const d of firstSeen.values()) expect(d <= day(69)).toBe(true);
    for (const s of out.sessions.slice(1, 6)) expect(chunksIn(s).some((c) => firstSeen.get(c) === s.scheduledFor)).toBe(true);
  });
});

describe('buildSchedule: the student days', () => {
  it('busy week: nothing on busy days, the plan starts after them', () => {
    const busyDays = [0, 1, 2, 3, 4, 5, 6].map(day);
    const out = run(input({ exams: [exam('e', day(14))], busyDays }));
    expect(daysOf(out, 'e')).toEqual([day(7), day(8), day(9), day(13)]);
  });

  it('busy day before the exam: final pass moves one day earlier', () => {
    const out = run(input({ exams: [exam('e', day(14))], busyDays: [day(13)] }));
    expect(out.sessions.find((s) => s.isFinalPass)!.scheduledFor).toBe(day(12));
  });

  it('two exams in one week, pace normal: both planned, never over 2 a day', () => {
    const out = run(input({ exams: [exam('b', day(6)), exam('a', day(5))], pace: 'normal' }));
    expect(daysOf(out, 'a')).toEqual([day(0), day(1), day(2), day(4)]);
    expect(daysOf(out, 'b')).toEqual([day(0), day(1), day(2), day(5)]);
  });

  it('pace light: the closer exam wins the day, the other moves to the next free day', () => {
    const out = run(input({ exams: [exam('far', day(20)), exam('near', day(5))], pace: 'light' }));
    expect(daysOf(out, 'near')).toEqual([day(0), day(1), day(2), day(4)]);
    expect(daysOf(out, 'far')[0]).toBe(day(3));
  });

  it('no day goes over the pace cap with many exams', () => {
    const exams = [exam('a', day(4)), exam('b', day(6)), exam('c', day(9)), exam('d', day(12))];
    for (const pace of ['light', 'normal', 'heavy'] as const) run(input({ exams, pace }));
  });
});

describe('buildSchedule: answers drive the plan', () => {
  it('skipped session reflow: kept day stays taken, unseen chunks come back next day', () => {
    // Plan made on day 0 had sessions on day 0, 3 and 5. Day 0 was done (all correct);
    // the day 3 session is skipped, and the plan is rebuilt on day 3.
    const e = exam('e', day(14));
    e.chunks = e.chunks.map((c) => ({ ...c, history: { correctSessions: 1, lastSeen: day(0), lastCorrect: true } }));
    const out = run(
      input({ today: day(3), exams: [e], keep: [{ examId: 'e', scheduledFor: day(3) }] }),
    );
    const days = daysOf(out, 'e');
    expect(days).not.toContain(day(3));
    expect(days[0]).toBe(day(4));
    expect(chunksIn(out.sessions[0]).sort()).toEqual(e.chunks.map((c) => c.id).sort());
  });

  it('a chunk with 3 correct sessions leaves the plan until the final pass', () => {
    const e = exam('e', day(20));
    e.chunks[0] = chunk('e-t1-c1', 'e-t1', { correctSessions: 3, lastSeen: day(-1), lastCorrect: true });
    const out = run(input({ exams: [e] }));
    for (const s of out.sessions.filter((x) => !x.isFinalPass)) expect(chunksIn(s)).not.toContain('e-t1-c1');
    expect(chunksIn(out.sessions.find((s) => s.isFinalPass)!)).toContain('e-t1-c1');
  });

  it('a wrong answer brings the chunk back first in the next session', () => {
    const e = exam('e', day(30));
    e.chunks = e.chunks.map((c) => ({ ...c, history: { correctSessions: 1, lastSeen: day(-1), lastCorrect: true } }));
    e.chunks[3] = { ...e.chunks[3], history: { correctSessions: 1, lastSeen: day(-1), lastCorrect: false } };
    const out = run(input({ exams: [e] }));
    expect(out.sessions[0].scheduledFor).toBe(day(0));
    expect(chunksIn(out.sessions[0])[0]).toBe(e.chunks[3].id);
  });

  it('a topic with no questions warns, and its chunks are never planned', () => {
    const e = exam('e', day(14));
    e.topics.push(topic('empty'));
    e.chunks.push(chunk('blank', 'empty', { questions: 0 }));
    const out = run(input({ exams: [e] }));
    expect(out.warnings).toEqual([
      { code: 'no_questions', examId: 'e' },
      { code: 'no_questions', examId: 'e', chunkId: 'blank' },
    ]);
    for (const s of out.sessions) expect(s.topicIds).not.toContain('empty');
  });

  it('an exam with no questions at all gets no sessions', () => {
    const e = { id: 'e', examDate: day(14), topics: [topic('t')], chunks: [] };
    const out = run(input({ exams: [e] }));
    expect(out).toEqual({ sessions: [], warnings: [{ code: 'no_questions', examId: 'e' }] });
  });

  it('difficulty prior: with no history, hard topics come first and easy last', () => {
    const e = {
      id: 'e',
      examDate: day(30),
      topics: [topic('easy', 1), topic('mid'), topic('hard', 5)],
      chunks: [chunk('e1', 'easy'), chunk('e2', 'easy'), chunk('m1', 'mid'), chunk('m2', 'mid'), chunk('h1', 'hard'), chunk('h2', 'hard')],
    };
    const out = run(input({ exams: [e] }));
    expect(chunksIn(out.sessions[0])).toEqual(['h1', 'h2', 'm1', 'm2', 'e1', 'e2']);
  });
});

describe('buildSchedule: inputs the screens can produce', () => {
  it('two exams on the same day: both planned, each gets its own final pass', () => {
    const out = run(input({ exams: [exam('y', day(10)), exam('x', day(10))], pace: 'normal' }));
    const finals = out.sessions.filter((s) => s.isFinalPass);
    expect(finals.map((s) => [s.examId, s.scheduledFor])).toEqual([
      ['x', day(9)],
      ['y', day(9)],
    ]);
  });

  it('two exams on the same day with pace light: the second final pass moves a day earlier', () => {
    const out = run(input({ exams: [exam('y', day(10)), exam('x', day(10))], pace: 'light' }));
    const finals = out.sessions.filter((s) => s.isFinalPass);
    expect(finals.map((s) => [s.examId, s.scheduledFor])).toEqual([
      ['y', day(8)],
      ['x', day(9)],
    ]);
  });

  it('chunks with no topic are planned, and no null topic id is listed', () => {
    const e = { id: 'e', examDate: day(14), topics: [], chunks: [chunk('n1', null), chunk('n2', null), chunk('n3', null)] };
    const out = run(input({ exams: [e] }));
    expect(out.sessions.length).toBeGreaterThan(0);
    for (const s of out.sessions) expect(s.topicIds).toEqual([]);
    expect(out.warnings).toEqual([]);
  });

  it('an exam a year away plans sparse sessions and a final pass', () => {
    const out = run(input({ exams: [exam('e', day(365), 4, 5)] }));
    const days = daysOf(out, 'e');
    expect(days[1]).toBe(day(14));
    expect(days.at(-1)).toBe(day(364));
  });

  it('refuses a date that is not YYYY-MM-DD instead of planning around it', () => {
    expect(() => buildSchedule(input({ exams: [exam('e', '2026-13-01')] }))).toThrow(/2026-13-01/);
    expect(() => buildSchedule(input({ today: '2026-11-2', exams: [exam('e', day(5))] }))).toThrow();
  });
});

describe('buildSchedule: warnings name the exam', () => {
  it('each exam gets its own warnings, sorted by code then exam', () => {
    const out = run(
      input({ exams: [exam('z', day(1)), exam('old', day(-3)), exam('a', day(1)), exam('fine', day(20))] }),
    );
    expect(out.warnings).toEqual([
      { code: 'exam_past', examId: 'old' },
      { code: 'not_enough_days', examId: 'a' },
      { code: 'not_enough_days', examId: 'z' },
    ]);
  });
});

describe('buildSchedule: deterministic (rule 11)', () => {
  const make = (): ScheduleInput =>
    input({
      exams: [exam('a', day(9), 2, 4), exam('b', day(30), 4, 3), exam('c', day(-2))],
      pace: 'normal',
      busyDays: [day(2), day(6)],
      keep: [{ examId: 'a', scheduledFor: day(0) }],
    });

  it('gives equal output for equal input', () => {
    expect(buildSchedule(make())).toEqual(buildSchedule(make()));
  });

  it('does not depend on the order of the exams', () => {
    const reversed = make();
    reversed.exams.reverse();
    expect(buildSchedule(reversed)).toEqual(buildSchedule(make()));
  });

  it('does not change its input', () => {
    const inp = make();
    const copy = structuredClone(inp);
    run(inp);
    expect(inp).toEqual(copy);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run packages/shared/src/schedule/build.test.ts`
Expected: FAIL, cannot resolve `./build`.

- [ ] **Step 3: Write the warning list and buildSchedule**

Create `packages/shared/src/schedule/warnings.ts`. It sorts with plain `<` and `>` rather than `localeCompare`, so the order never depends on the machine's language settings:

```ts
import {
  SCHEDULE_WARNING_CODES,
  type Id,
  type ScheduleWarning,
  type ScheduleWarningCode,
} from '../types';

/** Collects warnings while the plan is built: each one once, then sorted so the output is deterministic. */
export class WarningList {
  private readonly byKey = new Map<string, ScheduleWarning>();

  add(code: ScheduleWarningCode, examId: Id | null, chunkId?: Id): void {
    const key = `${code}|${examId ?? ''}|${chunkId ?? ''}`;
    if (this.byKey.has(key)) return;
    // chunkId is left out entirely when absent, so warnings compare cleanly with toEqual.
    this.byKey.set(key, chunkId === undefined ? { code, examId } : { code, examId, chunkId });
  }

  /** By code in SCHEDULE_WARNING_CODES order, then exam id, then chunk id. */
  list(): ScheduleWarning[] {
    const rank = (w: ScheduleWarning) => SCHEDULE_WARNING_CODES.indexOf(w.code);
    const text = (v: string | null | undefined) => v ?? '';
    const byText = (x: string, y: string) => (x < y ? -1 : x > y ? 1 : 0);
    return [...this.byKey.values()].sort(
      (a, b) =>
        rank(a) - rank(b) ||
        byText(text(a.examId), text(b.examId)) ||
        byText(text(a.chunkId), text(b.chunkId)),
    );
  }
}
```

Create `packages/shared/src/schedule/build.ts`:

```ts
import type { DateOnly, PlannedSession, ScheduleExam, ScheduleInput, ScheduleOutput } from '../types';
import { isSecure, recallsNeeded, recordVisit, toWorkingChunks, type WorkingChunk } from './chunk-state';
import { addDays, dayToMs } from './dates';
import { pickFinalPass, pickSession, type PickedSession } from './pick';
import {
  canPlace,
  isBehind,
  makeCalendar,
  nextRhythmDay,
  reserveFinalPass,
  rhythmDaysLeft,
  take,
  type Calendar,
} from './place';
import { WarningList } from './warnings';

/** One exam while its plan is being built. */
interface ExamPlan {
  exam: ScheduleExam;
  chunks: WorkingChunk[];
  finalPassDay: DateOnly | null;
  /** Normal sessions stop before this day: the final pass day, or the exam day when there is none. */
  stopDay: DateOnly;
  /** The next on-rhythm day (rule 7). It stays put while the exam cannot get a session, so the session moves to the next free day. */
  nextDay: DateOnly;
}

/** Every date in the input must be a real YYYY-MM-DD day; dates are compared as text below, so bad ones would slip through. */
function checkDates(input: ScheduleInput): void {
  dayToMs(input.today);
  for (const exam of input.exams) dayToMs(exam.examDate);
  for (const day of input.busyDays) dayToMs(day);
  for (const k of input.keep) dayToMs(k.scheduledFor);
}

/** Closest exam first; same day, by id, so the order never depends on the input order. */
function byExamDate(a: ScheduleExam, b: ScheduleExam): number {
  if (a.examDate !== b.examDate) return a.examDate < b.examDate ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * no_questions: one warning per chunk with no questions (with its chunkId), and
 * one for the exam when it has no chunks at all or a topic has no chunk with questions.
 */
function warnMissingQuestions(exam: ScheduleExam, warnings: WarningList): void {
  for (const c of exam.chunks) if (c.questionIds.length === 0) warnings.add('no_questions', exam.id, c.id);
  const topicWithout = exam.topics.some(
    (t) => !exam.chunks.some((c) => c.topicId === t.id && c.questionIds.length > 0),
  );
  if (exam.chunks.length === 0 || topicWithout) warnings.add('no_questions', exam.id);
}

function toSession(plan: ExamPlan, day: DateOnly, picked: PickedSession, isFinalPass: boolean): PlannedSession {
  return {
    examId: plan.exam.id,
    scheduledFor: day,
    questionIds: picked.questionIds,
    isFinalPass,
    topicIds: picked.topicIds,
  };
}

/** One exam on one day: its final pass, a normal session, or nothing. */
function planDay(
  plan: ExamPlan,
  day: DateOnly,
  calendar: Calendar,
  warnings: WarningList,
): PlannedSession | null {
  if (day === plan.finalPassDay) {
    const picked = pickFinalPass(plan.chunks);
    return picked && toSession(plan, day, picked, true);
  }
  if (day >= plan.stopDay || !canPlace(calendar, plan.exam.id, day)) return null;

  const onRhythm = day >= plan.nextDay;
  if (!onRhythm) {
    const left = rhythmDaysLeft(plan.nextDay, plan.stopDay, plan.exam.examDate);
    if (!isBehind(recallsNeeded(plan.chunks), left)) return null;
  }
  const picked = pickSession(plan.chunks, day, plan.exam.examDate);
  if (!picked) return null;

  take(calendar, plan.exam.id, day);
  for (const c of picked.chunks) recordVisit(c, day);
  if (onRhythm) plan.nextDay = nextRhythmDay(day, plan.exam.examDate);
  else warnings.add('load_increased', plan.exam.id);
  return toSession(plan, day, picked, false);
}

/**
 * The schedule engine: turns exams, notes, answers and the student's days into
 * planned sessions. Plain code, no AI, no clock, no randomness: the same input
 * always gives the same output (rule 11). The input is not changed.
 */
export function buildSchedule(input: ScheduleInput): ScheduleOutput {
  checkDates(input);
  const warnings = new WarningList();
  const calendar = makeCalendar(input);
  const plans: ExamPlan[] = [];

  for (const exam of [...input.exams].sort(byExamDate)) {
    if (exam.examDate < input.today) {
      warnings.add('exam_past', exam.id);
      continue;
    }
    warnMissingQuestions(exam, warnings);
    const chunks = toWorkingChunks(exam);
    if (chunks.length === 0) continue;
    const finalPassDay = reserveFinalPass(calendar, exam.id, input.today, exam.examDate);
    if (finalPassDay === null) warnings.add('not_enough_days', exam.id);
    plans.push({ exam, chunks, finalPassDay, stopDay: finalPassDay ?? exam.examDate, nextDay: input.today });
  }

  const sessions: PlannedSession[] = [];
  const lastExam = plans.reduce<DateOnly>((max, p) => (p.exam.examDate > max ? p.exam.examDate : max), input.today);
  for (let day = input.today; day < lastExam; day = addDays(day, 1)) {
    for (const plan of plans) {
      const session = planDay(plan, day, calendar, warnings);
      if (session) sessions.push(session);
    }
  }

  for (const plan of plans) {
    if (plan.chunks.some((c) => !isSecure(c))) warnings.add('not_enough_days', plan.exam.id);
  }
  return { sessions, warnings: warnings.list() };
}
```

- [ ] **Step 4: Export the engine**

Create `packages/shared/src/schedule/index.ts`:

```ts
// The schedule engine (task A5). buildSchedule is the one entry point.
// The date helpers and limits are exported for the build-schedule Edge Function and the screens.
export { buildSchedule } from './build';
export { addDays, daysBetween, isoDate } from './dates';
export { gapDays } from './gap';
export { SECURE_AFTER, isDue } from './chunk-state';
export { SESSION_MIN, SESSION_MAX, MAX_TOPICS } from './pick';
```

Replace the whole of `packages/shared/src/index.ts` with:

```ts
// Data shapes and the schedule engine are exported from here.
// The shapes were agreed in task T1 (see README.md in this package).
// The schedule engine is task A5.
export * from './types';
export * from './schedule';
```

- [ ] **Step 5: Run it to see it pass**

Run: `npx vitest run packages/shared/src/schedule/build.test.ts`
Expected: PASS, 29 tests.

Run: `npm test`
Expected: PASS, 6 test files, 66 tests.

Run: `npm run typecheck`
Expected: no errors. This also checks that the app still compiles with the larger `@cramrade/shared` export list.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/schedule/warnings.ts packages/shared/src/schedule/build.ts packages/shared/src/schedule/build.test.ts packages/shared/src/schedule/index.ts packages/shared/src/index.ts
git commit -m "A5: buildSchedule, the deterministic schedule engine

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: README, final check and pull request

**Files:**
- Modify: `packages/shared/README.md`

**Interfaces:**
- Consumes: the finished engine.
- Produces: the plain-words description Dev B reads before approving the types.

- [ ] **Step 1: Update the README**

In `packages/shared/README.md`, change the first line from `# Shared package: the data shapes (T1 proposal)` to:

```markdown
# Shared package: the data shapes and the schedule engine
```

Then add this section at the end of the file:

````markdown
## Schedule engine

`buildSchedule(input)` in `src/schedule/` turns exams, notes, answers and the student's free days into a list of short study sessions. It is plain code, not AI: the same input always gives the same plan. The server function `build-schedule` collects the input from the database, calls it, and saves the sessions, so the web app and the phone show the same plan.

What goes in (`ScheduleInput` in `src/types/schedule.ts`):

- `today`: the first day that may get a session. The engine never reads the clock.
- `exams`: every upcoming exam, each with its date, its topics (with the AI's difficulty guess, 1 to 5, or none) and its chunks of notes. Each chunk lists its checked questions, least recently asked first, and its history: how many separate sessions had a correct answer, the last day it was seen, and whether the last answer was right.
- `pace`: light, normal or heavy, meaning at most 1, 2 or 3 sessions a day across all exams.
- `busyDays`: days with no studying at all.
- `keep`: sessions already done or skipped. Their day stays taken.

What comes out: `sessions` (day, exam, 5 to 7 question ids in order, the topics, and whether it is the final pass) and `warnings`. Each warning has a `code` (`exam_past`, `no_questions`, `load_increased`, `not_enough_days`) and the `examId` it is about, so the screen can name the exam; a `no_questions` warning about one chunk also has its `chunkId`.

The rules, one line each:

1. Plan from today up to the last exam; nothing on or after an exam's date; a past exam gets no sessions and a warning.
2. A chunk comes back after about a fifth of the days left (daily in the last week, at most every 14 days), or at once if the last answer was wrong.
3. A chunk answered correctly in 3 separate sessions is learned and only comes back in the final pass.
4. Before any answers exist, chunks of topics rated 4 or 5 come first and those rated 1 or 2 last; after that the answers decide.
5. A session has 5 to 7 questions from 2 to 3 topics of one exam: at least 2 never-seen chunks while any remain, then missed chunks, chunks due again and more new ones; a learned chunk only fills a session up to 5.
6. At most one session per exam per day, never on a busy or kept day, never over the pace; when exams compete for a day, the closer exam wins.
7. Sessions follow the gap rhythm from today; when the material does not fit, extra sessions are added and the plan says so.
8. The day before each exam is a final pass that touches every topic once; exam day is empty.
9. Missed sessions are not copied forward: the plan is rebuilt from today with the real answers.
10. A session counts as done once one question is answered (the app and server apply this; the engine only reads the result).
11. Same input, same output: no randomness, no clock.

The plan assumes each planned question will be answered correctly. When it is not, the next rebuild brings that chunk back (rule 9).

Run the tests from the repo's top folder:

```sh
npm test                                                     # every test
npx vitest run packages/shared/src/schedule/build.test.ts    # just the engine scenarios
```
````

- [ ] **Step 2: Check the "Done when" from split_work.md**

split_work.md says A5 is done when: "Given "exam in 14 days", it returns a plan ending on exam day. Tests cover: exam tomorrow, exam in 3 months, two exams in the same week, exam already past."

Spec rule 1 is newer and approved, and it says nothing is planned on exam day. So "ending on exam day" is met this way: the plan runs up to the exam, and its last session, the final pass, is the day before. The test "exam in 14 days" checks exactly that. Run the five Done-when tests by name:

```bash
npx vitest run packages/shared/src/schedule/build.test.ts -t "exam tomorrow|exam in 14 days|exam in 3 months|two exams in one week|exam past"
```

Expected: 5 tests pass, the rest of the file is skipped.

Saving the plan on the server is the build-schedule task (spec 6.4), not this branch.

- [ ] **Step 3: Final check**

Run: `npm run typecheck && npm test`
Expected: typecheck passes with no errors; vitest reports 6 test files and 66 tests passed.

Run: `git diff main --stat`
Expected: only the files in this plan's file map, plus `package-lock.json`. No `.env` file and no key anywhere in the diff.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/README.md
git commit -m "A5: README section on the schedule engine

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Step 5: Push and open the pull request**

```bash
git push -u origin a5-schedule-engine
gh pr create --base main --title "A5: schedule engine (types, engine, tests)" --body "$(cat <<'EOF'
The schedule engine from spec section 6 (docs/superpowers/specs/2026-10-10-server-side-design.md): one pure function, buildSchedule, in packages/shared. No server code and no migration in this pull request.

Dev B: this adds new types in packages/shared/src/types/schedule.ts (Pace, PACES, SESSIONS_PER_DAY, SCHEDULE_WARNING_CODES, ScheduleWarningCode, ScheduleWarning as { code, examId, chunkId? }, and the engine's input and output shapes). Under the T1 rule these need your yes before merge.

Decisions the spec left open are listed in the plan (docs/superpowers/plans/2026-10-10-a5-schedule-engine.md, "Decisions this plan makes") and in the README section. The main ones:
- The plan assumes planned questions are answered correctly; a re-run with real answers brings missed chunks back.
- Extra sessions are added on off-rhythm days only when the exam is behind; that raises load_increased.
- build-schedule must pass each chunk's questionIds least recently asked first.

Root npm test now runs vitest from the repo root (vitest.config.mts), so the server's pure code can join later.

Checks: npm run typecheck and npm test pass (66 tests).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: the command prints the pull request link. Do not merge it; Dev B reviews it.
