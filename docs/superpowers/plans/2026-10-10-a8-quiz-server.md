# A8 Quiz Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the live quiz server: four Edge Functions (quiz-create, quiz-start, quiz-answer, quiz-advance), the database functions that make answering and advancing atomic, tested pure helpers for scoring and question picking, a plain-words guide for Dev B, and the five-player end-to-end script that is A8's "Done when".

**Architecture:** Thin Edge Functions check the caller and the input, then hand every time-sensitive write to one Postgres function so the database clock decides and two requests can never both win. Pure TypeScript in `supabase/functions/_shared` (scoring, answer matching, question picking, input parsing, room state mapping) is tested with vitest. Clients never move the clock: they watch the room row over Realtime, work out the phase from `question_started_at`, and ask the server to advance when their local timer runs out.

**Tech Stack:** Supabase Edge Functions (Deno, `npm:@supabase/supabase-js@2`), Postgres (plpgsql), Supabase Realtime (postgres_changes), vitest 5, TypeScript 6, Node 22 for the end-to-end script.

**Spec:** `docs/superpowers/specs/2026-10-10-server-side-design.md` (sections 9 and 10; section 11 for the columns this builds on)

## Global Constraints

- Branch `a8-quiz-server`, cut from `main` after `a4a-server-foundation` has merged. Never push to `main`. The plan ends with a pull request.
- Edge Functions run on the free plan: 150 seconds wall clock, 2 seconds CPU, 256 MB.
- Never run `supabase db push` or `supabase functions deploy`. Migrations and functions go live when the pull request merges to `main`.
- Pure code in `supabase/functions/_shared` uses no Deno-only API and no `npm:` or `jsr:` import, so vitest at the repo root can test it. Imports between `_shared` files use the `.ts` extension (Deno needs it; vitest accepts it).
- Every failure answer is JSON `{ error: { code, message } }` with 400 (bad input), 401 (no user), 403 (not yours), 404, 409 (too late or duplicate), 500.
- Scoring is exactly spec 9.2: 1000 points for an instant correct answer, 500 at the last moment, 0 when wrong, `msTaken` measured between two database timestamps.
- Correctness rule (spec 9.1): multiple choice and flashcard are an exact match on the answer text after trimming; short answer is case-insensitive with whitespace collapsed.
- The server owns quiz time and score. Never trust a time or score sent by a client.
- `quiz-create` requires a full user (`requireFullUser`). `quiz-answer` and `quiz-advance` accept guests (`requireUser`), because players sign in anonymously.
- Field names: camelCase in TypeScript, snake_case in the database.
- Commits end with the line `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Docs for the team are plain words, lists not tables. Code comments explain why.
- Keep all downloads on D:. Do not install Deno or any global tool.

## Review Focus

- **Two clients advance at the same instant.** Five players' timers expire together and all call quiz-advance. Exactly one call moves the room; the others get `advanced: false` and the same room state. Pinned by the SQL condition in Task 6 and asserted in the end-to-end script (Task 12: exactly one `advanced: true` per question).
- **An answer arrives after the deadline or twice.** A slow network or a double tap. The late or second answer scores nothing and gets 409 with a distinct code. Pinned by `submit_quiz_answer` in Task 6 and by the late-answer and duplicate-answer checks in Task 12.
- **A group member makes a quiz from a shared exam that has questions from a classmate's private note.** Only questions whose note the caller can see are used. Pinned by `visibleQuestions` in Task 5 (tested) and used in Task 7.
- **A player reloads the page mid-game.** Rejoining with the same session returns the same player row and score, and the player can keep answering. Asserted in Task 12.
- **Answer text with odd spacing or case.** A typed short answer `"  Carbon   DIOXIDE "` counts as right when the stored answer is `carbon dioxide`. A tapped multiple-choice answer must match the choice text exactly, apart from spaces at either end. Pinned by the `isCorrectAnswer` tests in Task 2.

## What this plan builds on (contract with `a4a-server-foundation`)

This branch starts after `a4a-server-foundation` merged. These names were agreed with the foundation plan on 2026-10-10 and are fixed. Task 1 still checks each one exists before any code is written.

- `supabase/functions/_shared/auth.ts`: `requireUser(req: Request): Promise<AuthedUser>` and `requireFullUser(req: Request): Promise<AuthedUser>`, where `AuthedUser` is `{ id: string; isAnonymous: boolean }`. Both throw `HttpError` (401 no user, 403 guest for `requireFullUser`).
- `supabase/functions/_shared/http.ts`: `class HttpError extends Error { constructor(status: number, code: string, message: string) }`, `json(body: unknown, status?: number): Response`, and `handle(fn: (req: Request) => Promise<Response>): (req: Request) => Promise<Response>`, which answers CORS preflight, turns a thrown `HttpError` into `{ error: { code, message } }` with its status, and turns anything else into 500.
- `supabase/functions/_shared/db.ts`: `db`, the service-role `SupabaseClient`.
- Database (spec 11): `quiz_rooms.mode` (`'group' | 'solo'`), `quiz_rooms.results_seconds` (default 5), `quiz_answers.points` (default 0), `public.current_quiz_question(room_id uuid)`, and `quiz_rooms` and `quiz_players` in the `supabase_realtime` publication.
- `packages/shared/src/types/quiz.ts`: `QUIZ_MODES` (`['group', 'solo'] as const`) and `QuizMode`.
- `public.current_quiz_question(room_id)` must return `question_id` alongside `prompt`, `kind`, `choices` and the late `answer`. Players need the id to call quiz-answer.

If any of these differ, Task 1 says what to change in this plan before continuing.

## File map

Created:

- `supabase/functions/_shared/scoring.ts`: `points()` and `isCorrectAnswer()`. Pure.
- `supabase/functions/_shared/scoring.test.ts`
- `supabase/functions/_shared/quiz-pick.ts`: `pickQuestions()`, `visibleQuestions()`. Pure.
- `supabase/functions/_shared/quiz-pick.test.ts`
- `supabase/functions/_shared/quiz-input.ts`: request body parsers for the four functions, `QUIZ_MODES`. Pure.
- `supabase/functions/_shared/quiz-input.test.ts`
- `supabase/functions/_shared/quiz-room.ts`: `roomState()` (database JSON to camelCase), `answerOutcomeError()`. Pure.
- `supabase/functions/_shared/quiz-room.test.ts`
- `supabase/functions/_shared/quiz-db.ts`: database calls shared by the four functions (load room, membership checks, call the SQL functions). Deno, not unit tested.
- `supabase/migrations/<timestamp>_quiz_answer_fn.sql`: `private.quiz_points`, `public.quiz_room_state`, `public.start_quiz_room`, `public.submit_quiz_answer`, `public.advance_quiz_room`, and removal of direct client inserts into `quiz_answers`.
- `supabase/functions/quiz-create/index.ts`, `quiz-start/index.ts`, `quiz-answer/index.ts`, `quiz-advance/index.ts`
- `supabase/functions/quiz-README.md`: the client flow for Dev B.
- `scripts/quiz-e2e.mjs`: the five-player end-to-end check.
- `scripts/quiz-e2e-seed.sql`, `scripts/quiz-e2e-cleanup.sql`: test data in and out.
- `scripts/quiz-e2e.env.example`: names of the script's settings.

Modified:

- `supabase/config.toml`: one `[functions.<name>]` block per quiz function.

---

### Task 1: Branch and foundation check

**Files:**
- Create (only if missing): `vitest.config.mts`

**Interfaces:**
- Consumes: the contract above.
- Produces: a branch `a8-quiz-server` where every name in the contract exists.

- [ ] **Step 1: Cut the branch**

```bash
git checkout main
git pull
git checkout -b a8-quiz-server
```

- [ ] **Step 2: Check the foundation names exist**

Run:

```bash
grep -nE "export (async )?function (requireUser|requireFullUser)" supabase/functions/_shared/auth.ts
grep -nE "export (class HttpError|function json|function handle)" supabase/functions/_shared/http.ts
grep -nE "export const db" supabase/functions/_shared/db.ts
grep -nE "QUIZ_MODES" packages/shared/src/types/quiz.ts
grep -lE "results_seconds|current_quiz_question|supabase_realtime" supabase/migrations/*.sql
grep -nE "question_id" supabase/migrations/*server_side*.sql
```

Expected: each command prints at least one line. The last one must show `question_id` inside the `current_quiz_question` function's return columns.

If a name differs (for example `db.ts` exports `serviceClient()` instead of `db`), replace the name everywhere in this plan's code before starting Task 2, and write the difference in the pull request description. If `current_quiz_question` does not return `question_id`, stop and tell Dev A: this branch's migration (Task 6) must then `drop function public.current_quiz_question(uuid)` and recreate it with `question_id` added, which is a change to a4a's work.

- [ ] **Step 3: Make sure the root test config exists**

Run: `ls vitest.config.mts`
If it exists (the a5-schedule-engine plan creates it), go to step 4. If it does not exist, create `vitest.config.mts` at the repo root:

```ts
// Runs the shared package tests and the pure server code in
// supabase/functions/_shared together, from the repo root.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/shared/src/**/*.test.ts', 'supabase/functions/_shared/**/*.test.ts'],
    passWithNoTests: true,
  },
});
```

Then commit it on its own:

```bash
git add vitest.config.mts
git commit -m "A8: root vitest config for shared and _shared tests

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Step 4: Check the test runner sees `_shared`**

Run: `npx vitest run supabase/functions/_shared --passWithNoTests`
Expected: exits 0.

No other commit in this task.

---

### Task 2: Scoring and answer matching

**Files:**
- Create: `supabase/functions/_shared/scoring.ts`
- Test: `supabase/functions/_shared/scoring.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `points(correct: boolean, msTaken: number, msAllowed: number): number`
  - `isCorrectAnswer(kind: QuestionKind, given: string, expected: string): boolean`
  - `type QuestionKind = 'multiple_choice' | 'short_answer' | 'flashcard'`
  - The SQL twin `private.quiz_points` in Task 6 must give the same numbers as `points()`.

- [ ] **Step 1: Write the failing tests**

Create `supabase/functions/_shared/scoring.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { isCorrectAnswer, points } from './scoring.ts';

