# Cramrade: project setup and folder structure

Part 1 is the commands to get the project running. Part 2 is the folder map.

The project is already created (task A1). To work on it you only need "Install these first" and "Join the project".

Run every command from the repo's top folder unless a step says otherwise.

---

## Part 1: Setup commands

### Install these first (both developers)

- **Git**: https://git-scm.com
- **Node.js** version 22 or newer: https://nodejs.org

npm comes with Node.js. Nothing else needs installing: Expo, the Supabase tool and the test runner are all downloaded into the project by `npm install`.

Check they work:

```sh
git --version
node --version
npm --version
```

### Join the project (Dev B, or any new computer)

```sh
git clone https://github.com/BennguyenEHK/Cramrade-.git
cd Cramrade-
npm install
```

Copy `apps/app/.env.example` to `apps/app/.env`. Ask Dev A for the two values and paste them in. Never send keys through the repo.

Then start the web app:

```sh
npm run web
```

It opens in the browser at `http://localhost:8081`.

If `npm install` or the tests fail with "Cannot find native binding", that is a known npm bug. Fix it with:

```sh
rm -rf node_modules package-lock.json
npm install
```

### If your C: drive is full (optional, Windows)

npm keeps a download cache on C: by default. To keep it inside the project folder instead, create a file named `.npmrc` in the repo's top folder with one line, using your own path:

```
cache=D:/dev/Startup/.local-deps/npm-cache
```

Both `.npmrc` and `.local-deps` are ignored by git, so this stays on your computer only and changes nothing for other projects.

### Everyday commands

**Start a task** (one task = one branch):

```sh
git checkout main
git pull
git checkout -b b3-exam-screen
```

**Run the web app:**

```sh
npm run web
```

**Check the code for type mistakes:**

```sh
npm run typecheck
```

Run the web app at least once first. The first start creates a small file the check needs.

**Run the tests** (shared package):

```sh
npm test
```

**Run one test file:**

```sh
npx vitest run packages/shared/src/schedule/some-file.test.ts
```

**Add a package to the app** (from `apps/app`, always with `expo install` so the version matches Expo):

```sh
npx expo install package-name
```

**Finish a task:**

```sh
git add .
git commit -m "Short description of what changed"
git push -u origin b3-exam-screen
```

Then open a pull request for the other developer to review.

### Server commands (Dev A)

Database changes and server functions go live by themselves when `main` changes. Supabase is connected to the GitHub repo with "Deploy to production" switched on, so nobody runs `db push` by hand.

**Connect to the real Supabase project** (once per computer, opens the browser):

```sh
npx supabase login
npx supabase link --project-ref ialkxvoytoqfuxxnzlaa
```

**New database change:**

```sh
npx supabase migration new add_something
```

Write the SQL in the file it creates under `supabase/migrations/`, open a pull request, and merge it. The merge applies it to the real database at once, and there is no test copy, so read it carefully first.

**New server function:**

```sh
npx supabase functions new make-questions
```

It goes online when the pull request is merged.

**Store a secret for server functions** (for example the Claude API key):

```sh
npx supabase secrets set ANTHROPIC_API_KEY=your-key-here
```

**Sign-in settings** (site address, allowed redirect addresses, guest sign-in, email confirmation) are changed in the Supabase dashboard under Authentication. The same settings in `supabase/config.toml` only affect a local test stack.

### Web hosting commands (Dev A)

The web app is hosted on Expo hosting (EAS Hosting). Run these from `apps/app`.

**Log in to Expo** (once):

```sh
npx eas-cli@latest login
```

**Put the web app online by hand:**

```sh
npx expo export --platform web
npx eas-cli@latest deploy
```

The command prints a preview address. Add `--prod` to the second command to update the live site.

The web app also deploys by itself when `main` changes, through the workflow in `apps/app/.eas/workflows/deploy.yml`. Each pull request gets a preview address.

### How the project was created (for the record)

Dev A ran these once. Nobody needs to run them again.

```sh
npx create-expo-app@latest apps/app --no-install
npm install
npm install -D supabase
npm install -D typescript vitest -w @cramrade/shared
cd apps/app && npx expo install @supabase/supabase-js react-native-url-polyfill expo-sqlite
npx supabase init
```

