# Cramrade: project setup and folder structure

Part 1 is the commands to set the project up. Part 2 is the folder map.

- **Dev A** runs "One-time setup" once, to create the project and push it.
- **Dev B** (and Dev A on a new computer) runs "Join the project" to get it running.

Run every command from the repo's top folder unless a step says otherwise.

---

## Part 1: Setup commands

### Install these first (both developers)

- **Git**: https://git-scm.com
- **Node.js** (the LTS version): https://nodejs.org
- **pnpm**, the package manager:

```sh
npm install -g pnpm
```

Check they work:

```sh
git --version
node --version
pnpm --version
```

### One-time setup (Dev A only)

**1. Get the repo**

```sh
git clone https://github.com/BennguyenEHK/Cramrade-.git
cd Cramrade-
```

**2. Make it a workspace** (one repo holding several packages)

```sh
pnpm init
```

Create a file named `pnpm-workspace.yaml` with:

```yaml
packages:
  - 'apps/*'
  - 'packages/*'
```

**3. Create the Expo app** (this generates the app's folders)

```sh
pnpm create expo-app apps/app
```

**4. Add the Supabase client to the app**

```sh
cd apps/app
npx expo install @supabase/supabase-js react-native-url-polyfill expo-sqlite
cd ../..
```

**5. Create the shared package** (data shapes and schedule engine)

```sh
mkdir -p packages/shared/src/types packages/shared/src/schedule
cd packages/shared
pnpm init
pnpm add -D typescript vitest
cd ../..
```

In `packages/shared/package.json`, set the name to `@cramrade/shared`.

**6. Create the Supabase folder and connect it to the real project**

```sh
npx supabase init
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
```

`YOUR_PROJECT_REF` is in the Supabase dashboard under Project Settings.

**7. Set up the keys file**

Create `apps/app/.env.example` (this one is committed, with empty values):

```
EXPO_PUBLIC_SUPABASE_URL=
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
```

Copy it to `apps/app/.env` and fill in the real values from the Supabase dashboard. Make sure `.gitignore` in the top folder contains:

```
node_modules
.env
.env.*
!.env.example
.expo
dist
```

**8. Install everything and check it runs**

```sh
pnpm install
cd apps/app
npx expo start --web
```

The empty app should open in the browser.

**9. Push it**

```sh
git checkout -b a1-repo-setup
git add .
git commit -m "Set up Expo app, shared package and Supabase folder"
git push -u origin a1-repo-setup
```

Then open a pull request on GitHub.

### Join the project (Dev B, or any new computer)

```sh
git clone https://github.com/BennguyenEHK/Cramrade-.git
cd Cramrade-
pnpm install
```

Copy `apps/app/.env.example` to `apps/app/.env`. Ask Dev A for the two values and paste them in. Never send keys through the repo.

```sh
cd apps/app
npx expo start --web
```

### Everyday commands

**Start a task** (one task = one branch):

```sh
git checkout main
git pull
git checkout -b b3-exam-screen
```

**Run the web app** (from `apps/app`):

```sh
npx expo start --web
```

**Run the tests of the shared package** (from `packages/shared`):

```sh
pnpm vitest run
```

**Finish a task:**

```sh
git add .
git commit -m "Short description of what changed"
git push -u origin b3-exam-screen
```

Then open a pull request for the other developer to review.

### Server commands (Dev A)

**New database change:**

```sh
npx supabase migration new create_tables
```

Write the SQL in the file it creates under `supabase/migrations/`, then send it to the real database:

```sh
npx supabase db push
```

**New server function:**

```sh
npx supabase functions new make-questions
```

**Put a server function online:**

```sh
npx supabase functions deploy make-questions
```

**Store a secret for server functions** (for example the Claude API key):

```sh
npx supabase secrets set ANTHROPIC_API_KEY=your-key-here
```

### Not verified yet

- The exact folders the Expo generator creates differ between Expo versions (the screens folder may be `app/` or `src/app/`). Keep what it generates.
- With an Expo version older than SDK 54, add the line `nodeLinker: hoisted` to `pnpm-workspace.yaml`.
- Supabase server functions run on Deno, a different runtime from the app. Importing `packages/shared` into a server function has not been tested. If it is awkward, the schedule code moves to `supabase/functions/_shared/`.
- Commands for building the phone app (phase 2) are not listed yet.

---

## Part 2: Folder structure

```
Cramrade/
├─ CLAUDE.md, split_work.md, project-initialize.md, README.md
├─ package.json, pnpm-workspace.yaml, .gitignore
│
├─ apps/app/                  ← the Expo project (generated)
│  ├─ app/                    ← screens only, kept thin
│  │  ├─ _layout.tsx
│  │  ├─ (auth)/              sign-in, sign-up
│  │  ├─ (main)/              schedule (home), exams, notes, study
│  │  └─ quiz/                host/[roomId], play/[roomId]
│  ├─ features/               ← the real code, one folder per feature
│  │  ├─ exams/  notes/  schedule/  study/  quiz/
│  │  └─ capture/  reminders/         (phone only, phase 2)
│  ├─ components/             ← shared buttons, cards, inputs
│  ├─ lib/                    ← Supabase client, settings
│  ├─ assets/
│  └─ .env.example
│
├─ packages/shared/           ← no screens, no internet
│  └─ src/
│     ├─ types/               the data shapes (Exam, Note, Question…)
│     └─ schedule/            the schedule engine and its tests
│
├─ supabase/                  ← generated by `supabase init`
│  ├─ migrations/             database tables and access rules
│  └─ functions/              one folder per server function
│     ├─ read-syllabus/  extract-text/  make-questions/
│     ├─ score-answer/  calendar-feed/
│     └─ _shared/             code several functions use
│
└─ docs/
```

### How to read it

- **Files in `app/` are screens.** Each file becomes a screen and a web address, like in Next.js. `app/(main)/exams/index.tsx` is the page at `/exams`.
- **`_layout.tsx`** wraps all the screens in its folder (shared header, navigation).
- **`[roomId]`** in a file or folder name is a part of the address that changes, like the room number of a quiz.
- **Folders in brackets like `(auth)`** group screens without changing the address.
- **`.web.tsx` and `.native.tsx`**: a file ending in `.web.tsx` is used only on the web, `.native.tsx` only on phones. The quiz host screen is web only. The camera is phone only.
- **Screens stay thin.** A file in `app/` only puts a screen together. The real code lives in `features/`.

### Who owns what

- **Dev B:** `apps/app` (screens, features, components).
- **Dev A:** `packages/shared`, `supabase/`, deployment settings, and `apps/app/features/reminders/` (the alarm code).
- **Both must agree:** any change to `packages/shared/src/types/`.
