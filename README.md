# Cramrade

A study app that builds your review plan around your real exam dates, reminds you to study, and lets your study group quiz each other from your own notes.

Live site: https://cramrade.expo.app

## Why the name

Cramrade is "cram" plus "comrade": studying hard, together. Cramming is what students do before an exam, and a comrade is the friend who does it with you, which is what the group quiz is for. The "-rade" ending also sounds like "grade", the thing you are both studying for.

## Where the project stands

Last updated 2026-10-06. The task-by-task status lives in `split_work.md`: finished tasks are marked DONE or PARTIALLY there, each with a Status line. This list is only the short version.

Finished:

- Project set up: one Expo app for web and phone, a shared package, a Supabase folder (task A1).
- Database live on Supabase: 16 tables, each student sees only their own rows and their groups' rows (task A2).
- Web app online at https://cramrade.expo.app with the homepage, theme and fonts (task A3).
- Sign in and Workspace exist as placeholder screens, ready for the real ones.

Waiting:

- Data shapes: the proposal is in `packages/shared/README.md` and needs Dev B's yes or no (task T1).
- Web trial: the Expo web version runs and builds. PDF upload and a wide quiz-host layout still need testing (task B1).

Next up:

- Dev B: B1 web trial, B2 sign-in, B3 exam screen.
- Dev A: A4 syllabus reader, A5 schedule engine.

## Start here

1. Install Git and Node.js 22 or newer.
2. Run:

   ```sh
   git clone https://github.com/BennguyenEHK/Cramrade-.git
   cd Cramrade-
   npm install
   ```

3. Copy `apps/app/.env.example` to `apps/app/.env` and ask Dev A for the two values.
4. `npm run web` opens the app at http://localhost:8081.

## What to read

- `split_work.md`: what is being built, who builds it, in what order, and what is done.
- `project-initialize.md`: all commands and the folder structure.
- `packages/shared/README.md`: the data shapes proposal.
- `apps/app/README.md` and `apps/app/DESIGN.md`: the app, its theme and fonts.
- `CLAUDE.md`: rules for Claude Code in this repo.
