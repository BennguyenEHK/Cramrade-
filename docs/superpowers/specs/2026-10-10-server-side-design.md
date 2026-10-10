# Cramrade server side: A4 to A8 plus the text extractor

Date: 2026-10-10. Status: approved in conversation by Dev A, waiting for Dev A's review of this file. Dev B must say yes to the data shape changes in section 11 before the migration merges.

This spec covers everything Dev A builds for the phase 1 web app behind the screen: the text extractor (server half of B4), the syllabus reader (A4), the schedule engine (A5), the question maker (A6), the calendar feed (A7) and the quiz server (A8). It builds on `docs/superpowers/specs/2026-10-03-cramrade-design.md`, `split_work.md` and the live database in `supabase/migrations/20261005120000_initial_schema.sql`.

## 1. Decisions made in this round

- **AI provider is Gemini, not Claude.** Dev A has a Gemini API key. All docs that say Claude API change to Gemini API. One module talks to Gemini; the model name is a server secret so it can change without code.
- **Prompts live in files.** Every prompt the AI sees is a plain text file under `supabase/functions/_shared/prompts/`, one per job, so Dev A can edit how questions are made without touching code.
- **The schedule stays plain code.** The AI gives numbers (topic difficulty), the student gives taps (busy days, pace), the app logs answers, and a deterministic engine turns all of it into sessions. The engine is "answer driven": each chunk comes back until it has been recalled correctly in three separate sessions. Research behind this is in section 6.
- **The text extractor moves to Dev A.** It is server code and A4 and A6 depend on it. Dev B keeps the upload button and the call.
- **Questions are made automatically** when a note's text is ready. No button.
- **The live quiz is fully automatic**: a competition, students against students. The server owns the clock. Any client may ask the server to advance once the time is up; the server advances exactly once.
- **Solo quiz exists**: same room, one player, starts at once, same timer and scoring.
- **Scoring is base points plus a speed bonus**, measured by the server from its own start time.
- **English** notes and syllabuses for version 1. Prompts and test files are English.
- **No vector database.** Nothing here searches by meaning. pgvector is available in Supabase if the cited lesson (A12) needs it later.

## 2. Pieces and where they live

```
supabase/
├─ config.toml                 verify_jwt per function, the uploads bucket
├─ migrations/
│  └─ <timestamp>_server_side.sql      section 11, made with `npx supabase migration new server_side`
└─ functions/
   ├─ _shared/
   │  ├─ ai.ts                 askGemini(promptFile, input, schema) -> typed JSON
   │  ├─ auth.ts               caller from the request, refuses guests where needed
   │  ├─ db.ts                 server database client (sees everything)
   │  ├─ chunking.ts           text -> numbered chunks (pure, tested with vitest)
   │  ├─ quote-check.ts        does the quote appear in the chunk (pure, tested)
   │  ├─ scoring.ts            quiz points from time taken (pure, tested)
   │  ├─ ics.ts                sessions and exams -> .ics text (pure, tested)
   │  ├─ proposals.ts          syllabus proposal validation (pure, tested)
   │  ├─ http.ts               json(), error(), cors
   │  └─ prompts/
   │     ├─ read-syllabus.md
   │     ├─ make-questions.md
   │     └─ rate-difficulty.md
   ├─ extract-text/index.ts
   ├─ read-syllabus/index.ts
   ├─ make-questions/index.ts
   ├─ build-schedule/index.ts
   ├─ calendar-feed/index.ts
   ├─ quiz-create/index.ts
   ├─ quiz-start/index.ts
   ├─ quiz-answer/index.ts
   └─ quiz-advance/index.ts

packages/shared/src/
├─ types/                      new: schedule.ts, settings.ts, plus small additions
└─ schedule/                   the engine: gap.ts, chunk-state.ts, pick.ts, place.ts, build.ts, *.test.ts
```

Rules for the function folders:

