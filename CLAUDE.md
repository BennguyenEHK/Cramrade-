# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project state

Cramrade is at the planning stage. There is no application code yet, so there are no build, lint or test commands. When task A1 in `split_work.md` creates the project, add the real commands to this file (install, run web, run tests, run a single test, deploy functions). Do not guess them before then.

`split_work.md` is the source of truth for what is being built, who builds it, and in what order. Read it before starting any task. Every task there has a "Done when" check: work is finished when that check passes, not before.

## What Cramrade is

A study app for students. It takes exam dates and the student's own notes, builds a study plan that ends on exam day, reminds the student, quizzes them with questions made from their notes, and lets a study group play a live quiz.

Two things set it apart, and changes should protect them: review scheduled around real exam dates with reminders, and group quizzes built from the group's own notes. It is not a general "chat with your notes" tool.

## Architecture (decided, not yet built)

- **One Expo (React Native) codebase** produces the web app, the Android app and the iPhone app. The web app is built first (phase 1), the phone app second (phase 2). The web app is not Next.js. Next.js is only the fallback if task B1 (web trial) fails.
- **Supabase is the only backend**: Postgres database, Auth, Realtime (live quiz), Edge Functions (all server code), Storage (temporary photos only). Do not add Neon or a second backend.
- **Claude API** reads syllabuses, writes questions and lessons, and reads handwriting. It is called only from Edge Functions, never from the app.
- **TypeScript everywhere.**

Planned layout (the full folder map and the setup commands are in `project-initialize.md`):

- `apps/app`: the one Expo app. Screens are shared by web and phone. Phone-only: camera, alarms. Web-only: the quiz host screen.
- `packages/shared`: data shapes (Exam, Topic, Note, Chunk, Question, Session, Quiz) and the schedule engine. No screen code and no network code, so it can be tested alone.
- `supabase/`: migrations (tables and Row Level Security) and Edge Functions.

How data moves: exam dates come in by hand or from a syllabus. Notes come in as files or photos and are turned into text. Text is cut into numbered chunks. An Edge Function asks Claude for questions, each tied to a chunk. The schedule engine places sessions of 5 to 7 questions between today and each exam and saves the plan on the server. Both apps read the same plan. The phone sets local notifications from it, and a calendar feed sends it out.

## Product rules

These are decisions, not suggestions. Do not change them without both developers agreeing.

- **The schedule is plain code, never AI.** The schedule engine is a deterministic function with unit tests. The AI only writes content.
- **Every question must trace to the student's notes.** Each question names its chunk and quotes it, and code verifies the quote exists in that chunk. Questions that fail are dropped, never repaired or padded.
- **The AI never adds content to notes.** Unclear text is flagged for the student to fix.
- **A date found in a syllabus is never saved until the student confirms it.** No dates found means saying so, not guessing.
- **No scanning the device for files.** The student always picks files or takes photos.
- **Photos are deleted after text is extracted**, from the device and from Storage. They never go to the gallery. Uploaded files are discarded after extraction too. Only text is stored.
- **Calendar is send-out only.** Cramrade never reads the student's calendar.
- **The server owns quiz time and score.** It records when each question started and scores answers against that. Never trust a time or score sent by a client.
- **The schedule lives on the server**, so web and phone always show the same plan. Only reminders are local to the phone.

## Limits to design around

- Supabase Edge Functions (paid plan): at most 400 seconds per run, must start responding within 150 seconds, 2 seconds of CPU time, 256 MB memory. Process notes in batches of a few pages, never one large call.
- iOS allows 64 pending local notifications per app. Schedule only the next two weeks and refresh on app open.
- Reminders are normal notifications in the first version. Alarms that ring through silent mode are out of scope.

## Two developers, two areas

- **Dev A (repo owner)** builds everything behind the screen: repo setup, database, hosting and deployment, schedule engine, syllabus reader, question maker, calendar feed, quiz server, phone builds, alarms. Owns `packages/shared`, `supabase/`, and deployment settings.
- **Dev B** builds everything the student sees and taps: sign-in, exam screen, file upload, syllabus confirm screen, schedule screen, study screen, quiz host and play screens, camera. Owns the screens in `apps/app`.

Before changing a file outside your developer's area, stop and say so. Changes to the data shapes in `packages/shared` need both developers to agree, because both sides build against them.

## Working rules

- This repository is public. Keys and secrets live in `.env` files that are never committed. If a secret appears in a diff, stop before committing.
- Never push to `main`. One task from `split_work.md` = one branch = one pull request, reviewed by the other developer.
- Name branches after the task, for example `a5-schedule-engine` or `b3-exam-screen`.
- Until the other side's part is ready, build against fake data in the agreed shapes. The "Needs first" lines in `split_work.md` say when this applies.
- Out of scope for the first version, do not build: Excel import, diagram understanding, a custom text-recognition model, reading the student's calendar, hosting a quiz from the phone, a weekly quiz limit.
- Documents for the team are written in plain words a non-expert can follow, with tasks as lists rather than tables.
