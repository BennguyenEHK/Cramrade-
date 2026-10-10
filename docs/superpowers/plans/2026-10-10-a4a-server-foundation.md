# A4a Server Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lay the server foundation for Cramrade's phase 1 backend: one database migration, the shared data shape changes, the shared Edge Function code (HTTP, auth, database client, Gemini calls, chunking, quote check), the `extract-text` function, and the doc changes that move the AI provider to Gemini and the text extractor to Dev A.

**Architecture:** Pure server code lives in `supabase/functions/_shared` with no Deno-only API, so the root vitest run tests it next to `packages/shared`. Deno-only code (secrets, database client, PDF and Word libraries) sits in thin files that are tested by hand against the live project. `extract-text` is a thin handler: check the caller, download the upload, parse, chunk, insert, delete the file, start `make-questions` in the background.

**Tech Stack:** Supabase Postgres (migration SQL, RLS, Storage, Realtime), Supabase Edge Functions on Deno 2, `npm:@supabase/supabase-js@2`, `npm:unpdf@1.8.1`, `npm:mammoth@1.12.0`, Gemini REST API (`generateContent`), TypeScript 6, vitest 5.

**Before you start:** this branch builds on `a5-schedule-engine` (spec section 14 merges it first). That branch creates the root `vitest.config.mts`, makes the root `test` script `vitest run`, and defines `Pace` and `PACES` in `packages/shared/src/types/schedule.ts`. Task 0 checks for these and creates only what is missing.

**Spec:** `docs/superpowers/specs/2026-10-10-server-side-design.md` (sections 2, 3, 4, 10, 11, 12; hand test from 13 for extract-text only). Also read `CLAUDE.md`, `split_work.md` and `supabase/migrations/20261005120000_initial_schema.sql`.

## Global Constraints

- Branch `a4a-server-foundation`. Never push to `main`. One pull request, reviewed by Dev B.
- Dev B must say yes to the type changes in `packages/shared/src/types` before merge (T1 rule: any change there needs both developers and a matching migration).
- Merging changes the live database at once. There is no staging copy and no Docker on Dev A's machine, so the migration cannot be applied locally. Read the SQL carefully.
- Do not run `supabase db push` or `supabase functions deploy` by hand. The GitHub integration applies the migration and deploys functions when `main` changes.
- AI provider is Gemini. Secrets `GEMINI_API_KEY` and `GEMINI_MODEL` (default `gemini-2.5-flash`). Plain `fetch`, no SDK. Temperature 0.2 for syllabus and difficulty, 0.7 for questions. 60 second timeout per call, one retry on a network error, none on a bad answer.
- Gemini call shape (agreed for every server plan): `POST https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}` with body `{ contents: [{ role: 'user', parts: [{ text }] }], generationConfig: { responseMimeType: 'application/json', responseSchema, temperature } }`; the answer text is at `candidates[0].content.parts[0].text`. Schemas use Gemini's form (`type: 'OBJECT'`, `'STRING'` ...).
- Shared names other plans import, verbatim: `askGemini`, `AiError` (ai.ts); `requireUser`, `requireFullUser` returning `{ id: string; isAnonymous: boolean }`, `isServiceCall` (auth.ts); `db` (db.ts); `HttpError(status, code, message)`, `json`, `handle`, `corsHeaders` (http.ts); `toChunks` (chunking.ts); `quoteAppears` (quote-check.ts).
- Edge Function limits (free plan): answer within 150 seconds, 2 seconds of CPU, 256 MB memory.
- Do not install Deno or any global tool on C:. Keep downloads on D: in the repo's gitignored `.local-deps` folder. Deno steps in this plan are optional and only run if Deno is already installed, with `DENO_DIR=.local-deps/deno`.
- Every error answer is `{ "error": { "code", "message" } }` with 400, 401, 403, 404, 409, 500 or 502.
- Product rules: only text is stored, so the uploaded file is deleted on every path, success or failure. The AI never edits chunks.
- Chunk positions start at 0 (agreed in T1, `Chunk.position`).
- The quote rule is the spec's "whitespace collapsed, case kept", the same in code and database. The live trigger `private.verify_question` today does an exact match (`position(source_quote in chunk_text) > 0`), so this branch's migration changes it (and `private.reverify_chunk_questions`) to `trim(regexp_replace(x, '[ \t\n\r\f\v]+', ' ', 'g'))` on both the quote and the chunk text, then `position() > 0`, with an empty quote never counting. `quoteAppears` implements the identical rule with the same explicit class, `/[ \t\n\r\f\v]+/g`: collapse runs of ASCII whitespace to one space, trim, case-sensitive substring. The class is spelled out on both sides because `\s` differs between the engines (checked on the live database on 2026-10-10: U+FEFF is whitespace only in JavaScript, U+0085 only in Postgres). With the explicit class neither side touches any non-ASCII character, so the two always agree. The A4/A6 plan relies on this rule.
- English only for notes, prompts and fixtures.
- Repo is public: no keys in any committed file. `.env` files are gitignored; `.env.example` files are committed with empty values.
- Documents are written in plain words, tasks as lists, not tables.
- Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. The pull request body ends with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

## Review Focus

1. **The same note sent twice at once** (a double click). Expected: both calls answer `ready` with the same count, chunks are not duplicated. Pinned by the parallel-call hand test in Task 10.
2. **A retry after a failure, in the same note.** The student uploads another file into the failed note's folder and the app calls again. Expected: the note becomes `ready` and `failure_reason` is cleared. Pinned by the retry hand test in Task 10.
3. **A browser upload whose content type the bucket does not list** (Markdown files often come as `text/markdown`, `text/x-markdown` or empty). Expected: the bucket accepts pdf, docx, plain text and both Markdown types, and the app (B4) always sends an explicit content type picked from the extension. Pinned by the `.md` hand test in Task 10 and a note to Dev B in the pull request.
4. **A file with a supported-looking content type but an unsupported extension** (`.rtf` uploaded as `text/plain`, `.doc`). Expected: failed with "file type not supported", file deleted. Pinned by `extraction.test.ts` in Task 7 and the `.rtf` hand test in Task 10.
5. **A quote the AI copies across a line break, or with doubled spaces.** Expected: `quoteAppears` finds it, and the database marks the inserted question verified by the same rule. Pinned by `quote-check.test.ts` in Task 4 and by the read-only check of the new trigger after merge in Task 10 Step 5.

---

## File map

Created:

- `vitest.config.mts`: only if the a5-schedule-engine branch has not created it yet.
- `supabase/migrations/<timestamp>_server_side.sql`: all database changes.
- `packages/shared/src/types/settings.ts`: `StudySettings`, `BusyDay` (it imports `Pace` from `./schedule`).
- `supabase/functions/.env.example`, `supabase/functions/README.md`, `supabase/functions/_shared/prompts/README.md`.
- `supabase/functions/_shared/`: `chunking.ts`, `quote-check.ts`, `template.ts`, `gemini.ts`, `http.ts`, `extraction.ts` (pure, each with a `.test.ts`), and `db.ts`, `auth.ts`, `ai.ts`, `invoke.ts` (Deno).
- `supabase/functions/extract-text/index.ts`, `supabase/functions/extract-text/parse.ts`.
- `supabase/functions/_fixtures/`: `README.md`, `typed-notes.txt`, `notes-photosynthesis.md`, `try-extract.sh`, plus three binary files made by hand (`typed-notes.pdf`, `typed-notes.docx`, `notes-scanned.pdf`).

Modified:

- `package.json` (root): only if the a5-schedule-engine branch has not already set the `test` script to `vitest run` and added vitest.
- `supabase/config.toml`: uploads bucket, `extract-text` settings.
- `packages/shared/src/types/`: `note.ts`, `exam.ts`, `session.ts`, `quiz.ts`, `index.ts`. `packages/shared/README.md`.
- `split_work.md`, `CLAUDE.md`, `project-initialize.md`.

---

### Task 0: Branch, and check what the engine branch already set up

**Files:**
- Create (only if missing): `vitest.config.mts`
- Modify (only if needed): `package.json`, `package-lock.json`

**Interfaces:**
- Consumes from `a5-schedule-engine`: `vitest.config.mts` at the root, the root `test` script `vitest run`, and `Pace`, `PACES` exported from `packages/shared/src/types/schedule.ts`.
- Produces: `npm test` at the top runs every `*.test.ts` under `packages/shared/src` and `supabase/functions/_shared`.

- [ ] **Step 1: Create the branch**

```bash
git checkout main
git pull
git checkout -b a4a-server-foundation
```

- [ ] **Step 2: See what is already there**

```bash
ls vitest.config.*
grep -n '"test"' package.json
grep -n "PACES" packages/shared/src/types/schedule.ts packages/shared/src/types/index.ts
```

Expected when the engine branch has merged: `vitest.config.mts`, `"test": "vitest run",`, and `PACES` found in both files. Then skip to Step 5.

If `schedule.ts` or `PACES` is missing, stop: Task 2 imports `Pace` from it. Merge `a5-schedule-engine` first, or ask Dev A whether to merge this branch first and move `Pace` here (that changes the engine plan too).

- [ ] **Step 3: Only if `vitest.config.mts` is missing, create it**

Exactly as the engine plan has it, so whichever branch lands first makes the same file:

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

- [ ] **Step 4: Only if the root `test` script is not `vitest run`, change it**

```bash
npm install --save-dev vitest@^5.0.3
```

Then in the root `package.json` set `"test": "vitest run",`. Leave the `test` script in `packages/shared/package.json` as it is.

- [ ] **Step 5: Run the tests**

Run: `npm test`
Expected: exits 0. The engine's tests pass; "No test files found" is fine if there are none yet.

- [ ] **Step 6: Commit, only if Steps 3 or 4 changed anything**

```bash
git add vitest.config.mts package.json package-lock.json
git commit -m "Root vitest run for packages/shared and supabase/functions/_shared

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 1: The migration and the bucket settings

**Files:**
- Create: `supabase/migrations/<timestamp>_server_side.sql` (the CLI picks the timestamp)
- Modify: `supabase/config.toml` (append at the end)

**Interfaces:**
- Produces (columns, snake_case in SQL): `notes.exam_id uuid null`, `notes.is_syllabus boolean`, `notes.failure_reason text null`, `topics.difficulty smallint null (1..5)`, `study_sessions.is_final_pass boolean`, `quiz_rooms.mode text ('group'|'solo')`, `quiz_rooms.results_seconds integer (0..60, default 5)`, `quiz_answers.points integer (default 0)`.
- Produces (tables): `study_settings(user_id pk, pace, days_off smallint[], session_time time, time_zone text, created_at, updated_at)`, `busy_days(id, user_id, from_date, to_date, reason, created_at)`.
- Produces (function): `public.current_quiz_question(room_id uuid)` returning `question_id, question_index, prompt, kind, choices, answer (null until answering time is over), question_started_at, seconds_per_question, results_seconds, server_now`. It returns these extra columns beyond prompt, kind, choices and answer because the play screen needs the question id to answer, and the timing fields plus the server's clock to draw the phases. This migration defines no submit or advance functions; the A8 plan adds its own quiz SQL later.
- Produces (storage): private bucket `uploads`, files at `<user id>/<note id>/<file name>`, owner-only insert, select, delete.
- Produces (quote rule): `private.collapse_whitespace(t text)`, `private.quote_in_chunk(quote text, chunk_text text)`; `verify_question` and `reverify_chunk_questions` use them.

Decisions in this SQL that go beyond the spec text, for the reviewer:

- The bucket is created by an `insert into storage.buckets` in the migration. `config.toml` settings only reach local stacks (the same is true of Auth settings, see `CLAUDE.md`), so the migration is what makes the bucket exist on the live project. `config.toml` gets the same settings for local use.
- The two notes write policies are recreated with one added line: `exam_id` must point at an exam the student can read. Without it a student could link notes to someone else's exam.
- `quiz_rooms.mode` and `results_seconds` are left out of the host's column update grant (`title, status, seconds_per_question`), and `quiz_answers.points` is left out of the players' insert grant (`room_id, player_id, question_id, answer`). Column grants do not cover new columns, so nothing needs revoking: only server code can set these.
- The quote trigger changes (section 7 of the SQL): `private.verify_question` and `private.reverify_chunk_questions` now collapse whitespace on both sides, through two new helpers `private.collapse_whitespace(text)` and `private.quote_in_chunk(quote, chunk_text)`. This makes the database follow spec section 3 and match `quoteAppears` (Task 4). The expression was checked on the live database with read-only `select`s on 2026-10-10: `trim(regexp_replace(x, '[ \t\n\r\f\v]+', ' ', 'g'))` collapses spaces, tabs and line breaks, leaves no-break spaces, em spaces, U+0085, U+FEFF and zero-width spaces alone, and `position('' in 'abc')` is 1, which is why `quote_in_chunk` refuses an empty quote. No questions exist yet, so nothing needs re-verifying.
- Spec 13: there is no Docker, so `npx supabase db diff` cannot run. The pull request shows the migration file itself, and the SQL is rehearsed on the live database inside `begin ... rollback` before the pull request opens (Task 10 Step 2b).

- [ ] **Step 1: Create the migration file**

```bash
npx supabase migration new server_side
```

Expected: prints a path like `supabase/migrations/20261010xxxxxx_server_side.sql`. Its timestamp must sort after `20261005120000`.

- [ ] **Step 2: Write the SQL**

Replace the file's contents with:

```sql
-- Cramrade: server-side additions (task A4a, spec section 11).
--
-- Adds what the text extractor, syllabus reader, schedule engine and quiz
-- server need. Same style as the initial migration: every policy names its
-- role, auth.uid() is wrapped in (select ...), helpers live in "private",
-- every filtered column has an index.
--
-- Reading guide:
--   1. new columns on existing tables
--   2. new tables: study_settings, busy_days
--   3. notes policies: a note may only link to an exam the student can see
--   4. current_quiz_question(): what a player may see of the current question
--   5. Realtime for the live quiz
--   6. the private "uploads" bucket and its policies
--   7. the quote check ignores differences in whitespace


-- ---------------------------------------------------------------------------
-- 1. New columns
-- ---------------------------------------------------------------------------

-- notes: which exam the notes are for, whether the file is a syllabus, and
-- the one-line reason shown when text extraction failed.
alter table public.notes
  add column exam_id uuid references public.exams (id) on delete set null,
  add column is_syllabus boolean not null default false,
  add column failure_reason text check (failure_reason is null or char_length(failure_reason) between 1 and 300);
create index notes_exam_id_idx on public.notes (exam_id);

-- topics: the AI's starting guess at difficulty, 1 (easy) to 5 (hard).
-- Only used until the student has answered questions on the topic.
alter table public.topics
  add column difficulty smallint check (difficulty between 1 and 5);

-- study_sessions: the last session before an exam touches every topic once.
alter table public.study_sessions
  add column is_final_pass boolean not null default false;

-- quiz_rooms: group (live, with a lobby) or solo (one player, starts at once),
-- and how long the right answer shows before the next question.
-- Not added to the host's column grant (title, status, seconds_per_question),
-- so only server code can set them.
alter table public.quiz_rooms
  add column mode text not null default 'group' check (mode in ('group', 'solo')),
  add column results_seconds integer not null default 5 check (results_seconds between 0 and 60);

-- quiz_answers: points for this answer, set by server code from its own
-- clock. Not in the players' insert grant (room_id, player_id, question_id,
-- answer), so a client cannot set it.
alter table public.quiz_answers
  add column points integer not null default 0 check (points >= 0);


-- ---------------------------------------------------------------------------
-- 2. New tables
-- ---------------------------------------------------------------------------

-- study_settings: one row per student, made by the app on first use. When
-- the row is missing, the server uses the column defaults.
-- days_off holds weekday numbers, 0 = Sunday to 6 = Saturday.
create table public.study_settings (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  pace text not null default 'normal' check (pace in ('light', 'normal', 'heavy')),
  days_off smallint[] not null default '{}' check (days_off <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[]),
  session_time time not null default '18:00',
  time_zone text not null default 'UTC' check (char_length(time_zone) between 1 and 64),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_updated_at before update on public.study_settings
  for each row execute function private.set_updated_at();

-- busy_days: dates the student cannot study, from_date to to_date inclusive.
create table public.busy_days (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  from_date date not null,
  to_date date not null,
  reason text check (reason is null or char_length(reason) between 1 and 120),
  created_at timestamptz not null default now(),
  check (to_date >= from_date),
  check (to_date - from_date <= 366)
);
create index busy_days_user_id_idx on public.busy_days (user_id, from_date);

alter table public.study_settings enable row level security;
alter table public.busy_days enable row level security;

-- Both are private to the student. Guests cannot create them.
create policy "study_settings: own read" on public.study_settings
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy "study_settings: own insert" on public.study_settings
  for insert to authenticated
  with check (user_id = (select auth.uid()) and not private.is_guest());

create policy "study_settings: own update" on public.study_settings
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "study_settings: own delete" on public.study_settings
  for delete to authenticated
  using (user_id = (select auth.uid()));

create policy "busy_days: own read" on public.busy_days
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy "busy_days: own insert" on public.busy_days
  for insert to authenticated
  with check (user_id = (select auth.uid()) and not private.is_guest());

create policy "busy_days: own update" on public.busy_days
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "busy_days: own delete" on public.busy_days
  for delete to authenticated
  using (user_id = (select auth.uid()));


-- ---------------------------------------------------------------------------
-- 3. Notes policies: exam_id must point at an exam the student can see
-- ---------------------------------------------------------------------------
-- Same as the initial policies plus one line, so nobody can attach notes to
-- another student's exam. The exams subquery runs under the exams read
-- policy, so "can see" means owner or member of the exam's group.

drop policy "notes: owner creates" on public.notes;
create policy "notes: owner creates" on public.notes
  for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and not private.is_guest()
    and (group_id is null or private.is_group_member(group_id))
    and (exam_id is null or exists (select 1 from public.exams e where e.id = notes.exam_id))
  );

drop policy "notes: owner updates" on public.notes;
create policy "notes: owner updates" on public.notes
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (
    owner_id = (select auth.uid())
    and (group_id is null or private.is_group_member(group_id))
    and (exam_id is null or exists (select 1 from public.exams e where e.id = notes.exam_id))
  );


-- ---------------------------------------------------------------------------
-- 4. current_quiz_question(room_id)
-- ---------------------------------------------------------------------------
-- Players never read quiz_room_questions (host only). They call this instead.
-- It returns the question the room is showing now, and the answer only once
-- the answering time is over (server clock). No row when the room is not
-- running. Refuses callers who are neither a player nor the host.

create or replace function public.current_quiz_question(room_id uuid)
returns table (
  question_id uuid,
  question_index integer,
  prompt text,
  kind text,
  choices jsonb,
  answer text,
  question_started_at timestamptz,
  seconds_per_question integer,
  results_seconds integer,
  server_now timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  rid uuid := current_quiz_question.room_id;
begin
  if (select auth.uid()) is null then
    raise exception 'not signed in';
  end if;
  if not (private.is_quiz_player(rid) or private.is_quiz_host(rid)) then
    raise exception 'not in this quiz';
  end if;

  return query
  select
    q.id,
    r.current_question_index,
    q.prompt,
    q.kind,
    q.choices,
    case
      when now() >= r.question_started_at + r.seconds_per_question * interval '1 second' then q.answer
    end,
    r.question_started_at,
    r.seconds_per_question,
    r.results_seconds,
    now() -- the server's clock, so a screen can correct its own countdown
  from public.quiz_rooms r
  join public.quiz_room_questions rq
    on rq.room_id = r.id
   and rq.position = r.current_question_index
  join public.questions q on q.id = rq.question_id
  where r.id = rid
    and r.status = 'running'
    and r.question_started_at is not null;
end;
$$;

revoke execute on function public.current_quiz_question(uuid) from public, anon;
grant execute on function public.current_quiz_question(uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- 5. Realtime
-- ---------------------------------------------------------------------------
-- Players follow their room (status, index, start time) and the scoreboard.
-- Row Level Security still decides who receives which row.
-- quiz_answers stays off Realtime.

alter publication supabase_realtime add table public.quiz_rooms, public.quiz_players;


-- ---------------------------------------------------------------------------
-- 6. The "uploads" bucket
-- ---------------------------------------------------------------------------
-- Private. Files live at <user id>/<note id>/<file name> for a few seconds:
-- extract-text deletes them once the text is out. The same settings are in
-- supabase/config.toml for local stacks; this insert is what creates the
-- bucket on the live project.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'uploads',
  'uploads',
  false,
  20971520, -- 20 MiB
  array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
    'text/markdown',
    'text/x-markdown'
  ]
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- A student may add, see and remove files only in their own folder.
-- Guests cannot upload.
create policy "uploads: own folder insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'uploads'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and not private.is_guest()
  );