- `index.ts` files stay thin: read the request, check the caller, load rows, call pure code, write rows, answer.
- Function folders are created by hand (`mkdir` plus `index.ts`), not with `supabase functions new`, because the CLI appends its own `[functions.<name>]` block with `verify_jwt = false` to `config.toml`. Each branch writes its own block. Branches that merge in parallel will both append to the end of `config.toml`; resolve the conflict by keeping both blocks.
- Pure code in `_shared` uses no Deno-only API and no `npm:` import, so vitest at the repo root can test it. The root vitest config includes `supabase/functions/_shared/**/*.test.ts`.
- Anything that needs a Deno or npm library (PDF parsing, Word parsing) is wrapped in one adapter file next to the function that uses it.
- Every function answers within the free plan limits: 150 seconds wall clock, 2 seconds CPU, 256 MB. Anything bigger is split into batches and chained by a follow-up call.

## 3. Shared server pieces

**`ai.ts`.** One function: `askGemini<T>(promptName, variables, jsonSchema): Promise<T>`. It loads `prompts/<promptName>.md`, fills `{{variables}}`, calls the Gemini REST API (`generateContent`) with `responseMimeType: application/json` and the schema, parses the answer, and throws a typed `AiError` on failure or malformed JSON. Secrets: `GEMINI_API_KEY`, `GEMINI_MODEL` (default `gemini-2.5-flash`; change to a newer Flash model when available). No SDK, plain `fetch`, so there is nothing to install. Temperature low (0.2) for syllabus and difficulty, moderate (0.7) for questions.

Prompt files are plain Markdown with `{{placeholders}}`. They are shipped with the functions as static files (`static_files` in `config.toml` for each function that uses them). If static files turn out not to deploy through the GitHub integration, fallback: the same text in `prompts/*.ts` as exported strings, still one file per prompt.

**`auth.ts`.** `requireUser(req)` returns the caller's user id from the JWT, or 401. `requireFullUser(req)` also refuses anonymous (guest) users, for everything except quiz play. The functions use `verify_jwt = true` except `calendar-feed`.

**`db.ts`.** The service-role client. Because it bypasses Row Level Security, every function checks ownership or membership itself before reading or writing on behalf of the caller, using the same helper questions the policies use (owner id, group membership).

**`chunking.ts`.** `toChunks(text): string[]`. Splits on blank lines, merges paragraphs until a chunk is 300 to 500 words, splits a paragraph longer than 600 words at sentence ends, drops empty chunks, normalises whitespace. Deterministic.

**`quote-check.ts`.** `quoteAppears(quote, chunkText): boolean`. Same rule as the database trigger `private.verify_question`: whitespace collapsed, case kept. Used before insert to avoid inserting rows the trigger will fail, so the function can report counts.

## 4. Text extractor (`extract-text`)

Flow:

1. The app uploads the file to the private Storage bucket `uploads` at `<user_id>/<note_id>/<filename>` and creates a Note with `status = processing`, `source = file`, `original_filename`, and (new) `exam_id` and `is_syllabus`. Storage policies allow a user to write and read only their own folder.
2. The app calls `extract-text` with `{ noteId }`.
3. The function checks the note belongs to the caller, downloads the file, picks the parser by extension and content type: `.pdf` via `unpdf` (`npm:unpdf`), `.docx` via `mammoth` (`npm:mammoth`), `.txt` and `.md` as UTF-8 text. Anything else: note `status = failed`, reason "file type not supported".
4. Text goes through `toChunks`. Zero chunks (scanned PDF with no text layer): `status = failed`, reason "no readable text, this looks like a scanned image". The file is deleted either way.
5. Chunks are inserted, the note becomes `ready`, the file is deleted from Storage.
6. If the note is not a syllabus, the function calls `make-questions` for the note (fire and forget, with the service key) and returns `{ chunks: n }`. If it is a syllabus, it returns `{ chunks: n }` and the app then calls `read-syllabus`.

Errors: a parser crash sets `failed` with a one-line reason the screen can show. The function is safe to call again: if chunks already exist for the note it answers with their count and does nothing.

Why the file is deleted even on failure: product rule, only text is stored. A failed note keeps its title and reason so the student can retry with a different file.

## 5. Syllabus reader (`read-syllabus`, A4)

