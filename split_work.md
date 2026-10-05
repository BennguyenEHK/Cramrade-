# Cramrade: who builds what

Two developers, both using Claude Code.

- **Dev A** (repo owner, Claude Max): the "behind the screen" side. Repo, database, hosting, the study schedule, reading the syllabus, making questions, the live quiz server, phone builds, alarms.
- **Dev B** (Claude Pro): the "on the screen" side. Every screen the student sees: sign-in, exam dates, file upload, the schedule, studying, the quiz, and later the camera.

Rule of thumb: Dev B builds *everything the student sees and taps*. Dev A builds *everything behind it*.

The plan has two phases:

- **Phase 1: the web app.** Works in any browser, on a computer or a phone. No app store needed.
- **Phase 2: the phone app.** The same code, plus the camera and alarms.

One task = one branch = one pull request.

The full design is in `docs/superpowers/specs/2026-10-03-cramrade-design.md`. That file is not in the repo yet; Dev A has it.

---

## What Cramrade is

**In one sentence:** Cramrade takes a student's exam dates and their own notes, builds a study plan that ends on exam day, reminds them to study, quizzes them from their notes, and lets a study group play a live quiz together.

**How it is built**

- **A web app** that runs in any browser. Best for a computer: uploading Word and PDF notes, uploading a syllabus, hosting a group quiz.
- **A phone app** for Android and iPhone. Best for a phone: alarms, notifications, photographing paper notes, quick study sessions.
- **One server (Supabase)** behind both. It holds the account, the notes, the questions and the study plan, and it runs the live quiz.

The web app and the phone app are made from the same code. Both connect to the same server over the internet. A student logs in with one account, so whatever they do on the computer shows up on the phone, and the other way round.

```
  Web app (browser)  ----+
                         +----  Supabase server  ----  Claude AI
  Phone app          ----+      (account, notes,       (reads the syllabus,
  (alarms, camera)              questions, plan,        writes questions)
                                live quiz)
```

**How a student uses it**

1. Signs up once. The same account works on the computer and the phone.
2. Adds exam dates: types them, or uploads the syllabus and confirms the dates Cramrade found.
3. Adds notes: uploads files on the computer, or photographs paper notes with the phone.
4. Cramrade turns the notes into questions and builds a study plan: short sessions of 5 to 7 questions, more often as the exam gets closer.
5. The phone rings when a session is due. The sessions also appear in the student's own calendar.
6. The student plays the session in a few minutes. Every question can show the exact note it came from.
7. Any time, the student can start extra flashcards or a quick quiz.
8. For a group quiz, one student hosts a room on the computer and shares a link. Classmates join from a browser or the phone app and play live, with questions made from the group's notes.

---

## Part 1: Tasks

### Important: read this first

- **Dev A deploys and hosts the web app.** Dev A owns the repo and the server, so one person holds the production keys and controls what goes live (task A3). The host is Expo's own hosting (EAS Hosting). Dev B has no part in hosting or deployment.
- **Dev A starts the phone app.** The web app and the phone app are the same Expo project, so it is started only once, in A1. Dev A also makes the first installable phone app (A9). After that, Dev B adds the camera.
- **The web app is built with Expo (React Native), using its web version. Not Next.js.** One codebase becomes the web app, the Android app and the iPhone app. Next.js is only the fallback if the web trial (B1) fails.

Three lists: what you do together, what Dev A does, what Dev B does. Inside each list the tasks are in the order to do them, first to last.

A task marked **DONE** or **PARTIALLY** after its title has a **Status** line saying what was done, when, and what is left.

Every task has the same labels:

- **Type:** the form the finished work takes. A page, a server function, a database table, a document, a trial, and so on.
- **Where it runs:** web app, phone app, server, or outside the code.
- **Tools:** the technology used to build it.
- **What it means:** the task in plain words.
- **Done when:** the check that proves it is finished.
- **Needs first:** a task that must be finished before this one can be completed.

Words used in the labels:

- **App screen (page):** something the student sees and taps.
- **Server function (API):** code that runs on Supabase, not on the student's device. The app sends it a request and gets an answer back.
- **Code function (pure logic):** code that only calculates. No screen, no internet.
- **Trial:** a quick experiment to answer a question. The code is thrown away, the answer is kept.