describe('points', () => {
  it('gives 1000 for an instant correct answer', () => {
    expect(points(true, 0, 20_000)).toBe(1000);
  });

  it('gives 500 at the last moment', () => {
    expect(points(true, 20_000, 20_000)).toBe(500);
  });

  it('gives 750 at half time', () => {
    expect(points(true, 10_000, 20_000)).toBe(750);
  });

  it('clamps answers after the time limit to 500', () => {
    expect(points(true, 25_000, 20_000)).toBe(500);
  });

  it('clamps a negative time (clock rounding) to 1000', () => {
    expect(points(true, -50, 20_000)).toBe(1000);
  });

  it('gives 0 for a wrong answer at any time', () => {
    expect(points(false, 0, 20_000)).toBe(0);
    expect(points(false, 20_000, 20_000)).toBe(0);
  });

  // 999.5 exactly. The SQL twin rounds half away from zero, so must this.
  it('rounds an exact half up, the same as the database', () => {
    expect(points(true, 20, 20_000)).toBe(1000);
    expect(points(true, 60, 20_000)).toBe(999);
  });

  // The same table the SQL twin is checked against in Task 6, step 3.
  it.each([
    [0, 15_000, 1000],
    [1, 15_000, 1000],
    [2_500, 15_000, 917],
    [5_000, 15_000, 833],
    [7_500, 15_000, 750],
    [10_000, 15_000, 667],
    [14_999, 15_000, 500],
  ])('ms %i of %i gives %i', (ms, allowed, expected) => {
    expect(points(true, ms, allowed)).toBe(expected);
  });

  it('refuses a zero or negative time limit', () => {
    expect(() => points(true, 0, 0)).toThrow(RangeError);
  });
});