create policy "uploads: own folder read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'uploads'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "uploads: own folder delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'uploads'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );


-- ---------------------------------------------------------------------------
-- 7. Quote check: ignore differences in whitespace
-- ---------------------------------------------------------------------------
-- The initial trigger wanted the quote character for character, so a quote
-- the AI copied across a line break failed. Spec section 3 sets the rule
-- "whitespace collapsed, case kept". Both sides are normalised the same way
-- as quoteAppears() in supabase/functions/_shared/quote-check.ts: every run of
-- ASCII whitespace (space, tab, line feed, carriage return, form feed,
-- vertical tab) becomes one space, then the ends are trimmed. The class is
-- spelled out instead of \s because \s differs between Postgres and
-- JavaScript (U+FEFF, U+0085); with the explicit class both sides agree.

create or replace function private.collapse_whitespace(t text)
returns text
language sql
immutable
set search_path = ''
as $$
  select trim(regexp_replace(t, '[ \t\n\r\f\v]+', ' ', 'g'));
$$;

-- True when quote appears in chunk_text after both are collapsed. An empty
-- quote is never found (position() would say 1).
create or replace function private.quote_in_chunk(quote text, chunk_text text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select private.collapse_whitespace(quote) <> ''
     and position(private.collapse_whitespace(quote) in private.collapse_whitespace(chunk_text)) > 0;
$$;

create or replace function private.verify_question()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  chunk_text text;
begin
  select c.text into chunk_text
  from public.chunks c
  where c.id = new.chunk_id
    and c.note_id = new.note_id;

  if chunk_text is null then
    raise exception 'question chunk % does not belong to note %', new.chunk_id, new.note_id;
  end if;

  new.verified = private.quote_in_chunk(new.source_quote, chunk_text);
  return new;
end;
$$;

create or replace function private.reverify_chunk_questions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.questions q
  set verified = private.quote_in_chunk(q.source_quote, new.text)
  where q.chunk_id = new.id;
  return new;
end;
$$;

revoke execute on function
  private.collapse_whitespace(text),
  private.quote_in_chunk(text, text)
from public;
grant execute on function
  private.collapse_whitespace(text),
  private.quote_in_chunk(text, text)
to authenticated, service_role;
```

- [ ] **Step 3: Declare the bucket and the function in config.toml**

Append to the end of `supabase/config.toml`:

```toml

# --- Added in A4a -----------------------------------------------------------
# The uploads bucket for local stacks. On the live project the bucket is
# created by the server_side migration; this block does not reach it.
[storage.buckets.uploads]
public = false
file_size_limit = "20MiB"
allowed_mime_types = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "text/markdown",
  "text/x-markdown",
]

# One block per Edge Function. verify_jwt = true: the platform refuses calls
# without a valid token before our code runs. A function that uses AI prompt
# files also needs: static_files = ["./functions/_shared/prompts/*.md"]
[functions.extract-text]
enabled = true
verify_jwt = true
```

`extract-text` uses no prompt, so it has no `static_files` line. Do not add blocks for functions that do not exist yet; each later task adds its own. Function folders are made by hand, never with `npx supabase functions new`, because the CLI appends its own `[functions.<name>]` block with `verify_jwt = false` (spec section 2). Branches that merge in parallel all append to the end of `config.toml`; resolve that conflict by keeping every block.

- [ ] **Step 4: Check the SQL parses**

There is no local database, so check with a Postgres parser (pglast uses the real Postgres parser). It installs into the repo's gitignored `.local-deps` folder on D:, not globally. Run from the top folder in Git Bash:

```bash
pip install --quiet --no-cache-dir --target .local-deps/pglast pglast
PYTHONPATH=.local-deps/pglast python -c "
import glob, pglast
path = sorted(glob.glob('supabase/migrations/*_server_side.sql'))[-1]
sql = open(path, encoding='utf-8').read()
print(len(pglast.parse_sql(sql)), 'statements parse')
for name in ['public.current_quiz_question', 'private.verify_question()', 'private.reverify_chunk_questions()']:
    start = sql.index('create or replace function ' + name)
    pglast.parse_plpgsql(sql[start:sql.index('\$\$;', start) + 3])
    print('plpgsql body parses:', name)
"
```

Expected:

```
38 statements parse
plpgsql body parses: public.current_quiz_question
plpgsql body parses: private.verify_question()
plpgsql body parses: private.reverify_chunk_questions()
```

Also check the regular expression kept its backslashes (some shells and editors turn `\t` into a real tab):

```bash
grep -n "regexp_replace" supabase/migrations/*_server_side.sql
```

Expected: one line, `  select trim(regexp_replace(t, '[ \t\n\r\f\v]+', ' ', 'g'));`, with every backslash visible.

- [ ] **Step 5: Check the TOML parses**

```bash
python -c "import tomllib; c = tomllib.load(open('supabase/config.toml', 'rb')); print(c['storage']['buckets']['uploads']['file_size_limit'], c['functions']['extract-text'])"
```

Expected: `20MiB {'enabled': True, 'verify_jwt': True}`

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/*_server_side.sql supabase/config.toml
git commit -m "Migration server_side: note, topic, session and quiz fields, study settings, busy days, current_quiz_question, Realtime, uploads bucket, whitespace-tolerant quote check

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Shared data shape changes (needs Dev B's yes)

**Files:**
- Create: `packages/shared/src/types/settings.ts`
- Modify: `packages/shared/src/types/note.ts`, `exam.ts`, `session.ts`, `quiz.ts`, `index.ts`
- Modify: `packages/shared/README.md`

**Interfaces:**
- Consumes: `Pace` from `./schedule` (the a5-schedule-engine branch owns `Pace`, `PACES` and `SESSIONS_PER_DAY` and already exports them from `types/index.ts`).
- Produces: `Note.examId: Id | null`, `Note.isSyllabus: boolean`, `Note.failureReason: string | null`, `Topic.difficulty: 1 | 2 | 3 | 4 | 5 | null`, `StudySession.isFinalPass: boolean`, `QuizRoom.mode: QuizMode`, `QuizRoom.resultsSeconds: number`, `QuizAnswer.points: number`, `QUIZ_MODES`, `QuizMode`, `StudySettings`, `BusyDay`.
- Do not define `Pace` or `PACES` here: two definitions would clash in `types/index.ts`.

These are types only: `npm run typecheck` is the test.

- [ ] **Step 1: Add the settings shapes**

Create `packages/shared/src/types/settings.ts`:

```ts
import type { DateOnly, Id, Timestamp } from './common';
// Pace (light, normal, heavy) and PACES belong to the schedule engine.
import type { Pace } from './schedule';

/**
 * The student's study plan settings. One row per student, created by the app
 * the first time the settings screen saves. When the row is missing, the
 * server uses the defaults shown below.
 *
 * Table: study_settings. Visible to and editable by the student only.
 */
export interface StudySettings {
  userId: Id;
  /** The most sessions per day across all exams: light 1, normal 2, heavy 3. Default 'normal'. */
  pace: Pace;
  /** Weekdays with no sessions: 0 = Sunday, 1 = Monday ... 6 = Saturday. Default none. */
  daysOff: number[];
  /** Usual time of day for a session, as the database returns it: "18:00:00". Default 18:00. */
  sessionTime: string;
  /** IANA time zone name, for example "Europe/Berlin". Default "UTC". */
  timeZone: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/**
 * Dates the student cannot study, fromDate to toDate inclusive (one day:
 * both the same). The schedule engine places no session on these days.
 *
 * Table: busy_days. Visible to and editable by the student only.
 */
export interface BusyDay {
  id: Id;
  userId: Id;
  fromDate: DateOnly;
  toDate: DateOnly;
  /** Optional, shown back to the student, for example "football trip". Up to 120 characters. */
  reason: string | null;
  createdAt: Timestamp;
}
```

- [ ] **Step 2: Extend Note**

In `packages/shared/src/types/note.ts`, replace:

```ts
  /** 'processing' while text is being extracted and questions made, then 'ready' or 'failed'. */
  status: NoteStatus;
  createdAt: Timestamp;
```

with:

```ts
  /** 'processing' while text is being extracted and questions made, then 'ready' or 'failed'. */
  status: NoteStatus;
  /** The exam these notes are for. Questions made from the note are linked to it. Null when not linked. */
  examId: Id | null;
  /** True when the file is a syllabus: the server reads dates from it instead of making questions. */
  isSyllabus: boolean;
  /** Why text extraction failed, one line to show the student. Null unless status is 'failed'. */
  failureReason: string | null;
  createdAt: Timestamp;
```

- [ ] **Step 3: Extend Topic**

In `packages/shared/src/types/exam.ts`, replace:

```ts
  /** Order on the screen, starting at 0. */
  position: number;
  createdAt: Timestamp;
}
```

with:

```ts
  /** Order on the screen, starting at 0. */
  position: number;
  /**
   * The AI's first guess at how hard the topic is, 1 (easy) to 5 (hard).
   * Set by the server, used by the schedule only until the student has
   * answered questions on it. Null until rated.
   */
  difficulty: 1 | 2 | 3 | 4 | 5 | null;
  createdAt: Timestamp;
}
```

- [ ] **Step 4: Extend StudySession**

In `packages/shared/src/types/session.ts`, replace:

```ts
  /** When the session is due. */
  scheduledFor: Timestamp;
  status: StudySessionStatus;
```

with:

```ts
  /** When the session is due. */
  scheduledFor: Timestamp;
  status: StudySessionStatus;
  /** True for the last session before the exam, which touches every topic once. */
  isFinalPass: boolean;
```

- [ ] **Step 5: Extend QuizRoom and QuizAnswer**

In `packages/shared/src/types/quiz.ts`, replace:

```ts
export const QUIZ_ROOM_STATUSES = ['lobby', 'running', 'finished'] as const;
export type QuizRoomStatus = (typeof QUIZ_ROOM_STATUSES)[number];
```

with:

```ts
export const QUIZ_ROOM_STATUSES = ['lobby', 'running', 'finished'] as const;
export type QuizRoomStatus = (typeof QUIZ_ROOM_STATUSES)[number];

/** group: a live room with a lobby and a join code. solo: one player, starts at once. */
export const QUIZ_MODES = ['group', 'solo'] as const;
export type QuizMode = (typeof QUIZ_MODES)[number];
```

Replace:

```ts
  /** How long players get for each question. */
  secondsPerQuestion: number;
```

with:

```ts
  /** How long players get for each question. */
  secondsPerQuestion: number;
  /** Group or solo. Set by the server when the room is made. */
  mode: QuizMode;
  /** How long the right answer and scores show before the next question. Default 5. */
  resultsSeconds: number;
```

Replace:

```ts
  /** Null until the server has scored it. */
  isCorrect: boolean | null;
  answeredAt: Timestamp;
}
```

with:

```ts
  /** Null until the server has scored it. */
  isCorrect: boolean | null;
  /** Points for this answer: 0 when wrong, 500 to 1000 when right, faster is more. Set by the server. */
  points: number;
  answeredAt: Timestamp;
}
```

- [ ] **Step 6: Export the new names**

In `packages/shared/src/types/index.ts`, replace:

```ts
export type {
  QuizRoom,
  QuizRoomStatus,
  QuizRoomQuestion,
  QuizPlayer,
  QuizAnswer,
} from './quiz';
export type { CalendarFeed } from './calendar';
```

with:

```ts
export type {
  QuizRoom,
  QuizRoomStatus,
  QuizMode,
  QuizRoomQuestion,
  QuizPlayer,
  QuizAnswer,
} from './quiz';
export type { CalendarFeed } from './calendar';
export type { StudySettings, BusyDay } from './settings';
```

and replace:

```ts
export { QUIZ_ROOM_STATUSES } from './quiz';
```

with:

```ts
export { QUIZ_ROOM_STATUSES, QUIZ_MODES } from './quiz';
```

Leave the engine's `export type { Pace, ... } from './schedule';` and `export { PACES, SESSIONS_PER_DAY, SCHEDULE_WARNING_CODES } from './schedule';` lines as they are.

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: exits 0. (On a fresh clone it fails until `npm run web` has run once, because `apps/app/expo-env.d.ts` is generated then.) If the app already maps note, topic, session or quiz rows into these types, the new required fields show up as errors here: tell Dev B, do not edit `apps/app`.

- [ ] **Step 8: Update the shared README**

In `packages/shared/README.md`:

Replace the paragraph under `## Exam and Topic`:

```markdown
Exam: `title`, `examDate`, `kind` (exam, quiz, competition), `source` (manual, syllabus), optional `groupId` to share it. Syllabus proposals stay on the confirm screen until confirmed, so every row here is one the student agreed to. Topic: `title` and `position` inside an exam.
```

with:

```markdown
Exam: `title`, `examDate`, `kind` (exam, quiz, competition), `source` (manual, syllabus), optional `groupId` to share it. Syllabus proposals stay on the confirm screen until confirmed, so every row here is one the student agreed to. Topic: `title` and `position` inside an exam, and `difficulty` (1 to 5, or null): the AI's first guess at how hard the topic is, set by the server and used by the schedule only until the student has answered questions on it.
```

Replace the first paragraph under `## Note and Chunk`:

```markdown
Note: `title`, `source` (file, photo, text), `originalFilename`, `status` (processing, ready, failed), optional `groupId`. Only text is ever stored, in Chunks: numbered pieces with `position` and `text`.
```

with:

```markdown
Note: `title`, `source` (file, photo, text), `originalFilename`, `status` (processing, ready, failed), optional `groupId`, optional `examId` (the exam the notes are for), `isSyllabus` (the file is a syllabus, so the server reads dates from it instead of making questions) and `failureReason` (one line to show when text extraction failed). Only text is ever stored, in Chunks: numbered pieces with `position` (from 0) and `text`.

Uploading a file: the app creates the note (`source` file, `status` processing), uploads the file to the private Storage bucket `uploads` at `<user id>/<note id>/<file name>` with an explicit content type, and calls the server function `extract-text` with `{ noteId }`. The server saves the chunks, deletes the file and sets `status` to ready, or to failed with `failureReason`.
```

Replace the first paragraph under `## StudySession, SessionQuestion, Attempt`:

```markdown
StudySession: one short session for one exam, `scheduledFor`, `status` (planned, done, skipped). SessionQuestion lists its questions in order. Attempt: one answer while studying alone, `answer`, `isCorrect`, `answeredAt`; `sessionId` is null for an on-demand review.
```

with:

```markdown
StudySession: one short session for one exam, `scheduledFor`, `status` (planned, done, skipped), `isFinalPass` (the last session before the exam, touching every topic once). SessionQuestion lists its questions in order. Attempt: one answer while studying alone, `answer`, `isCorrect`, `answeredAt`; `sessionId` is null for an on-demand review.
```

Replace the first paragraph under `## QuizRoom, QuizRoomQuestion, QuizPlayer, QuizAnswer`:

```markdown
QuizRoom: `title`, `code`, `status` (lobby, running, finished), `secondsPerQuestion`, `currentQuestionIndex`, `questionStartedAt`, optional `groupId`. QuizRoomQuestion is the ordered question list, visible to the host only, so players cannot read ahead. QuizPlayer: `nickname`, `score`, `userId`. QuizAnswer: one answer per player per question.
```

with:

```markdown
QuizRoom: `title`, `code`, `status` (lobby, running, finished), `mode` (group or solo, from `QUIZ_MODES`), `secondsPerQuestion`, `resultsSeconds` (how long the answer shows before the next question), `currentQuestionIndex`, `questionStartedAt`, optional `groupId`. QuizRoomQuestion is the ordered question list, visible to the host only, so players cannot read ahead. Players read the current question with the database function `current_quiz_question(room_id)`, which adds the answer only once answering time is over. QuizPlayer: `nickname`, `score`, `userId`. QuizAnswer: one answer per player per question, with `points` set by the server.
```

Insert this new section after the `## CalendarFeed` section and before `## Decided (T1 closed on 2026-10-10)`:

```markdown
## StudySettings and BusyDay

StudySettings: one row per student with `pace` (light, normal, heavy: at most 1, 2 or 3 sessions a day, from `PACES`), `daysOff` (weekdays, 0 = Sunday to 6 = Saturday), `sessionTime` ("18:00:00") and `timeZone` ("UTC" or a name like "Europe/Berlin"). The app creates the row the first time settings are saved; until then the server uses those defaults. BusyDay: `fromDate` to `toDate` (inclusive) when the student cannot study, with an optional `reason`. The schedule places nothing on those days.

Seen and edited by: the student only. Guests cannot create either.
```

Append to the end of the `## Decided (T1 closed on 2026-10-10)` section:

```markdown

## Changed in A4a (2026-10-10, needs Dev B's yes)

New fields: `Note.examId`, `Note.isSyllabus`, `Note.failureReason`, `Topic.difficulty`, `StudySession.isFinalPass`, `QuizRoom.mode`, `QuizRoom.resultsSeconds`, `QuizAnswer.points`. New shapes: `StudySettings`, `BusyDay` (its `pace` uses `Pace` and `PACES` from the schedule engine, `types/schedule.ts`). New value list: `QUIZ_MODES`. The matching database migration is `supabase/migrations/*_server_side.sql`.
```

- [ ] **Step 9: Commit**

```bash
git add packages/shared
git commit -m "Shared types: note exam link and failure reason, topic difficulty, final pass, quiz mode and points, study settings, busy days

Needs Dev B's yes (T1 rule).

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Chunking

**Files:**
- Create: `supabase/functions/_shared/chunking.ts`
- Test: `supabase/functions/_shared/chunking.test.ts`

**Interfaces:**
- Produces: `toChunks(text: string): string[]`, `countWords(text: string): number`, constants `MIN_WORDS = 300`, `MAX_WORDS = 500`, `LONG_PARAGRAPH_WORDS = 600`. Paragraphs inside a chunk are joined by a blank line (`\n\n`); whitespace inside a paragraph is single spaces.

Rules (spec 3): split on blank lines; merge paragraphs while the chunk stays at or under 500 words, and close it once it reaches 300; a paragraph over 600 words is cut at sentence ends into pieces of at most 500 words (a single sentence over 500 words is cut every 500 words); a paragraph of 600 words or fewer is never cut, so a chunk can exceed 500 in that case; the last chunk may be under 300; whitespace normalised, invisible characters dropped, form feeds (PDF page breaks) count as paragraph breaks; deterministic.

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/_shared/chunking.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { countWords, toChunks } from './chunking.ts';

/** n distinct words: "w0 w1 w2 ...", prefixed so paragraphs differ. */
const words = (n: number, prefix = 'w') => Array.from({ length: n }, (_, i) => `${prefix}${i}`).join(' ');
/** One sentence of n words ending with a full stop. */
const sentence = (n: number, prefix: string) => `${words(n, prefix)}.`;

