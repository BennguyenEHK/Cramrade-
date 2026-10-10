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

Exam: `title`, `examDate`, `kind` (exam, quiz, competition), `source` (manual, syllabus), optional `groupId` to share it. Syllabus proposals stay on the confirm screen until confirmed, so every row here is one the student agreed to. Topic: `title` and `position` inside an exam, and `difficulty` (1 to 5, or null): the AI's first guess at how hard the topic is, set by the server and used by the schedule only until the student has answered questions on it.

Seen by: the owner, and group members when `groupId` is set. Edited by: the owner.

## Note and Chunk

Note: `title`, `source` (file, photo, text), `originalFilename`, `status` (processing, ready, failed), optional `groupId`, optional `examId` (the exam the notes are for), `isSyllabus` (the file is a syllabus, so the server reads dates from it instead of making questions) and `failureReason` (one line to show when text extraction failed). Only text is ever stored, in Chunks: numbered pieces with `position` (from 0) and `text`.

Uploading a file: the app creates the note (`source` file, `status` processing), uploads the file to the private Storage bucket `uploads` at `<user id>/<note id>/<file name>` with an explicit content type, and calls the server function `extract-text` with `{ noteId }`. The server saves the chunks, deletes the file and sets `status` to ready, or to failed with `failureReason`.

Seen by: the owner, and group members when shared. The owner creates notes, adds chunks (typed notes) and fixes chunk text (unclear words from a photo). The server adds chunks for uploads.

## Question

Made by the server from one chunk: `kind` (multiple_choice, short_answer, flashcard), `prompt`, `choices` (multiple choice only), `answer`, `sourceQuote`, `verified`, plus `noteId`, `chunkId`, optional `examId` and `topicId`. The database sets `verified` itself: true only when `sourceQuote` appears word for word in the chunk's text. Editing a chunk re-checks its questions. Screens show only verified questions.

Seen by: whoever can see the note. The app cannot insert or edit questions; the note's owner can delete one.

## StudySession, SessionQuestion, Attempt

StudySession: one short session for one exam, `scheduledFor`, `status` (planned, done, skipped), `isFinalPass` (the last session before the exam, touching every topic once). SessionQuestion lists its questions in order. Attempt: one answer while studying alone, `answer`, `isCorrect`, `answeredAt`; `sessionId` is null for an on-demand review.

Seen and edited by: the owner only. The schedule engine writes sessions; the app marks them done or skipped and saves attempts.

## QuizRoom, QuizRoomQuestion, QuizPlayer, QuizAnswer

QuizRoom: `title`, `code`, `status` (lobby, running, finished), `mode` (group or solo, from `QUIZ_MODES`), `secondsPerQuestion`, `resultsSeconds` (how long the answer shows before the next question), `currentQuestionIndex`, `questionStartedAt`, optional `groupId`. QuizRoomQuestion is the ordered question list, visible to the host only, so players cannot read ahead. Players read the current question with the database function `current_quiz_question(room_id)`, which adds the answer only once answering time is over. QuizPlayer: `nickname`, `score`, `userId`. QuizAnswer: one answer per player per question, with `points` set by the server.

- The host creates and deletes the room and may change `title`, `status` and `secondsPerQuestion`. Only the server sets `currentQuestionIndex` and `questionStartedAt`.
- Players join with `join_quiz_room(code, nickname)`. Calling it again with the same login returns the same player, score kept, which is how rejoining works.
- A player inserts an answer (`roomId`, `playerId`, `questionId`, `answer`) only while that question is current. The database stamps the time; the server fills `isCorrect` and the score.

Seen by: the host and the players in the room. A player sees only their own answers; the host sees all.

## CalendarFeed

`userId` and a random `token` made by the database; the calendar link carries the token. Delete and recreate the row for a new link. Seen by the student only.

## StudySettings and BusyDay

StudySettings: one row per student with `pace` (light, normal, heavy: at most 1, 2 or 3 sessions a day, from `PACES`), `daysOff` (weekdays, 0 = Sunday to 6 = Saturday), `sessionTime` ("18:00:00") and `timeZone` ("UTC" or a name like "Europe/Berlin"). The app creates the row the first time settings are saved; until then the server uses those defaults. BusyDay: `fromDate` to `toDate` (inclusive) when the student cannot study, with an optional `reason`. The schedule places nothing on those days.

Seen and edited by: the student only. Guests cannot create either.

## Decided (T1 closed on 2026-10-10)

Both developers agreed:

1. **Field names are camelCase in TypeScript** (`examDate`) **and snake_case in the database** (`exam_date`). The app maps between them when it reads or writes rows (Dev B writes that mapping, in `apps/app/src/lib`). Server code maps the same way.
2. **`Note.status` and `QuizRoom.secondsPerQuestion` stay.**
3. **`Attempt.sessionId` may be null**, for a review outside the plan.
4. **The allowed-value lists are exported as constants** next to each type: `EXAM_KINDS`, `EXAM_SOURCES`, `GROUP_ROLES`, `NOTE_SOURCES`, `NOTE_STATUSES`, `QUESTION_KINDS`, `QUIZ_ROOM_STATUSES`, `STUDY_SESSION_STATUSES`. Pickers read from these. The types are derived from the lists, so they cannot drift apart.

From here on, any change to `src/types/` needs a yes from both developers and a matching database migration.

## Changed in A4a (2026-10-10, needs Dev B's yes)

New fields: `Note.examId`, `Note.isSyllabus`, `Note.failureReason`, `Topic.difficulty`, `StudySession.isFinalPass`, `QuizRoom.mode`, `QuizRoom.resultsSeconds`, `QuizAnswer.points`. New shapes: `StudySettings`, `BusyDay` (its `pace` uses `Pace` and `PACES` from the schedule engine, `types/schedule.ts`). New value list: `QUIZ_MODES`. The matching database migration is `supabase/migrations/*_server_side.sql`.