Input: `{ noteId }` for a note with `is_syllabus = true` and `status = ready`. The function concatenates its chunks (a syllabus is short; cap at 40 chunks, which is far more than any syllabus) and calls `askGemini('read-syllabus', { text, today })` with this output schema:

```ts
interface SyllabusProposal {
  title: string;                 // "Midterm 1"
  date: string;                  // YYYY-MM-DD
  kind: 'exam' | 'quiz' | 'competition';
  topics: string[];              // in syllabus order
  evidence: string;              // the sentence the date came from, copied
}
interface SyllabusResult { found: boolean; proposals: SyllabusProposal[]; }
```

`proposals.ts` then validates: date parses as a real calendar date, evidence appears in the text (whitespace collapsed), title 1 to 120 characters, topics deduplicated and capped at 30. Proposals that fail validation are dropped, not repaired. Dates in the past are kept but flagged `past: true` so the confirm screen (B5) can grey them. Zero valid proposals means `{ found: false, proposals: [] }`. Nothing is saved. The confirm screen saves exams and topics itself through the normal tables once the student confirms.

The prompt says: only report dates that are written in the text, copy the evidence sentence exactly, never infer a date from "week 7" unless the text gives the week's date, and return `found: false` when unsure.

## 6. Schedule engine (A5) and `build-schedule`

### 6.1 What the research says, in short

Two agents researched learning science and real products on 2026-10-10. The findings that shape the engine:

- Quizzing with feedback beats rereading (effect about 0.5, about 0.73 with feedback shown).
- Spreading sessions out beats cramming (effect about 0.74). The best gap between sessions on the same material is about 20 percent of the days left, shrinking as a share for far exams (Cepeda et al. 2008).
- An item is secure after a correct recall in about three separate sessions (Rawson and Dunlosky, successive relearning). Three recalls spread over sessions: 68 percent kept a week later. Three in one sitting: 26 percent.
- Expanding gaps are no better than equal gaps (Latimier et al. 2021). Keep gaps simple.
- Mixing two or three related topics in a session beats one topic at a time (Rohrer 2020, 61 versus 38 percent a month later).
- Sleep between sessions helps (Mazza et al. 2016): one visit per topic per day.
- Real planners (RemNote, UWorld, Osmosis, Cram Fighter) anchor on the exam date, ask for days off and a time budget, spread missed work over the remaining days, never push past the exam, and do one final pass over everything just before the exam.
- Weak or no evidence: time of day, self-rated confidence, learned per-item memory models at this data size, AI difficulty ratings. The AI rating is kept only as a starting guess before any answers exist.

### 6.2 Inputs

```ts
export type Pace = 'light' | 'normal' | 'heavy';   // max sessions per day across all exams: 1, 2, 3

export interface ChunkHistory {
  correctSessions: number;       // distinct sessions with at least one correct answer on this chunk
  lastSeen: DateOnly | null;
  lastCorrect: boolean | null;   // result of the most recent answer
}

export interface ScheduleChunk {
  id: Id;
  topicId: Id | null;
  questionIds: Id[];             // verified questions available for this chunk
  history: ChunkHistory;
}

export interface ScheduleTopic { id: Id; difficulty: 1 | 2 | 3 | 4 | 5 | null; }

export interface ScheduleExam {
  id: Id;
  examDate: DateOnly;
  topics: ScheduleTopic[];
  chunks: ScheduleChunk[];
}

export interface ScheduleInput {
  today: DateOnly;
  exams: ScheduleExam[];         // all upcoming exams of the student, so the daily cap is shared
  pace: Pace;
  busyDays: DateOnly[];          // expanded from days off and busy ranges, within the horizon
  keep: { examId: Id; scheduledFor: DateOnly }[];   // sessions already done or skipped; their days stay taken
}

export interface PlannedSession {
  examId: Id;
  scheduledFor: DateOnly;
  questionIds: Id[];             // 5 to 7, ordered
  isFinalPass: boolean;
  topicIds: Id[];                // the 2 to 3 topics in this session
}

export const SCHEDULE_WARNING_CODES = ['exam_past', 'no_questions', 'load_increased', 'not_enough_days'] as const;
export type ScheduleWarningCode = (typeof SCHEDULE_WARNING_CODES)[number];

export interface ScheduleWarning {
  code: ScheduleWarningCode;
  examId: Id | null;             // which exam the warning is about, so the screen can say so
  chunkId?: Id;                  // for no_questions
}

export interface ScheduleOutput {
  sessions: PlannedSession[];
  warnings: ScheduleWarning[];
}
```