The top-level `package.json` lists `apps/*` and `packages/*` as npm workspaces, so one `npm install` at the top installs everything.

### What has been checked, and what has not

Checked on Windows on 2026-10-05:

- `npm install` works.
- The web app starts and answers in the browser (`npm run web`).
- The web app builds for hosting (`npx expo export --platform web`).
- `npm run typecheck` and `npm test` pass (there are no tests yet).

Not checked yet:

- `supabase functions new` and `supabase secrets set` have not been run on this project yet.
- The first automatic Supabase deploy from `main`.
- Running the project on Mac or Linux.
- Supabase server functions run on Deno, a different runtime from the app. Importing `packages/shared` into a server function has not been tested. If it is awkward, the schedule code moves to `supabase/functions/_shared/`.
- Commands for building the phone app (phase 2) are not listed yet.

---

## Part 2: Folder structure

Folders marked "exists" are in the repo now. The others are created by the task that needs them.

```
Cramrade/
├─ CLAUDE.md, split_work.md, project-initialize.md, README.md
├─ package.json, package-lock.json, .gitignore, .mcp.json
│
├─ apps/app/                  ← the Expo project (exists)
│  ├─ src/
│  │  ├─ app/                 ← screens only, kept thin (exists)
│  │  │  ├─ _layout.tsx
│  │  │  ├─ (auth)/           sign-in, sign-up
│  │  │  ├─ (main)/           schedule (home), exams, notes, study
│  │  │  └─ quiz/             host/[roomId], play/[roomId]
│  │  ├─ features/            ← the real code, one folder per feature
│  │  │  ├─ exams/  notes/  schedule/  study/  quiz/
│  │  │  └─ capture/  reminders/      (phone only, phase 2)
│  │  ├─ components/          ← shared buttons, cards, inputs (exists)
│  │  ├─ hooks/  constants/   ← from the Expo template (exist)
│  │  └─ lib/                 ← Supabase client, settings
│  ├─ assets/                 (exists)
│  ├─ AGENTS.md               ← Expo's own rules for AI coding tools (exists)
│  ├─ app.json                ← Expo settings (exists)
│  └─ .env.example            (exists)
│
├─ packages/shared/           ← no screens, no internet (exists)
│  └─ src/
│     ├─ index.ts
│     ├─ types/               the data shapes (Exam, Note, Question…)
│     └─ schedule/            the schedule engine and its tests
│
├─ supabase/                  ← made by `supabase init` (exists)
│  ├─ config.toml
│  ├─ migrations/             database tables and access rules
│  └─ functions/              one folder per server function
│     ├─ read-syllabus/  extract-text/  make-questions/
│     ├─ score-answer/  calendar-feed/
│     └─ _shared/             code several functions use
│
└─ docs/
```

The Expo template comes with two example screens (`src/app/index.tsx` and `src/app/explore.tsx`) and some example components. They are placeholders and get replaced as the real screens are built.

### How to read it

- **Files in `src/app/` are screens.** Each file becomes a screen and a web address, like in Next.js. `src/app/(main)/exams/index.tsx` is the page at `/exams`.
- **`_layout.tsx`** wraps all the screens in its folder (shared header, navigation).
- **`[roomId]`** in a file or folder name is a part of the address that changes, like the room number of a quiz.
- **Folders in brackets like `(auth)`** group screens without changing the address.
- **`.web.tsx` and `.native.tsx`**: a file ending in `.web.tsx` is used only on the web, `.native.tsx` only on phones. The quiz host screen is web only. The camera is phone only.
- **Screens stay thin.** A file in `src/app/` only puts a screen together. The real code lives in `src/features/`.
- **`@/`** at the start of an import means `apps/app/src/`.

### Who owns what

- **Dev B:** `apps/app` (screens, features, components).
- **Dev A:** `packages/shared`, `supabase/`, deployment settings, and `apps/app/src/features/reminders/` (the alarm code).
- **Both must agree:** any change to `packages/shared/src/types/`.
