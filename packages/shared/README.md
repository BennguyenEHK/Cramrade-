# Shared package: the data shapes (T1 proposal)

Dev A's proposal for task T1. Dev B reads it and says yes, or says what to change. After that, any change to `src/types/` needs both to agree.

Each shape is one database table (`supabase/migrations/20261005120000_initial_schema.sql`). Columns are snake_case (`exam_date`), TypeScript fields camelCase (`examDate`). Ids are UUIDs made by the database. Times are ISO strings; exam dates are `YYYY-MM-DD`.

"Seen by" is enforced by the database (Row Level Security), not the app: one student's request never returns another's rows. Server code (Edge Functions) sees everything. Guests (quiz players signed in anonymously) have a user id but can only play quizzes.

## Profile

A student's public details: `id` (same as the login id), `displayName`. The database creates the row at sign-up (pass `display_name` in the sign-up metadata to fill it in); the app never inserts it.

Seen by: the student and anyone in a group with them. Edited by: the student.

## Group and GroupMember

A study group: `name`, `ownerId`, `joinCode` (6 characters, made by the database). GroupMember links a user to a group with a `role` (owner or member). The owner becomes the first member automatically; others join by calling the database function `join_group(code)`. The app never inserts into `group_members`.

Seen by: members. Edited or deleted by: the owner. Members can leave; the owner can remove members.

## Exam and Topic

Exam: `title`, `examDate`, `kind` (exam, quiz, competition), `source` (manual, syllabus), optional `groupId` to share it. Syllabus proposals stay on the confirm screen until confirmed, so every row here is one the student agreed to. Topic: `title` and `position` inside an exam.

Seen by: the owner, and group members when `groupId` is set. Edited by: the owner.

## Note and Chunk

Note: `title`, `source` (file, photo, text), `originalFilename`, `status` (processing, ready, failed), optional `groupId`. Only text is ever stored, in Chunks: numbered pieces with `position` and `text`.

Seen by: the owner, and group members when shared. The owner creates notes, adds chunks (typed notes) and fixes chunk text (unclear words from a photo). The server adds chunks for uploads.

## Question

Made by the server from one chunk: `kind` (multiple_choice, short_answer, flashcard), `prompt`, `choices` (multiple choice only), `answer`, `sourceQuote`, `verified`, plus `noteId`, `chunkId`, optional `examId` and `topicId`. The database sets `verified` itself: true only when `sourceQuote` appears word for word in the chunk's text. Editing a chunk re-checks its questions. Screens show only verified questions.

Seen by: whoever can see the note. The app cannot insert or edit questions; the note's owner can delete one.

## StudySession, SessionQuestion, Attempt

StudySession: one short session for one exam, `scheduledFor`, `status` (planned, done, skipped). SessionQuestion lists its questions in order. Attempt: one answer while studying alone, `answer`, `isCorrect`, `answeredAt`; `sessionId` is null for an on-demand review.

Seen and edited by: the owner only. The schedule engine writes sessions; the app marks them done or skipped and saves attempts.

## QuizRoom, QuizRoomQuestion, QuizPlayer, QuizAnswer

QuizRoom: `title`, `code`, `status` (lobby, running, finished), `secondsPerQuestion`, `currentQuestionIndex`, `questionStartedAt`, optional `groupId`. QuizRoomQuestion is the ordered question list, visible to the host only, so players cannot read ahead. QuizPlayer: `nickname`, `score`, `userId`. QuizAnswer: one answer per player per question.

- The host creates and deletes the room and may change `title`, `status` and `secondsPerQuestion`. Only the server sets `currentQuestionIndex` and `questionStartedAt`.
- Players join with `join_quiz_room(code, nickname)`. Calling it again with the same login returns the same player, score kept, which is how rejoining works.
- A player inserts an answer (`roomId`, `playerId`, `questionId`, `answer`) only while that question is current. The database stamps the time; the server fills `isCorrect` and the score.

Seen by: the host and the players in the room. A player sees only their own answers; the host sees all.

## CalendarFeed

`userId` and a random `token` made by the database; the calendar link carries the token. Delete and recreate the row for a new link. Seen by the student only.

## Decided (T1 closed on 2026-10-10)

Both developers agreed:

1. **Field names are camelCase in TypeScript** (`examDate`) **and snake_case in the database** (`exam_date`). The app maps between them when it reads or writes rows (Dev B writes that mapping, in `apps/app/src/lib`). Server code maps the same way.
2. **`Note.status` and `QuizRoom.secondsPerQuestion` stay.**
3. **`Attempt.sessionId` may be null**, for a review outside the plan.
4. **The allowed-value lists are exported as constants** next to each type: `EXAM_KINDS`, `EXAM_SOURCES`, `GROUP_ROLES`, `NOTE_SOURCES`, `NOTE_STATUSES`, `QUESTION_KINDS`, `QUIZ_ROOM_STATUSES`, `STUDY_SESSION_STATUSES`. Pickers read from these. The types are derived from the lists, so they cannot drift apart.

From here on, any change to `src/types/` needs a yes from both developers and a matching database migration.

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