### 6.3 Rules

1. **Horizon.** Plan from `today` to the latest exam date. Nothing on or after an exam's own date. An exam already past yields no sessions and a warning.
2. **Gap.** `gapDays(daysLeft) = daysLeft <= 7 ? 1 : clamp(round(daysLeft * 0.2), 1, 14)`. A chunk is due when it has never been seen, or its last answer was wrong, or `today - lastSeen >= gapDays`.
3. **Secure.** A chunk with `correctSessions >= 3` is not due. It returns only in the final pass.
4. **Difficulty prior.** With no history, chunks of a topic rated 4 or 5 are placed first and get an extra slot per session when space allows. Rated 1 or 2 go last. Null counts as 3. Once a chunk has any history, the history decides and the rating is ignored.
5. **Session content.** 5 to 7 questions, from 2 to 3 topics of one exam, never two exams. Every normal session reserves at least 2 slots for never-seen chunks while any remain (hard topics first, by the difficulty prior), so far exams keep covering new material instead of repeating the first chunks for weeks. The remaining slots go to wrong-last-time chunks, then overdue, then more new chunks, then one question from a secure chunk only to reach 5. Within a chunk pick the question least recently asked. A chunk with no verified questions is skipped with a warning.
6. **Days.** One session per exam per day. One visit per topic per day. Never on a busy day or a day in `keep`. At most `pace` sessions per day across exams; when two exams want the same day, the closer exam wins and the other moves to the next free day.
7. **Spacing of sessions.** For each exam, sessions are placed every `gapDays(daysLeft)` days from today, so they are sparse far out and daily inside the last week. If the due chunks do not fit into the sessions available, sessions are added on free days up to the pace cap, and if they still do not fit, `load_increased` or `not_enough_days` is reported.
8. **Final pass.** The day before each exam is a session marked `isFinalPass` that touches every topic once: one question per chunk, hardest and most-missed first, capped at 7. Exam day itself has nothing.
9. **Reflow.** Skipped or missed sessions are not copied forward. The engine simply re-runs from today with the real history, so the chunks that were not seen are due again and get spread across the remaining days. Nothing moves past the exam.
10. **Smallest session counts.** A session is `done` when the student answers at least one question; the plan never stacks unfinished sessions.
11. **Deterministic.** Same input, same output, no randomness, no clock reads inside the engine. `today` is an input.

### 6.4 `build-schedule` function

Input: `{ examId }` or `{}` for all upcoming exams of the caller. Steps:

1. Load the caller's upcoming exams, topics, notes linked to each exam (`notes.exam_id`), chunks, verified questions, attempts, study settings, busy days, and done or skipped sessions.
2. For every topic with `difficulty = null` and at least one chunk, call `askGemini('rate-difficulty', { topicTitle, sampleChunks })` once, save the number on the topic. At most 10 topics per call to stay inside the time limit; more are rated on the next run.
3. Build `ScheduleInput`, run `buildSchedule`, and replace the caller's `planned` sessions for those exams with the output. Done and skipped sessions are never touched. `scheduled_for` is the planned date at the student's `session_time` (default 18:00) in the student's time zone (setting, default UTC).
4. Return `{ sessions, warnings }`.

Who calls it: the app, after the student confirms exams, marks a session done or skipped, or changes busy days or pace. The question maker, after it adds questions for a note that is linked to an exam. There is no nightly job: "today" is always the day the plan is viewed, and the app calls `build-schedule` when the schedule screen opens if the plan is older than one day.

## 7. Question maker (`make-questions`, A6)

