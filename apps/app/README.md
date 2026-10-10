# Cramrade app

The one Expo app that becomes the web app, the Android app and the iPhone app. Cramrade takes a student's exam dates and their own notes, builds a study plan that ends on exam day, reminds them, quizzes them from their notes, and lets a study group play a live quiz.

Project rules, who owns what, and the task list are in the repo's top folder: `CLAUDE.md`, `split_work.md`, `project-initialize.md`. Expo's own rules for AI tools are in `AGENTS.md` here.

## Run it

From the repo's top folder:

```sh
npm install
npm run web          # dev server at http://localhost:8081
npm run typecheck
```

From this folder:

```sh
npx expo install <package>          # add a dependency, never plain npm install
npx expo export --platform web      # production web build into dist/
```

Copy `.env.example` to `.env` and fill in the two Supabase values. Never commit `.env`.

## Where things are

- `src/app/`: one file per screen (Expo Router). Screens stay thin and only put pieces together.
  - `_layout.tsx`: the app shell. Loads the fonts, picks light or dark, holds the sign-in state, draws the top bar.
  - `index.tsx`: the public homepage.
  - `sign-in.tsx`: sign in or create an account. A signed-in student sees their account and can sign out. `?mode=create` opens the create-account form.
  - `workspace.tsx`: placeholder. See below.
- `src/components/frame/`: the shell pieces. Top bar, wordmark, page body with footer, section, content column, page title.
- `src/components/home/`: the homepage sections. Hero with the day strip, how it works, what makes it different, closing.
- `src/components/ui/`: `AppText` (the only text component), `LinkButton` (moves to another screen), `Button` (does something on this screen) and `TextField` (a labelled input).
- `src/features/auth/`: sign-in. `AuthProvider` and `useAuth()` give any screen the current session; `auth-actions.ts` signs in, signs up and signs out, and turns Supabase errors into plain sentences.
- `src/lib/`: the Supabase client. `supabase.ts` is for phones (session kept with expo-sqlite), `supabase.web.ts` for the browser (session kept in localStorage, nothing kept during the build-time render). Without the two `.env` values the app still runs and the sign-in page says it is not connected.
- `src/constants/theme.ts`: every color, font, size, spacing and radius. Change the look here, not in screens. `DESIGN.md` explains the choices.
- `src/hooks/`: `useTheme` (colors for the current scheme), `useLayout` (phone or wide), `useColorScheme`.
- `src/global.css`: web-only base styles, including the keyboard focus ring.
- `assets/images/`: app icon, favicon, splash image and Android icon layers. All generated from the same mark (the day strip in miniature).

Fonts come from `@expo-google-fonts/bricolage-grotesque` (headlines) and `@expo-google-fonts/atkinson-hyperlegible` (everything else), loaded with `useFonts` in `_layout.tsx`. In Expo SDK 57 each weight is its own font family name, so text styles pick a family and never set `fontWeight`.

One thing that bites: a child of `<Link asChild>` must get a single flat style object. Link merges styles with an object spread, so a style array throws and a style function is silently dropped. `LinkButton` and the top bar show the pattern.

## Placeholders for Dev B

One route exists so the navigation works, but holds no real feature yet. Replace the whole file, keep the route name:

- `src/app/workspace.tsx`: becomes the signed-in area with exams, notes, schedule and study (tasks B3 to B7). It already asks signed-out visitors to sign in.

It renders `src/components/frame/placeholder.tsx`, which can be deleted once the workspace is real.

## Deployment (Dev A)

The web app is hosted on EAS Hosting. `eas.json` and `.eas/workflows/` are set up; the Expo project itself is created on first use.

One-time setup, from this folder:

```sh
npx eas-cli@latest login
npx eas-cli@latest init                       # creates the Expo project and writes extra.eas.projectId into app.json
npx expo export --platform web
npx eas-cli@latest deploy --prod              # first deploy, choose the preview subdomain "cramrade"
```

Then connect GitHub so the workflows run by themselves: in the Expo dashboard open the project, Settings, GitHub, install the GitHub app, pick this repo, and set the base directory to `apps/app` (the project is in a subfolder of the repo).

After that:

- `.eas/workflows/deploy.yml` puts every change merged into `main` live.
- `.eas/workflows/pr-preview.yml` gives every pull request its own preview address and posts the link on the PR.

Check the workflow files with `npx eas-cli@latest workflow:validate .eas/workflows/deploy.yml` once the project exists, and run one by hand with `npx eas-cli@latest workflow:run .eas/workflows/deploy.yml`.