describe('toChunks', () => {
  it('gives no chunks for empty or blank text', () => {
    expect(toChunks('')).toEqual([]);
    expect(toChunks('  \n\n \t\r\n')).toEqual([]);
  });

  it('keeps a short note as one chunk, paragraphs separated by a blank line', () => {
    expect(toChunks('Cells divide.\n\nThey grow.')).toEqual(['Cells divide.\n\nThey grow.']);
  });

  it('normalises whitespace inside paragraphs and drops invisible characters', () => {
    const text = 'Hello   world\nagain\r\n\r\n\r\n\tNext\u00a0 para\u200b';
    expect(toChunks(text)).toEqual(['Hello world again\n\nNext para']);
  });

  it('treats a page break (form feed) as a paragraph break', () => {
    expect(toChunks('Page one text.\fPage two text.')).toEqual(['Page one text.\n\nPage two text.']);
  });

  it('merges small paragraphs until a chunk reaches 300 words', () => {
    const text = Array.from({ length: 10 }, (_, i) => words(100, `p${i}w`)).join('\n\n');
    expect(toChunks(text).map(countWords)).toEqual([300, 300, 300, 100]);
  });

  it('never cuts a paragraph of 600 words or fewer, even above 500', () => {
    const text = [words(100, 'a'), words(550, 'b'), words(100, 'c')].join('\n\n');
    expect(toChunks(text).map(countWords)).toEqual([100, 550, 100]);
  });

  it('splits a paragraph over 600 words at sentence ends', () => {
    const text = Array.from({ length: 60 }, (_, i) => sentence(20, `s${i}w`)).join(' ');
    const chunks = toChunks(text);
    expect(chunks.map(countWords)).toEqual([500, 500, 200]);
    for (const chunk of chunks) expect(chunk.endsWith('.')).toBe(true);
  });

  it('cuts a sentence longer than 500 words into 500-word pieces', () => {
    expect(toChunks(words(1300)).map(countWords)).toEqual([500, 500, 300]);
  });

  it('loses no words and changes no word', () => {
    const text = [words(250, 'a'), sentence(30, 'b'), words(700, 'c'), 'tail end'].join('\n\n');
    const before = text.split(/\s+/).filter(Boolean);
    const after = toChunks(text).join(' ').split(/\s+/).filter(Boolean);
    expect(after).toEqual(before);
  });

  it('is deterministic', () => {
    const text = [words(120, 'x'), sentence(700, 'y'), words(40, 'z')].join('\n\n');
    expect(toChunks(text)).toEqual(toChunks(text));
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run supabase/functions/_shared/chunking.test.ts`
Expected: FAIL, "Failed to resolve import ./chunking.ts" (or "Cannot find module").

- [ ] **Step 3: Implement**

Create `supabase/functions/_shared/chunking.ts`:

```ts
// Note text -> numbered chunks of about 300 to 500 words (spec section 3).
// Pure and deterministic: no Deno APIs, no randomness, tested with vitest.
//
export const MIN_WORDS = 300;
export const MAX_WORDS = 500;
export const LONG_PARAGRAPH_WORDS = 600;

export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed === '' ? 0 : trimmed.split(/\s+/).length;
}

function toParagraphs(text: string): string[] {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/\f/g, '\n\n')
    .replace(/[\u200b\u200c\u200d\u2060\ufeff]/g, '')
    .replace(/[\u00a0\u2000-\u200a\u202f\u205f\u3000]/g, ' ')
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter((p) => p !== '');
}

function hardSplit(sentence: string): string[] {
  const words = sentence.split(' ');
  const pieces: string[] = [];
  for (let i = 0; i < words.length; i += MAX_WORDS) {
    pieces.push(words.slice(i, i + MAX_WORDS).join(' '));
  }
  return pieces;
}

function splitLongParagraph(paragraph: string): string[] {
  if (countWords(paragraph) <= LONG_PARAGRAPH_WORDS) return [paragraph];
  const sentences = paragraph.split(/(?<=[.!?]["'\u201d\u2019)\]]*) /);
  const pieces: string[] = [];
  let current = '';
  for (const sentence of sentences) {
    if (countWords(sentence) > MAX_WORDS) {
      if (current !== '') pieces.push(current);
      current = '';
      pieces.push(...hardSplit(sentence));
      continue;
    }
    if (current === '') current = sentence;
    else if (countWords(current) + countWords(sentence) <= MAX_WORDS) current += ' ' + sentence;
    else {
      pieces.push(current);
      current = sentence;
    }
  }
  if (current !== '') pieces.push(current);
  return pieces;
}

export function toChunks(text: string): string[] {
  const pieces = toParagraphs(text).flatMap(splitLongParagraph);
  const chunks: string[] = [];
  let current = '';
  for (const piece of pieces) {
    if (current === '') current = piece;
    else if (countWords(current) + countWords(piece) <= MAX_WORDS) current += '\n\n' + piece;
    else {
      chunks.push(current);
      current = piece;
    }
    if (countWords(current) >= MIN_WORDS) {
      chunks.push(current);
      current = '';
    }
  }
  if (current !== '') chunks.push(current);
  return chunks;
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `npx vitest run supabase/functions/_shared/chunking.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/chunking.ts supabase/functions/_shared/chunking.test.ts
git commit -m "Chunking: note text to 300-500 word chunks, deterministic

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Quote check and prompt filling

**Files:**
- Create: `supabase/functions/_shared/quote-check.ts`, `supabase/functions/_shared/template.ts`
- Test: `supabase/functions/_shared/quote-check.test.ts`, `supabase/functions/_shared/template.test.ts`

**Interfaces:**
- Produces: `quoteAppears(quote: string, chunkText: string): boolean`, `collapseWhitespace(text: string): string`, `fillPrompt(template: string, variables: Record<string, PromptValue>): string`, `type PromptValue = string | number | boolean | null | object`.
- The question maker (A6) and syllabus reader (A4) call `quoteAppears` directly on what the AI returned; the database trigger applies the same rule on insert (Task 1, section 7 of the SQL), so a quote that passes here is verified there.

The database side is `private.quote_in_chunk`: `trim(regexp_replace(x, '[ \t\n\r\f\v]+', ' ', 'g'))` on both sides, then `position(...) > 0`, and false for an empty quote. `collapseWhitespace` is the same three operations in JavaScript with the same class, `/[ \t\n\r\f\v]+/g`. `\s` is not used on either side because it differs between the engines on U+FEFF and U+0085 (checked on the live database). Postgres `trim()` removes only spaces, which is why the code removes one leading and one trailing space instead of calling `.trim()`. The tests say at the top that they mirror the trigger, and every expected value in them was checked against the live database.

- [ ] **Step 1: Write the failing tests**

Create `supabase/functions/_shared/quote-check.test.ts`:

```ts
// These tests mirror the database trigger private.verify_question, which
// (after the server_side migration) does
//   position(trim(regexp_replace(quote, '[ \t\n\r\f\v]+', ' ', 'g'))
//            in trim(regexp_replace(chunk_text, '[ \t\n\r\f\v]+', ' ', 'g'))) > 0
// and refuses an empty quote. Each expected value here is what the live
// database answered for the same input on 2026-10-10.
import { describe, expect, it } from 'vitest';
import { collapseWhitespace, quoteAppears } from './quote-check.ts';

const chunk = 'Mitosis has four phases.\n\nIn prophase the chromosomes condense and become visible.';

describe('collapseWhitespace (same as the trigger)', () => {
  it('turns runs of spaces, tabs and line breaks into one space and trims the ends', () => {
    expect(collapseWhitespace('  a \t\n b\r\n\f\vc  ')).toBe('a b c');
  });
  it('leaves no-break, em-space and next-line characters alone, as the trigger does', () => {
    expect(collapseWhitespace('a\u00a0b\u2003c\u0085d')).toBe('a\u00a0b\u2003c\u0085d');
    expect(collapseWhitespace('a \u00a0 b')).toBe('a \u00a0 b');
  });
  it('leaves the byte-order mark and zero-width space alone', () => {
    expect(collapseWhitespace('a\ufeffb\u200bc')).toBe('a\ufeffb\u200bc');
  });
});

describe('quoteAppears', () => {
  it('finds an exact substring', () => {
    expect(quoteAppears('the chromosomes condense', chunk)).toBe(true);
  });
  it('accepts the whole chunk', () => {
    expect(quoteAppears(chunk, chunk)).toBe(true);
  });
  it('is case-sensitive', () => {
    expect(quoteAppears('The chromosomes condense', chunk)).toBe(false);
  });
  it('ignores differences in whitespace, including a line break the AI copied', () => {
    expect(quoteAppears('the  chromosomes\ncondense', chunk)).toBe(true);
    expect(quoteAppears('  In prophase the chromosomes ', chunk)).toBe(true);
  });
  it('matches across a paragraph break, as the trigger does', () => {
    expect(quoteAppears('four phases. In prophase', chunk)).toBe(true);
  });
  it('treats straight and curly apostrophes as different characters', () => {
    expect(quoteAppears('it\u2019s', "it's here")).toBe(false);
  });
  it('rejects a quote that is empty or only whitespace', () => {
    expect(quoteAppears('', chunk)).toBe(false);
    expect(quoteAppears(' \n\t', chunk)).toBe(false);
  });
  it('rejects words that are not in the chunk', () => {
    expect(quoteAppears('chromosomes divide', chunk)).toBe(false);
  });
});
```

Create `supabase/functions/_shared/template.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { fillPrompt } from './template.ts';

describe('fillPrompt', () => {
  it('fills string placeholders, with or without inner spaces', () => {
    expect(fillPrompt('Today is {{today}}. {{ name }}!', { today: '2026-10-10', name: 'Hi' })).toBe(
      'Today is 2026-10-10. Hi!',
    );
  });
  it('writes non-strings as JSON', () => {
    expect(fillPrompt('{{n}} {{list}}', { n: 3, list: ['a'] })).toBe('3 [\n  "a"\n]');
  });
  it('throws on a placeholder with no value', () => {
    expect(() => fillPrompt('{{missing}}', {})).toThrow('{{missing}}');
  });
  it('does not re-read placeholders inside inserted text', () => {
    expect(fillPrompt('{{a}}', { a: '{{b}}' })).toBe('{{b}}');
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run supabase/functions/_shared/quote-check.test.ts supabase/functions/_shared/template.test.ts`
Expected: FAIL, both imports cannot be resolved.

- [ ] **Step 3: Implement**

Create `supabase/functions/_shared/quote-check.ts`:

```ts
// Does a question's quote really appear in its chunk?
//
// This mirrors the database trigger private.verify_question (changed by the
// server_side migration). The database does, on both the quote and the
// chunk text:
//   trim(regexp_replace(x, '[ \t\n\r\f\v]+', ' ', 'g'))
// then position(quote in chunk) > 0, and an empty quote never counts.
// So: every run of ASCII whitespace (space, tab, line feed, carriage return,
// form feed, vertical tab) becomes one space, the ends are trimmed, and the
// test is a case-sensitive substring match.
//
// The class is spelled out on both sides instead of \s because \s means
// different things in the two engines (checked on the live database on
// 2026-10-10: U+FEFF is whitespace only in JavaScript, U+0085 only in
// Postgres). With the explicit class both sides leave every non-ASCII
// character alone, including no-break spaces, so they always agree.
// Postgres trim() removes only spaces, and after collapsing any whitespace
// at the ends is a single space, so the code removes one space at each end
// instead of calling .trim(), which would also remove other characters.

const WHITESPACE_RUN = /[ \t\n\r\f\v]+/g;

/** Collapse whitespace runs to one space and trim spaces at the ends, exactly as the trigger does. */
export function collapseWhitespace(text: string): string {
  return text.replace(WHITESPACE_RUN, ' ').replace(/^ /, '').replace(/ $/, '');
}

/**
 * True when the quote appears in the chunk once whitespace is collapsed on
 * both sides. Case-sensitive. A quote that is empty after collapsing is false
 * (Postgres would find '' at position 1, so the trigger checks this too).
 */
export function quoteAppears(quote: string, chunkText: string): boolean {
  const needle = collapseWhitespace(quote);
  if (needle === '') return false;
  return collapseWhitespace(chunkText).includes(needle);
}
```

Create `supabase/functions/_shared/template.ts`:

```ts
// Fill {{placeholders}} in a prompt file. Pure, so vitest can test it.

export type PromptValue = string | number | boolean | null | object;

/**
 * Replace every {{name}} in template with variables[name]. Strings go in as
 * they are; anything else goes in as pretty JSON. A placeholder with no value
 * throws, so a prompt never reaches the AI with a hole in it. Extra variables
 * are ignored.
 */
export function fillPrompt(template: string, variables: Record<string, PromptValue>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, name: string) => {
    if (!Object.prototype.hasOwnProperty.call(variables, name)) {
      throw new Error(`prompt placeholder {{${name}}} has no value`);
    }
    const value = variables[name];
    return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  });
}
```

- [ ] **Step 4: Run them to see them pass**

Run: `npx vitest run supabase/functions/_shared/quote-check.test.ts supabase/functions/_shared/template.test.ts`
Expected: PASS, 11 + 4 tests.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/quote-check.ts supabase/functions/_shared/quote-check.test.ts supabase/functions/_shared/template.ts supabase/functions/_shared/template.test.ts
git commit -m "Quote check (whitespace collapsed, same rule as the new trigger) and prompt filling

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Gemini call core and HTTP helpers

**Files:**
- Create: `supabase/functions/_shared/gemini.ts`, `supabase/functions/_shared/http.ts`
- Test: `supabase/functions/_shared/gemini.test.ts`, `supabase/functions/_shared/http.test.ts`

**Interfaces:**
- Produces from `gemini.ts`: `class AiError extends Error { code: AiErrorCode; status?: number }`, `type AiErrorCode = 'ai_config' | 'ai_timeout' | 'ai_network' | 'ai_http' | 'ai_blocked' | 'ai_empty' | 'ai_bad_json'`, `interface GeminiRequest`, `callGemini<T>(req: GeminiRequest): Promise<T>`.
- Produces from `http.ts`: `corsHeaders`, `class HttpError extends Error { constructor(status: number, code: string, message: string) }`, `json(body: unknown, status = 200): Response`, `error(code: string, status: number, message: string): Response`, `readJson(req: Request): Promise<Record<string, unknown>>`, `requireId(body: Record<string, unknown>, field: string): string`, `handle(fn: (req: Request) => Promise<Response>): (req: Request) => Promise<Response>`.
- Every function is written as `Deno.serve(handle(async (req) => { ... }))` and throws `HttpError` for expected failures. Codes are snake_case words; the ones in use: `bad_input` 400, `not_signed_in` 401, `guest_not_allowed` and `not_yours` 403, `not_found` 404, `internal` 500, `ai_failed` 502 (the names fixed by spec section 10; a wrong HTTP method is also `bad_input`).

Gemini details: the agreed call shape from Global Constraints. The key is in the URL, so `callGemini` never puts the URL or the key into an error message (Deno's fetch errors include the URL; the code replaces the key with `[key]`). Retries: one, after one second, on a thrown fetch (network or timeout) or a 429 or 5xx answer. Two attempts of 60 seconds stay inside the 150-second limit.

- [ ] **Step 1: Write the failing tests**

Create `supabase/functions/_shared/gemini.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { AiError, callGemini, type GeminiRequest } from './gemini.ts';

/** A Gemini answer whose text is the given string. */
function answer(text: string, finishReason = 'STOP'): Response {
  return new Response(JSON.stringify({ candidates: [{ finishReason, content: { parts: [{ text }] } }] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function request(fetchFn: typeof fetch, extra: Partial<GeminiRequest> = {}): GeminiRequest {
  return {
    apiKey: 'test-key',
    model: 'gemini-2.5-flash',
    prompt: 'Say hi as JSON',
    schema: { type: 'OBJECT' },
    temperature: 0.2,
    retryDelayMs: 0,
    fetchFn,
    ...extra,
  };
}

async function failure(promise: Promise<unknown>): Promise<AiError> {
  try {
    await promise;
  } catch (e) {
    if (e instanceof AiError) return e;
    throw e;
  }
  throw new Error('expected an AiError');
}

describe('callGemini', () => {
  it('sends the prompt, key, schema and temperature, and parses the JSON answer', async () => {
    const fetchFn = vi.fn(async () => answer('{"hi":"there"}'));
    await expect(callGemini(request(fetchFn as unknown as typeof fetch))).resolves.toEqual({ hi: 'there' });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=test-key',
    );
    const body = JSON.parse(init.body as string);
    expect(body.contents[0].parts[0].text).toBe('Say hi as JSON');
    expect(body.generationConfig).toEqual({
      temperature: 0.2,
      responseMimeType: 'application/json',
      responseSchema: { type: 'OBJECT' },
    });
  });

  it('retries once after a network error', async () => {
    const fetchFn = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('connection reset'))
      .mockResolvedValueOnce(answer('{"ok":true}'));
    await expect(callGemini(request(fetchFn))).resolves.toEqual({ ok: true });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('never puts the key in an error message', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new TypeError('error sending request for url (...?key=test-key)'));
    const err = await failure(callGemini(request(fetchFn)));
    expect(err.message).not.toContain('test-key');
    expect(err.message).toContain('[key]');
  });

  it('gives up after two network errors', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new TypeError('offline'));
    expect((await failure(callGemini(request(fetchFn)))).code).toBe('ai_network');
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('retries once on 503, not on 400', async () => {
    const busy = vi
      .fn()
      .mockResolvedValueOnce(new Response('overloaded', { status: 503 }))
      .mockResolvedValueOnce(answer('{"ok":1}'));
    await expect(callGemini(request(busy))).resolves.toEqual({ ok: 1 });

    const bad = vi.fn().mockResolvedValue(new Response('bad schema', { status: 400 }));
    const err = await failure(callGemini(request(bad)));
    expect(err.code).toBe('ai_http');
    expect(err.status).toBe(400);
    expect(bad).toHaveBeenCalledTimes(1);
  });

  it('times out each attempt and reports ai_timeout', async () => {
    const hang = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
    );
    const err = await failure(callGemini(request(hang as unknown as typeof fetch, { timeoutMs: 20 })));
    expect(err.code).toBe('ai_timeout');
    expect(hang).toHaveBeenCalledTimes(2);
  });

  it('does not retry an answer that is not JSON', async () => {
    const fetchFn = vi.fn(async () => answer('not json'));
    expect((await failure(callGemini(request(fetchFn as unknown as typeof fetch)))).code).toBe('ai_bad_json');
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('reports a refused prompt, a safety stop and an empty answer', async () => {
    const refused = vi.fn(async () => new Response(JSON.stringify({ promptFeedback: { blockReason: 'SAFETY' } })));
    expect((await failure(callGemini(request(refused as unknown as typeof fetch)))).code).toBe('ai_blocked');

    const stopped = vi.fn(async () => answer('{}', 'SAFETY'));
    expect((await failure(callGemini(request(stopped as unknown as typeof fetch)))).code).toBe('ai_blocked');

    const empty = vi.fn(async () => answer('  '));
    expect((await failure(callGemini(request(empty as unknown as typeof fetch)))).code).toBe('ai_empty');
  });
});
```

Create `supabase/functions/_shared/http.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { AiError } from './gemini.ts';
import { error, handle, HttpError, json, readJson, requireId } from './http.ts';

const post = (body: string) => new Request('http://x/fn', { method: 'POST', body });

describe('json and error', () => {
  it('answers JSON with CORS headers', async () => {
    const res = json({ chunks: 3 });
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.headers.get('Content-Type')).toBe('application/json');
    expect(await res.json()).toEqual({ chunks: 3 });
  });

  it('wraps errors as { error: { code, message } }', async () => {
    const res = error('not_found', 404, 'That note could not be found.');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: 'not_found', message: 'That note could not be found.' } });
  });
});

describe('readJson and requireId', () => {
  it('reads an object body', async () => {
    await expect(readJson(post('{"noteId":"x"}'))).resolves.toEqual({ noteId: 'x' });
  });

  it('refuses a body that is not a JSON object', async () => {
    await expect(readJson(post('nope'))).rejects.toMatchObject({ status: 400, code: 'bad_input' });
    await expect(readJson(post('[1]'))).rejects.toMatchObject({ status: 400 });
  });

  it('accepts a uuid and refuses anything else', () => {
    const id = '0b6f2a4e-6c1d-4a39-9d3e-1f2a3b4c5d6e';
    expect(requireId({ noteId: id }, 'noteId')).toBe(id);
    expect(() => requireId({ noteId: 'abc' }, 'noteId')).toThrow('noteId must be an id.');
    expect(() => requireId({}, 'noteId')).toThrow(HttpError);
  });
});

describe('handle', () => {
  it('answers OPTIONS without calling the handler', async () => {
    const fn = vi.fn();
    const res = await handle(fn)(new Request('http://x/fn', { method: 'OPTIONS' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Headers')).toContain('authorization');
    expect(fn).not.toHaveBeenCalled();
  });

  it('turns HttpError into its status, code and message', async () => {
    const res = await handle(async () => {
      throw new HttpError(403, 'not_yours', 'That note belongs to someone else.');
    })(post('{}'));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: { code: 'not_yours', message: 'That note belongs to someone else.' } });
  });

  it('turns AiError into 502 ai_failed and anything else into 500 internal', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const ai = await handle(async () => {
      throw new AiError('ai_bad_json', 'x');
    })(post('{}'));
    expect(ai.status).toBe(502);
    expect((await ai.json()).error.code).toBe('ai_failed');

    const boom = await handle(async () => {
      throw new Error('db down');
    })(post('{}'));
    expect(boom.status).toBe(500);
    expect((await boom.json()).error.code).toBe('internal');
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run supabase/functions/_shared/gemini.test.ts supabase/functions/_shared/http.test.ts`
Expected: FAIL, imports cannot be resolved.

- [ ] **Step 3: Implement**

Create `supabase/functions/_shared/gemini.ts`:

```ts
// The one place that talks to the Gemini REST API. Pure apart from fetch and
// timers (both exist in Node too), so vitest can test it with a fake fetch.
// ai.ts wraps it with the Deno-only parts: secrets and prompt files.

export type AiErrorCode =
  | 'ai_config' // GEMINI_API_KEY missing
  | 'ai_timeout' // no answer within the time limit, twice
  | 'ai_network' // could not reach Gemini, twice
  | 'ai_http' // Gemini answered with an error status
  | 'ai_blocked' // Gemini refused the prompt or stopped for safety
  | 'ai_empty' // an answer with no text
  | 'ai_bad_json'; // text that is not JSON

/** Any failure talking to the AI. http.ts turns it into a 502 answer. */
export class AiError extends Error {
  constructor(
    readonly code: AiErrorCode,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'AiError';
  }
}

export interface GeminiRequest {
  apiKey: string;
  model: string;
  prompt: string;
  /** The shape the answer must follow, in Gemini's responseSchema form (type: 'OBJECT', 'STRING', ...). */
  schema: object;
  /** 0.2 for reading syllabuses and rating difficulty, 0.7 for writing questions. */
  temperature: number;
  /** Per attempt. Default 60 000. */
  timeoutMs?: number;
  /** Pause before the one retry. Default 1 000; tests pass 0. */
  retryDelayMs?: number;
  /** Injected in tests. Default: the global fetch. */
  fetchFn?: typeof fetch;
}

const API = 'https://generativelanguage.googleapis.com/v1beta/models';
const RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);

interface GeminiAnswer {
  promptFeedback?: { blockReason?: string };
  candidates?: { finishReason?: string; content?: { parts?: { text?: string }[] } }[];
}

/**
 * Send one prompt, get back parsed JSON. Retries once when Gemini cannot be
 * reached, times out, or answers 429 or 5xx. Never retries a bad answer.
 * The caller must still check the shape of what comes back.
 */
export async function callGemini<T>(req: GeminiRequest): Promise<T> {
  const fetchFn = req.fetchFn ?? fetch;
  const url = `${API}/${encodeURIComponent(req.model)}:generateContent?key=${encodeURIComponent(req.apiKey)}`;
  const body = JSON.stringify({
    contents: [{ role: 'user', parts: [{ text: req.prompt }] }],
    generationConfig: {
      temperature: req.temperature,
      responseMimeType: 'application/json',
      responseSchema: req.schema,
    },
  });

  let lastError: AiError | null = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    if (attempt === 2) await sleep(req.retryDelayMs ?? 1000);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), req.timeoutMs ?? 60_000);
    let res: Response;
    try {
      res = await fetchFn(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: controller.signal,
      });
    } catch (e) {
      lastError = controller.signal.aborted
        ? new AiError('ai_timeout', `Gemini did not answer within ${req.timeoutMs ?? 60_000} ms`)
        : // Deno's fetch errors include the URL, and the URL carries the key: hide it.
          new AiError('ai_network', `could not reach Gemini: ${String(e).replaceAll(req.apiKey, '[key]')}`);
      continue;
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      // The URL carries the key, so only the answer text goes into the message.
      const detail = (await res.text()).slice(0, 500);
      lastError = new AiError('ai_http', `Gemini answered ${res.status}: ${detail}`, res.status);
      if (RETRY_STATUSES.has(res.status)) continue;
      throw lastError;
    }
    return readAnswer<T>((await res.json()) as GeminiAnswer);
  }
  throw lastError ?? new AiError('ai_network', 'Gemini call failed');
}

function readAnswer<T>(answer: GeminiAnswer): T {
  const blocked = answer.promptFeedback?.blockReason;
  if (blocked) throw new AiError('ai_blocked', `Gemini refused the prompt: ${blocked}`);
  const candidate = answer.candidates?.[0];
  const reason = candidate?.finishReason;
  if (reason && reason !== 'STOP' && reason !== 'MAX_TOKENS') {
    throw new AiError('ai_blocked', `Gemini stopped early: ${reason}`);
  }
  const text = (candidate?.content?.parts ?? []).map((p) => p.text ?? '').join('');
  if (text.trim() === '') throw new AiError('ai_empty', 'Gemini returned no text');
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new AiError('ai_bad_json', `Gemini returned text that is not JSON: ${text.slice(0, 200)}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
```

Create `supabase/functions/_shared/http.ts`:

```ts
// Answers, errors and CORS for every function. No Deno-only API, so vitest
// can test it.
//
// Every error answer has the body { error: { code, message } }. The code is a
// short snake_case word the app can switch on; the message is a sentence a
// student can read. The codes are fixed by spec section 10:
//   400 bad_input, 401 not_signed_in, 403 guest_not_allowed or not_yours,
//   404 not_found, 409 a conflict word (for example too_late),
//   500 internal, 502 ai_failed.

import { AiError } from './gemini.ts';

/** The browser app calls functions from another origin, so every answer carries these. */
export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

/** Throw this anywhere inside a handler to answer with an error. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

/** A JSON answer with CORS headers. */
export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/** An error answer: { error: { code, message } }. */
export function error(code: string, status: number, message: string): Response {
  return json({ error: { code, message } }, status);
}

/** Read the request body as a JSON object, or throw a 400. */
export async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    if (body && typeof body === 'object' && !Array.isArray(body)) return body as Record<string, unknown>;
  } catch {
    // fall through to the 400 below
  }
  throw new HttpError(400, 'bad_input', 'Send a JSON object as the request body.');
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** body[field] as a row id, or throw a 400 naming the field. */
export function requireId(body: Record<string, unknown>, field: string): string {
  const value = body[field];
  if (typeof value !== 'string' || !UUID.test(value)) {
    throw new HttpError(400, 'bad_input', `${field} must be an id.`);
  }
  return value;
}

/**
 * Wrap a handler: answers the browser's OPTIONS check, turns HttpError and
 * AiError into proper answers, and anything else into a logged 500.
 */
export function handle(fn: (req: Request) => Promise<Response>): (req: Request) => Promise<Response> {
  return async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
    try {
      return await fn(req);
    } catch (e) {
      if (e instanceof HttpError) return error(e.code, e.status, e.message);
      if (e instanceof AiError) {
        console.error('AI call failed', e.code, e.message);
        return error('ai_failed', 502, 'The AI did not answer properly. Try again in a minute.');
      }
      console.error('unexpected error', e);
      return error('internal', 500, 'Something went wrong on the server. Try again in a moment.');
    }
  };
}
```

- [ ] **Step 4: Run them to see them pass**

Run: `npx vitest run supabase/functions/_shared/gemini.test.ts supabase/functions/_shared/http.test.ts`
Expected: PASS, 8 + 8 tests.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/gemini.ts supabase/functions/_shared/gemini.test.ts supabase/functions/_shared/http.ts supabase/functions/_shared/http.test.ts
git commit -m "Gemini call with timeout and one retry; JSON answers, error shape and CORS for every function

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Deno pieces: database client, caller check, askGemini, background calls, secrets

**Files:**
- Create: `supabase/functions/_shared/db.ts`, `auth.ts`, `ai.ts`, `invoke.ts`
- Create: `supabase/functions/_shared/prompts/README.md`
- Create: `supabase/functions/.env.example`

**Interfaces:**
- Consumes: `HttpError` (Task 5), `AiError`, `callGemini` (Task 5), `fillPrompt`, `PromptValue` (Task 4).
- Produces: `db` (the service-role `SupabaseClient`), `serviceRoleKey: string`; `interface AuthedUser { id: string; isAnonymous: boolean }`, `bearerToken(req: Request): string | null`, `requireUser(req: Request): Promise<AuthedUser>` (401 `not_signed_in`), `requireFullUser(req: Request): Promise<AuthedUser>` (also 403 `guest_not_allowed`), `isServiceCall(req: Request): boolean`; `askGemini<T>(promptName: string, variables: Record<string, PromptValue>, jsonSchema: object, options?: { temperature?: number; timeoutMs?: number }): Promise<T>` (without a temperature it picks 0.7 for `make-questions` and 0.2 for everything else, so the A4/A6 plan's three-argument calls get the spec's temperatures), `loadPrompt(name: string): Promise<string>`, re-exported `AiError`; `invokeInBackground(name: string, body: unknown): void`.
- Spec 3 says `requireUser` returns the user id. It returns `{ id, isAnonymous }` instead, because the quiz functions need to know whether the caller is a guest; the other plans already expect this shape. `variables` accepts any `PromptValue`, which includes the plain strings the other plans pass.

Why the service-role key and not the newer secret keys: the project has legacy JWT keys switched on (checked 2026-10-10: the legacy anon key is enabled). A function called with `verify_jwt = true` only accepts JWTs, and `SUPABASE_SERVICE_ROLE_KEY` is one, so `invokeInBackground` can pass it and the called function can recognise it with `isServiceCall`. The newer `sb_secret_...` keys are not JWTs and would be refused. If the legacy keys are ever switched off, functions called this way need `verify_jwt = false` and their own key check.

`EdgeRuntime` is a global of Supabase's runtime. Deno's type checker does not know it (importing `jsr:@supabase/functions-js/edge-runtime.d.ts` did not declare it in testing), so `invoke.ts` declares it itself.

No unit tests here: these files only read secrets and call Supabase. They are exercised by the hand tests in Task 10.

- [ ] **Step 1: Write db.ts**

Create `supabase/functions/_shared/db.ts`:

```ts
// The server's database client. It uses the service role, so it bypasses
// Row Level Security and sees every row. Every function must check that the
// caller owns (or may see) a row before reading or writing it for them.

import { createClient } from 'npm:@supabase/supabase-js@2';

const url = Deno.env.get('SUPABASE_URL');
const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');

/**
 * The service-role key Supabase gives every function. It is a JWT while the
 * project's legacy API keys are on (checked 2026-10-10), which is what lets
 * one function call another through verify_jwt (see invoke.ts).
 */
export const serviceRoleKey: string = key;

/** One shared service-role client per running function. */
export const db = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});
```

- [ ] **Step 2: Write auth.ts**

Create `supabase/functions/_shared/auth.ts`:

```ts
// Who is calling? Functions run with verify_jwt = true, so the platform has
// already checked the token's signature; here we turn it into a user.

import { db, serviceRoleKey } from './db.ts';
import { HttpError } from './http.ts';

export interface AuthedUser {
  /** The auth user id, same as profiles.id. */
  id: string;
  /** True for anonymous (guest) sign-ins: quiz players without an account. */
  isAnonymous: boolean;
}

/** The token after "Bearer ", or null. */
export function bearerToken(req: Request): string | null {
  const header = req.headers.get('Authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1].trim() : null;
}

/** The signed-in caller, guests included. 401 when there is no valid user token. */
export async function requireUser(req: Request): Promise<AuthedUser> {
  const token = bearerToken(req);
  if (!token) throw new HttpError(401, 'not_signed_in', 'Sign in first.');
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, 'not_signed_in', 'Sign in first.');
  return { id: data.user.id, isAnonymous: data.user.is_anonymous === true };
}

/** Like requireUser, but guests get 403. Everything except quiz play uses this. */
export async function requireFullUser(req: Request): Promise<AuthedUser> {
  const user = await requireUser(req);
  if (user.isAnonymous) {
    throw new HttpError(403, 'guest_not_allowed', 'Guests cannot do this. Create an account first.');
  }
  return user;
}

/** True when another function called with the service-role key (see invoke.ts). */
export function isServiceCall(req: Request): boolean {
  return bearerToken(req) === serviceRoleKey;
}
```

- [ ] **Step 3: Write ai.ts**

Create `supabase/functions/_shared/ai.ts`:

```ts
// askGemini: the only way functions talk to the AI.
//
// Prompts are Markdown files in ./prompts/<name>.md with {{placeholders}}.
// A function that uses a prompt must ship the prompt files with it, by adding
// to supabase/config.toml:
//
//   [functions.<function-name>]
//   static_files = ["./functions/_shared/prompts/*.md"]
//
// Secrets: GEMINI_API_KEY (required), GEMINI_MODEL (default gemini-2.5-flash).

import { AiError, callGemini } from './gemini.ts';
import { fillPrompt, type PromptValue } from './template.ts';

export { AiError } from './gemini.ts';

/**
 * Temperature by prompt when the caller gives none (spec section 3): writing
 * questions needs some variety, reading dates and rating difficulty must not.
 */
const TEMPERATURE_BY_PROMPT: Record<string, number> = {
  'make-questions': 0.7,
  'read-syllabus': 0.2,
  'rate-difficulty': 0.2,
};

export interface AskOptions {
  /** Overrides the default for the prompt (0.7 for make-questions, 0.2 otherwise). */
  temperature?: number;
  /** Per attempt. Default 60 000 ms. */
  timeoutMs?: number;
}

/** Read prompts/<name>.md. Names are lowercase words joined by dashes. */
export async function loadPrompt(name: string): Promise<string> {
  if (!/^[a-z0-9-]+$/.test(name)) throw new Error(`bad prompt name: ${name}`);
  return await Deno.readTextFile(new URL(`./prompts/${name}.md`, import.meta.url));
}

/**
 * Fill the prompt, ask Gemini for JSON that follows jsonSchema (Gemini's
 * responseSchema form: type 'OBJECT', 'ARRAY', 'STRING' ...), and return it
 * parsed. Throws AiError on any failure. The result is NOT validated against
 * the schema here: each caller checks the fields it uses and drops bad items.
 */
export async function askGemini<T>(
  promptName: string,
  variables: Record<string, PromptValue>,
  jsonSchema: object,
  options: AskOptions = {},
): Promise<T> {
  const apiKey = Deno.env.get('GEMINI_API_KEY');
  if (!apiKey) throw new AiError('ai_config', 'GEMINI_API_KEY is not set');
  const model = Deno.env.get('GEMINI_MODEL') || 'gemini-2.5-flash';
  const prompt = fillPrompt(await loadPrompt(promptName), variables);
  return await callGemini<T>({
    apiKey,
    model,
    prompt,
    schema: jsonSchema,
    temperature: options.temperature ?? TEMPERATURE_BY_PROMPT[promptName] ?? 0.2,
    timeoutMs: options.timeoutMs ?? 60_000,
  });
}
```

There are no prompt files in this branch. Each task that adds an AI job (A4 `read-syllabus.md`, A5 `rate-difficulty.md`, A6 `make-questions.md`) adds its prompt file to `supabase/functions/_shared/prompts/` and the `static_files` line to its function's block in `config.toml`. Create the folder now with a short README so those plans find it:

Create `supabase/functions/_shared/prompts/README.md`:

```markdown
# Prompts

One Markdown file per AI job: `read-syllabus.md`, `make-questions.md`, `rate-difficulty.md`. `askGemini('<name>', variables, schema)` in `../ai.ts` reads `<name>.md` and replaces every `{{placeholder}}` with the matching variable. A placeholder with no variable is an error, so a prompt never reaches the AI with a hole in it.

A function that uses a prompt must ship it: add `static_files = ["./functions/_shared/prompts/<name>.md"]` to that function's block in `supabase/config.toml`.

Prompts are English. They tell the AI to use only the text it is given and never to add facts.
```

- [ ] **Step 4: Write invoke.ts**

Create `supabase/functions/_shared/invoke.ts`:

```ts
// Start another function without waiting for its answer ("fire and forget"),
// for example extract-text starting make-questions.
//
// The call carries the service-role key, which is a JWT while the project's
// legacy API keys are on, so it passes verify_jwt. The called function
// recognises it with isServiceCall() from auth.ts. If the legacy keys are
// ever switched off, the called function needs verify_jwt = false and its own
// key check.

import { serviceRoleKey } from './db.ts';

/** Supabase's runtime global: keeps the worker alive for work after the answer is sent. */
declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

/** POST body to /functions/v1/<name>. Failures are logged, never thrown. */
export function invokeInBackground(name: string, body: unknown): void {
  const url = `${Deno.env.get('SUPABASE_URL')}/functions/v1/${name}`;
  const call = fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${serviceRoleKey}`, apikey: serviceRoleKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
    .then(async (res) => {
      const text = await res.text();
      if (!res.ok) console.error(`${name} answered ${res.status}: ${text.slice(0, 300)}`);
    })
    .catch((e) => console.error(`${name} could not be called`, e));
  // Keep this worker alive until the call is done, after our own answer is sent.
  EdgeRuntime.waitUntil(call);
}
```

- [ ] **Step 5: Write the secrets example**

Create `supabase/functions/.env.example`:

```sh
# Secrets for the server functions. Copy to supabase/functions/.env for a
# local run (never commit it). On the live project set them with
#   npx supabase secrets set NAME=value
# SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are given to every function by
# Supabase and are not listed here.

# Gemini API key from Google AI Studio.
GEMINI_API_KEY=
# Model name. Empty means gemini-2.5-flash.
GEMINI_MODEL=
```

Check it is not ignored: `git check-ignore supabase/functions/.env.example` must print nothing (the root `.gitignore` has `!.env.example`).

- [ ] **Step 6: Type-check with Deno (optional, only if Deno is already installed)**

Run: `deno --version`. If it prints a version, run from the top folder:

```bash
DENO_DIR=.local-deps/deno deno check supabase/functions/_shared/db.ts supabase/functions/_shared/auth.ts supabase/functions/_shared/ai.ts supabase/functions/_shared/invoke.ts
```

Expected: four `Check` lines and no error. The first run downloads the npm packages into `.local-deps/deno` (on D:, gitignored). If Deno is not installed, skip this; do not install it.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/_shared/db.ts supabase/functions/_shared/auth.ts supabase/functions/_shared/ai.ts supabase/functions/_shared/invoke.ts supabase/functions/_shared/prompts/README.md supabase/functions/.env.example
git commit -m "Server pieces: service client, caller check, askGemini with prompt files, background function calls

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: The extract-text function

**Files:**
- Create: `supabase/functions/_shared/extraction.ts`
- Test: `supabase/functions/_shared/extraction.test.ts`
- Create: `supabase/functions/extract-text/parse.ts`, `supabase/functions/extract-text/index.ts`

**Interfaces:**
- Consumes: `toChunks` (Task 3), `handle`, `HttpError`, `json`, `readJson`, `requireId` (Task 5), `requireFullUser`, `db`, `invokeInBackground` (Task 6).
- Produces from `extraction.ts`: `type FileKind = 'pdf' | 'docx' | 'text'`, `fileKind(filename: string, contentType: string | null): FileKind | null`, `looksBinary(text: string): boolean`, `MAX_PDF_PAGES = 100`, `FAILURE` (the reason strings below).
- Produces from `parse.ts`: `extractFileText(bytes: Uint8Array, filename: string, contentType: string | null): Promise<{ ok: true; text: string } | { ok: false; reason: string }>`, never throws.
- Produces the endpoint: `POST /functions/v1/extract-text` with `{ "noteId": "<uuid>" }` and a full user's token. Answers 200 `{ "status": "ready", "chunks": n }` or 200 `{ "status": "failed", "chunks": 0, "reason": "<FAILURE value>" }`. Errors as JSON: 400 `bad_input`, 401 `not_signed_in`, 403 `guest_not_allowed` or `not_yours`, 404 `not_found`. For a note that is not a syllabus it starts `make-questions` with `{ "noteId" }` and the service-role key. That function does not exist until A6, so until then the logs show "make-questions answered 404", which is expected.

Failure reasons, exactly as the screen will show them:

- `file type not supported, use PDF, Word (.docx), .txt or .md`
- `no readable text, this looks like a scanned image`
- `the file could not be read, it may be damaged or password protected`
- `the uploaded file was not found, upload it again`
- `the file has more than 100 pages, split it into smaller files`
- `something went wrong on our side, upload the file again`

Library versions are pinned. `mammoth@1.13.0` fails under Deno with "ExternalPromise.resolve is not a function" because it sets `__proto__`, which Deno removes; `1.12.0` works. `unpdf@1.8.1` is the version checked on 2026-10-10. `@supabase/supabase-js@2` stays on the major version, like every other function.

Why `index.ts` can't get a unit test: it needs a live database and storage. Its logic is the order of calls; the pure decisions (file kind, chunking, reasons) are tested, and Task 10 runs it end to end.

- [ ] **Step 1: Write the failing test for the file rules**

Create `supabase/functions/_shared/extraction.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { fileKind, looksBinary } from './extraction.ts';

describe('fileKind', () => {
  it('picks the parser from the extension, any case', () => {
    expect(fileKind('Week 1.PDF', null)).toBe('pdf');
    expect(fileKind('notes.docx', 'application/octet-stream')).toBe('docx');
    expect(fileKind('notes.txt', null)).toBe('text');
    expect(fileKind('notes.md', null)).toBe('text');
    expect(fileKind('notes.markdown', null)).toBe('text');
  });

  it('uses only the last part of a storage path', () => {
    expect(fileKind('user/note/my.notes.pdf', null)).toBe('pdf');
  });

  it('refuses unknown extensions even when the content type says text', () => {
    expect(fileKind('notes.doc', 'application/msword')).toBeNull();
    expect(fileKind('notes.rtf', 'text/plain')).toBeNull();
    expect(fileKind('photo.jpg', 'image/jpeg')).toBeNull();
  });

  it('falls back to the content type only when there is no extension', () => {
    expect(fileKind('notes', 'text/plain; charset=utf-8')).toBe('text');
    expect(fileKind('notes', 'application/pdf')).toBe('pdf');
    expect(fileKind('notes', null)).toBeNull();
    expect(fileKind('.hidden', 'text/markdown')).toBe('text');
  });
});

describe('looksBinary', () => {
  it('flags text with NUL characters', () => {
    expect(looksBinary('PK\u0003\u0004\u0000\u0000')).toBe(true);
    expect(looksBinary('plain notes')).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run supabase/functions/_shared/extraction.test.ts`
Expected: FAIL, the import cannot be resolved.

- [ ] **Step 3: Implement the file rules**

Create `supabase/functions/_shared/extraction.ts`:

```ts
// Rules for the text extractor that need no parser: which files we read and
// the reasons a student sees when we cannot. Pure, tested with vitest.

export type FileKind = 'pdf' | 'docx' | 'text';

/** A PDF longer than this is refused, to stay inside the 2-second CPU limit. */
export const MAX_PDF_PAGES = 100;

/** One-line reasons saved in notes.failure_reason and shown on the screen. */
export const FAILURE = {
  unsupported: 'file type not supported, use PDF, Word (.docx), .txt or .md',
  noText: 'no readable text, this looks like a scanned image',
  unreadable: 'the file could not be read, it may be damaged or password protected',
  missing: 'the uploaded file was not found, upload it again',
  tooLong: `the file has more than ${MAX_PDF_PAGES} pages, split it into smaller files`,
  serverError: 'something went wrong on our side, upload the file again',
} as const;

const BY_EXTENSION: Record<string, FileKind> = {
  pdf: 'pdf',
  docx: 'docx',
  txt: 'text',
  md: 'text',
  markdown: 'text',
};

const BY_CONTENT_TYPE: Record<string, FileKind> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'text/plain': 'text',
  'text/markdown': 'text',
  'text/x-markdown': 'text',
};

/**
 * Which parser to use. The file name's extension decides when there is one;
 * an unknown extension (.doc, .rtf, .pages) is not supported even if the
 * content type claims text. Only a name with no extension falls back to the
 * content type. Null means "not supported".
 */
export function fileKind(filename: string, contentType: string | null): FileKind | null {
  const base = filename.split('/').pop() ?? '';
  const dot = base.lastIndexOf('.');
  if (dot > 0) return BY_EXTENSION[base.slice(dot + 1).toLowerCase()] ?? null;
  const type = (contentType ?? '').split(';')[0].trim().toLowerCase();
  return BY_CONTENT_TYPE[type] ?? null;
}

/** A "text" file that contains NUL characters is really a binary file renamed. */
export function looksBinary(text: string): boolean {
  return text.includes('\u0000');
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `npx vitest run supabase/functions/_shared/extraction.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Write the parser adapter**

Create `supabase/functions/extract-text/parse.ts`:

```ts
// The only file that touches the PDF and Word libraries. Bytes in, text out.

import { extractText, getDocumentProxy } from 'npm:unpdf@1.8.1';
import mammoth from 'npm:mammoth@1.12.0';
import { Buffer } from 'node:buffer';
import { FAILURE, fileKind, looksBinary, MAX_PDF_PAGES } from '../_shared/extraction.ts';

export type ParseResult = { ok: true; text: string } | { ok: false; reason: string };

/** Pull the plain text out of an uploaded file. Never throws. */
export async function extractFileText(
  bytes: Uint8Array,
  filename: string,
  contentType: string | null,
): Promise<ParseResult> {
  const kind = fileKind(filename, contentType);
  if (!kind) return { ok: false, reason: FAILURE.unsupported };
  try {
    if (kind === 'pdf') {
      const pdf = await getDocumentProxy(bytes);
      if (pdf.numPages > MAX_PDF_PAGES) return { ok: false, reason: FAILURE.tooLong };
      const { text } = await extractText(pdf, { mergePages: false });
      // A blank line between pages, so a page never runs into the next one.
      return { ok: true, text: text.join('\n\n') };
    }
    if (kind === 'docx') {
      const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
      return { ok: true, text: value };
    }
    const text = new TextDecoder('utf-8').decode(bytes);
    if (looksBinary(text)) return { ok: false, reason: FAILURE.unreadable };
    return { ok: true, text };
  } catch (e) {
    console.error(`could not parse ${kind} file`, e);
    return { ok: false, reason: FAILURE.unreadable };
  }
}
```

- [ ] **Step 6: Write the handler**

Create `supabase/functions/extract-text/index.ts`:

```ts
// extract-text: turn an uploaded file into numbered chunks of text (task A4a).
//
// POST { noteId }  with the student's access token.
// The app has already created the note (source 'file', status 'processing')
// and uploaded the file to uploads/<user id>/<note id>/<file name>.
//
// Answers 200 with one of:
//   { status: 'ready',  chunks: n }
//   { status: 'failed', chunks: 0, reason }   (the reason is also saved on the note)
// Errors: 400 bad_input, 401 not_signed_in, 403 guest_not_allowed or
// not_yours, 404 not_found.
//
// The uploaded file is deleted on every path. Calling again for a note that
// already has chunks changes nothing and answers with the same count.

import { requireFullUser } from '../_shared/auth.ts';
import { toChunks } from '../_shared/chunking.ts';
import { db } from '../_shared/db.ts';
import { FAILURE } from '../_shared/extraction.ts';
import { handle, HttpError, json, readJson, requireId } from '../_shared/http.ts';
import { invokeInBackground } from '../_shared/invoke.ts';
import { extractFileText } from './parse.ts';

const BUCKET = 'uploads';

Deno.serve(
  handle(async (req) => {
    if (req.method !== 'POST') throw new HttpError(400, 'bad_input', 'Use POST.');
    const user = await requireFullUser(req);
    const noteId = requireId(await readJson(req), 'noteId');

    const { data: note, error } = await db
      .from('notes')
      .select('id, owner_id, source, status, is_syllabus')
      .eq('id', noteId)
      .maybeSingle();
    if (error) throw error;
    if (!note) throw new HttpError(404, 'not_found', 'That note could not be found.');
    if (note.owner_id !== user.id) throw new HttpError(403, 'not_yours', 'That note belongs to someone else.');
    if (note.source !== 'file') throw new HttpError(400, 'bad_input', 'That note was not uploaded as a file.');

    const folder = `${user.id}/${noteId}`;
    try {
      // Safe to call again: chunks already there means the work is done.
      const existing = await countChunks(noteId);
      if (existing > 0) {
        if (note.status !== 'ready') await markReady(noteId);
        return json({ status: 'ready', chunks: existing });
      }

      const files = await listFolder(folder);
      if (files.length === 0) return await markFailed(noteId, FAILURE.missing);
      const newest = files[0];

      const { data: blob, error: downloadError } = await db.storage.from(BUCKET).download(`${folder}/${newest.name}`);
      if (downloadError || !blob) return await markFailed(noteId, FAILURE.missing);

      const parsed = await extractFileText(new Uint8Array(await blob.arrayBuffer()), newest.name, newest.mimetype);
      if (!parsed.ok) return await markFailed(noteId, parsed.reason);

      const chunks = toChunks(parsed.text);
      if (chunks.length === 0) return await markFailed(noteId, FAILURE.noText);

      const { error: insertError } = await db
        .from('chunks')
        .insert(chunks.map((text, position) => ({ note_id: noteId, position, text })));
      if (insertError) {
        // 23505 (unique note_id + position): a call running at the same time inserted them first.
        if (insertError.code === '23505') return json({ status: 'ready', chunks: await countChunks(noteId) });
        throw insertError;
      }
      await markReady(noteId);

      // A syllabus goes to read-syllabus (the app calls it). Notes get questions.
      if (!note.is_syllabus) invokeInBackground('make-questions', { noteId });
      return json({ status: 'ready', chunks: chunks.length });
    } catch (e) {
      console.error('extract-text failed', e);
      return await markFailed(noteId, FAILURE.serverError);
    } finally {
      // Product rule: only text is stored. The file goes on every path.
      await removeFolder(folder);
    }
  }),
);

async function countChunks(noteId: string): Promise<number> {
  const { count, error } = await db.from('chunks').select('id', { count: 'exact', head: true }).eq('note_id', noteId);
  if (error) throw error;
  return count ?? 0;
}

interface StoredFile {
  name: string;
  mimetype: string | null;
}

/** Files (not sub-folders) in the note's upload folder, newest first. */
async function listFolder(folder: string): Promise<StoredFile[]> {
  const { data, error } = await db.storage
    .from(BUCKET)
    .list(folder, { limit: 100, sortBy: { column: 'created_at', order: 'desc' } });
  if (error) throw error;
  return (data ?? [])
    .filter((f) => f.id !== null)
    .map((f) => ({ name: f.name, mimetype: (f.metadata?.mimetype as string | undefined) ?? null }));
}

async function removeFolder(folder: string): Promise<void> {
  try {
    const files = await listFolder(folder);
    if (files.length === 0) return;
    const { error } = await db.storage.from(BUCKET).remove(files.map((f) => `${folder}/${f.name}`));
    if (error) console.error(`could not delete uploads in ${folder}`, error);
  } catch (e) {
    console.error(`could not delete uploads in ${folder}`, e);
  }
}

async function markReady(noteId: string): Promise<void> {
  const { error } = await db.from('notes').update({ status: 'ready', failure_reason: null }).eq('id', noteId);
  if (error) throw error;
}

async function markFailed(noteId: string, reason: string): Promise<Response> {
  const { error } = await db.from('notes').update({ status: 'failed', failure_reason: reason }).eq('id', noteId);
  if (error) console.error('could not mark the note failed', error);
  return json({ status: 'failed', chunks: 0, reason });
}
```

- [ ] **Step 7: Type-check (optional, only if Deno is already installed)**

```bash
DENO_DIR=.local-deps/deno deno check supabase/functions/extract-text/index.ts
```

Expected: `Check supabase/functions/extract-text/index.ts` and no error. Skip if `deno --version` fails; do not install Deno.

- [ ] **Step 8: Run the parser on real bytes (optional, only if Deno is already installed)**

This proves the PDF and Word libraries load and work under Deno, not just that their types check. The throwaway script goes in the gitignored `.local-deps/tmp` folder. Run from the top folder in Git Bash:

```bash
mkdir -p .local-deps/tmp
cat > .local-deps/tmp/smoke.ts <<'EOF'
import { extractFileText } from '../../supabase/functions/extract-text/parse.ts';
const enc = new TextEncoder();
console.log(JSON.stringify(await extractFileText(enc.encode('\ufeffHello notes'), 'a.txt', 'text/plain')));
console.log(JSON.stringify(await extractFileText(new Uint8Array([1, 2, 3]), 'a.pdf', null)));
console.log(JSON.stringify(await extractFileText(new Uint8Array([1]), 'a.rtf', 'text/plain')));
EOF
DENO_DIR=.local-deps/deno deno run -A .local-deps/tmp/smoke.ts
```

Expected (a "could not parse pdf file" log line between them is fine):

```
{"ok":true,"text":"Hello notes"}
{"ok":false,"reason":"the file could not be read, it may be damaged or password protected"}
{"ok":false,"reason":"file type not supported, use PDF, Word (.docx), .txt or .md"}
```

After Task 8 adds the PDF and Word fixtures, add these two lines to `.local-deps/tmp/smoke.ts`, run it again, and expect `"ok":true` with the Biology 101 notes text for both (the script runs from the top folder, so the paths are relative to it):

```ts
console.log(JSON.stringify(await extractFileText(await Deno.readFile('supabase/functions/_fixtures/typed-notes.pdf'), 'n.pdf', null)));
console.log(JSON.stringify(await extractFileText(await Deno.readFile('supabase/functions/_fixtures/typed-notes.docx'), 'n.docx', null)));
```

If Deno is not installed, the PDF and Word parsing is first exercised by the live hand test in Task 10.

- [ ] **Step 9: Run every test**

Run: `npm test`
Expected: PASS, 6 files in `supabase/functions/_shared`, 46 tests, plus the engine's tests in `packages/shared`.

- [ ] **Step 10: Commit**

```bash
git add supabase/functions/_shared/extraction.ts supabase/functions/_shared/extraction.test.ts supabase/functions/extract-text
git commit -m "extract-text: PDF, Word, text and Markdown to chunks; file deleted on every path; starts make-questions

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Fixtures and the functions README

**Files:**
- Create: `supabase/functions/README.md`
- Create: `supabase/functions/_fixtures/README.md`, `typed-notes.txt`, `notes-photosynthesis.md`, `try-extract.sh`
- Create by hand: `supabase/functions/_fixtures/typed-notes.pdf`, `typed-notes.docx`, `notes-scanned.pdf`

**Interfaces:**
- Produces: `bash supabase/functions/_fixtures/try-extract.sh <file> <content-type> [note-id]`, reading `CRAMRADE_EMAIL`, `CRAMRADE_PASSWORD` and `SUPABASE_PUBLISHABLE_KEY` from the environment.

- [ ] **Step 1: Write the functions README**

Create `supabase/functions/README.md`:

~~~~markdown
# Server functions (Supabase Edge Functions)

All server code for Cramrade. Each folder is one function, reachable at
`https://ialkxvoytoqfuxxnzlaa.supabase.co/functions/v1/<folder name>`.
Functions go live by themselves when a pull request is merged into `main`.

## Folders

- `_shared/`: code several functions use.
  - Pure files (`chunking.ts`, `quote-check.ts`, `template.ts`, `gemini.ts`, `http.ts`, `extraction.ts`) use no Deno-only feature, so `npm test` at the top of the repo tests them with vitest. Keep it that way: no `Deno.` and no `npm:` imports in these.
  - Deno files (`db.ts`, `auth.ts`, `ai.ts`, `invoke.ts`) read secrets and talk to the database. They are not unit tested; the hand tests below exercise them.
  - `prompts/`: one Markdown file per AI job, with `{{placeholders}}`. Each task that adds an AI job adds its prompt file here.
- The quote rule: `quoteAppears` in `_shared/quote-check.ts` and the database trigger `private.verify_question` both collapse runs of spaces, tabs and line breaks to one space and trim the ends before looking for the quote. Change one, change the other.
- `extract-text/`: turns an uploaded file into chunks of text (task A4a).
- `_fixtures/`: sample files and a script for testing by hand.

## Secrets

The functions need two secrets of our own. Supabase gives every function `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` by itself.

- `GEMINI_API_KEY`: the Gemini API key from Google AI Studio.
- `GEMINI_MODEL`: which Gemini model to use. Leave it unset for `gemini-2.5-flash`.

Set them once on the live project (Dev A, from the top folder of the repo, after `npx supabase login` and `npx supabase link`):

```sh
npx supabase secrets set GEMINI_API_KEY=your-key-here
npx supabase secrets set GEMINI_MODEL=gemini-2.5-flash
npx supabase secrets list
```

`supabase/functions/.env.example` lists the same names with empty values. A real `.env` file is never committed.

## Prompt files must ship with their function

A function that calls `askGemini` reads its prompt from `_shared/prompts/`. Add this to `supabase/config.toml` for that function, or the file will be missing when it runs:

```toml
[functions.make-questions]
verify_jwt = true
static_files = ["./functions/_shared/prompts/*.md"]
```

If the files still do not arrive after a deploy (the function fails with "No such file"), fall back to `prompts/<name>.ts` files that export the same text as a string, one file per prompt, and change `loadPrompt` in `ai.ts` to import them.

## Calling a function by hand

Every function except the calendar feed needs a signed-in user's access token. Sign in with a test account to get one:

```sh
SB=https://ialkxvoytoqfuxxnzlaa.supabase.co
KEY=sb_publishable_...   # EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY from apps/app/.env

curl -s "$SB/auth/v1/token?grant_type=password" -H "apikey: $KEY" -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"..."}'
# copy access_token from the answer
TOKEN=eyJ...

curl -s -X POST "$SB/functions/v1/extract-text" -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{"noteId":"<note id>"}'
```

Errors always look like `{"error":{"code":"not_yours","message":"That note belongs to someone else."}}`, with status 400, 401, 403, 404, 409, 500 or 502 (the AI failed). A call with no token at all is refused by Supabase before our code runs, with its own 401 body.

For extract-text, `_fixtures/try-extract.sh` does the whole round trip (sign in, create a note, upload, call, check the file is gone). See `_fixtures/README.md`.

## Type-checking the functions (optional)

Only if Deno is already installed (do not install it just for this). Keep its download cache on D: inside the repo's ignored `.local-deps` folder:

```sh
DENO_DIR=.local-deps/deno deno check supabase/functions/extract-text/index.ts
```

Do not point it at the `*.test.ts` files: those are for vitest.

## Logs

Supabase dashboard, Edge Functions, pick the function, Logs. `console.error` lines from the code show up there.
~~~~

- [ ] **Step 2: Write the fixtures README**

Create `supabase/functions/_fixtures/README.md`:

~~~~markdown
# Sample files for testing the server functions by hand

All text is English and made up for testing.

- `typed-notes.txt`: Biology 101 notes, weeks 1 to 8, 3,341 words. extract-text makes 10 chunks from it. The A6 hand test ("10 pages of notes give at least 20 questions") uses the PDF made from it.
- `typed-notes.pdf`: the same text as a normal (typed) PDF, about 10 pages.
- `typed-notes.docx`: the same text as a Word file.
- `notes-photosynthesis.md`: about 140 words of Markdown. extract-text makes 1 chunk.
- `notes-scanned.pdf`: a PDF that is only a picture of text, with no text layer.
- `try-extract.sh`: uploads one file and runs extract-text on it.

## Making the PDF and Word files

They are binary, so make them once by hand and commit them:

1. Open `typed-notes.txt` in Word or Google Docs. Keep the blank lines between paragraphs. Set the text to 12 pt with 1.5 line spacing, which gives about 10 pages.
2. Save as `typed-notes.docx` (Word) here.
3. Save or download as PDF: `typed-notes.pdf` here.
4. For the scanned one: take a screenshot of the first page of the PDF, open the screenshot in the Photos app, print it with "Microsoft Print to PDF", and save it here as `notes-scanned.pdf`. Check it really has no text: in a PDF viewer you cannot select any words.

Keep each file under 1 MB.

## Running a hand test

From the top folder of the repo, in Git Bash, with a test account:

```sh
export CRAMRADE_EMAIL=test@example.com CRAMRADE_PASSWORD=... SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
bash supabase/functions/_fixtures/try-extract.sh supabase/functions/_fixtures/typed-notes.txt text/plain
```

The expected answers for each file are in the A4a plan (`docs/superpowers/plans/2026-10-10-a4a-server-foundation.md`, last task).
~~~~

- [ ] **Step 3: Write the text fixtures**

The name `typed-notes` is fixed: the A4/A6 plan's hand test uploads the `typed-notes.pdf` made from this text.

Create `supabase/functions/_fixtures/typed-notes.txt` (3,341 words, about 10 pages at 12 pt with 1.5 spacing; toChunks gives 10 chunks):

```text
Biology 101: lecture notes, weeks 1 to 8

Week 1: What makes something alive

Biologists use a short list of features to decide whether something is alive. Living things are made of one or more cells. They take in energy and use it to build and repair themselves, which is called metabolism. They respond to changes around them, keep their inside conditions fairly steady, grow, reproduce, and pass on information in the form of DNA. Over many generations, populations of living things change, which is called evolution. No single feature is enough on its own. A crystal grows and a fire uses energy, but neither has cells or DNA.

Viruses sit at the edge of this list. A virus has genetic material wrapped in a protein coat, and it can evolve, but it has no cells and no metabolism of its own. It can only copy itself inside the cell of a host. For this reason most biologists do not count viruses as living things, although they study them closely because they cause many diseases in plants and animals.

Life is organised in levels. Atoms join to form molecules, and large molecules such as proteins and DNA are called macromolecules. Inside a cell, groups of molecules form organelles, each with its own job. Many cells of the same kind form a tissue, and several tissues working together form an organ, such as the heart or a leaf. Organs work together in organ systems, and a whole living thing is called an organism. Above the organism come populations, communities, ecosystems and finally the biosphere, which is every place on Earth where life is found.

Scientists learn about life using the scientific method. They make an observation, ask a question, and suggest a hypothesis, which is a possible explanation that can be tested. They then design an experiment with one variable changed on purpose, the independent variable, and measure its effect on another, the dependent variable. Everything else is kept the same, and a control group that receives no treatment is used for comparison. A hypothesis is never proved for certain; it is supported or rejected by the evidence. A theory, such as the theory of evolution, is a broad explanation supported by a large body of evidence from many experiments.

Week 2: The chemistry of life

About 96 percent of the mass of the human body is made of just four elements: carbon, hydrogen, oxygen and nitrogen. Carbon is special because each carbon atom can form four strong bonds, so carbon atoms can join into long chains and rings. These carbon skeletons are the backbone of the molecules of life.

Water makes up most of a cell. A water molecule is polar: the oxygen end carries a slight negative charge and the hydrogen ends carry a slight positive charge. Because of this, water molecules stick to each other through hydrogen bonds. Hydrogen bonding explains several properties of water that matter for life. Water takes a lot of energy to heat up, so it keeps temperatures steady. Ice is less dense than liquid water, so lakes freeze from the top down and the water underneath stays liquid. Water also dissolves many substances, which is why it is called the universal solvent.

There are four main groups of large biological molecules. Carbohydrates, such as glucose and starch, are made of sugar units and are used for quick energy and, in plants, for structure in the form of cellulose. Lipids, which include fats, oils and phospholipids, do not mix with water. They store energy over the long term and form the membranes around every cell. Proteins are chains of amino acids folded into precise shapes. They do most of the work in a cell: they speed up reactions, carry signals, move things and build structures. Nucleic acids, DNA and RNA, store and pass on genetic information.

Enzymes are proteins that act as catalysts. They speed up chemical reactions by lowering the activation energy, the energy needed to start the reaction, without being used up themselves. Each enzyme has an active site with a shape that fits only certain molecules, called substrates. This is often described with the lock and key model, although the active site actually changes shape slightly when the substrate binds, which is called induced fit. Enzymes work best at a certain temperature and pH. Too much heat or the wrong pH changes the shape of the active site, and the enzyme is said to be denatured. A denatured enzyme no longer works.

Week 3: Cells and their parts

The cell theory has three parts: all living things are made of cells, the cell is the basic unit of life, and all cells come from cells that already exist. There are two basic kinds of cells. Prokaryotic cells, found in bacteria and archaea, are small and simple and have no nucleus; their DNA floats in a region called the nucleoid. Eukaryotic cells, found in plants, animals, fungi and protists, are larger and keep their DNA inside a nucleus surrounded by a membrane.

Every cell is surrounded by a plasma membrane made of a double layer of phospholipids. Each phospholipid has a head that is attracted to water and two tails that avoid water, so the tails point inwards and the heads face the watery inside and outside of the cell. Proteins float in this layer, and the whole structure is described as a fluid mosaic. The membrane is selectively permeable: small uncharged molecules such as oxygen pass through easily, while ions and large molecules need the help of transport proteins.

Eukaryotic cells contain many organelles. The nucleus holds the DNA and controls the cell. Ribosomes build proteins, either floating free or attached to the rough endoplasmic reticulum. The smooth endoplasmic reticulum makes lipids. The Golgi apparatus modifies, sorts and packages proteins into vesicles for transport. Lysosomes contain enzymes that break down worn-out parts and food particles. Mitochondria release energy from food through cellular respiration and are often called the powerhouse of the cell.

Plant cells have three structures that animal cells lack. A rigid cell wall made of cellulose surrounds the membrane and gives support. Chloroplasts capture light energy for photosynthesis. A large central vacuole stores water and keeps the cell firm by pushing outwards against the wall. Mitochondria and chloroplasts both have their own DNA and ribosomes and divide on their own, which supports the endosymbiotic theory: long ago they were free-living bacteria that were taken in by a larger cell and stayed.

Substances cross membranes in several ways. Diffusion is the movement of particles from a region of high concentration to a region of low concentration, and it needs no energy. Osmosis is the diffusion of water across a selectively permeable membrane. In a hypotonic solution, which has fewer dissolved particles than the cell, water moves in and an animal cell may burst. In a hypertonic solution water moves out and the cell shrinks. Facilitated diffusion uses channel or carrier proteins but still needs no energy. Active transport moves substances against their concentration gradient and uses energy from ATP, as in the sodium-potassium pump.

Week 4: Cell division

Every living thing is made of cells, and new cells only come from cells that already exist. A cell copies itself through a sequence of events called the cell cycle. The cycle has two main stages. Interphase is the long stage in which the cell grows, carries out its normal work and copies its DNA. The mitotic phase is the short stage in which the copied DNA is separated and the cell splits into two. In a typical human cell grown in the lab, one full cycle takes about 24 hours, and less than one hour of that is spent in mitosis itself.

Interphase is divided into three parts. In the G1 phase the cell grows and makes proteins and organelles. In the S phase the cell replicates its DNA, so that each chromosome now consists of two identical sister chromatids joined at a region called the centromere. In the G2 phase the cell keeps growing and makes the structures it will need for division, such as the proteins that form the spindle. Cells that stop dividing, like most nerve cells, leave the cycle after G1 and enter a resting state called G0.

Mitosis is the division of the nucleus. It is usually described in four phases. In prophase the chromatin condenses into chromosomes that can be seen with a light microscope, the nucleolus disappears and the mitotic spindle starts to form from the centrosomes. In metaphase the nuclear envelope has broken down and the chromosomes line up along the middle of the cell, a plane called the metaphase plate. Each sister chromatid is attached to spindle fibres from opposite poles. In anaphase the centromeres split and the sister chromatids are pulled apart towards opposite ends of the cell. In telophase a new nuclear envelope forms around each set of chromosomes and the chromosomes begin to unwind.

Cytokinesis is the division of the cytoplasm, and it usually overlaps with telophase. In animal cells a ring of actin filaments contracts just under the cell membrane and pinches the cell in two, forming a cleavage furrow. Plant cells have a rigid cell wall and cannot pinch in. Instead, vesicles from the Golgi apparatus gather in the middle of the cell and fuse to form a cell plate, which grows outwards until it joins the existing wall. Either way, the result is two daughter cells, each with a full and identical set of chromosomes.

The cell cycle is controlled by checkpoints, points where the cell checks that conditions are right before it moves on. The G1 checkpoint checks cell size, nutrients and damage to DNA. The G2 checkpoint checks that DNA replication is complete and correct. The spindle checkpoint, during metaphase, checks that every chromosome is attached to the spindle. Proteins called cyclins and cyclin-dependent kinases drive the cell from one phase to the next. When these controls fail, a cell can divide again and again without stopping, which is how a tumour forms. Many cancer treatments work by stopping cells in the middle of division.

Meiosis is a different kind of division that makes gametes, the sperm and egg cells. It has two rounds of division after a single round of DNA replication, so it produces four cells, each with half the number of chromosomes of the parent cell. In humans that means 23 chromosomes instead of 46. During the first division, matching chromosomes from the mother and the father pair up and swap pieces of DNA in a process called crossing over. This, together with the random way the pairs line up, is why brothers and sisters are not identical, except for identical twins.

Week 5: Photosynthesis

Photosynthesis is the process in which plants, algae and some bacteria use light energy to make sugar from carbon dioxide and water. Oxygen is released as a by-product. The overall equation is six molecules of carbon dioxide plus six molecules of water, with light energy, giving one molecule of glucose and six molecules of oxygen. Almost all the energy in food chains on Earth first entered living things through photosynthesis.

Photosynthesis takes place in the chloroplasts. A chloroplast has two outer membranes and, inside, stacks of flattened sacs called thylakoids. A stack of thylakoids is called a granum. The thick fluid around the thylakoids is the stroma. The green pigment chlorophyll sits in the thylakoid membranes. Chlorophyll absorbs mainly red and blue light and reflects green light, which is why leaves look green.

The first stage is the light-dependent reactions, which happen in the thylakoid membranes. Light energy excites electrons in chlorophyll. To replace these electrons, water molecules are split, and this is where the oxygen released by plants comes from. The excited electrons pass along an electron transport chain, and their energy is used to make ATP and NADPH, two molecules that carry energy to the next stage.

The second stage is the Calvin cycle, which happens in the stroma and does not need light directly. The enzyme RuBisCO attaches carbon dioxide from the air to a five-carbon sugar. This step is called carbon fixation. Using the energy in ATP and NADPH, the cell then turns the products into a three-carbon sugar, some of which leaves the cycle to build glucose while the rest is recycled to keep the cycle going. RuBisCO is thought to be the most common protein on Earth.

The rate of photosynthesis depends on three main limiting factors: light intensity, carbon dioxide concentration and temperature. If any one of them is in short supply, it holds back the whole process, even if the others are plentiful. Greenhouse growers use this idea by adding extra carbon dioxide and light to increase their crops. At very high temperatures the rate falls because enzymes such as RuBisCO begin to lose their shape.

Week 6: Cellular respiration

Cellular respiration is the process that releases the energy stored in food and stores it in ATP, the energy currency of the cell. In aerobic respiration, glucose and oxygen are turned into carbon dioxide and water. The equation is roughly the reverse of photosynthesis. Both plants and animals carry out respiration; plants make their own glucose first, while animals get it from food.

Respiration has three main stages. Glycolysis happens in the cytoplasm and does not need oxygen. One glucose molecule is split into two molecules of pyruvate, giving a small gain of two ATP. If oxygen is present, the pyruvate enters the mitochondria. In the Krebs cycle, also called the citric acid cycle, it is broken down completely, carbon dioxide is released, and energy-carrying molecules called NADH and FADH2 are made.

The last stage is the electron transport chain, found in the inner membrane of the mitochondrion. NADH and FADH2 hand over their electrons, which pass along a chain of proteins. The energy released is used to pump hydrogen ions across the membrane. The ions flow back through an enzyme called ATP synthase, which uses their movement to make ATP. Oxygen is the final electron acceptor at the end of the chain and joins with hydrogen to form water. Altogether, one glucose molecule can give about 30 to 32 molecules of ATP.

When there is no oxygen, cells can still make a little ATP by fermentation. Glycolysis continues, and the pyruvate is turned into another product so that the cell can keep glycolysis running. In human muscle cells during hard exercise, pyruvate is turned into lactic acid. In yeast, it is turned into ethanol and carbon dioxide, which is how bread rises and how beer and wine are made. Fermentation gives only two ATP per glucose, far less than aerobic respiration.

Week 7: Genetics

Gregor Mendel, a monk who studied pea plants in the 1860s, discovered the basic rules of inheritance. He found that traits are passed on in separate units that we now call genes. Each organism has two copies of each gene, one from each parent. Different versions of a gene are called alleles. An allele that shows its effect even when only one copy is present is dominant; an allele that shows only when two copies are present is recessive.

The combination of alleles an organism carries is its genotype, and the trait that can be seen is its phenotype. An organism with two identical alleles is homozygous, and one with two different alleles is heterozygous. Mendel's law of segregation says that the two alleles separate when gametes form, so each gamete carries only one. His law of independent assortment says that alleles of different genes are passed on independently of each other, as long as the genes are on different chromosomes.

A Punnett square is a simple grid used to predict the results of a cross. When two heterozygous pea plants with purple flowers are crossed, and purple is dominant over white, the offspring appear in a ratio of about three purple to one white. The genotypes appear in a ratio of one homozygous dominant to two heterozygous to one homozygous recessive. A test cross, in which an organism showing the dominant trait is crossed with a homozygous recessive one, reveals whether it is homozygous or heterozygous.

Not all traits follow Mendel's simple pattern. In incomplete dominance, the heterozygote shows a blend, as when red and white snapdragons give pink offspring. In codominance, both alleles show fully, as in the AB blood group in humans. Many traits, such as height and skin colour, are controlled by several genes and also affected by the environment. Some genes are carried on the X chromosome, so recessive conditions such as red-green colour blindness are much more common in males, who have only one X chromosome.

DNA is a double helix made of two strands. Each strand is a chain of nucleotides, and each nucleotide contains a sugar, a phosphate group and one of four bases: adenine, thymine, guanine or cytosine. The bases pair in a fixed way across the two strands, adenine with thymine and guanine with cytosine. Because of this pairing, each strand can act as a template to rebuild the other, which is how DNA is copied before a cell divides. The structure was described by James Watson and Francis Crick in 1953, using X-ray images made by Rosalind Franklin.

A gene is a stretch of DNA that carries the instructions for making a protein. In transcription, which happens in the nucleus, the gene is copied into a messenger RNA molecule. In translation, which happens at the ribosomes, the messenger RNA is read three bases at a time. Each group of three bases, called a codon, stands for one amino acid, and transfer RNA molecules bring the matching amino acids. A change in the DNA sequence is called a mutation. Some mutations have no effect, some are harmful, and a few are helpful.

Week 8: Evolution

Evolution is the change in the inherited traits of a population over many generations. Charles Darwin and Alfred Russel Wallace proposed natural selection as its main cause. Darwin gathered much of his evidence during a five-year voyage on HMS Beagle, including his famous observations of finches and tortoises on the Galapagos Islands.

Natural selection rests on a few observations. Individuals in a population vary, and much of this variation is inherited. More offspring are born than can survive, so there is a struggle for food, space and mates. Individuals with traits that suit their environment are more likely to survive and reproduce, and so they pass those traits on. Over time, helpful traits become more common in the population. This process is often summed up as survival of the fittest, where fitness means success at reproducing, not strength.

The evidence for evolution comes from many fields. Fossils show how living things have changed over millions of years, and some, such as early whales with legs, show forms in between groups. Homologous structures, such as the arm of a human, the wing of a bat and the flipper of a whale, have the same bones arranged in the same way, which points to a common ancestor. Comparing DNA shows that closely related species share more of their sequence. Evolution can also be seen happening today, for example when bacteria become resistant to antibiotics.

A species is usually defined as a group of organisms that can breed with each other and produce fertile offspring. New species form when populations become separated and stop sharing genes. If a mountain range or a stretch of sea divides a population, each part may change in a different way until the two can no longer breed together. This is called speciation. Over very long periods, speciation has produced the great variety of life we see today.

Key words to learn for the exam: metabolism, hypothesis, control group, hydrogen bond, enzyme, active site, denatured, prokaryotic, eukaryotic, fluid mosaic, osmosis, active transport, interphase, chromatid, cytokinesis, checkpoint, meiosis, chlorophyll, Calvin cycle, limiting factor, glycolysis, Krebs cycle, fermentation, allele, genotype, phenotype, codominance, transcription, codon, natural selection, homologous structure, speciation.
```

Create `supabase/functions/_fixtures/notes-photosynthesis.md`:

~~~~markdown
# Photosynthesis (Biology 101, week 5)

## The overall reaction

Plants, algae and some bacteria use light energy to turn carbon dioxide and water into glucose and oxygen. The overall equation is 6 CO2 + 6 H2O + light energy -> C6H12O6 + 6 O2. Photosynthesis takes place in the chloroplasts, mostly in the leaf cells.

## Two stages

- The **light-dependent reactions** happen in the thylakoid membranes. Chlorophyll absorbs light, water is split, oxygen is released, and the energy is stored in ATP and NADPH.
- The **Calvin cycle** happens in the stroma. It uses ATP and NADPH to fix carbon dioxide into sugar. The enzyme that fixes carbon dioxide is called RuBisCO.

## Limiting factors

The rate of photosynthesis is limited by light intensity, carbon dioxide concentration and temperature. Whichever factor is in shortest supply sets the rate.
~~~~

Check the chunk counts:

```bash
node --experimental-strip-types --no-warnings --input-type=module -e "import { toChunks, countWords } from './supabase/functions/_shared/chunking.ts'; import { readFileSync } from 'node:fs'; for (const f of ['typed-notes.txt', 'notes-photosynthesis.md']) console.log(f, toChunks(readFileSync('supabase/functions/_fixtures/' + f, 'utf8')).map(countWords));"
```

Expected:

```
typed-notes.txt [
  379, 372, 331, 413,
  369, 351, 321, 350,
  328, 127
]
notes-photosynthesis.md [ 140 ]
```

(If an editor changed the files' spacing, the numbers can move by a few words; the .txt must still give 10 chunks and the .md 1.)

- [ ] **Step 4: Write the hand test script**

Create `supabase/functions/_fixtures/try-extract.sh`:

```bash
#!/usr/bin/env bash
# Hand test for extract-text against the live project.
#
#   bash supabase/functions/_fixtures/try-extract.sh <file> <content-type> [note-id]
#
# Needs these in the environment (never commit them):
#   CRAMRADE_EMAIL, CRAMRADE_PASSWORD   a test account that signs in with a password
#   SUPABASE_PUBLISHABLE_KEY            the sb_publishable_... key (apps/app/.env)
#   SKIP_CALL=1 (optional)              stop after the upload, for testing calls by hand
#
# Steps: sign in, create a note (unless a note id is given), upload the file
# to uploads/<user>/<note>/<name>, call extract-text, then list what is left
# in the upload folder (should be []) and show the note row.
set -euo pipefail

SB="https://ialkxvoytoqfuxxnzlaa.supabase.co"
FILE="$1"
TYPE="$2"
NOTE_ID="${3:-}"
NAME="$(basename "$FILE")"
: "${CRAMRADE_EMAIL:?set CRAMRADE_EMAIL}" "${CRAMRADE_PASSWORD:?set CRAMRADE_PASSWORD}" "${SUPABASE_PUBLISHABLE_KEY:?set SUPABASE_PUBLISHABLE_KEY}"
KEY="$SUPABASE_PUBLISHABLE_KEY"

field() { node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));const v=$1;if(v===undefined){console.error(JSON.stringify(d));process.exit(1)}console.log(v)"; }

SESSION="$(curl -s "$SB/auth/v1/token?grant_type=password" -H "apikey: $KEY" -H "Content-Type: application/json" \
  -d "{\"email\":\"$CRAMRADE_EMAIL\",\"password\":\"$CRAMRADE_PASSWORD\"}")"
TOKEN="$(echo "$SESSION" | field 'd.access_token')"
USER_ID="$(echo "$SESSION" | field 'd.user.id')"

if [ -z "$NOTE_ID" ]; then
  NOTE_ID="$(curl -s "$SB/rest/v1/notes" -H "apikey: $KEY" -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" -H "Prefer: return=representation" \
    -d "{\"title\":\"Hand test: $NAME\",\"source\":\"file\",\"original_filename\":\"$NAME\"}" | field 'd[0].id')"
fi
echo "user $USER_ID  note $NOTE_ID"

echo "--- upload"
curl -s -X POST "$SB/storage/v1/object/uploads/$USER_ID/$NOTE_ID/$NAME" -H "apikey: $KEY" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: $TYPE" --data-binary "@$FILE"
echo

if [ "${SKIP_CALL:-}" = "1" ]; then
  echo "SKIP_CALL=1: file uploaded, extract-text not called"
  exit 0
fi

echo "--- extract-text"
curl -s -X POST "$SB/functions/v1/extract-text" -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d "{\"noteId\":\"$NOTE_ID\"}"
echo

echo "--- left in the upload folder (expect [])"
curl -s -X POST "$SB/storage/v1/object/list/uploads" -H "apikey: $KEY" -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d "{\"prefix\":\"$USER_ID/$NOTE_ID\"}"
echo

echo "--- note row"
curl -s "$SB/rest/v1/notes?id=eq.$NOTE_ID&select=status,failure_reason" -H "apikey: $KEY" -H "Authorization: Bearer $TOKEN"
echo
```

Run: `bash -n supabase/functions/_fixtures/try-extract.sh`
Expected: no output (syntax is fine).

- [ ] **Step 5: Make the three binary fixtures**

Follow "Making the PDF and Word files" in `_fixtures/README.md`. If Deno is installed, run the two extra lines from Task 7 Step 8 and check both print `"ok":true` with the Biology 101 notes text; then add a line for `notes-scanned.pdf` and check it prints `"ok":true` with a text of only whitespace or nothing (the handler turns that into "no readable text"). If it prints any words, the PDF still has a text layer: make it again from a screenshot.

If Dev A cannot make them now, commit without them and say so in the pull request; Task 10 needs them.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/README.md supabase/functions/_fixtures
git commit -m "Functions README, sample notes and a hand test script for extract-text

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Docs: Gemini, the extractor moves to Dev A, new and changed tasks

**Files:**
- Modify: `split_work.md`, `CLAUDE.md`, `project-initialize.md`

Each step shows the exact old text and the new text. Match the old text exactly (use the editor's find).

- [ ] **Step 1: split_work.md, the design files line**

Old:

```markdown
The full design is in `docs/superpowers/specs/2026-10-03-cramrade-design.md`. That file is not in the repo yet; Dev A has it.
```

New:

```markdown
The full design is in `docs/superpowers/specs/2026-10-03-cramrade-design.md`. That file is not in the repo yet; Dev A has it. The server side (A4a to A8) is designed in `docs/superpowers/specs/2026-10-10-server-side-design.md`.
```

- [ ] **Step 2: split_work.md, the diagram**

Old:

```
  Web app (browser)  ----+
                         +----  Supabase server  ----  Claude AI
  Phone app          ----+      (account, notes,       (reads the syllabus,
  (alarms, camera)              questions, plan,        writes questions)
                                live quiz)
```

New:

```
  Web app (browser)  ----+
                         +----  Supabase server  ----  Gemini AI
  Phone app          ----+      (account, notes,       (reads the syllabus,
  (alarms, camera)              questions, plan,        writes questions)
                                live quiz)
```

- [ ] **Step 3: split_work.md, T2**

Old:

```markdown
- Status: Supabase project `cramrade` created (region US East, Ohio), Expo and Claude accounts exist, GitHub is linked to Expo and Supabase. Open point on 2026-10-05: the Supabase organization is on the free plan, which pauses the project after 7 idle days. Upgrade or move it.
- Type: Setup, no code
- Where it runs: Outside the repo, on each service's website
- Tools: Supabase dashboard, Expo account, Claude Console (for the API key), `.env` files
- What it means: Supabase project (the paid one), Expo (also used for hosting the web app), and a Claude API key. Google Play and Apple accounts wait until phase 2.
```

New:

```markdown
- Status: Supabase project `cramrade` created (region US East, Ohio), Expo and Claude accounts exist, GitHub is linked to Expo and Supabase. Open point on 2026-10-05: the Supabase organization is on the free plan, which pauses the project after 7 idle days. Upgrade or move it. Update 2026-10-10: the AI provider is now Gemini; Dev A holds the Gemini API key.
- Type: Setup, no code
- Where it runs: Outside the repo, on each service's website
- Tools: Supabase dashboard, Expo account, Google AI Studio (for the Gemini API key), `.env` files
- What it means: Supabase project (the paid one), Expo (also used for hosting the web app), and a Gemini API key. Google Play and Apple accounts wait until phase 2.
```

- [ ] **Step 4: split_work.md, new task A4a before A4, and A4's tools and needs**

Old:

```markdown
**A4. Syllabus reader (server part)**
- Type: Server function (an API)
- Where it runs: Server
- Tools: Supabase Edge Function, Claude API
- What it means: Server code that takes the text of an uploaded syllabus and asks the AI for the exam and quiz dates and the topics for each. It returns a list of proposals. It saves nothing by itself. If it finds no dates, it says so and never guesses. Dev B builds the screen that shows the list (B5).
- Done when: A real syllabus returns the right dates and topics, and a file with no dates returns a clear "no dates found" answer.
- Needs first: B4 (it reuses how text is pulled out of an uploaded file)
```

New:

```markdown
**A4a. Text extractor**
- Type: Server function (an API) plus database changes
- Where it runs: Server
- Tools: Supabase Edge Function, Supabase Storage (temporary), `unpdf` (PDF), `mammoth` (Word), Supabase database
- What it means: The server half of file upload, moved here from B4 because it is server code and A4 and A6 need it. The app puts the file in a private storage folder and calls `extract-text`. The server pulls the text out of PDF, Word (.docx), .txt and .md files, cuts it into numbered chunks, saves them, deletes the file, and starts the question maker. A scanned PDF with no text, or a file type it cannot read, makes the note "failed" with a one-line reason the screen can show. The file is deleted either way. This task also adds the database changes the rest of the server work needs (new fields on notes, topics, sessions and quizzes, study settings, busy days, the uploads folder) and the shared server code (Gemini calls, sign-in checks, chunking, quote check).
- Done when: A typed PDF, a Word file and a text file uploaded by a test account become ready notes with readable chunks, a scanned PDF becomes a failed note with the reason "no readable text, this looks like a scanned image", the uploads folder is empty afterwards every time, and Dev B has said yes to the data shape changes.
- Needs first: T1, A2

**A4. Syllabus reader (server part)**
- Type: Server function (an API)
- Where it runs: Server
- Tools: Supabase Edge Function, Gemini API
- What it means: Server code that takes the text of an uploaded syllabus and asks the AI for the exam and quiz dates and the topics for each. It returns a list of proposals. It saves nothing by itself. If it finds no dates, it says so and never guesses. Dev B builds the screen that shows the list (B5).
- Done when: A real syllabus returns the right dates and topics, and a file with no dates returns a clear "no dates found" answer.
- Needs first: A4a (it reads the text the extractor saved)
```

- [ ] **Step 5: split_work.md, A5**

Old:

```markdown
**A5. Schedule engine**
- Type: Code function (pure logic) with automatic tests
- Where it runs: Shared code, run by the server
- Tools: TypeScript, Vitest (test runner), Supabase database to save the plan
- What it means: Plain code (no AI) that takes exam dates and topics and returns a list of dated study sessions. Sessions get closer together as the exam gets near. Each session has 5 to 7 questions. The plan is saved on the server so web and phone show the same one.
- Done when: Given "exam in 14 days", it returns a plan ending on exam day. Tests cover: exam tomorrow, exam in 3 months, two exams in the same week, exam already past.
- Needs first: T1 (the agreed data shapes)
```

New:

```markdown
**A5. Schedule engine**
- Type: Code function (pure logic) with automatic tests, plus the server function that runs it
- Where it runs: Shared code, run by the server (`build-schedule`)
- Tools: TypeScript, Vitest (test runner), Supabase Edge Function, Supabase database to save the plan, Gemini API (topic difficulty only)
- What it means: Plain code (no AI) that turns exams, the questions made from the student's notes, the student's answers so far, and their settings into a list of dated study sessions. It is "answer driven": each piece of the notes keeps coming back until the student has answered it correctly in three separate sessions, and a wrong answer brings it back in the next session. Sessions are sparse while the exam is far away and daily in the last week. Each session has 5 to 7 questions from 2 or 3 topics of one exam. The day before each exam is a final pass over every topic; exam day itself is empty. Missed sessions are not piled up: the plan is simply rebuilt from today. The inputs are: today's date, every upcoming exam with its topics and questions, the answer history, the pace (light, normal or heavy: at most 1, 2 or 3 sessions a day), weekdays off and busy days, and the sessions already done or skipped. Before any answers exist, the AI's difficulty rating for each topic (1 to 5) decides what comes first; after that only the answers count. The plan is saved on the server so web and phone show the same one.
- Done when: Given "exam in 14 days", it returns a plan that ends with a final pass the day before the exam and nothing on exam day. Tests cover: exam tomorrow, exam in 14 days, exam in 3 months, exam already past, two exams in the same week, a busy week, a skipped session, a piece answered right three times leaving the plan, a wrong answer coming back next session, and the same input always giving the same plan.
- Needs first: T1 (the agreed data shapes), A4a (the database changes: study settings, busy days, topic difficulty)
```

- [ ] **Step 6: split_work.md, A6**

Old:

```markdown
- Tools: Supabase Edge Function, Claude API, Supabase database
- What it means: Server code that sends note text to Claude and gets back questions. Every question must point to the exact piece of note it came from. Code then checks that piece really exists.
- Done when: 10 pages of notes produce at least 20 questions, each with a working link to its source text. Questions without a real source are thrown away.
- Needs first: B4 (real notes to read)
```

New:

```markdown
- Tools: Supabase Edge Function, Gemini API, Supabase database
- What it means: Server code that sends note text to Gemini and gets back questions. It starts by itself as soon as a note's text is ready; there is no button. Every question must point to the exact piece of note it came from. Code then checks that piece really exists.
- Done when: 10 pages of notes produce at least 20 questions, each with a working link to its source text. Questions without a real source are thrown away.
- Needs first: A4a (real notes to read)
```

- [ ] **Step 7: split_work.md, A8**

Old:

```markdown
- What it means: The live game: create a room, hand out a join link, send each question to everyone at the same time, run the timer, count the score. Questions go out through Supabase's live messaging. The server writes down when each question started and scores every answer against that time, so nobody can cheat.
- Done when: 5 browsers join one room, play 5 questions, and all show the same final scores.
- Needs first: A6
```

New:

```markdown
- What it means: The live game: create a room, hand out a join link, send each question to everyone at the same time, run the timer, count the score. Questions go out through Supabase's live messaging. The server writes down when each question started and scores every answer against that time, so nobody can cheat. The game runs by itself: each question gets the same answering time, then the right answer and scores show for a few seconds, then the next question comes, with nobody pressing "next". Any player's screen may ask the server to move on once the time is up, and the server moves exactly once. A right answer scores 1000 points if instant, down to 500 at the last moment, measured by the server's clock; a wrong answer scores 0. A solo mode uses the same room with one player and starts at once.
- Done when: 5 browsers join one room, play 5 questions, and all show the same final scores. A solo quiz can be played from start to finish.
- Needs first: A4a, A6
```

- [ ] **Step 8: split_work.md, A12**

Old:

```markdown
- Tools: Supabase Edge Function, Claude API, Expo
- What it means: A 5 to 10 minute explanation of one topic where every sentence links to the note it came from.
```

New:

```markdown
- Tools: Supabase Edge Function, Gemini API, Expo
- What it means: A 5 to 10 minute explanation of one topic where every sentence links to the note it came from.
```

- [ ] **Step 9: split_work.md, B4 shrinks**

Old:

```markdown
**B4. File upload**
- Type: Part of a page (upload button) plus a server function
- Where it runs: Web app and phone app, with the text work on the server
- Tools: Expo document picker, Supabase Edge Function, Supabase database
- What it means: A button to pick Word, PDF, text or Markdown files from the computer. The server pulls the text out and throws the file itself away.
- Done when: Uploading a PDF and a Word file results in readable text saved as Notes.
- Needs first: B2
```

New:

```markdown
**B4. File upload**
- Type: Part of a page (upload button)
- Where it runs: Web app and phone app
- Tools: Expo document picker, Supabase Storage, Supabase database
- What it means: A button to pick Word (.docx), PDF, text or Markdown files from the computer. The app creates the note, uploads the file to the private `uploads` folder at `<user id>/<note id>/<file name>` with a content type picked from the file's extension, and calls the server function `extract-text` (A4a), which pulls the text out and deletes the file. The screen shows "processing", then "ready", or the failure reason with a way to try another file. The same button uploads a syllabus (the note is marked as a syllabus) and can link notes to an exam.
- Done when: Uploading a PDF and a Word file results in readable text saved as Notes, and a scanned PDF shows its failure reason.
- Needs first: B2, A4a (use a fake answer until it is ready)
```

- [ ] **Step 10: split_work.md, B8**

Old:

```markdown
- What it means: The host screen (question, timer, scoreboard) for a computer. The play screen where a classmate opens the link, picks a nickname and answers. Guests need no account and no install.
- Done when: A person with only a browser joins and finishes a quiz. A player who drops out can rejoin and keep their score.
```

New:

```markdown
- What it means: The host screen (question, timer, scoreboard) for a computer. The play screen where a classmate opens the link, picks a nickname and answers. Guests need no account and no install. The quiz moves by itself: the screens show the question and a countdown, then the right answer and scores for a few seconds, then the next question, all timed from the server's clock. Nobody presses "next". A "play alone" button starts a solo quiz at once with the same screens.
- Done when: A person with only a browser joins and finishes a quiz. A player who drops out can rejoin and keep their score. A solo quiz starts with one button and plays to the end.
```

- [ ] **Step 11: split_work.md, B9**

Old:

```markdown
- Tools: Phone camera, the phone's built-in text reader (Google ML Kit, Apple Vision), Claude API (vision)
- What it means: Take 20 photos of real student notes (handwritten and printed, in the languages your users write in). Try the phone's built-in text reader and Claude's vision on each. This decides how the camera feature is built and what each page costs.
```

New:

```markdown
- Tools: Phone camera, the phone's built-in text reader (Google ML Kit, Apple Vision), Gemini API (vision)
- What it means: Take 20 photos of real student notes (handwritten and printed, in the languages your users write in). Try the phone's built-in text reader and Gemini's vision on each. This decides how the camera feature is built and what each page costs.
```

- [ ] **Step 12: split_work.md, new tasks B13 and B14 after B8**

Insert after the B8 block (after its `- Needs first: A8` line) and before `**B9. Handwriting trial**`:

```markdown
**B13. Study settings screen**
- Type: App screen (a small page)
- Where it runs: Web app and phone app
- Tools: Expo, Supabase database
- What it means: A short settings page for the study plan: pace (light, normal or heavy), weekdays off, the usual time for a session, and the time zone. A "busy in the next few days?" prompt lets the student mark dates they cannot study, saved as busy days. After any change the app asks the server to rebuild the plan (`build-schedule`).
- Done when: Changing the pace or marking a busy day is saved, is still there after a reload, and the schedule screen shows no sessions on the busy days once the plan is rebuilt.
- Needs first: A4a (the settings tables), A5 (use the default settings until it is ready)

**B14. Calendar button**
- Type: Part of a page (a button and a short instructions panel)
- Where it runs: Web app and phone app
- Tools: Expo, Supabase database
- What it means: A button that creates the student's calendar link if there is none yet and shows it, with steps for Google Calendar ("From URL") and Apple Calendar ("New Calendar Subscription"). A second button makes a new link and stops the old one working.
- Done when: The link can be copied, and adding it to Google Calendar shows the student's sessions and exam dates.
- Needs first: A7
```

- [ ] **Step 13: split_work.md, where the two lists meet**

Old:

```markdown
- **B4 and A6:** Dev A's question maker reads the notes Dev B's upload saved.
```

New:

```markdown
- **B4 and A4a:** Dev B's upload button sends the file to Dev A's text extractor.
- **A4a and A6:** Dev A's question maker starts by itself when the extractor has saved a note's text.
- **A5 and B13:** Dev A's schedule engine uses the pace, days off and busy days Dev B's settings screen saves.
- **A7 and B14:** Dev B's calendar button shows the link to Dev A's calendar feed.
```

- [ ] **Step 14: split_work.md, Part 2**

Old:

```markdown
- **AI (Claude):** reads the syllabus, writes questions, and later lessons. It never decides the schedule and never adds to the notes.
```

New:

```markdown
- **AI (Gemini):** reads the syllabus, writes questions, and later lessons. It gives each topic a first difficulty guess, but never decides the schedule and never adds to the notes.
```

Old:

```markdown
- The server asks Claude to write questions from those chunks. Each question carries the number of the chunk it came from.
```

New:

```markdown
- The server asks Gemini to write questions from those chunks. Each question carries the number of the chunk it came from.
```

Old:

```markdown
- Note text does leave the device (to our server and to Claude). The app must tell the student this plainly.
```

New:

```markdown
- Note text does leave the device (to our server and to Gemini). The app must tell the student this plainly.
```

- [ ] **Step 15: split_work.md, Part 3**

Old:

```markdown
**Supabase Storage**
- What it is for: Holds a handwritten photo for a few seconds while the AI reads it, then it is deleted.
- Cost: Included

**Claude API**
- What it is for: Reads the syllabus, writes the questions and lessons, and reads handwriting if the trial says the phone cannot.
- Cost: Pay per use. Cost per student not yet measured.
```

New:

```markdown
**Supabase Storage**
- What it is for: Holds an uploaded file or a handwritten photo for a few seconds while the text is pulled out, then it is deleted.
- Cost: Included

**Gemini API (Google)**
- What it is for: Reads the syllabus, writes the questions and lessons, gives each topic a first difficulty guess, and reads handwriting if the trial says the phone cannot.
- Cost: Pay per use. Cost per student not yet measured.
```

- [ ] **Step 16: Check no Claude API mention is left in split_work.md**

Run: `grep -n -i "claude api\|claude ai\|claude's vision\|claude console\|asks claude\|to claude\|(claude)" split_work.md`
Expected: no output. ("Claude Code", "Claude Max", "Claude Pro" and "Claude accounts" in the T2 status are about the developers' tools and stay.)

- [ ] **Step 17: CLAUDE.md**

Old:

```markdown
npm test                    # vitest for packages/shared
```

New:

```markdown
npm test                    # vitest for packages/shared and supabase/functions/_shared
```

(If the engine branch already reworded this line, keep its wording as long as it says the run covers `supabase/functions/_shared`.)

Old:

```markdown
npx supabase functions new <name>   # new Edge Function
```

New:

```markdown
# new Edge Function: make supabase/functions/<name>/index.ts by hand and add a
# [functions.<name>] block (verify_jwt = true) to supabase/config.toml.
# Not `supabase functions new`: it writes verify_jwt = false into config.toml.
```

Insert this new bullet in "Things that are easy to get wrong", directly above the bullet that starts with "- `apps/app/AGENTS.md` holds Expo's own rules" (leave that bullet unchanged):

```markdown
- Server code that needs Deno or an `npm:` package cannot be unit tested; it is tested by hand against the live project after merge (`supabase/functions/README.md`). Do not install Deno for it. If Deno is already installed, `DENO_DIR=.local-deps/deno deno check <file>` type-checks a function with its cache kept on D:.
```

Old:

```markdown
- **Supabase is the only backend**: Postgres database, Auth, Realtime (live quiz), Edge Functions (all server code), Storage (temporary photos only). Do not add Neon or a second backend.
- **Claude API** reads syllabuses, writes questions and lessons, and reads handwriting. It is called only from Edge Functions, never from the app.
```

New:

```markdown
- **Supabase is the only backend**: Postgres database, Auth, Realtime (live quiz), Edge Functions (all server code), Storage (temporary uploads and photos only). Do not add Neon or a second backend.
- **Gemini API** reads syllabuses, writes questions and lessons, rates topic difficulty, and reads handwriting. It is called only from Edge Functions, never from the app, through `askGemini` in `supabase/functions/_shared/ai.ts`. Prompts are Markdown files in `supabase/functions/_shared/prompts/`. The model name is the secret `GEMINI_MODEL`.
```

Old:

```markdown
- `supabase/`: migrations (tables and Row Level Security) and Edge Functions.
```

New:

```markdown
- `supabase/`: migrations (tables and Row Level Security) and Edge Functions. Pure server code in `supabase/functions/_shared` uses no Deno-only API and no `npm:` import, so vitest tests it; anything needing a Deno or npm library sits in one adapter file next to the function that uses it.
```

Old:

```markdown
How data moves: exam dates come in by hand or from a syllabus. Notes come in as files or photos and are turned into text. Text is cut into numbered chunks. An Edge Function asks Claude for questions, each tied to a chunk.
```

New:

```markdown
How data moves: exam dates come in by hand or from a syllabus. Notes come in as files or photos and are turned into text (files by the `extract-text` function). Text is cut into numbered chunks. An Edge Function asks Gemini for questions, each tied to a chunk.
```

Old:

```markdown
- **The schedule is plain code, never AI.** The schedule engine is a deterministic function with unit tests. The AI only writes content.
```

New:

```markdown
- **The schedule is plain code, never AI.** The schedule engine is a deterministic function with unit tests. The AI only writes content, and rates topic difficulty as a starting guess that the student's answers replace.
```

Old:

```markdown
- **Dev A (repo owner)** builds everything behind the screen: repo setup, database, hosting and deployment, schedule engine, syllabus reader, question maker, calendar feed, quiz server, phone builds, alarms. Owns `packages/shared`, `supabase/`, and deployment settings.
- **Dev B** builds everything the student sees and taps: sign-in, exam screen, file upload, syllabus confirm screen, schedule screen, study screen, quiz host and play screens, camera. Owns `apps/app`, except `src/features/reminders` (Dev A's alarm code).
```

New:

```markdown
- **Dev A (repo owner)** builds everything behind the screen: repo setup, database, hosting and deployment, text extractor, schedule engine, syllabus reader, question maker, calendar feed, quiz server, phone builds, alarms. Owns `packages/shared`, `supabase/`, and deployment settings.
- **Dev B** builds everything the student sees and taps: sign-in, exam screen, file upload button, syllabus confirm screen, schedule screen, study settings screen, study screen, quiz host and play screens, calendar button, camera. Owns `apps/app`, except `src/features/reminders` (Dev A's alarm code).
```

- [ ] **Step 18: project-initialize.md**

Old:

````markdown
**Store a secret for server functions** (for example the Claude API key):

```sh
npx supabase secrets set ANTHROPIC_API_KEY=your-key-here
```
````

New:

````markdown
**Store a secret for server functions** (the Gemini API key and model name; the list is in `supabase/functions/.env.example`):

```sh
npx supabase secrets set GEMINI_API_KEY=your-key-here
npx supabase secrets set GEMINI_MODEL=gemini-2.5-flash
```

**Test a server function by hand** after it is live: see `supabase/functions/README.md`.
````

Old:

```markdown
- `supabase functions new` and `supabase secrets set` have not been run on this project yet.
```

New:

```markdown
- `supabase secrets set` was first used in task A4a. The first function (`extract-text`) goes live with that task's merge. Function folders are made by hand, not with `supabase functions new` (see "New server function" above).
```

Old:

````markdown
**New server function:**

```sh
npx supabase functions new make-questions
```

It goes online when the pull request is merged.
````

New:

````markdown
**New server function:** make the folder and its `index.ts` by hand, then add a block for it at the end of `supabase/config.toml`:

```toml
[functions.make-questions]
enabled = true
verify_jwt = true
```

Do not use `npx supabase functions new`: it adds its own block with `verify_jwt = false`. A function that reads an AI prompt also needs `static_files = ["./functions/_shared/prompts/<name>.md"]` in its block. It goes online when the pull request is merged.
````

Old:

```markdown
- Supabase server functions run on Deno, a different runtime from the app. Importing `packages/shared` into a server function has not been tested. If it is awkward, the schedule code moves to `supabase/functions/_shared/`.
```

New:

```markdown
- Supabase server functions run on Deno, a different runtime from the app. Importing `packages/shared` into a server function has not been tested. If it is awkward, the schedule code moves to `supabase/functions/_shared/`. Server code that does not need Deno lives in `supabase/functions/_shared/` and is tested by `npm test` with the rest.
```

Old:

```
│  └─ functions/              one folder per server function
│     ├─ read-syllabus/  extract-text/  make-questions/
│     ├─ score-answer/  calendar-feed/
│     └─ _shared/             code several functions use
```

New:

```
│  └─ functions/              one folder per server function
│     ├─ extract-text/  read-syllabus/  make-questions/
│     ├─ build-schedule/  calendar-feed/
│     ├─ quiz-create/  quiz-start/  quiz-answer/  quiz-advance/
│     ├─ _shared/             code several functions use (prompts/ inside)
│     └─ _fixtures/           sample files for testing by hand
```

- [ ] **Step 19: Commit**

```bash
git add split_work.md CLAUDE.md project-initialize.md
git commit -m "Docs: Gemini replaces Claude API, A4a text extractor, A5/A6/A8/B4/B8 updated, B13 and B14 added

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: Verify, open the pull request, then the live hand test after merge

**Files:**
- No new files. Optionally `docs/superpowers/plans/2026-10-10-a4a-server-foundation.md` and `docs/superpowers/specs/2026-10-10-server-side-design.md` if they are not on `main` yet.

- [ ] **Step 1: Full check**

```bash
npm run typecheck && npm test
```

Expected: both exit 0. `npm test` lists the 6 test files in `supabase/functions/_shared` (46 tests) plus the engine's tests in `packages/shared`. If Deno is already installed, also run `DENO_DIR=.local-deps/deno deno check supabase/functions/extract-text/index.ts` and expect no error.

This is the plan's `npm run typecheck && npm test` gate. The "Done when" check for A4a in `split_work.md` (typed PDF, Word and text files become ready notes, a scanned PDF fails with its reason, the upload folder is empty every time, Dev B said yes to the types) can only pass after merge: Steps 5 and 6.

- [ ] **Step 2: Check no secret is in the diff**

```bash
git diff main --stat
git diff main | grep -n -i -E "sb_secret_|service_role\"|eyJhbGci|AIza[0-9A-Za-z_-]{20,}" || echo "no secrets"
```

Expected: `no secrets`. If anything matches, stop and remove it before pushing.

- [ ] **Step 2b: Rehearse the migration on the live database, keeping nothing (spec section 13)**

This runs the real SQL against the real tables inside a transaction that is thrown away, so mistakes show up before merge. Dev A does it in the Supabase dashboard's SQL editor (it runs as the database owner, like the GitHub integration).

1. Open a new query. The first line is exactly `begin;`.
2. Paste the whole migration file below it.
3. The last line is exactly `rollback;`.
4. Run the whole query (not a selection). If the editor warns about destructive statements, check that the first line is `begin;` and the last is `rollback;`, then confirm.

Expected: it finishes with no error. If any statement fails, Postgres aborts the transaction and keeps nothing; fix the SQL, then rehearse again.

Then check nothing was kept:

```sql
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'notes' and column_name = 'exam_id') as exam_id_columns,
  (select count(*) from storage.buckets where id = 'uploads') as uploads_buckets,
  (select count(*) from information_schema.tables
    where table_schema = 'public' and table_name in ('study_settings', 'busy_days')) as new_tables;
-- expect: 0 | 0 | 0
```

If any count is not 0, the transaction was committed: stop and tell Dev A before doing anything else, because the live database now has the changes without the merge.

- [ ] **Step 3: Add the spec and this plan if main does not have them**

```bash
git ls-tree main --name-only docs/superpowers/specs/ docs/superpowers/plans/ 2>/dev/null
git add docs/superpowers/specs/2026-10-10-server-side-design.md docs/superpowers/plans/2026-10-10-a4a-server-foundation.md
git commit -m "Add the server-side spec and the A4a plan

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

Skip the commit if both files are already on `main`. Do not add `founder/` or other untracked folders.

- [ ] **Step 4: Push and open the pull request**

```bash
git push -u origin a4a-server-foundation
gh pr create --base main --head a4a-server-foundation --title "A4a: server foundation and text extractor" --body-file - <<'EOF'
## What this does

- One migration (`supabase/migrations/*_server_side.sql`): new fields on notes, topics, study sessions, quiz rooms and quiz answers; new tables `study_settings` and `busy_days` (own rows only); `current_quiz_question(room_id)` for players; quiz rooms and players on Realtime; the private `uploads` bucket with owner-only folders.
- The quote check now ignores differences in whitespace (spec section 3): the migration changes the `verify_question` and `reverify_chunk_questions` triggers to collapse spaces, tabs and line breaks on both sides, and `quoteAppears` does the same in code.
- Shared server code in `supabase/functions/_shared`: JSON answers and errors, caller checks, the service database client, `askGemini` (60 s timeout, one retry), chunking, the quote check.
- The `extract-text` function: PDF, Word (.docx), .txt and .md to chunks. The file is deleted every time. Not a syllabus: starts `make-questions` (arrives with A6; until then the log shows a 404 for it).
- Docs: Gemini replaces the Claude API everywhere; new task A4a; B4 is now only the button; A5, A6, A8, B8 updated; new B13 (study settings) and B14 (calendar button).

## Dev B: please say yes to these type changes (T1 rule)

- `Note.examId` (exam the notes are for, or null)
- `Note.isSyllabus` (true for a syllabus upload)
- `Note.failureReason` (one line to show when extraction failed)
- `Topic.difficulty` (1 to 5 or null, set by the server)
- `StudySession.isFinalPass`
- `QuizRoom.mode` (`QUIZ_MODES`: group, solo) and `QuizRoom.resultsSeconds`
- `QuizAnswer.points`
- New `StudySettings` and `BusyDay` in `types/settings.ts` (`pace` uses `Pace` from the schedule engine's `types/schedule.ts`)

For the upload button (B4): create the note with `source: 'file'`, upload to `uploads/<user id>/<note id>/<file name>` with an explicit content type from the extension (`application/pdf`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`, `text/plain`, `text/markdown`), then call `extract-text` with `{ noteId }`. The answer is `{ status: 'ready', chunks }` or `{ status: 'failed', chunks: 0, reason }`.

## Read carefully

Merging applies the migration to the live database at once. There is no Docker on Dev A's machine, so `supabase db diff` was not run; the migration file is the exact SQL. It parses with the Postgres parser (pglast) and was rehearsed on the live database inside `begin ... rollback` with no errors and nothing kept. The notes insert and update policies are recreated with one extra line: `exam_id` must be an exam the student can see. The two quote triggers are replaced (same behaviour plus whitespace collapsing).

## Tested

- `npm run typecheck` and `npm test` (46 new tests) pass.
- Not yet: the function against the live project. That runs right after merge (hand test in the plan, Task 10).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
```

Expected: prints the pull request URL. Wait for Dev B's review and yes on the types before merging.

- [ ] **Step 5: After merge, set the secrets and check the deploy**

```bash
npx supabase secrets set GEMINI_API_KEY=<the key> GEMINI_MODEL=gemini-2.5-flash
npx supabase migration list
```

Expected: the `server_side` migration shows in both the Local and Remote columns. In the dashboard: Edge Functions lists `extract-text` with "Verify JWT" on; Storage lists a private `uploads` bucket. If the function shows "Verify JWT" off, the integration ignored `config.toml`: switch it on in the dashboard and note it in `CLAUDE.md`.

Check the new database objects in the dashboard's SQL editor (read-only queries):

```sql
select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'notes' and column_name in ('exam_id', 'is_syllabus', 'failure_reason');
-- expect 3 rows

select tablename from pg_publication_tables where pubname = 'supabase_realtime';
-- expect quiz_rooms and quiz_players

select id, public, file_size_limit from storage.buckets where id = 'uploads';
-- expect: uploads | false | 20971520

select private.quote_in_chunk(E'the\nchromosomes  condense', 'In prophase the chromosomes condense.') as with_line_break,
       private.quote_in_chunk('The chromosomes', 'the chromosomes') as case_differs,
       private.quote_in_chunk('   ', 'abc') as blank;
-- expect: true | false | false (the same answers as quote-check.test.ts)
```

- [ ] **Step 6: Hand test extract-text on the live project**

In Git Bash from the top folder, with a test account that signs in with a password:

```bash
export CRAMRADE_EMAIL=... CRAMRADE_PASSWORD=... SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
F=supabase/functions/_fixtures
```

Run each line and compare the `--- extract-text` and `--- left in the upload folder` output:

1. `bash $F/try-extract.sh $F/typed-notes.txt text/plain`
   Expected: `{"status":"ready","chunks":10}`, then `[]`, then `[{"status":"ready","failure_reason":null}]`.
2. `bash $F/try-extract.sh $F/notes-photosynthesis.md text/markdown`
   Expected: `{"status":"ready","chunks":1}`, then `[]`.
3. `bash $F/try-extract.sh $F/typed-notes.docx application/vnd.openxmlformats-officedocument.wordprocessingml.document`
   Expected: `{"status":"ready","chunks":10}`, then `[]`.
4. `bash $F/try-extract.sh $F/typed-notes.pdf application/pdf`
   Expected: `{"status":"ready","chunks":N}` with N from 8 to 12 (where the PDF breaks paragraphs depends on the editor that made it), then `[]`.
5. `bash $F/try-extract.sh $F/notes-scanned.pdf application/pdf`
   Expected: `{"status":"failed","chunks":0,"reason":"no readable text, this looks like a scanned image"}`, then `[]`, then `[{"status":"failed","failure_reason":"no readable text, this looks like a scanned image"}]`.
6. Unsupported type: `mkdir -p .local-deps/tmp && cp $F/notes-photosynthesis.md .local-deps/tmp/notes.rtf && bash $F/try-extract.sh .local-deps/tmp/notes.rtf text/plain`
   Expected: `{"status":"failed","chunks":0,"reason":"file type not supported, use PDF, Word (.docx), .txt or .md"}`, then `[]`.
7. Retry in the same note: take the note id printed by run 5 and run `bash $F/try-extract.sh $F/typed-notes.txt text/plain <that note id>`.
   Expected: `{"status":"ready","chunks":10}`, then `[]`, then `[{"status":"ready","failure_reason":null}]`.
8. Calling again changes nothing: with the note id from run 1, call the function directly (the script would upload again):

   ```bash
   SB=https://ialkxvoytoqfuxxnzlaa.supabase.co
   TOKEN=$(curl -s "$SB/auth/v1/token?grant_type=password" -H "apikey: $SUPABASE_PUBLISHABLE_KEY" -H "Content-Type: application/json" -d "{\"email\":\"$CRAMRADE_EMAIL\",\"password\":\"$CRAMRADE_PASSWORD\"}" | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).access_token")
   curl -s -X POST "$SB/functions/v1/extract-text" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"noteId":"<note id from run 1>"}'
   ```

   Expected: `{"status":"ready","chunks":10}`.
9. Two calls at once: create a note and upload the .txt without calling the function, then fire two calls together with the new note id the script prints:

   ```bash
   SKIP_CALL=1 bash $F/try-extract.sh $F/typed-notes.txt text/plain
   for i in 1 2; do curl -s -X POST "$SB/functions/v1/extract-text" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"noteId":"<new note id>"}' & done; wait
   curl -s "$SB/rest/v1/chunks?note_id=eq.<new note id>&select=position" -H "apikey: $SUPABASE_PUBLISHABLE_KEY" -H "Authorization: Bearer $TOKEN"
   ```

   Expected: both answers `{"status":"ready","chunks":10}` (one may come from the "already there" path), and the chunk list has exactly the positions 0 to 9, each once.
10. Errors:
    - No token: `curl -s -o /dev/null -w "%{http_code}\n" -X POST "$SB/functions/v1/extract-text" -d '{}'` prints `401`.
    - Bad body: same call with `-H "Authorization: Bearer $TOKEN" -d '{"noteId":"abc"}'` answers 400 `{"error":{"code":"bad_input","message":"noteId must be an id."}}`.
    - Unknown note: `-d '{"noteId":"00000000-0000-4000-8000-000000000000"}'` answers 404 `{"error":{"code":"not_found","message":"That note could not be found."}}`.
    - Guest: get a guest token with `curl -s -X POST "$SB/auth/v1/signup" -H "apikey: $SUPABASE_PUBLISHABLE_KEY" -H "Content-Type: application/json" -d '{}'` (needs anonymous sign-in on in the dashboard; the token is `access_token` in the answer), call with run 1's note id: 403 `{"error":{"code":"guest_not_allowed","message":"Guests cannot do this. Create an account first."}}`.
    - Someone else's note: with a second test account's token and run 1's note id: 403 `{"error":{"code":"not_yours","message":"That note belongs to someone else."}}`.
11. Logs: dashboard, Edge Functions, `extract-text`, Logs. Expect "make-questions answered 404" lines for the non-syllabus notes until A6 is merged, and no other errors.

- [ ] **Step 7: Record the result**

Mark A4a DONE in `split_work.md` with a Status line (date, what passed, anything left), on a small follow-up branch and pull request, as for A2 and A3. Delete the hand-test notes from the test account in the app or the dashboard.

---

## Self-review notes

- Spec 2 file list for this branch: `http.ts`, `auth.ts`, `db.ts`, `ai.ts`, `chunking.ts`, `quote-check.ts` (Tasks 3 to 6), `extract-text` (Task 7), migration and config (Task 1). `scoring.ts`, `ics.ts`, `proposals.ts` and the prompt files belong to A8, A7, A4 and A6. Added beyond the spec list: `gemini.ts` (the testable half of `ai.ts`), `template.ts`, `extraction.ts` (testable rules of the extractor), `invoke.ts` (background calls).
- Spec 3: `askGemini(promptName, variables, jsonSchema)` signature kept, with an optional fourth `options` argument for temperature and timeout. Quote rule follows spec 3 ("whitespace collapsed") and the trigger is changed to match, as the A4/A6 plan expects.
- Cross-plan names checked against the A4/A6, A5/A7 and A8 plans on 2026-10-10: `db`, `requireUser`/`requireFullUser` returning `{ id, isAnonymous }`, `isServiceCall`, `HttpError(status, code, message)`, `json`, `handle`, `askGemini`, `AiError`, `quoteAppears`, `[functions.extract-text]` block in `config.toml`, `prompts/` folder.
- Spec 4: every numbered step is in `extract-text/index.ts`; idempotent on existing chunks; file deleted in `finally`.
- Spec 10: error shape and codes in `http.ts`; 60 s timeout and one retry in `gemini.ts`; secrets in `.env.example` and the README.
- Spec 11: every bullet is in the migration; types in Task 2.
- Spec 12: every bullet is in Task 9.
- Spec 13 "Functions", extract-text only: Task 10 Step 6. The syllabus fixtures belong to A4.