Input: `{ noteId, batchStart? }`. The function checks the caller is the note's owner, or the call came from `extract-text` with the service key.

1. Load the note, its exam and topics (if `exam_id` is set), and its chunks that have no questions yet, 6 chunks per batch.
2. Call `askGemini('make-questions', { chunks, topics, questionsPerChunk: 3 })` with this output schema:

```ts
interface MadeQuestion {
  chunkPosition: number;
  kind: 'multiple_choice' | 'short_answer' | 'flashcard';
  prompt: string;
  choices: string[] | null;      // 4 for multiple choice, the answer among them
  answer: string;
  sourceQuote: string;           // copied exactly from that chunk
  topicTitle: string | null;     // one of the exam's topics, or null
}
```

3. For each returned question: run `quoteAppears`; drop it if the quote is not in the chunk, if the kind and choices disagree, or if a multiple-choice answer is not among the choices. Map `topicTitle` to a topic id (exact title match), else null. Insert the rest with `exam_id` and `topic_id`. The database trigger sets `verified`; the function counts verified rows after insert.
4. If more chunks remain, the function calls itself for the next batch (fire and forget) and returns `{ made, dropped, remaining }`.
5. When the note is linked to an exam and the last batch is done, call `build-schedule` for that exam.

The prompt asks for a mix of kinds (roughly half multiple choice, a quarter short answer, a quarter flashcard), questions that test understanding rather than copying, choices that are plausible, and a quote of 5 to 30 words copied character for character from the chunk. It states that inventing facts not in the chunk is forbidden and that unclear chunks get fewer questions, not guesses.

Safe to re-run: chunks with questions are skipped. A failed AI call leaves the note `ready` with fewer questions; the screen shows "questions are still being made" while `remaining > 0` or when a note has chunks without questions, and the app can call the function again.