### Together

**Focus: agree on the rules before splitting up, and test with real students at the end of phase 1.**

**T1. Agree on the data shapes** PARTIALLY
- Status: Started. `packages/shared/src/types/` exists but is empty until the shapes are written down and both have agreed.
- Type: Code file (the list of data shapes)
- Where it runs: Shared by the web app, the phone app and the server
- Tools: TypeScript
- What it means: Sit together and write down what an Exam, a Topic, a Note, a Question, a Study Session and a Quiz look like (which fields each has). Example: an Exam has a name, a date and a list of topics. Both sides build against these, so nobody waits for the other.
- Done when: The shapes are in `packages/shared` and both of you have said yes.

**T2. Create the accounts** DONE
- Status: Supabase project `cramrade` created (region US East, Ohio), Expo and Claude accounts exist, GitHub is linked to Expo and Supabase. Open point on 2026-10-05: the Supabase organization is on the free plan, which pauses the project after 7 idle days. Upgrade or move it.
- Type: Setup, no code
- Where it runs: Outside the repo, on each service's website
- Tools: Supabase dashboard, Expo account, Claude Console (for the API key), `.env` files
- What it means: Supabase project (the paid one), Expo (also used for hosting the web app), and a Claude API key. Google Play and Apple accounts wait until phase 2.
- Done when: Both of you can log in to each one. Keys are in `.env` files that are not in git.

**T3. Write the shared `CLAUDE.md`** DONE
- Type: Document file
- Where it runs: The repo's top folder
- Tools: Markdown (`.md` file)
- What it means: A short file in the repo telling Claude Code the stack, the folder owners, and the rules (never push to `main`, never commit keys).
- Done when: Both Claude Code sessions read the same file.

*Then split up and work on your own lists. Come back together for T4 when phase 1 is built.*

**T4. Test with 10 students**
- Type: User test, no code
- Where it runs: Real students using the live web app
- Tools: The web app, plus a simple sheet to record results
- What it means: Find 10 students with an exam within 2 weeks. They use the web app. Watch what breaks and what they skip.
- Done when: You know how many of the 10 finished at least 5 of 7 daily sessions, and you have a list of the top 5 problems.
- Needs first: all phase 1 tasks of Dev A and Dev B

### Dev A: behind the screen

**Focus: everything behind the screen.** The repo, the database, hosting, the study schedule, reading the syllabus, making questions, sending to the calendar, the live quiz server, and later the phone builds and alarms. Mostly logic and server code.

**Phase 1: web app**

**A1. Set up the repo** DONE
- Status: Done 2026-10-05, merged into `main`. Expo app, shared package, Supabase folder, npm workspace, scripts, `.gitignore`, `.env.example`. Supabase command-line tool is linked to the project on Dev A's computer.
- Type: Project setup (folders and settings)
- Where it runs: The GitHub repo
- Tools: Git, GitHub (branch protection), Expo, npm workspaces
- What it means: Start the one Expo project that becomes both the web app and the phone app. Create the folders: `apps/app` (the one app for web and phone), `packages/shared` (data shapes and schedule code), `supabase` (database and server code). Protect `main` so changes only arrive by pull request.
- Done when: Dev B can clone, install, and see the empty app in a browser.
- Needs first: T1

**A2. Create the database tables** DONE
- Status: Done 2026-10-05, merged into `main`. 16 tables with Row Level Security applied to the live project with `supabase db push`. Two-user test passed: one user cannot read another's exam; profiles are created by trigger. The T1 proposal for Dev B is in `packages/shared/README.md`.
- Type: Database tables and access rules
- Where it runs: Server
- Tools: Supabase Postgres database, SQL migration files, Supabase Row Level Security
- What it means: Turn the agreed data shapes into real tables in Supabase, with rules so each student sees only their own data.
- Done when: Tables exist, a test row can be saved and read back, and one test user cannot read another's row.
- Needs first: T1, A1