describe('isCorrectAnswer', () => {
  it('multiple choice: exact text after trimming', () => {
    expect(isCorrectAnswer('multiple_choice', '  Carbon dioxide ', 'Carbon dioxide')).toBe(true);
    expect(isCorrectAnswer('multiple_choice', 'carbon dioxide', 'Carbon dioxide')).toBe(false);
    expect(isCorrectAnswer('multiple_choice', 'Carbon  dioxide', 'Carbon dioxide')).toBe(false);
  });

  it('flashcard: exact text after trimming', () => {
    expect(isCorrectAnswer('flashcard', 'Mitochondria\n', 'Mitochondria')).toBe(true);
    expect(isCorrectAnswer('flashcard', 'mitochondria', 'Mitochondria')).toBe(false);
  });

  it('short answer: ignores case and collapses whitespace', () => {
    expect(isCorrectAnswer('short_answer', '  Carbon \t  DIOXIDE ', 'carbon dioxide')).toBe(true);
    expect(isCorrectAnswer('short_answer', 'carbon\ndioxide', 'Carbon Dioxide')).toBe(true);
  });

  it('short answer: different words are wrong', () => {
    expect(isCorrectAnswer('short_answer', 'oxygen', 'carbon dioxide')).toBe(false);
    expect(isCorrectAnswer('short_answer', 'carbondioxide', 'carbon dioxide')).toBe(false);
  });

  it('a blank answer is never right', () => {
    expect(isCorrectAnswer('short_answer', '   ', 'x')).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run supabase/functions/_shared/scoring.test.ts`
Expected: FAIL, "Failed to load url ./scoring.ts" (the file does not exist yet).

- [ ] **Step 3: Write the code**

Create `supabase/functions/_shared/scoring.ts`:

```ts
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
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run supabase/functions/_shared/scoring.test.ts`
Expected: PASS, 0 failed.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/scoring.ts supabase/functions/_shared/scoring.test.ts
git commit -m "A8: quiz scoring and answer matching

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Picking questions across chunks

**Files:**
- Create: `supabase/functions/_shared/quiz-pick.ts`
- Test: `supabase/functions/_shared/quiz-pick.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `pickQuestions(questions: readonly PickableQuestion[], count: number): string[]`
  - `visibleQuestions<Q extends { noteOwnerId: string; noteGroupId: string | null }>(questions: readonly Q[], userId: string, groupIds: ReadonlySet<string>): Q[]`
  - `interface PickableQuestion { id: string; chunkId: string }`

- [ ] **Step 1: Write the failing tests**

Create `supabase/functions/_shared/quiz-pick.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { pickQuestions, visibleQuestions } from './quiz-pick.ts';

const q = (id: string, chunkId: string) => ({ id, chunkId });

describe('pickQuestions', () => {
  const pool = [
    q('a1', 'A'), q('a2', 'A'), q('a3', 'A'),
    q('b1', 'B'), q('b2', 'B'),
    q('c1', 'C'),
  ];

  it('takes one question from each chunk before taking a second', () => {
    expect(pickQuestions(pool, 3)).toEqual(['a1', 'b1', 'c1']);
    expect(pickQuestions(pool, 5)).toEqual(['a1', 'b1', 'c1', 'a2', 'b2']);
  });

  it('returns everything when count is larger than the pool', () => {
    expect(pickQuestions(pool, 50)).toEqual(['a1', 'b1', 'c1', 'a2', 'b2', 'a3']);
  });

  it('does not depend on the order of the input', () => {
    const shuffled = [pool[5], pool[2], pool[3], pool[0], pool[4], pool[1]];
    expect(pickQuestions(shuffled, 4)).toEqual(pickQuestions(pool, 4));
  });

  it('ignores a question listed twice', () => {
    expect(pickQuestions([q('a1', 'A'), q('a1', 'A'), q('b1', 'B')], 5)).toEqual(['a1', 'b1']);
  });

  it('returns nothing for an empty pool or a count of 0', () => {
    expect(pickQuestions([], 10)).toEqual([]);
    expect(pickQuestions(pool, 0)).toEqual([]);
  });
});

describe('visibleQuestions', () => {
  const rows = [
    { id: 'mine', noteOwnerId: 'me', noteGroupId: null },
    { id: 'group', noteOwnerId: 'friend', noteGroupId: 'g1' },
    { id: 'other-group', noteOwnerId: 'friend', noteGroupId: 'g2' },
    { id: 'friend-private', noteOwnerId: 'friend', noteGroupId: null },
  ];

  it('keeps my notes and notes shared with my groups only', () => {
    const ids = visibleQuestions(rows, 'me', new Set(['g1'])).map((r) => r.id);
    expect(ids).toEqual(['mine', 'group']);
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run supabase/functions/_shared/quiz-pick.test.ts`
Expected: FAIL, "Failed to load url ./quiz-pick.ts".

- [ ] **Step 3: Write the code**

Create `supabase/functions/_shared/quiz-pick.ts`:

```ts
// Which questions a quiz asks. Pure code, tested with vitest.

export interface PickableQuestion {
  id: string;
  chunkId: string;
}

/**
 * Spread the quiz across the notes: one question from each chunk in turn,
 * then a second from each, and so on, until count is reached. Chunks and
 * the questions inside a chunk are sorted by id, so the same pool always
 * gives the same quiz (no randomness on the server, easy to test).
 */
export function pickQuestions(questions: readonly PickableQuestion[], count: number): string[] {
  const byChunk = new Map<string, Set<string>>();
  for (const { id, chunkId } of questions) {
    const ids = byChunk.get(chunkId) ?? new Set<string>();
    ids.add(id);
    byChunk.set(chunkId, ids);
  }
  const queues = [...byChunk.keys()]
    .sort()
    .map((chunkId) => [...byChunk.get(chunkId)!].sort());

  const picked: string[] = [];
  for (let round = 0; picked.length < count; round++) {
    let tookAny = false;
    for (const queue of queues) {
      if (picked.length >= count) break;
      if (round < queue.length) {
        picked.push(queue[round]);
        tookAny = true;
      }
    }
    if (!tookAny) break;
  }
  return picked;
}

/**
 * The server reads questions with the service role, which skips Row Level
 * Security. An exam shared with a group can have questions made from a
 * classmate's private note; this keeps only questions whose note the
 * caller could read themselves (own note, or note shared with one of
 * their groups), the same rule as the "questions: read with note" policy.
 */
export function visibleQuestions<Q extends { noteOwnerId: string; noteGroupId: string | null }>(
  questions: readonly Q[],
  userId: string,
  groupIds: ReadonlySet<string>,
): Q[] {
  return questions.filter(
    (row) => row.noteOwnerId === userId || (row.noteGroupId !== null && groupIds.has(row.noteGroupId)),
  );
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run supabase/functions/_shared/quiz-pick.test.ts`
Expected: PASS, 0 failed.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/quiz-pick.ts supabase/functions/_shared/quiz-pick.test.ts
git commit -m "A8: pick quiz questions across chunks, only from visible notes

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Request parsing

**Files:**
- Create: `supabase/functions/_shared/quiz-input.ts`
- Test: `supabase/functions/_shared/quiz-input.test.ts`

**Interfaces:**
- Consumes: `QUIZ_MODES` from `@cramrade/shared` (test only, to prove the copy matches; the runtime file never imports it).
- Produces:
  - `QUIZ_MODES` (`['group', 'solo'] as const`), `type QuizMode`
  - `type Parsed<T> = { ok: true; value: T } | { ok: false; message: string }`
  - `parseCreateInput(body: unknown): Parsed<CreateInput>` where `CreateInput = { source: { kind: 'exam'; examId: string } | { kind: 'note'; noteId: string }; count: number; secondsPerQuestion: number; mode: QuizMode }`
  - `parseRoomInput(body: unknown): Parsed<{ roomId: string }>`
  - `parseAnswerInput(body: unknown): Parsed<{ roomId: string; questionId: string; answer: string }>`
  - `parseAdvanceInput(body: unknown): Parsed<{ roomId: string; expectedIndex: number }>`

- [ ] **Step 1: Write the failing tests**

Create `supabase/functions/_shared/quiz-input.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
// Only the test imports the shared package; quiz-input.ts itself must not.
import { QUIZ_MODES as SHARED_QUIZ_MODES } from '@cramrade/shared';
import {
  QUIZ_MODES,
  parseAdvanceInput,
  parseAnswerInput,
  parseCreateInput,
  parseRoomInput,
} from './quiz-input.ts';

const ID = '3f1c2a8e-5b7d-4c1e-9a2b-1c2d3e4f5a6b';
const ID2 = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

describe('QUIZ_MODES', () => {
  // Edge Functions cannot import packages/shared once deployed, so the list
  // is copied. This test fails if the two copies drift apart.
  it('matches packages/shared', () => {
    expect([...QUIZ_MODES]).toEqual([...SHARED_QUIZ_MODES]);
  });
});

describe('parseCreateInput', () => {
  it('fills in the defaults', () => {
    expect(parseCreateInput({ source: { examId: ID }, mode: 'group' })).toEqual({
      ok: true,
      value: { source: { kind: 'exam', examId: ID }, count: 10, secondsPerQuestion: 20, mode: 'group' },
    });
  });

  it('accepts a note source and explicit numbers', () => {
    const r = parseCreateInput({ source: { noteId: ID }, mode: 'solo', count: 50, secondsPerQuestion: 5 });
    expect(r).toEqual({
      ok: true,
      value: { source: { kind: 'note', noteId: ID }, count: 50, secondsPerQuestion: 5, mode: 'solo' },
    });
  });

  it.each([
    ['no body', null],
    ['no source', { mode: 'group' }],
    ['both sources', { source: { examId: ID, noteId: ID2 }, mode: 'group' }],
    ['bad id', { source: { examId: 'abc' }, mode: 'group' }],
    ['no mode', { source: { examId: ID } }],
    ['unknown mode', { source: { examId: ID }, mode: 'team' }],
    ['count 0', { source: { examId: ID }, mode: 'group', count: 0 }],
    ['count 51', { source: { examId: ID }, mode: 'group', count: 51 }],
    ['count 2.5', { source: { examId: ID }, mode: 'group', count: 2.5 }],
    ['seconds 4', { source: { examId: ID }, mode: 'group', secondsPerQuestion: 4 }],
    ['seconds 301', { source: { examId: ID }, mode: 'group', secondsPerQuestion: 301 }],
    ['seconds as text', { source: { examId: ID }, mode: 'group', secondsPerQuestion: '20' }],
  ])('refuses %s', (_name, body) => {
    expect(parseCreateInput(body).ok).toBe(false);
  });
});

describe('parseRoomInput', () => {
  it('reads a room id', () => {
    expect(parseRoomInput({ roomId: ID })).toEqual({ ok: true, value: { roomId: ID } });
  });
  it('refuses a missing or bad id', () => {
    expect(parseRoomInput({}).ok).toBe(false);
    expect(parseRoomInput({ roomId: 42 }).ok).toBe(false);
  });
});

describe('parseAnswerInput', () => {
  it('reads room, question and answer', () => {
    expect(parseAnswerInput({ roomId: ID, questionId: ID2, answer: 'Paris' })).toEqual({
      ok: true,
      value: { roomId: ID, questionId: ID2, answer: 'Paris' },
    });
  });
  it.each([
    ['blank answer', { roomId: ID, questionId: ID2, answer: '   ' }],
    ['answer not text', { roomId: ID, questionId: ID2, answer: 3 }],
    ['answer over 500 characters', { roomId: ID, questionId: ID2, answer: 'x'.repeat(501) }],
    ['no question', { roomId: ID, answer: 'Paris' }],
  ])('refuses %s', (_name, body) => {
    expect(parseAnswerInput(body).ok).toBe(false);
  });
});

describe('parseAdvanceInput', () => {
  it('reads room and expected index', () => {
    expect(parseAdvanceInput({ roomId: ID, expectedIndex: 0 })).toEqual({
      ok: true,
      value: { roomId: ID, expectedIndex: 0 },
    });
  });
  it.each([
    ['negative index', { roomId: ID, expectedIndex: -1 }],
    ['fraction', { roomId: ID, expectedIndex: 1.5 }],
    ['missing index', { roomId: ID }],
  ])('refuses %s', (_name, body) => {
    expect(parseAdvanceInput(body).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run supabase/functions/_shared/quiz-input.test.ts`
Expected: FAIL, "Failed to load url ./quiz-input.ts".

- [ ] **Step 3: Write the code**

Create `supabase/functions/_shared/quiz-input.ts`:

```ts
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
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run supabase/functions/_shared/quiz-input.test.ts`
Expected: PASS, 0 failed.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/quiz-input.ts supabase/functions/_shared/quiz-input.test.ts
git commit -m "A8: parse quiz function inputs

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Room state and answer outcomes

**Files:**
- Create: `supabase/functions/_shared/quiz-room.ts`
- Test: `supabase/functions/_shared/quiz-room.test.ts`

**Interfaces:**
- Consumes: `QuizMode` from `./quiz-input.ts`.
- Produces:
  - `interface QuizRoomState { id; code; title; hostId; mode: QuizMode; status: 'lobby' | 'running' | 'finished'; secondsPerQuestion; resultsSeconds; currentQuestionIndex; questionStartedAt: string | null; questionCount; serverNow: string }`
  - `roomState(raw: unknown): QuizRoomState` (input: the JSON from `public.quiz_room_state`, `start_quiz_room` or `advance_quiz_room`)
  - `ANSWER_OUTCOMES = ['ok', 'no_room', 'not_player', 'not_current', 'too_late', 'duplicate'] as const`, `type AnswerOutcome`
  - `answerOutcomeError(outcome: AnswerOutcome): { status: number; code: string; message: string } | null`

- [ ] **Step 1: Write the failing tests**

Create `supabase/functions/_shared/quiz-room.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { answerOutcomeError, roomState } from './quiz-room.ts';

const raw = {
  room: {
    id: 'r1',
    host_id: 'h1',
    group_id: null,
    title: 'Biology',
    code: 'ABC234',
    status: 'running',
    mode: 'group',
    seconds_per_question: 20,
    results_seconds: 5,
    current_question_index: 2,
    question_started_at: '2026-10-10T12:00:00.123+00:00',
    created_at: '2026-10-10T11:59:00+00:00',
    updated_at: '2026-10-10T12:00:00+00:00',
  },
  questionCount: 5,
  serverNow: '2026-10-10T12:00:03.000+00:00',
};

describe('roomState', () => {
  it('turns the database row into the camelCase room state', () => {
    expect(roomState(raw)).toEqual({
      id: 'r1',
      code: 'ABC234',
      title: 'Biology',
      hostId: 'h1',
      mode: 'group',
      status: 'running',
      secondsPerQuestion: 20,
      resultsSeconds: 5,
      currentQuestionIndex: 2,
      questionStartedAt: '2026-10-10T12:00:00.123+00:00',
      questionCount: 5,
      serverNow: '2026-10-10T12:00:03.000+00:00',
    });
  });

  it('keeps a null start time for a room in the lobby', () => {
    const lobby = { ...raw, room: { ...raw.room, status: 'lobby', current_question_index: -1, question_started_at: null } };
    expect(roomState(lobby).questionStartedAt).toBeNull();
  });

  it('throws when the room is missing (database returned null)', () => {
    expect(() => roomState(null)).toThrow();
    expect(() => roomState({ room: null, questionCount: 0, serverNow: 'x' })).toThrow();
  });
});

describe('answerOutcomeError', () => {
  it('is null for a scored answer', () => {
    expect(answerOutcomeError('ok')).toBeNull();
  });

  it('maps each refusal to its status', () => {
    expect(answerOutcomeError('no_room')?.status).toBe(404);
    expect(answerOutcomeError('not_player')?.status).toBe(403);
    expect(answerOutcomeError('not_current')).toMatchObject({ status: 409, code: 'not_current_question' });
    expect(answerOutcomeError('too_late')).toMatchObject({ status: 409, code: 'too_late' });
    expect(answerOutcomeError('duplicate')).toMatchObject({ status: 409, code: 'already_answered' });
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run supabase/functions/_shared/quiz-room.test.ts`
Expected: FAIL, "Failed to load url ./quiz-room.ts".

- [ ] **Step 3: Write the code**

Create `supabase/functions/_shared/quiz-room.ts`:

```ts
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
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run supabase/functions/_shared/quiz-room.test.ts`
Expected: PASS, 0 failed.

- [ ] **Step 5: Run every `_shared` test together**

Run: `npx vitest run supabase/functions/_shared`
Expected: PASS for scoring, quiz-pick, quiz-input and quiz-room (plus any a4a tests), 0 failed.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/_shared/quiz-room.ts supabase/functions/_shared/quiz-room.test.ts
git commit -m "A8: quiz room state shape and answer refusal codes

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Database functions for start, answer and advance

**Files:**
- Create: `supabase/migrations/<timestamp>_quiz_answer_fn.sql` (the CLI picks the timestamp)

**Interfaces:**
- Consumes: tables from the initial schema and the a4a migration (`quiz_rooms.mode`, `quiz_rooms.results_seconds`, `quiz_answers.points`).
- Produces (all callable by `service_role` only):
  - `private.quiz_points(correct boolean, ms_taken bigint, ms_allowed bigint) returns integer`
  - `public.quiz_room_state(p_room_id uuid) returns jsonb`: `{ room, questionCount, serverNow }`, or null when the room does not exist
  - `public.start_quiz_room(p_room_id uuid) returns jsonb`: `{ started: boolean, room, questionCount, serverNow }`
  - `public.submit_quiz_answer(p_room_id uuid, p_user_id uuid, p_question_id uuid, p_answer text, p_is_correct boolean) returns jsonb`: `{ outcome, isCorrect, points, score }`
  - `public.advance_quiz_room(p_room_id uuid, p_expected_index integer) returns jsonb`: `{ advanced: boolean, room, questionCount, serverNow }`

Why `public` and not `private`: the Edge Functions call these through the Supabase API (`db.rpc`), and the API only exposes the `public` schema. Each function has execute revoked from `anon` and `authenticated` (Supabase grants new public functions to them by default), so no app can call them. `quiz_points` is only called from SQL, so it stays in `private`.

Why these run as the caller (no `security definer`): only the service role can run them, and it already has full table access.

- [ ] **Step 1: Create the migration file**

Run: `npx supabase migration new quiz_answer_fn`
Expected: prints `Created new migration at supabase/migrations/<timestamp>_quiz_answer_fn.sql`. Its timestamp must sort after a4a's `server_side` migration; check with `ls supabase/migrations`.

- [ ] **Step 2: Write the SQL**

Put this in the new file:

```sql
-- A8 quiz server: the steps that must happen in one go on the database.
--
-- The Edge Functions quiz-create, quiz-start, quiz-answer and quiz-advance
-- check who is calling, then call these functions with the service role.
-- Each decision that depends on time ("is the question still open?", "is
-- it time to move on?") is made here with the database clock, inside the
-- same statement that writes the result, so two requests can never both
-- win and no client clock is ever trusted.
--
-- They live in public because the API only exposes public; execute is
-- revoked from every app role at the bottom of this file.

-- Points for one answer. Twin of points() in
-- supabase/functions/_shared/scoring.ts; change both together.
-- 1000 at an instant answer, 500 at the last moment, 0 when wrong.
create or replace function private.quiz_points(correct boolean, ms_taken bigint, ms_allowed bigint)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case
    when not correct then 0
    -- numeric division, so an exact half rounds away from zero like Math.round
    else round(1000 - (500 * least(greatest(ms_taken, 0), ms_allowed))::numeric / ms_allowed)::integer
  end;
$$;

-- The room as the quiz functions return it, plus the question count and
-- the database clock. Null when the room does not exist.
create or replace function public.quiz_room_state(p_room_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'room', to_jsonb(r),
    'questionCount', (select count(*) from public.quiz_room_questions q where q.room_id = r.id),
    'serverNow', now()
  )
  from public.quiz_rooms r
  where r.id = p_room_id;
$$;

-- Start a room: lobby to running, first question, clock starts now.
-- Only a room in the lobby with at least one player and one question starts.
create or replace function public.start_quiz_room(p_room_id uuid)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_moved integer;
begin
  update public.quiz_rooms r
  set status = 'running',
      current_question_index = 0,
      question_started_at = now()
  where r.id = p_room_id
    and r.status = 'lobby'
    and exists (select 1 from public.quiz_players p where p.room_id = r.id)
    and exists (select 1 from public.quiz_room_questions q where q.room_id = r.id);
  get diagnostics v_moved = row_count;

  return jsonb_build_object('started', v_moved > 0) || public.quiz_room_state(p_room_id);
end;
$$;

-- Record one answer and add its points to the player's score.
--
-- p_is_correct is worked out by the Edge Function (isCorrectAnswer in
-- scoring.ts), because it only compares text. Everything that depends on
-- time or on earlier answers is decided here:
--   - the room is running and p_question_id is the question at the
--     current position
--   - now() is before question_started_at + seconds_per_question
--   - the player has not answered this question before
-- The room row is locked for share, so an advance (which updates that row)
-- waits until this answer is written, and this answer never lands on a
-- question that has just been replaced.
create or replace function public.submit_quiz_answer(
  p_room_id uuid,
  p_user_id uuid,
  p_question_id uuid,
  p_answer text,
  p_is_correct boolean
)
returns jsonb
language plpgsql
set search_path = ''
as $$
-- Variables start with v_ so none shares a name with a column (plpgsql
-- would call that ambiguous, for example in the on conflict list).
declare
  v_room public.quiz_rooms;
  v_player_id uuid;
  v_answered_at timestamptz := now();
  v_ms_allowed bigint;
  v_ms_taken bigint;
  v_points integer;
  v_score integer;
begin
  select r.* into v_room
  from public.quiz_rooms r
  where r.id = p_room_id
  for share;

  if v_room.id is null then
    return jsonb_build_object('outcome', 'no_room');
  end if;

  select p.id into v_player_id
  from public.quiz_players p
  where p.room_id = p_room_id and p.user_id = p_user_id;

  if v_player_id is null then
    return jsonb_build_object('outcome', 'not_player');
  end if;

  if v_room.status <> 'running'
     or v_room.question_started_at is null
     or not exists (
       select 1 from public.quiz_room_questions rq
       where rq.room_id = v_room.id
         and rq.position = v_room.current_question_index
         and rq.question_id = p_question_id
     ) then
    return jsonb_build_object('outcome', 'not_current');
  end if;

  v_ms_allowed := v_room.seconds_per_question::bigint * 1000;
  v_ms_taken := floor(extract(epoch from (v_answered_at - v_room.question_started_at)) * 1000)::bigint;

  if v_ms_taken >= v_ms_allowed then
    return jsonb_build_object('outcome', 'too_late');
  end if;

  v_points := private.quiz_points(p_is_correct, v_ms_taken, v_ms_allowed);

  insert into public.quiz_answers (room_id, player_id, question_id, answer, is_correct, answered_at, points)
  values (p_room_id, v_player_id, p_question_id, p_answer, p_is_correct, v_answered_at, v_points)
  on conflict (player_id, question_id) do nothing;

  if not found then
    return jsonb_build_object('outcome', 'duplicate');
  end if;

  update public.quiz_players p
  set score = p.score + v_points
  where p.id = v_player_id
  returning p.score into v_score;

  return jsonb_build_object('outcome', 'ok', 'isCorrect', p_is_correct, 'points', v_points, 'score', v_score);
end;
$$;

-- Move the room to the next question, or finish it after the last one.
--
-- One conditional update: it only matches while the room is still on
-- p_expected_index and the answering and results phases are both over.
-- When five clients call at the same moment, the first update changes the
-- index, the row no longer matches for the others, and they change
-- nothing. Every caller gets the room as it is now.
create or replace function public.advance_quiz_room(p_room_id uuid, p_expected_index integer)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_question_count integer;
  v_is_last boolean;
  v_moved integer;
begin
  select count(*) into v_question_count
  from public.quiz_room_questions q
  where q.room_id = p_room_id;

  v_is_last := p_expected_index + 1 >= v_question_count;

  update public.quiz_rooms r
  set current_question_index = case when v_is_last then r.current_question_index else p_expected_index + 1 end,
      question_started_at = case when v_is_last then r.question_started_at else now() end,
      status = case when v_is_last then 'finished' else 'running' end
  where r.id = p_room_id
    and r.status = 'running'
    and r.current_question_index = p_expected_index
    and now() >= r.question_started_at
                 + make_interval(secs => r.seconds_per_question + r.results_seconds);
  get diagnostics v_moved = row_count;

  return jsonb_build_object('advanced', v_moved > 0) || public.quiz_room_state(p_room_id);
end;
$$;

-- Only the service role (the Edge Functions) may run these.
revoke execute on function
  private.quiz_points(boolean, bigint, bigint),
  public.quiz_room_state(uuid),
  public.start_quiz_room(uuid),
  public.submit_quiz_answer(uuid, uuid, uuid, text, boolean),
  public.advance_quiz_room(uuid, integer)
from public, anon, authenticated;

grant execute on function
  private.quiz_points(boolean, bigint, bigint),
  public.quiz_room_state(uuid),
  public.start_quiz_room(uuid),
  public.submit_quiz_answer(uuid, uuid, uuid, text, boolean),
  public.advance_quiz_room(uuid, integer)
to service_role;

-- Answers now go only through quiz-answer, which scores them. Before this,
-- a client could insert into quiz_answers directly: that row had no score,
-- and it blocked the player's real answer as a duplicate. Remove that path.
drop policy if exists "quiz_answers: player answers current question" on public.quiz_answers;
revoke insert (room_id, player_id, question_id, answer) on public.quiz_answers from authenticated;
revoke insert on public.quiz_answers from anon, authenticated;
```

- [ ] **Step 3: Check the SQL without changing the live database**

There is no test copy of the database. Paste this into the Supabase dashboard SQL editor (project `ialkxvoytoqfuxxnzlaa`) after the whole migration text, wrapped as shown. It creates everything inside a transaction, checks the points twin against the table from `scoring.test.ts`, and rolls back, so nothing stays.

```sql
begin;
-- (paste the full migration text here)

select ms, allowed, private.quiz_points(true, ms, allowed) as got, expected
from (values
  (0, 20000, 1000), (20000, 20000, 500), (10000, 20000, 750), (25000, 20000, 500),
  (-50, 20000, 1000), (20, 20000, 1000), (60, 20000, 999),
  (0, 15000, 1000), (1, 15000, 1000), (2500, 15000, 917), (5000, 15000, 833),
  (7500, 15000, 750), (10000, 15000, 667), (14999, 15000, 500)
) as t(ms, allowed, expected)
where private.quiz_points(true, ms, allowed) <> expected;

select private.quiz_points(false, 0, 20000) as wrong_gives_zero;
rollback;
```

Expected: the first query returns no rows (every value matches TypeScript), the second returns `0`, and the editor ends with `ROLLBACK`. Any error message (a typo, a missing column from a4a) must be fixed in the migration before continuing.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/*_quiz_answer_fn.sql
git commit -m "A8: database functions to start, answer and advance a quiz atomically

Answers now go only through the quiz-answer function; the direct client
insert on quiz_answers is removed.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Shared database helpers and quiz-create

**Files:**
- Create: `supabase/functions/_shared/quiz-db.ts`
- Create: `supabase/functions/quiz-create/index.ts`
- Modify: `supabase/config.toml` (append at the end)

**Interfaces:**
- Consumes: `requireFullUser` (a4a), `db` (a4a), `HttpError`, `json`, `handle` (a4a), `parseCreateInput`, `pickQuestions`, `visibleQuestions`, `roomState`, `QuizRoomState`, the SQL functions from Task 6.
- Produces:
  - In `quiz-db.ts`: `loadRoom(roomId: string): Promise<QuizRoomState>` (throws 404), `isRoomMember(roomId: string, userId: string): Promise<{ host: boolean; player: boolean }>`, `startRoom(roomId: string): Promise<{ started: boolean; room: QuizRoomState }>`, `groupIdsOf(userId: string): Promise<Set<string>>`
  - HTTP `POST /functions/v1/quiz-create` with `{ source: { examId } | { noteId }, count?, secondsPerQuestion?, mode }` answers 200 `{ roomId, code, questionCount, status, room: QuizRoomState }`.

- [ ] **Step 1: Create the function folder by hand**

Do not use `npx supabase functions new`: CLI 2.119.0 appends its own `[functions.quiz-create]` block with `verify_jwt = false`, `import_map` and `entrypoint`, and creates a `deno.json`. This plan writes the folder and the config block itself, like the a4a plan.

Run: `mkdir -p supabase/functions/quiz-create`
Expected: the folder exists and is empty. The next steps create `index.ts` in it.

- [ ] **Step 2: Write `quiz-db.ts`**

Create `supabase/functions/_shared/quiz-db.ts`:

```ts
// Database calls the four quiz functions share. Uses the service-role
// client, which skips Row Level Security, so every caller check happens in
// the function before these are called. Not unit tested (needs a
// database); covered by scripts/quiz-e2e.mjs.

import { db } from './db.ts';
import { HttpError } from './http.ts';
import { roomState, type QuizRoomState } from './quiz-room.ts';

export async function loadRoom(roomId: string): Promise<QuizRoomState> {
  const { data, error } = await db.rpc('quiz_room_state', { p_room_id: roomId });
  if (error) throw new HttpError(500, 'internal', error.message);
  if (!data) throw new HttpError(404, 'room_not_found', 'No quiz room with that id.');
  return roomState(data);
}

export async function isRoomMember(
  roomId: string,
  userId: string,
): Promise<{ host: boolean; player: boolean }> {
  const [room, player] = await Promise.all([
    db.from('quiz_rooms').select('host_id').eq('id', roomId).maybeSingle(),
    db.from('quiz_players').select('id').eq('room_id', roomId).eq('user_id', userId).maybeSingle(),
  ]);
  if (room.error) throw new HttpError(500, 'internal', room.error.message);
  if (player.error) throw new HttpError(500, 'internal', player.error.message);
  if (!room.data) throw new HttpError(404, 'room_not_found', 'No quiz room with that id.');
  return { host: room.data.host_id === userId, player: player.data !== null };
}

export async function startRoom(roomId: string): Promise<{ started: boolean; room: QuizRoomState }> {
  const { data, error } = await db.rpc('start_quiz_room', { p_room_id: roomId });
  if (error) throw new HttpError(500, 'internal', error.message);
  return { started: data.started === true, room: roomState(data) };
}

export async function groupIdsOf(userId: string): Promise<Set<string>> {
  const { data, error } = await db.from('group_members').select('group_id').eq('user_id', userId);
  if (error) throw new HttpError(500, 'internal', error.message);
  return new Set((data ?? []).map((row: { group_id: string }) => row.group_id));
}
```

- [ ] **Step 3: Write `quiz-create/index.ts`**

Create `supabase/functions/quiz-create/index.ts`:

```ts
// quiz-create: a full user makes a quiz room from an exam or a note they
// can see. Group mode waits in the lobby for players; solo mode joins the
// caller and starts at once (spec 9.1).

import { requireFullUser } from '../_shared/auth.ts';
import { db } from '../_shared/db.ts';
import { HttpError, handle, json } from '../_shared/http.ts';
import { parseCreateInput, type QuizSource } from '../_shared/quiz-input.ts';
import { pickQuestions, visibleQuestions } from '../_shared/quiz-pick.ts';
import { groupIdsOf, loadRoom, startRoom } from '../_shared/quiz-db.ts';

interface SourceRow {
  id: string;
  owner_id: string;
  group_id: string | null;
  title: string;
}

async function loadSource(source: QuizSource): Promise<SourceRow> {
  const table = source.kind === 'exam' ? 'exams' : 'notes';
  const id = source.kind === 'exam' ? source.examId : source.noteId;
  const { data, error } = await db.from(table).select('id, owner_id, group_id, title').eq('id', id).maybeSingle();
  if (error) throw new HttpError(500, 'internal', error.message);
  if (!data) throw new HttpError(404, 'source_not_found', `No ${source.kind} with that id.`);
  return data as SourceRow;
}

interface QuestionRow {
  id: string;
  chunk_id: string;
  notes: { owner_id: string; group_id: string | null };
}

async function loadQuestions(source: QuizSource) {
  const column = source.kind === 'exam' ? 'exam_id' : 'note_id';
  const id = source.kind === 'exam' ? source.examId : source.noteId;
  const { data, error } = await db
    .from('questions')
    .select('id, chunk_id, notes!inner(owner_id, group_id)')
    .eq(column, id)
    .eq('verified', true);
  if (error) throw new HttpError(500, 'internal', error.message);
  return ((data ?? []) as unknown as QuestionRow[]).map((row) => ({
    id: row.id,
    chunkId: row.chunk_id,
    noteOwnerId: row.notes.owner_id,
    noteGroupId: row.notes.group_id,
  }));
}

async function insertRoom(fields: Record<string, unknown>): Promise<{ id: string; code: string }> {
  // The join code is random (6 characters). On the rare clash with an
  // existing room, the unique index refuses it and we try again.
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data, error } = await db.from('quiz_rooms').insert(fields).select('id, code').single();
    if (!error) return data as { id: string; code: string };
    if (error.code !== '23505') throw new HttpError(500, 'internal', error.message);
  }
  throw new HttpError(500, 'code_clash', 'Could not make a unique room code. Try again.');
}

Deno.serve(
  handle(async (req) => {
    if (req.method !== 'POST') throw new HttpError(400, 'bad_input', 'Use POST.');
    const user = await requireFullUser(req);
    const parsed = parseCreateInput(await req.json().catch(() => null));
    if (!parsed.ok) throw new HttpError(400, 'bad_input', parsed.message);
    const input = parsed.value;

    const source = await loadSource(input.source);
    const groupIds = await groupIdsOf(user.id);
    const canSee = source.owner_id === user.id || (source.group_id !== null && groupIds.has(source.group_id));
    if (!canSee) throw new HttpError(403, 'not_yours', `You cannot use this ${input.source.kind}.`);

    const pool = visibleQuestions(await loadQuestions(input.source), user.id, groupIds);
    const questionIds = pickQuestions(pool, input.count);
    if (questionIds.length === 0) {
      throw new HttpError(409, 'no_questions', 'There are no checked questions for this yet.');
    }

    const room = await insertRoom({
      host_id: user.id, // the service role has no auth.uid(), so the default would be null
      group_id: source.group_id,
      title: source.title.slice(0, 120),
      mode: input.mode,
      seconds_per_question: input.secondsPerQuestion,
    });

    const { error: listError } = await db
      .from('quiz_room_questions')
      .insert(questionIds.map((questionId, position) => ({ room_id: room.id, question_id: questionId, position })));
    if (listError) {
      await db.from('quiz_rooms').delete().eq('id', room.id);
      throw new HttpError(500, 'internal', listError.message);
    }

    if (input.mode === 'solo') {
      const { data: profile } = await db.from('profiles').select('display_name').eq('id', user.id).maybeSingle();
      const nickname = ((profile?.display_name as string | null) ?? 'Player').trim().slice(0, 24) || 'Player';
      const { error: playerError } = await db
        .from('quiz_players')
        .insert({ room_id: room.id, user_id: user.id, nickname });
      if (playerError) throw new HttpError(500, 'internal', playerError.message);
      const { room: started } = await startRoom(room.id);
      return json({
        roomId: room.id,
        code: room.code,
        questionCount: started.questionCount,
        status: started.status,
        room: started,
      });
    }

    const state = await loadRoom(room.id);
    return json({ roomId: room.id, code: room.code, questionCount: state.questionCount, status: state.status, room: state });
  }),
);
```

- [ ] **Step 4: Add the config entry**

Append to the end of `supabase/config.toml`, in the same form as a4a's blocks (`enabled = true`, `verify_jwt = true`; only `calendar-feed` uses `false`):

```toml
[functions.quiz-create]
enabled = true
verify_jwt = true
```

- [ ] **Step 5: Check it parses**

There is no Deno on this computer, so the TypeScript in `index.ts` is checked by reading and by the deploy on merge. Run the `_shared` tests again to make sure nothing they cover changed:

Run: `npx vitest run supabase/functions/_shared`
Expected: PASS, 0 failed.

Then read `index.ts` once against this list: every `throw` is an `HttpError` with a status from Global Constraints; `host_id` is set explicitly; the room is deleted if the question list fails to insert.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/_shared/quiz-db.ts supabase/functions/quiz-create/index.ts supabase/config.toml
git commit -m "A8: quiz-create function, group and solo rooms

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: quiz-start

**Files:**
- Create: `supabase/functions/quiz-start/index.ts`
- Modify: `supabase/config.toml` (append)

**Interfaces:**
- Consumes: `requireFullUser`, `HttpError`, `handle`, `json`, `parseRoomInput`, `isRoomMember`, `loadRoom`, `startRoom`.
- Produces: HTTP `POST /functions/v1/quiz-start` with `{ roomId }` answers 200 `{ room: QuizRoomState }`; 403 `not_host`; 409 `not_in_lobby` or `no_players`.

- [ ] **Step 1: Create the function folder by hand**

Do not use `npx supabase functions new`: CLI 2.119.0 appends its own `[functions.quiz-start]` block with `verify_jwt = false`, `import_map` and `entrypoint`, and creates a `deno.json`. This plan writes the folder and the config block itself, like the a4a plan.

Run: `mkdir -p supabase/functions/quiz-start`
Expected: the folder exists and is empty. The next steps create `index.ts` in it.

- [ ] **Step 2: Write `quiz-start/index.ts`**

Create `index.ts` in the new folder with:

```ts
// quiz-start: the host starts a room that is waiting in the lobby. The
// database sets the first question and its start time (spec 9.1).

import { requireFullUser } from '../_shared/auth.ts';
import { db } from '../_shared/db.ts';
import { HttpError, handle, json } from '../_shared/http.ts';
import { parseRoomInput } from '../_shared/quiz-input.ts';
import { isRoomMember, loadRoom, startRoom } from '../_shared/quiz-db.ts';

Deno.serve(
  handle(async (req) => {
    if (req.method !== 'POST') throw new HttpError(400, 'bad_input', 'Use POST.');
    // Hosts are full users (quiz-create requires it), so a guest can never be one.
    const user = await requireFullUser(req);
    const parsed = parseRoomInput(await req.json().catch(() => null));
    if (!parsed.ok) throw new HttpError(400, 'bad_input', parsed.message);
    const { roomId } = parsed.value;

    const member = await isRoomMember(roomId, user.id);
    if (!member.host) throw new HttpError(403, 'not_host', 'Only the host can start the quiz.');

    const before = await loadRoom(roomId);
    if (before.status !== 'lobby') throw new HttpError(409, 'not_in_lobby', 'This quiz has already started.');

    const { count, error } = await db
      .from('quiz_players')
      .select('id', { count: 'exact', head: true })
      .eq('room_id', roomId);
    if (error) throw new HttpError(500, 'internal', error.message);
    if (!count) throw new HttpError(409, 'no_players', 'Wait for at least one player to join.');

    const { started, room } = await startRoom(roomId);
    // Another start request won the race between our checks and the update.
    if (!started) throw new HttpError(409, 'not_in_lobby', 'This quiz has already started.');
    return json({ room });
  }),
);
```

- [ ] **Step 3: Add the config entry**

Append to the end of `supabase/config.toml`:

```toml
[functions.quiz-start]
enabled = true
verify_jwt = true
```

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/quiz-start/index.ts supabase/config.toml
git commit -m "A8: quiz-start function

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: quiz-answer

**Files:**
- Create: `supabase/functions/quiz-answer/index.ts`
- Modify: `supabase/config.toml` (append)

**Interfaces:**
- Consumes: `requireUser`, `db`, `HttpError`, `handle`, `json`, `parseAnswerInput`, `isCorrectAnswer`, `QuestionKind`, `answerOutcomeError`, `AnswerOutcome`, `public.submit_quiz_answer`.
- Produces: HTTP `POST /functions/v1/quiz-answer` with `{ roomId, questionId, answer }` answers 200 `{ isCorrect: boolean, points: number, score: number }`; 404 `room_not_found` or `question_not_found`; 403 `not_a_player`; 409 `not_current_question`, `too_late` or `already_answered`.

- [ ] **Step 1: Create the function folder by hand**

Do not use `npx supabase functions new`: CLI 2.119.0 appends its own `[functions.quiz-answer]` block with `verify_jwt = false`, `import_map` and `entrypoint`, and creates a `deno.json`. This plan writes the folder and the config block itself, like the a4a plan.

Run: `mkdir -p supabase/functions/quiz-answer`
Expected: the folder exists and is empty. The next steps create `index.ts` in it.

- [ ] **Step 2: Write `quiz-answer/index.ts`**

Create `index.ts` in the new folder with:

```ts
// quiz-answer: a player answers the current question. Guests allowed.
// The text comparison happens here (isCorrectAnswer); the deadline,
// duplicate check, points and score update happen in one database call
// (public.submit_quiz_answer), timed by the database clock (spec 9.1).

import { requireUser } from '../_shared/auth.ts';
import { db } from '../_shared/db.ts';
import { HttpError, handle, json } from '../_shared/http.ts';
import { parseAnswerInput } from '../_shared/quiz-input.ts';
import { answerOutcomeError, type AnswerOutcome } from '../_shared/quiz-room.ts';
import { isCorrectAnswer, type QuestionKind } from '../_shared/scoring.ts';

Deno.serve(
  handle(async (req) => {
    if (req.method !== 'POST') throw new HttpError(400, 'bad_input', 'Use POST.');
    const user = await requireUser(req);
    const parsed = parseAnswerInput(await req.json().catch(() => null));
    if (!parsed.ok) throw new HttpError(400, 'bad_input', parsed.message);
    const { roomId, questionId, answer } = parsed.value;

    const { data: question, error } = await db
      .from('questions')
      .select('kind, answer')
      .eq('id', questionId)
      .maybeSingle();
    if (error) throw new HttpError(500, 'internal', error.message);
    if (!question) throw new HttpError(404, 'question_not_found', 'No question with that id.');

    const isCorrect = isCorrectAnswer(question.kind as QuestionKind, answer, question.answer as string);

    const { data, error: rpcError } = await db.rpc('submit_quiz_answer', {
      p_room_id: roomId,
      p_user_id: user.id,
      p_question_id: questionId,
      p_answer: answer,
      p_is_correct: isCorrect,
    });
    if (rpcError) throw new HttpError(500, 'internal', rpcError.message);

    const refusal = answerOutcomeError(data.outcome as AnswerOutcome);
    if (refusal) throw new HttpError(refusal.status, refusal.code, refusal.message);
    return json({ isCorrect: data.isCorrect, points: data.points, score: data.score });
  }),
);
```

- [ ] **Step 3: Add the config entry**

Append to the end of `supabase/config.toml`:

```toml
[functions.quiz-answer]
enabled = true
verify_jwt = true
```

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/quiz-answer/index.ts supabase/config.toml
git commit -m "A8: quiz-answer function, scored on the database clock

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: quiz-advance

**Files:**
- Create: `supabase/functions/quiz-advance/index.ts`
- Modify: `supabase/config.toml` (append)

**Interfaces:**
- Consumes: `requireUser`, `db`, `HttpError`, `handle`, `json`, `parseAdvanceInput`, `isRoomMember`, `roomState`, `public.advance_quiz_room`.
- Produces: HTTP `POST /functions/v1/quiz-advance` with `{ roomId, expectedIndex }` answers 200 `{ advanced: boolean, room: QuizRoomState }` whether or not this call moved the room; 403 `not_in_room`.

- [ ] **Step 1: Create the function folder by hand**

Do not use `npx supabase functions new`: CLI 2.119.0 appends its own `[functions.quiz-advance]` block with `verify_jwt = false`, `import_map` and `entrypoint`, and creates a `deno.json`. This plan writes the folder and the config block itself, like the a4a plan.

Run: `mkdir -p supabase/functions/quiz-advance`
Expected: the folder exists and is empty. The next steps create `index.ts` in it.

- [ ] **Step 2: Write `quiz-advance/index.ts`**

Create `index.ts` in the new folder with:

```ts
// quiz-advance: any player or the host asks the server to move on once the
// answering and results phases are over. The database decides whether it
// is time, and only the first caller for a question moves the room; the
// rest get advanced: false and the same room (spec 9.1).

import { requireUser } from '../_shared/auth.ts';
import { db } from '../_shared/db.ts';
import { HttpError, handle, json } from '../_shared/http.ts';
import { parseAdvanceInput } from '../_shared/quiz-input.ts';
import { isRoomMember } from '../_shared/quiz-db.ts';
import { roomState } from '../_shared/quiz-room.ts';

Deno.serve(
  handle(async (req) => {
    if (req.method !== 'POST') throw new HttpError(400, 'bad_input', 'Use POST.');
    const user = await requireUser(req);
    const parsed = parseAdvanceInput(await req.json().catch(() => null));
    if (!parsed.ok) throw new HttpError(400, 'bad_input', parsed.message);
    const { roomId, expectedIndex } = parsed.value;

    const member = await isRoomMember(roomId, user.id);
    if (!member.host && !member.player) throw new HttpError(403, 'not_in_room', 'Join the room first.');

    const { data, error } = await db.rpc('advance_quiz_room', {
      p_room_id: roomId,
      p_expected_index: expectedIndex,
    });
    if (error) throw new HttpError(500, 'internal', error.message);
    return json({ advanced: data.advanced === true, room: roomState(data) });
  }),
);
```

- [ ] **Step 3: Add the config entry**

Append to the end of `supabase/config.toml`:

```toml
[functions.quiz-advance]
enabled = true
verify_jwt = true
```

- [ ] **Step 4: Check the config has all four blocks**

Run: `grep -n -A2 "^\[functions\.quiz-" supabase/config.toml`
Expected: exactly four blocks, `quiz-create`, `quiz-start`, `quiz-answer`, `quiz-advance`, each with `enabled = true` and `verify_jwt = true`, the same as a4a's blocks.

If a block shows `verify_jwt = false`, or a quiz function appears twice, or has `import_map` or `entrypoint` lines, the CLI was used by mistake: keep one block per function, set it to `enabled = true` and `verify_jwt = true`, delete the extra lines, and delete any `deno.json` inside the quiz function folders (`ls supabase/functions/quiz-*/deno.json` must print nothing). With `false`, the function would accept calls with no login.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/quiz-advance/index.ts supabase/config.toml
git commit -m "A8: quiz-advance function, first caller moves the room

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: Guide for Dev B

**Files:**
- Create: `supabase/functions/quiz-README.md`

**Interfaces:**
- Consumes: the four functions' inputs and outputs (Tasks 7 to 10), `join_quiz_room`, `current_quiz_question`.
- Produces: the document Dev B builds B8 (quiz host and play screens) against.

- [ ] **Step 1: Write the guide**

Create `supabase/functions/quiz-README.md`:

````markdown
# Live quiz: how the app talks to the server

For Dev B, building the quiz host and play screens (B8). Server side is task A8.

The server owns the clock and the scores. The app never sends a time or a score. It shows what the server says and asks the server to move on when the time is up.

## The pieces

- Four server functions, called with `supabase.functions.invoke(name, { body })` while signed in: `quiz-create`, `quiz-start`, `quiz-answer`, `quiz-advance`.
- Two database functions, called with `supabase.rpc(name, args)`: `join_quiz_room(code, nickname)` and `current_quiz_question(room_id)`.
- Two live tables, watched with Realtime: `quiz_rooms` (one row per room) and `quiz_players` (one row per player, with the score).

Every function failure looks like `{ "error": { "code": "too_late", "message": "Time is up for this question." } }`. Show the message; use the code to decide what to do.

## The room state

`quiz-create`, `quiz-start` and `quiz-advance` all return the room like this:

```json
{
  "id": "…", "code": "ABC234", "title": "Biology", "hostId": "…",
  "mode": "group", "status": "running",
  "secondsPerQuestion": 20, "resultsSeconds": 5,
  "currentQuestionIndex": 2, "questionStartedAt": "2026-10-10T12:00:00.123+00:00",
  "questionCount": 10, "serverNow": "2026-10-10T12:00:03.000+00:00"
}
```

`serverNow` is the server's clock when it answered. Work out how far the phone or browser clock is off, once per answer, and use that for every countdown:

```ts
const offsetMs = Date.parse(room.serverNow) - Date.now(); // add to Date.now() to get server time
const serverNowMs = () => Date.now() + offsetMs;
```

## Host flow (web only)

1. Call `quiz-create` with `{ source: { examId } }` or `{ source: { noteId } }`, `mode: "group"`, and optionally `count` (1 to 50, default 10) and `secondsPerQuestion` (5 to 300, default 20). The answer has `roomId` and `code`.
2. Show the code (and a join link with it) so players can join.
3. Watch `quiz_players` for the room to show who has joined.
4. Call `quiz-start` with `{ roomId }`. It refuses with `no_players` until someone has joined.
5. From here the host screen runs exactly like a player screen, without the answer buttons.

Solo mode: call `quiz-create` with `mode: "solo"`. The student is added as the only player and the quiz starts at once (`status` is `running`). Go straight to the play screen.

## Player flow (web and phone)

1. Sign in. Guests use `supabase.auth.signInAnonymously()`.
2. Call `supabase.rpc('join_quiz_room', { code, nickname })`. It returns the player row (`id`, `score`). Calling it again with the same login returns the same row and score, which is how a player who reloads the page gets back in.
3. Subscribe to the room row and the players:

```ts
supabase
  .channel(`quiz:${roomId}`)
  .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'quiz_rooms', filter: `id=eq.${roomId}` },
      (payload) => onRoom(payload.new))
  .on('postgres_changes', { event: '*', schema: 'public', table: 'quiz_players', filter: `room_id=eq.${roomId}` },
      (payload) => onPlayer(payload))
  .subscribe();
```

   The Realtime row uses database names (`current_question_index`, `question_started_at`, `seconds_per_question`, `results_seconds`, `status`). Realtime does not carry `serverNow`; keep the offset from the last function answer, or call `quiz-advance` once on joining (it is harmless and returns the room with `serverNow`).
4. Whenever `current_question_index` changes, call `supabase.rpc('current_quiz_question', { room_id: roomId })`. It returns `question_id`, `prompt`, `kind` and `choices`. Players never read the question list directly, so nobody can read ahead.
5. Work out the phase from three numbers, all in server time:
   - answering: from `question_started_at` until `question_started_at + seconds_per_question`
   - results: from there until `+ results_seconds` more
   - then the next question, or the end when `status` becomes `finished`
6. During answering, send the player's choice once: `quiz-answer` with `{ roomId, questionId, answer }`. For multiple choice, send the choice text exactly as shown. The answer is `{ isCorrect, points, score }`. Points are 1000 for an instant right answer, falling to 500 at the last moment, and 0 when wrong.
7. When answering ends, call `current_quiz_question` again: it now includes `answer`, so the results phase can show the right answer.
8. When the results phase ends on the local timer, call `quiz-advance` with `{ roomId, expectedIndex: current_question_index }`. Every client may do this; the server moves the room once and the others get `advanced: false`. If a call comes a little early, it changes nothing; the Realtime update or the next timer tick fixes it.
9. When `status` is `finished`, show the final scores from `quiz_players`.

## Refusals from quiz-answer

- `too_late`: the answering time ran out before the answer reached the server. No points.
- `already_answered`: the player already answered this question. Only the first answer counts.
- `not_current_question`: the room has moved on. Fetch the current question.
- `not_a_player`: join the room first.

## Checking it end to end

`scripts/quiz-e2e.mjs` at the repo root plays a whole quiz with five guest players against the live project. How to run it is at the top of that file.
````

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/quiz-README.md
git commit -m "A8: plain-words quiz client guide for Dev B

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 12: End-to-end script and test data

**Files:**
- Create: `scripts/quiz-e2e.mjs`
- Create: `scripts/quiz-e2e-seed.sql`
- Create: `scripts/quiz-e2e-cleanup.sql`
- Create: `scripts/quiz-e2e.env.example`

**Interfaces:**
- Consumes: `@supabase/supabase-js` (installed at the repo root through the app workspace), `apps/app/.env` (`EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`), `scripts/.env.quiz-e2e` (host login and the seeded note id), all four functions, `join_quiz_room`, `current_quiz_question`, Realtime on `quiz_rooms`.
- Produces: the A8 "Done when" check. Exit code 0 means pass.

- [ ] **Step 1: Write the seed SQL**

Create `scripts/quiz-e2e-seed.sql`:

```sql
-- Test data for scripts/quiz-e2e.mjs. Run once in the Supabase dashboard
-- SQL editor, after creating the host account (Authentication > Users >
-- Add user, with a password). Replace the email on the first line of the
-- block with that account's email.
--
-- It makes one note with three chunks and six questions. Questions are
-- normally made only by the server; the SQL editor runs as the database
-- owner, so it can insert them. The verify_question trigger still checks
-- each quote is inside its chunk: all six must come out verified.
do $$
declare
  host_email text := 'quiz-host@example.com';
  host uuid;
  note uuid;
  c1 uuid;
  c2 uuid;
  c3 uuid;
begin
  select u.id into host from auth.users u where u.email = host_email;
  if host is null then
    raise exception 'no user with email %, create the host account first', host_email;
  end if;

  insert into public.notes (owner_id, title, source, status)
  values (host, 'Quiz e2e test note', 'text', 'ready')
  returning id into note;

  insert into public.chunks (note_id, position, text) values
    (note, 0, 'Photosynthesis happens in the chloroplast. During photosynthesis plants take in carbon dioxide and release oxygen.')
    returning id into c1;
  insert into public.chunks (note_id, position, text) values
    (note, 1, 'The mitochondria is the powerhouse of the cell. It turns glucose into energy the cell can use.')
    returning id into c2;
  insert into public.chunks (note_id, position, text) values
    (note, 2, 'Water boils at 100 degrees Celsius at sea level. At higher altitude it boils at a lower temperature.')
    returning id into c3;

  insert into public.questions (note_id, chunk_id, kind, prompt, choices, answer, source_quote) values
    (note, c1, 'multiple_choice', 'Which gas do plants take in during photosynthesis?',
       '["Oxygen", "Carbon dioxide", "Nitrogen", "Helium"]', 'Carbon dioxide',
       'plants take in carbon dioxide and release oxygen'),
    (note, c1, 'short_answer', 'Where in the cell does photosynthesis happen?', null, 'the chloroplast',
       'Photosynthesis happens in the chloroplast'),
    (note, c2, 'multiple_choice', 'Which part is the powerhouse of the cell?',
       '["Nucleus", "Ribosome", "Mitochondria", "Membrane"]', 'Mitochondria',
       'The mitochondria is the powerhouse of the cell'),
    (note, c2, 'flashcard', 'What does the mitochondria turn glucose into?', null, 'energy',
       'It turns glucose into energy the cell can use'),
    (note, c3, 'short_answer', 'At what temperature in Celsius does water boil at sea level?', null, '100 degrees',
       'Water boils at 100 degrees Celsius at sea level'),
    (note, c3, 'multiple_choice', 'At higher altitude, water boils at a temperature that is…',
       '["Higher", "Lower", "The same", "Unpredictable"]', 'Lower',
       'At higher altitude it boils at a lower temperature');
end $$;

-- Copy the note id from this result into scripts/.env.quiz-e2e.
select n.id as quiz_e2e_note_id,
       count(*) filter (where q.verified) as verified_questions
from public.notes n
join public.questions q on q.note_id = n.id
where n.title = 'Quiz e2e test note'
group by n.id;
```

Expected when run: one row, `verified_questions = 6`.

- [ ] **Step 2: Write the cleanup SQL**

Create `scripts/quiz-e2e-cleanup.sql`:

```sql
-- Removes the test data made by quiz-e2e-seed.sql and the rooms the script
-- made from it. Run in the Supabase dashboard SQL editor when done.
-- Deleting the note removes its chunks and questions; deleting a question
-- removes it from any room, so rooms are deleted first by title and host.
delete from public.quiz_rooms r
using public.notes n
where n.title = 'Quiz e2e test note'
  and r.host_id = n.owner_id
  and r.title = 'Quiz e2e test note';

delete from public.notes where title = 'Quiz e2e test note';

-- The five guest players stay in Authentication > Users as anonymous users.
-- The script prints their ids; delete them there if you want them gone.
```

- [ ] **Step 3: Write the settings example**

Create `scripts/quiz-e2e.env.example`:

```sh
# Copy to scripts/.env.quiz-e2e (ignored by git) and fill in.
# The Supabase URL and publishable key come from apps/app/.env.
QUIZ_E2E_HOST_EMAIL=
QUIZ_E2E_HOST_PASSWORD=
QUIZ_E2E_NOTE_ID=
```

Check git ignores the real file: `git check-ignore -v scripts/.env.quiz-e2e`
Expected: prints the `.env.*` rule from `.gitignore`.

- [ ] **Step 4: Write the script**

Create `scripts/quiz-e2e.mjs`:

```js
// A8 "Done when": five players join one room, play five questions, and all
// see the same final scores. Runs against the live Supabase project.
//
// Before the first run:
//   1. Anonymous sign-in is on (Supabase dashboard > Authentication > Sign In / Providers).
//   2. A host account exists with a password, and scripts/quiz-e2e-seed.sql
//      has been run for it in the SQL editor.
//   3. scripts/.env.quiz-e2e is filled in (see scripts/quiz-e2e.env.example).
//
// Run from the repo root (Node 22 or newer):
//   node --env-file=apps/app/.env --env-file=scripts/.env.quiz-e2e scripts/quiz-e2e.mjs
//
// It takes about two minutes. Exit code 0 means every check passed.

import { createClient } from '@supabase/supabase-js';

const URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const KEY = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const HOST_EMAIL = process.env.QUIZ_E2E_HOST_EMAIL;
const HOST_PASSWORD = process.env.QUIZ_E2E_HOST_PASSWORD;
const NOTE_ID = process.env.QUIZ_E2E_NOTE_ID;

const PLAYERS = 5;
const QUESTIONS = 5;
const SECONDS_PER_QUESTION = 15;
const DELAYS_MS = [0, 2500, 5000, 7500, 10000];
const WRONG_PLAYER = 4; // answers question 0 wrong
const LATE_PLAYER = 3; // answers question 1 after the time is up
const REJOIN_PLAYER = 2; // reloads before question 2
const MARGIN_MS = 400; // wait a little past each server deadline

for (const [name, value] of Object.entries({ URL, KEY, HOST_EMAIL, HOST_PASSWORD, NOTE_ID })) {
  if (!value) {
    console.error(`Missing setting ${name}. See the comment at the top of scripts/quiz-e2e.mjs.`);
    process.exit(2);
  }
}

let failures = 0;
function check(condition, message) {
  if (condition) {
    console.log(`  ok    ${message}`);
  } else {
    failures++;
    console.error(`  FAIL  ${message}`);
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));

function newClient() {
  return createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function token(client) {
  const { data } = await client.auth.getSession();
  return data.session.access_token;
}

// Plain fetch instead of functions.invoke, so a 409 comes back as data.
async function call(client, name, body) {
  const res = await fetch(`${URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${await token(client)}`,
      apikey: KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    // empty body
  }
  return { status: res.status, body: json };
}

// The server's clock, estimated from the last serverNow it sent.
let offsetMs = 0;
function syncClock(room) {
  offsetMs = Date.parse(room.serverNow) - Date.now();
}
const serverNow = () => Date.now() + offsetMs;
const waitUntilServer = (ms) => sleep(ms - serverNow() + MARGIN_MS);

async function currentQuestion(client, roomId) {
  const { data, error } = await client.rpc('current_quiz_question', { room_id: roomId });
  if (error) throw new Error(`current_quiz_question: ${error.message}`);
  return Array.isArray(data) ? data[0] : data;
}

// Each player watches the room row over Realtime, like a browser would.
function watchRoom(player, roomId) {
  return new Promise((resolve, reject) => {
    player.seen = player.seen ?? [];
    player.channel = player.client
      .channel(`quiz-e2e:${roomId}:${player.index}:${Date.now()}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'quiz_rooms', filter: `id=eq.${roomId}` },
        (payload) => player.seen.push({ status: payload.new.status, index: payload.new.current_question_index }),
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') resolve();
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') reject(new Error(`Realtime ${status}`));
      });
  });
}

async function main() {
  console.log('Signing in the host');
  const host = newClient();
  const signIn = await host.auth.signInWithPassword({ email: HOST_EMAIL, password: HOST_PASSWORD });
  if (signIn.error) throw new Error(`host sign-in: ${signIn.error.message}`);

  // The host owns the note, so Row Level Security lets it read the answers.
  const { data: questionRows, error: qError } = await host
    .from('questions')
    .select('id, answer')
    .eq('note_id', NOTE_ID)
    .eq('verified', true);
  if (qError) throw new Error(`reading questions: ${qError.message}`);
  const answers = new Map(questionRows.map((row) => [row.id, row.answer]));
  check(answers.size >= QUESTIONS, `the note has at least ${QUESTIONS} verified questions (${answers.size})`);

  console.log('Signing in five guest players');
  const players = [];
  for (let i = 0; i < PLAYERS; i++) {
    const client = newClient();
    const { data, error } = await client.auth.signInAnonymously();
    if (error) throw new Error(`guest ${i + 1} sign-in: ${error.message}`);
    client.realtime.setAuth(data.session.access_token);
    players.push({ index: i, client, userId: data.user.id, pointsTotal: 0 });
  }
  console.log(`  guest user ids: ${players.map((p) => p.userId).join(', ')}`);

  console.log('Creating the room');
  const guestCreate = await call(players[0].client, 'quiz-create', { source: { noteId: NOTE_ID }, mode: 'group' });
  check(guestCreate.status === 403, `a guest cannot create a room (got ${guestCreate.status})`);

  const created = await call(host, 'quiz-create', {
    source: { noteId: NOTE_ID },
    count: QUESTIONS,
    secondsPerQuestion: SECONDS_PER_QUESTION,
    mode: 'group',
  });
  if (created.status !== 200) throw new Error(`quiz-create: ${created.status} ${JSON.stringify(created.body)}`);
  const { roomId, code } = created.body;
  check(created.body.status === 'lobby', 'a group room starts in the lobby');
  check(created.body.questionCount === QUESTIONS, `the room has ${QUESTIONS} questions`);
  console.log(`  room ${roomId}, code ${code}`);

  const earlyStart = await call(host, 'quiz-start', { roomId });
  check(earlyStart.status === 409, `starting with no players is refused (got ${earlyStart.status})`);

  console.log('Joining five players');
  for (const player of players) {
    const { data, error } = await player.client.rpc('join_quiz_room', { code, nickname: `Player ${player.index + 1}` });
    if (error) throw new Error(`join ${player.index + 1}: ${error.message}`);
    player.playerId = data.id;
    check(data.score === 0, `player ${player.index + 1} joins with score 0`);
    await watchRoom(player, roomId);
  }

  const playerStart = await call(players[0].client, 'quiz-start', { roomId });
  check(playerStart.status === 403, `a player cannot start the quiz (got ${playerStart.status})`);

  console.log('Starting');
  const started = await call(host, 'quiz-start', { roomId });
  if (started.status !== 200) throw new Error(`quiz-start: ${started.status} ${JSON.stringify(started.body)}`);
  let room = started.body.room;
  syncClock(room);
  check(room.status === 'running' && room.currentQuestionIndex === 0, 'the room is running on question 0');

  for (let q = 0; q < QUESTIONS; q++) {
    console.log(`Question ${q + 1}`);
    check(room.currentQuestionIndex === q, `room is on question index ${q}`);
    const startedAt = Date.parse(room.questionStartedAt);
    const answerEnd = startedAt + room.secondsPerQuestion * 1000;
    const resultsEnd = answerEnd + room.resultsSeconds * 1000;

    if (q === 2) {
      // Player 3 "reloads the page": a new client with the same session.
      const old = players[REJOIN_PLAYER];
      const { data: before } = await old.client.from('quiz_players').select('score').eq('id', old.playerId).single();
      const { data: session } = await old.client.auth.getSession();
      await old.client.removeChannel(old.channel);
      const client = newClient();
      const restored = await client.auth.setSession({
        access_token: session.session.access_token,
        refresh_token: session.session.refresh_token,
      });
      if (restored.error) throw new Error(`rejoin session: ${restored.error.message}`);
      client.realtime.setAuth(session.session.access_token);
      const { data: again, error } = await client.rpc('join_quiz_room', { code, nickname: 'Player 3 again' });
      if (error) throw new Error(`rejoin: ${error.message}`);
      check(again.id === old.playerId, 'the rejoining player gets the same player row');
      check(again.score === before.score, `the rejoining player keeps their score (${again.score})`);
      players[REJOIN_PLAYER] = { ...old, client, seen: [...old.seen] };
      await watchRoom(players[REJOIN_PLAYER], roomId);
    }

    const shown = await Promise.all(players.map((p) => currentQuestion(p.client, roomId)));
    const questionId = shown[0].question_id;
    check(shown.every((s) => s.question_id === questionId), 'all five see the same question');
    check(shown.every((s) => s.answer === null || s.answer === undefined), 'the answer is hidden while answering');
    const rightAnswer = answers.get(questionId);

    await Promise.all(
      players.map(async (player) => {
        if (q === 1 && player.index === LATE_PLAYER) return; // answers late, below
        await sleep(startedAt + DELAYS_MS[(player.index + q) % PLAYERS] - serverNow());
        const wrong = q === 0 && player.index === WRONG_PLAYER;
        const res = await call(player.client, 'quiz-answer', {
          roomId,
          questionId,
          answer: wrong ? 'definitely not the answer' : rightAnswer,
        });
        check(res.status === 200, `player ${player.index + 1} answer accepted (got ${res.status})`);
        if (res.status !== 200) return;
        check(res.body.isCorrect === !wrong, `player ${player.index + 1} marked ${wrong ? 'wrong' : 'right'}`);
        const inRange = wrong ? res.body.points === 0 : res.body.points >= 500 && res.body.points <= 1000;
        check(inRange, `player ${player.index + 1} got ${res.body.points} points`);
        player.pointsTotal += res.body.points;
      }),
    );

    const duplicate = await call(players[0].client, 'quiz-answer', { roomId, questionId, answer: rightAnswer });
    check(duplicate.status === 409 && duplicate.body?.error?.code === 'already_answered', 'a second answer is refused');

    await waitUntilServer(answerEnd);

    if (q === 1) {
      const late = await call(players[LATE_PLAYER].client, 'quiz-answer', { roomId, questionId, answer: rightAnswer });
      check(late.status === 409 && late.body?.error?.code === 'too_late', 'an answer after the time limit is refused');
    }

    const revealed = await currentQuestion(players[1].client, roomId);
    check(revealed.answer === rightAnswer, 'the answer is shown once answering is over');

    const early = await call(players[1].client, 'quiz-advance', { roomId, expectedIndex: q });
    check(early.status === 200 && early.body.advanced === false, 'advancing during the results phase does nothing');

    await waitUntilServer(resultsEnd);

    // All five timers run out together and all five ask to advance.
    const advances = await Promise.all(players.map((p) => call(p.client, 'quiz-advance', { roomId, expectedIndex: q })));
    check(advances.every((a) => a.status === 200), 'every advance call is answered');
    const movers = advances.filter((a) => a.body?.advanced === true).length;
    check(movers === 1, `exactly one call moved the room (got ${movers})`);
    room = advances[0].body.room;
    syncClock(room);
    const last = q === QUESTIONS - 1;
    check(
      advances.every((a) => a.body.room.currentQuestionIndex === room.currentQuestionIndex && a.body.room.status === room.status),
      'every caller sees the same room afterwards',
    );
    check(last ? room.status === 'finished' : room.currentQuestionIndex === q + 1, last ? 'the room is finished' : 'the room moved to the next question');
  }

  console.log('Final scores');
  await sleep(2000); // let the last Realtime messages arrive
  const boards = await Promise.all(
    players.map(async (p) => {
      const { data, error } = await p.client.from('quiz_players').select('id, nickname, score').eq('room_id', roomId).order('id');
      if (error) throw new Error(`scoreboard for player ${p.index + 1}: ${error.message}`);
      return data;
    }),
  );
  const first = JSON.stringify(boards[0]);
  check(boards.every((b) => JSON.stringify(b) === first), 'all five see the same final scores');
  check(boards[0].length === PLAYERS, `the scoreboard has ${PLAYERS} players`);
  for (const player of players) {
    const row = boards[0].find((r) => r.id === player.playerId);
    check(row?.score === player.pointsTotal, `player ${player.index + 1} score ${row?.score} equals the points they were given (${player.pointsTotal})`);
    check(player.seen.some((s) => s.status === 'finished'), `player ${player.index + 1} saw the finish over Realtime`);
  }
  console.table(boards[0].map(({ nickname, score }) => ({ nickname, score })));

  for (const player of players) await player.client.removeAllChannels();
  const { error: deleteError } = await host.from('quiz_rooms').delete().eq('id', roomId);
  if (deleteError) console.warn(`could not delete room ${roomId}: ${deleteError.message}`);
}

main()
  .then(() => {
    console.log(failures === 0 ? '\nPASS: every check passed' : `\nFAIL: ${failures} check(s) failed`);
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch((error) => {
    console.error(`\nERROR: ${error.message}`);
    process.exit(1);
  });
```

- [ ] **Step 5: Check the script loads**

The functions are not live until the merge, so the full run happens in Task 13. Check it starts and stops cleanly on a missing setting:

Run: `node scripts/quiz-e2e.mjs`
Expected: `Missing setting URL. See the comment at the top of scripts/quiz-e2e.mjs.` and exit code 2. (This proves the file parses and `@supabase/supabase-js` resolves from the repo root.)

- [ ] **Step 6: Commit**

```bash
git add scripts/quiz-e2e.mjs scripts/quiz-e2e-seed.sql scripts/quiz-e2e-cleanup.sql scripts/quiz-e2e.env.example
git commit -m "A8: five-player end-to-end quiz script and test data

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 13: Pull request, then the "Done when" run

**Files:** none changed (unless the run finds a bug).

**Interfaces:**
- Consumes: everything above.
- Produces: A8 done: "5 browsers join one room, play 5 questions, and all show the same final scores" (`split_work.md`), checked by `scripts/quiz-e2e.mjs`.

- [ ] **Step 1: Run every check that works before merge**

Run:

```bash
npx vitest run supabase/functions/_shared
npm test
npm run typecheck
```

Expected: all pass. (`npm run typecheck` does not cover `supabase/functions`; it confirms nothing in the app or shared package broke.)

- [ ] **Step 2: Scan the diff for secrets**

Run: `git diff main --stat && git diff main | grep -nE "sb_secret_|service_role.*ey|eyJhbGci|QUIZ_E2E_HOST_PASSWORD=."`
Expected: the stat lists only files from this plan; the grep prints nothing. If it prints anything, stop and remove it before pushing.

- [ ] **Step 3: Push and open the pull request**

`supabase/config.toml`: other branches (a4, a5, a6, a7) append `[functions.*]` blocks at the end of this file too. If GitHub reports a merge conflict there, resolve it by keeping both sides' blocks, then check each function still appears once.

```bash
git push -u origin a8-quiz-server
gh pr create --base main --head a8-quiz-server --title "A8: quiz server" --body "$(cat <<'EOF'
Quiz server for A8 (spec docs/superpowers/specs/2026-10-10-server-side-design.md, section 9).

What is in it:
- quiz-create, quiz-start, quiz-answer, quiz-advance Edge Functions
- migration quiz_answer_fn: database functions that start, answer and advance a room in one step on the database clock
- tested pure code: scoring, answer matching, question picking, input parsing
- supabase/functions/quiz-README.md: the client flow for Dev B (B8)
- scripts/quiz-e2e.mjs: the five-player Done-when check, run after merge

Changes for Dev B to approve:
- The database functions start_quiz_room, submit_quiz_answer, advance_quiz_room and quiz_room_state live in the public schema, because the API only exposes public. Execute is revoked from anon and authenticated, so only the Edge Functions (service role) can run them.
- Points are computed in SQL (private.quiz_points), a twin of points() in _shared/scoring.ts, because the deadline check and the score write must happen in one statement on the database clock. Both are checked against the same number table.
- points() is written as 1000 - 500 * ms / allowed, which gives the same numbers as the spec's formula but rounds an exact half the same way Postgres does.
- Two extra database functions, start_quiz_room and quiz_room_state, so the quiz start time also comes from the database clock.
- Every room state answer carries serverNow (the database clock), so screens can correct their countdown for a wrong device clock.
- quiz-advance takes { roomId, expectedIndex }, as in spec 9.1, so a client that is behind can never move the room twice.
- The direct client insert on quiz_answers is removed (policy dropped, grants revoked). Answers go only through quiz-answer, which scores them. Before this, a direct insert scored nothing and blocked the real answer as a duplicate.
- The room state shape the screens read is described in supabase/functions/quiz-README.md.

How the migration was checked:
- It was rehearsed on the live database inside begin ... rollback in the SQL editor (DDL on production, nothing kept), with the points table compared to the TypeScript tests.
- There is no Docker on this computer, so `supabase db diff` cannot run. The exact SQL is the migration file in this pull request; read it as the diff.
- The end-to-end script lives at scripts/quiz-e2e.mjs, as in spec 9.4.

Merging applies the migration to the live database and deploys the four functions. After merge, run the end-to-end script (steps in the script's header).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: prints the pull request URL. Dev B reviews and merges.

- [ ] **Step 4: After the merge, prepare the test data**

1. In the Supabase dashboard, confirm anonymous sign-in is on (Authentication, Sign In / Providers).
2. Create the host account (Authentication, Users, Add user, with a password and auto-confirm).
3. Put its email in `scripts/quiz-e2e-seed.sql` and run the file in the SQL editor. Expected: one row with `verified_questions = 6`.
4. Copy `scripts/quiz-e2e.env.example` to `scripts/.env.quiz-e2e` and fill in the email, password and the note id from step 3.
5. Confirm the four functions are listed under Edge Functions in the dashboard (deployed by the merge).

- [ ] **Step 5: Run the Done-when check**

Run: `node --env-file=apps/app/.env --env-file=scripts/.env.quiz-e2e scripts/quiz-e2e.mjs`
Expected: about two minutes of `ok` lines, a score table of five players, and `PASS: every check passed` with exit code 0.

If any line says `FAIL` or the run ends with `ERROR`, open a branch `a8-quiz-server-fix`, fix it, and repeat this task from step 1.

- [ ] **Step 6: Clean up**

Run `scripts/quiz-e2e-cleanup.sql` in the SQL editor. Expected: the test note and its rooms are gone. Optionally delete the five anonymous users printed by the script under Authentication, Users.