Target from `split_work.md`: 10 pages of notes give at least 20 verified questions. Ten pages is about 3,300 words, which is about 10 chunks of 300 to 500 words, three questions each, so about 30 questions before the quote check. A drop rate above one third fails the target. If that happens, first fix the prompt wording, then raise questions per chunk to 4 (Dev A's call).

## 8. Calendar feed (`calendar-feed`, A7)

`GET /calendar-feed?token=<token>`, `verify_jwt = false`. The function looks up `calendar_feeds` by token (constant-time compare is unnecessary, the token is 64 random hex characters), loads the user's upcoming exams and planned sessions, and returns `text/calendar` built by `ics.ts`:

- One all-day `VEVENT` per exam, titled "Exam: <title>".
- One 20-minute `VEVENT` per planned session at its `scheduled_for`, titled "Study: <exam title>", description with the topic titles, a `UID` from the session id so updates replace rather than duplicate.
- `X-WR-CALNAME: Cramrade`, `REFRESH-INTERVAL` and `X-PUBLISHED-TTL` of 1 hour.

The app's button (Dev B, small) creates the `calendar_feeds` row if missing and shows the link with instructions for Google Calendar ("From URL") and Apple Calendar ("New Calendar Subscription"). Unknown token returns 404 with an empty body. Rate limit is unnecessary at this size; the response is small and cached by the calendar clients.

## 9. Quiz server (A8)

### 9.1 Room lifecycle

- `quiz-create` `{ source: { examId } | { noteId }, count?: 10, secondsPerQuestion?: 20, mode: 'group' | 'solo' }`. Caller must be a full user who can see the source (owner, or group member). The server picks up to `count` verified questions, spread across chunks, inserts the room (`mode`, `results_seconds` default 5) and `quiz_room_questions`. Group mode: status `lobby`, returns `{ roomId, code }`. Solo mode: joins the caller as the only player with their display name and starts at once (same as `quiz-start`).
- Players join through the existing `join_quiz_room(code, nickname)` RPC, as guests or users. Rejoin with the same login returns the same player and score.
- `quiz-start` `{ roomId }`, host only, lobby only: sets `status = running`, `current_question_index = 0`, `question_started_at = now()`.
- `quiz-answer` `{ roomId, questionId, answer }`, player only: the server checks the question is current, `now() < question_started_at + seconds_per_question`, and no earlier answer exists. It marks `is_correct` (multiple choice and flashcard: exact match on the answer text; short answer: case-insensitive, whitespace-collapsed match), computes `points` with `scoring.ts`, inserts the answer, and adds the points to the player's score in one statement. Late or duplicate answers get 409 and score nothing.
- `quiz-advance` `{ roomId, expectedIndex }`, any player or the host: if `now() >= question_started_at + seconds_per_question + results_seconds`, advance with a single conditional `update ... where current_question_index = expectedIndex` so only the first caller moves the room. The client sends the index it is showing, so a stale client can never skip a question. Last question done: `status = finished`. Clients call it when their local timer runs out; later calls are no-ops that return the current state.

Phases are derived by every client from the same two fields: answering until `started + seconds`, results until `started + seconds + results`, then the next question. The clock is the server's; clients only display it.

### 9.2 Scoring (`scoring.ts`)

```ts
// Kahoot-style: 1000 points at instant answer, 500 at the last moment, 0 when wrong.
export function points(correct: boolean, msTaken: number, msAllowed: number): number {
  if (!correct) return 0;
  const frac = Math.min(Math.max(msTaken / msAllowed, 0), 1);
  return Math.round(1000 * (1 - frac / 2));
}
```

`msTaken` is `answered_at - question_started_at`, both server timestamps.

### 9.3 What players can see

- A database function `public.current_quiz_question(room_id)` returns the current question's `prompt`, `kind` and `choices` for a player in the room, and adds `answer` only once the answering phase is over. Players never read `quiz_room_questions` directly.
- Realtime: `quiz_rooms` and `quiz_players` are added to the `supabase_realtime` publication. Players subscribe to their room's row (status, index, started_at) and to the room's players (scores). Row Level Security already limits both to room members. `quiz_answers` stays off Realtime; each player reads their own result from `quiz-answer`'s response.

### 9.4 Done when

A Node script at `scripts/quiz-e2e.mjs` (run by hand with `node scripts/quiz-e2e.mjs` against the live project with five anonymous sessions; it needs the network, so it is not a vitest test) creates a room, joins five players, answers five questions with different delays, advances, and asserts all five see the same final scores. One player signs in again mid-game with the same session and keeps their score.

## 10. Errors, limits and safety

- Every function returns JSON `{ error: { code, message } }` with 400 `bad_input` (also for a wrong HTTP method), 401 `not_signed_in`, 403 `not_yours` or `guest_not_allowed`, 404 `not_found`, 409 (too late or duplicate), 502 `ai_failed`, 500 `internal`.
- The AI is called with a 60-second timeout per call; one retry on a network error, none on a bad answer.
- Nothing is stored that the product rules forbid: files are deleted after extraction, syllabus dates are returned not saved, the AI never edits chunks.
- The service-role key and Gemini key are function secrets (`supabase secrets set`), never in the repo. `.env.example` under `supabase/functions` lists their names with empty values.
- CPU time: parsing a 50-page PDF with `unpdf` is well under 2 seconds. The question maker's CPU work is JSON handling only; waiting on Gemini is I/O and does not count.

## 11. Database changes (one migration, needs Dev B's yes on the types)

- `notes`: add `exam_id uuid references exams on delete set null`, `is_syllabus boolean not null default false`, `failure_reason text`.
- `topics`: add `difficulty smallint check (difficulty between 1 and 5)`.
- `questions`: no change.
- `study_sessions`: add `is_final_pass boolean not null default false`.
- New `study_settings` (`user_id` primary key, `pace text default 'normal'`, `days_off smallint[] default '{}'` as weekday numbers 0 to 6, `session_time time default '18:00'`, `time_zone text default 'UTC'`). RLS: own row only. Created by the app on first use, with defaults when missing.
- New `busy_days` (`id`, `user_id`, `from_date date`, `to_date date`, `reason text`). RLS: own rows only.
- `quiz_rooms`: add `mode text not null default 'group' check (mode in ('group','solo'))`, `results_seconds integer not null default 5 check (between 0 and 60)`.
- `quiz_answers`: add `points integer not null default 0`.
- Function `public.current_quiz_question(room_id uuid)`, security definer, as in 9.3.
- `alter publication supabase_realtime add table quiz_rooms, quiz_players`.
- Storage bucket `uploads` (private, 20 MB per file, allowed types pdf, docx, txt, md) declared in `config.toml` and policies in the migration: insert, select and delete only under `<auth.uid()>/`.

Type changes in `packages/shared/src/types`: `Note.examId`, `Note.isSyllabus`, `Note.failureReason`; `Topic.difficulty`; `StudySession.isFinalPass`; new `StudySettings`, `BusyDay`, `Pace`, `PACES`; `QuizRoom.mode`, `QuizRoom.resultsSeconds`, `QUIZ_MODES`; `QuizAnswer.points`; the engine types from 6.2. These go in the first pull request, tagged for Dev B's review, as agreed in T1.

## 12. Changes to `split_work.md` and `CLAUDE.md`

- Everywhere: Claude API becomes Gemini API.
- New Dev A task before A4: **A4a. Text extractor**, with the "Done when" from B4's server half. B4 shrinks to the upload button, the Storage upload and the call to `extract-text`.
- A5 "What it means" gains the answer-driven engine and the inputs list. "Needs first" gains the migration.
- A8 gains automatic pacing, solo mode and the speed bonus.
- New Dev B task: **B13. Study settings screen**: pace, days off, session time, a "busy in the next few days?" prompt that writes `busy_days`. Small.
- B8 gains the solo start button and the automatic phases.
- New Dev B task: **B14. Calendar button**: creates the feed row and shows the link with instructions.
- `CLAUDE.md`: provider line, the extractor ownership, the engine rule stays ("plain code, never AI; the AI only rates topic difficulty as a starting guess").

## 13. Testing

- **Engine** (vitest, `packages/shared`): exam tomorrow, exam in 14 days, exam in 3 months, exam past, two exams in one week with pace normal, a busy week, a skipped session reflowed, a chunk reaching three correct recalls leaves the plan, a wrong answer brings the chunk back next session, a topic with no questions, difficulty prior ordering, final pass present and exam day empty, and a determinism check (two runs, equal output).
- **Pure server code** (vitest, `supabase/functions/_shared`): chunking sizes and determinism, quote check against the trigger's rule, scoring at 0, half and full time, ics output parses with a strict parser and has stable UIDs, proposal validation drops bad dates and missing evidence.
- **Functions** (by hand against the live project, scripted with `curl` or a small Node script, documented in `supabase/functions/README.md`): one typed PDF, one Word file, one text file, one scanned PDF (expects failed with reason), one syllabus with dates, one without. Sample files live in `supabase/functions/_fixtures/`.
- **Quiz**: the end-to-end script in 9.4.
- **Migration**: applied by the GitHub integration on merge. The pull request shows the migration SQL itself (there is no Docker on Dev A's machine, so `npx supabase db diff` cannot run). Before opening the pull request, the SQL is rehearsed on the live database inside `begin ... rollback`, which runs it and keeps nothing.

## 14. Order of work and branches

1. `a5-schedule-engine`: types, engine, tests. No server, no migration. Can merge first.
2. `a4a-server-foundation`: migration, `_shared`, prompts, `extract-text`, config. Dev B's yes on types needed before merge.
3. `a4-syllabus-reader` and `a6-question-maker`: in parallel after 2.
4. `a5-build-schedule`: after 1 and 2.
5. `a7-calendar-feed` and `a8-quiz-server`: in parallel after 2 (A8 also needs verified questions, so test data comes from A6).
6. `docs-server-side`: the split_work and CLAUDE.md changes from section 12, merged with 2.

## 15. Not in this spec

Photos and handwriting (phase 2, B9 to B11), alarms (A10), phone builds (A9, A11), the cited lesson (A12), hosting a quiz from the phone, a weekly quiz limit, exam priority weighting, a retention slider, learned memory models, vector search.