**A3. Put the web app online** PARTIALLY
- Status: App shell, theme, homepage, placeholder screens and EAS deploy files are merged into `main` (2026-10-05). Left: Dev A logs in to Expo, runs `eas init` and the first `eas deploy --prod`, and connects the GitHub repo in the Expo dashboard (base directory `apps/app`). See `apps/app/README.md`, Deployment.
- Type: Deployment setup (settings, no product code)
- Where it runs: The web host
- Tools: Expo hosting (EAS Hosting), Expo workflows, GitHub
- What it means: Connect the repo to Expo hosting so that every change merged into `main` goes live by itself. Dev A does this because Dev A owns the repo and holds the production keys. From here on there is always a real web address to test on.
- Done when: The empty app opens at a public web address, and a merged change shows up there without anyone uploading by hand.
- Needs first: A1, B1

**A4. Syllabus reader (server part)**
- Type: Server function (an API)
- Where it runs: Server
- Tools: Supabase Edge Function, Claude API
- What it means: Server code that takes the text of an uploaded syllabus and asks the AI for the exam and quiz dates and the topics for each. It returns a list of proposals. It saves nothing by itself. If it finds no dates, it says so and never guesses. Dev B builds the screen that shows the list (B5).
- Done when: A real syllabus returns the right dates and topics, and a file with no dates returns a clear "no dates found" answer.
- Needs first: B4 (it reuses how text is pulled out of an uploaded file)

**A5. Schedule engine**
- Type: Code function (pure logic) with automatic tests
- Where it runs: Shared code, run by the server
- Tools: TypeScript, Vitest (test runner), Supabase database to save the plan
- What it means: Plain code (no AI) that takes exam dates and topics and returns a list of dated study sessions. Sessions get closer together as the exam gets near. Each session has 5 to 7 questions. The plan is saved on the server so web and phone show the same one.
- Done when: Given "exam in 14 days", it returns a plan ending on exam day. Tests cover: exam tomorrow, exam in 3 months, two exams in the same week, exam already past.
- Needs first: T1 (the agreed data shapes)

**A6. Question maker**
- Type: Server function (an API)
- Where it runs: Server
- Tools: Supabase Edge Function, Claude API, Supabase database
- What it means: Server code that sends note text to Claude and gets back questions. Every question must point to the exact piece of note it came from. Code then checks that piece really exists.
- Done when: 10 pages of notes produce at least 20 questions, each with a working link to its source text. Questions without a real source are thrown away.
- Needs first: B4 (real notes to read)

**A7. Send to calendar**
- Type: Server function (a calendar link) plus a button in the app
- Where it runs: Server, with one button in the app
- Tools: Supabase Edge Function, the iCalendar (`.ics`) format, Expo
- What it means: The student adds their Cramrade sessions and exam dates to their Google or Apple calendar. Cramrade only sends. It never reads the calendar.
- Done when: On a test account, sessions and exam dates show up in Google Calendar and in Apple Calendar.
- Needs first: A5

**A8. Quiz server**
- Type: Server functions (APIs) plus a live channel
- Where it runs: Server
- Tools: Supabase Edge Functions, Supabase Realtime, Supabase database
- What it means: The live game: create a room, hand out a join link, send each question to everyone at the same time, run the timer, count the score. Questions go out through Supabase's live messaging. The server writes down when each question started and scores every answer against that time, so nobody can cheat.
- Done when: 5 browsers join one room, play 5 questions, and all show the same final scores.
- Needs first: A6

**Phase 2: phone app**

**A9. First phone build**
- Type: App build (an installable Android app)
- Where it runs: Phone
- Tools: Expo EAS Build, a real Android phone
- What it means: Turn the same code into an Android app and install it on a real phone.
- Done when: The app opens on an Android phone, sign-in works, and the schedule and study screens work as on the web.
- Needs first: T4

**A10. Alarms and notifications**
- Type: Phone feature (code inside the app)
- Where it runs: Phone app only
- Tools: Expo notifications
- What it means: The phone shows a notification when a session is due, even if the app is closed. Only the next two weeks are set at a time (iPhone allows 64 at once), and they refresh each time the app opens.
- Done when: A reminder fires within a few minutes of its time on a real Android phone with the app closed.
- Needs first: A9

