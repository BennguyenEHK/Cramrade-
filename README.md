# Cramrade

A study app that builds your review plan around your real exam dates, reminds you to study, and lets your study group quiz each other from your own notes.

Live site: https://cramrade.expo.app

## Why the name

Cramrade is "cram" plus "comrade": studying hard, together. Cramming is what students do before an exam, and a comrade is the friend who does it with you, which is what the group quiz is for. The "-rade" ending also sounds like "grade", the thing you are both studying for.

## Where the project stands

Last updated 2026-10-10. The task-by-task status lives in `split_work.md`: finished tasks are marked DONE or PARTIALLY there, each with a Status line. This list is only the short version.

Finished:

- Project set up: one Expo app for web and phone, a shared package, a Supabase folder (A1).
- Database live on Supabase with Row Level Security (A2), plus the server-side tables and columns (A4a).
- Web app online at https://cramrade.expo.app with automatic deploys from `main` (A3).
- Data shapes agreed by both developers (T1).
- Schedule engine: plain code, 66 tests (A5).
- Sign-in, exam screen and the upload screens (B2, B3, B4) by Dev B.

Built, merged and live, waiting for their real-data checks:

- Text extractor, syllabus reader, question maker, build-schedule, calendar feed, quiz server (A4a, A4, A5 server half, A6, A7, A8). What each still needs is in its Status line in `split_work.md`.

Next up:

- Dev A: run the hand tests above, then A9 (first phone build).
- Dev B: B5 syllabus confirm screen, B6 schedule screen, B7 study screen, B8 quiz screens, plus the small B13 settings screen and B14 calendar button.

## Note for the team: the extract-text collision (2026-10-10)

What happened: Dev A built the `extract-text` server function in pull request 2 (task A4a). On the same day Dev B built another one as part of B4 and merged it into `main` without review. Two functions with the same name and different designs cannot both exist, so they were merged into one.

What Dev B's did better: the file is sent straight to the function and never stored, with the size checked while it arrives. The upload id comes from the app, so a retry never makes a duplicate. Simpler and more private than Dev A's bucket-based version.

What Dev A's did better: text is cut at paragraph and sentence boundaries into 300 to 500 word chunks, which the question maker and the quote check need. It records the exam link, the syllabus flag and failure reasons, starts the question maker, uses the shared helpers and the agreed error shape, and allows 100 pages and 20 MB instead of 5 pages and 4 MB.

Decision: one function, now on `main`. Dev B's transport, Dev A's behaviour inside. Dev B's parser files were removed; their migration stays. Dev B has two small follow-ups in `apps/app/src/features/notes/upload.ts`: read `error.message`, and treat a 200 with `status: 'failed'` as a failure. Contract: top of `supabase/functions/extract-text/index.ts`.

Rule from now on: never merge your own pull request, and never change files under `supabase/` or `packages/shared/` (Dev A) or `apps/app` (Dev B) without asking the owner first. Branch protection on `main` now enforces the review.

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