**A11. iPhone build**
- Type: App build (an installable iPhone app)
- Where it runs: Phone
- Tools: Expo EAS Build, Apple Developer account, a real iPhone
- What it means: Buy the Apple developer account, build the iPhone app, and check camera and reminders on a real iPhone.
- Done when: The app runs on a real iPhone and B10, B11 and A10 pass there too.
- Needs first: A10, B11

**A12. Cited lesson**
- Type: Server function (an API) plus a screen
- Where it runs: Server, with one screen in the app
- Tools: Supabase Edge Function, Claude API, Expo
- What it means: A 5 to 10 minute explanation of one topic where every sentence links to the note it came from.
- Done when: A lesson shows only sentences whose source was verified by code.
- Needs first: A6

### Dev B: on the screen

**Focus: everything the student sees and taps.** Sign-in, the exam screen, file upload, the syllabus confirm screen, the schedule screen, the study screen, the quiz screens, and later the camera.

**Phase 1: web app**

**B1. Web trial** PARTIALLY
- Status: During A1 the Expo web version was started in a browser and built for hosting, so the basics work. Still to test: uploading a PDF and a wide full-screen layout.
- Type: Trial (a throwaway test page and a short written result)
- Where it runs: Web
- Tools: Expo web, Chrome
- What it means: We chose one codebase for web and phone (Expo). Before building on it, check its web version can do the two web-only jobs: upload a PDF, and show a wide full-screen layout for hosting a quiz. **This is the most important early task.** If it fails, the web app is built separately with Next.js.
- Done when: A test page in Chrome uploads a PDF and shows a full-width screen. A short note says "works" or "does not work, because".
- Needs first: A1

**B2. Sign-in**
- Type: App screens (sign-up page and log-in page)
- Where it runs: Web app and phone app
- Tools: Expo, Supabase Auth (email sign-in)
- What it means: Let a student create an account and log in, using Supabase sign-in.
- Done when: A new user can sign up in a browser, close the tab, come back, and still be logged in.
- Needs first: A1, T2

**B3. Exam screen**
- Type: App screen (a page)
- Where it runs: Web app and phone app
- Tools: Expo (React Native), Supabase database
- What it means: A screen where the student types an exam or quiz name and picks its date.
- Done when: An exam can be added, edited, deleted, and is still there after reloading.
- Needs first: A2, B2

**B4. File upload**
- Type: Part of a page (upload button) plus a server function
- Where it runs: Web app and phone app, with the text work on the server
- Tools: Expo document picker, Supabase Edge Function, Supabase database
- What it means: A button to pick Word, PDF, text or Markdown files from the computer. The server pulls the text out and throws the file itself away.
- Done when: Uploading a PDF and a Word file results in readable text saved as Notes.
- Needs first: B2

**B5. Syllabus confirm screen**
- Type: App screen (a page)
- Where it runs: Web app and phone app
- Tools: Expo, Supabase database
- What it means: The student uploads a syllabus with the same upload button as for notes. The screen then lists the exam dates and topics the AI found. The student confirms or fixes each one, and only then are they saved as exams. If nothing was found, the screen says so and opens the exam screen for typing them in.
- Done when: A real syllabus leads to a list the student can fix and confirm, and the confirmed exams appear on the exam screen.
- Needs first: B3, B4, A4 (use a fake list until it is ready)

**B6. Schedule screen**
- Type: App screen (a page)
- Where it runs: Web app and phone app
- Tools: Expo, Supabase database
- What it means: A screen showing the plan: which sessions are today, which are coming, and which exam each belongs to.
- Done when: The plan from A5 shows correctly and updates when an exam date changes.
- Needs first: A5 (use a fake plan until it is ready)

**B7. Study screen**
- Type: App screen (a page)
- Where it runs: Web app and phone app
- Tools: Expo, Supabase database
- What it means: One screen used two ways. Scheduled: today's session of 5 to 7 questions. On demand: the student starts flashcards or a quick quiz whenever they want. Shows right or wrong, and a "show me where this is in my notes" button.
- Done when: A scheduled session and an on-demand review can both be played with real questions, and results are saved.
- Needs first: A6 (use fake questions until it is ready)

**B8. Host and play screens**
- Type: Two app screens (host page and play page)
- Where it runs: Host page: web only. Play page: web app and phone app
- Tools: Expo, Supabase Realtime, Supabase Auth (guest sign-in)
- What it means: The host screen (question, timer, scoreboard) for a computer. The play screen where a classmate opens the link, picks a nickname and answers. Guests need no account and no install.
- Done when: A person with only a browser joins and finishes a quiz. A player who drops out can rejoin and keep their score.
- Needs first: A8

**B9. Handwriting trial**
- Type: Trial (a written result, no product code)
- Where it runs: A phone and a computer
- Tools: Phone camera, the phone's built-in text reader (Google ML Kit, Apple Vision), Claude API (vision)
- What it means: Take 20 photos of real student notes (handwritten and printed, in the languages your users write in). Try the phone's built-in text reader and Claude's vision on each. This decides how the camera feature is built and what each page costs.
- Done when: A one-page result: correct pages out of 20 for each method, and seconds per page.
- Needs first: nothing, can start any time in phase 1

**Phase 2: phone app**

**B10. Multi-photo capture**
- Type: Phone screen (camera page)
- Where it runs: Phone app only
- Tools: Expo camera
- What it means: A camera screen where the student takes many photos in a row, sees small previews, can delete a bad one, then presses Submit once. Nothing is processed before Submit.
- Done when: 10 photos can be taken, one removed, and 9 submitted together. Nothing appears in the phone's gallery.
- Needs first: A9

**B11. Photo to text, then delete**
- Type: Phone feature plus a server function
- Where it runs: Phone app, with handwriting read on the server
- Tools: The reader chosen in B9, Supabase Storage (temporary), Supabase Edge Function
- What it means: After Submit, turn each photo into text using the method B9 picked. Then delete every photo from the phone (and from the server if it went there). Unclear words are marked for the student to fix. Nothing is invented.
- Done when: 10 photos become text in under 1 minute, and a check confirms zero photos remain.
- Needs first: B9, B10

**B12. Tester group**
- Type: Store setup, no code
- Where it runs: Google Play
- Tools: Google Play Console
- What it means: Sign up 12 testers for the Google Play closed test and keep them in for 14 days in a row. Google requires this for new accounts before public release.
- Done when: 12 testers opted in for 14 unbroken days.
- Needs first: A9

### Where the two lists meet

- **A2 and B3:** Dev B's exam screen saves exams into the tables Dev A made.
- **A4 and B5:** Dev B's confirm screen shows the dates Dev A's syllabus reader found.
- **A5 and B6:** Dev B's schedule screen shows Dev A's plan.
- **B4 and A6:** Dev A's question maker reads the notes Dev B's upload saved.
- **A6 and B7:** Dev B's study screen shows the questions Dev A made.
- **A8 and B8:** Dev B's quiz screens talk to Dev A's quiz server. Agree on the messages between them before either starts.
- **A9 and B10:** Dev A's first phone build must exist before Dev B starts the camera.

Timing: phase 1 is about 4 weeks of full-time work. Phase 2 is not estimated yet. Part-time, everything takes longer. These are guesses, not promises.

---

## Part 2: How the app is built and how it works

**The pieces**

- **One app, three outputs:** the same code becomes the web app, the Android app and the iPhone app.
- **Web app:** upload files and the syllabus, see the schedule, study, host and play group quizzes, send sessions to a calendar.
- **Phone app:** everything above except hosting, plus photographing paper notes and alarms.
- **Server (Supabase):** the one "brain" both talk to. It stores data, calls the AI, and runs the live quiz.
- **AI (Claude):** reads the syllabus, writes questions, and later lessons. It never decides the schedule and never adds to the notes.

**The flow, step by step**

- The student signs in.
- The student types exam dates or uploads a syllabus. For a syllabus, the AI proposes dates and topics and the student confirms them.
- The student adds notes: uploads files on the computer, or takes photos on the phone and presses Submit.
- Files and photos are turned into text. The files and photos are deleted. Only text is kept.
- The note text is cut into small numbered pieces ("chunks").
- The server asks Claude to write questions from those chunks. Each question carries the number of the chunk it came from.
- Code checks each question's source really exists in that chunk. Failures are dropped.
- The schedule engine places 5 to 7 question sessions on dates between today and each exam. The plan is saved on the server.
- The sessions are sent to the student's calendar. The phone app also sets its own alarms.
- The student plays the day's session, or starts a review any time, and can open the source note for any question.
- For a group quiz, the host creates a room on the web and shares a link. Classmates join in a browser or the phone app. The server sends questions, runs the timer, and keeps score.

**Rules that never change**

- No scanning the device for files. The student always picks them.
- The AI never adds content to the notes.
- A date found by the AI is never saved until the student confirms it.
- Photos never reach the gallery and never stay after Submit.
- Cramrade sends to the calendar. It never reads it.
- Note text does leave the device (to our server and to Claude). The app must tell the student this plainly.

---

## Part 3: Technology and hosting

**TypeScript**
- What it is for: One language for the app and the server, so both developers can read all the code.
- Cost: Free

**Expo (React Native)**
- What it is for: The one codebase that becomes the web app, the Android app and the iPhone app. Its cloud service makes the installable phone app files.
- Cost: Free plan: 15 Android + 15 iOS builds a month

**Web hosting: Expo hosting (EAS Hosting)**
- What it is for: Puts the web app on the internet. Made for Expo web apps, uses the same Expo account as the phone builds, and can deploy by itself when `main` changes. Vercel is only the fallback if the web trial (B1) fails and the web app moves to Next.js.
- Cost: Free plan to start (hosting limits not checked). A custom domain needs a paid Expo plan.

**Supabase: Postgres database**
- What it is for: Stores all the data.
- Cost: Already paid (your Supabase plan)

**Supabase Auth**
- What it is for: Sign-up and log-in on web and phone, and guest access for quiz players.
- Cost: Included

**Supabase Realtime**
- What it is for: Sends quiz questions and scores to every player at the same moment.
- Cost: Included, with usage limits (not checked for the paid plan)

**Supabase Edge Functions**
- What it is for: The server code: reads the syllabus, pulls text out of files, makes questions, scores quiz answers, builds the calendar feed.
- Cost: Included, with usage limits

**Supabase Storage**
- What it is for: Holds a handwritten photo for a few seconds while the AI reads it, then it is deleted.
- Cost: Included

**Claude API**
- What it is for: Reads the syllabus, writes the questions and lessons, and reads handwriting if the trial says the phone cannot.
- Cost: Pay per use. Cost per student not yet measured.

**Google Play** (phase 2)
- What it is for: Where Android users download the app. New accounts need a 12-tester, 14-day closed test first.
- Cost: One-time fee (price not checked)

**Apple App Store** (phase 2)
- What it is for: Where iPhone users download the app. A paid developer account is needed even to test on a real iPhone when building from Windows.
- Cost: Yearly fee (price not checked)

**GitHub**
- What it is for: Holds the code, the task list (Issues), and pull requests.
- Cost: Free

### Why Supabase

You pay for both Supabase and Neon. Use **Supabase only**:

- **Sign-in on the phone is proven.** Supabase officially supports Expo apps.
- **The live quiz needs less code.** Supabase has live messaging built in, so there is no connection server to write and run.
- **One backend, not two.** Splitting data across two databases means double the setup, keys and bills, and it solves nothing.

Limits to design around ([Supabase docs](https://supabase.com/docs/guides/functions/limits)):

- A server function on a paid plan can run for at most 400 seconds, and must start answering within 150 seconds. That is enough for making questions from a few pages at a time. Large uploads must be processed in batches, not in one call.
- Each call gets 2 seconds of actual computing time (waiting for the AI does not count) and 256 MB of memory. Pulling text out of a very large PDF may not fit. If it does not, that one job moves to another host.

## Open questions

1. Are your students' notes mostly handwritten or typed, and in which language?
2. How many hours a week can each of you work on this?
3. Which phones do you two own (Android, iPhone), and does either of you have a Mac?
4. Should the repo stay public?
