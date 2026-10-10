# Server functions (Supabase Edge Functions)

All server code for Cramrade. Each folder is one function, reachable at
`https://ialkxvoytoqfuxxnzlaa.supabase.co/functions/v1/<folder name>`.
Functions go live by themselves when a pull request is merged into `main`.

## Folders

- `_shared/`: code several functions use.
  - Pure files (`chunking.ts`, `quote-check.ts`, `template.ts`, `gemini.ts`, `http.ts`, `extraction.ts`) use no Deno-only feature, so `npm test` at the top of the repo tests them with vitest. Keep it that way: no `Deno.` and no `npm:` imports in these.
  - Deno files (`db.ts`, `auth.ts`, `ai.ts`, `invoke.ts`) read secrets and talk to the database. They are not unit tested; the hand tests below exercise them.
  - `prompts/`: one Markdown file per AI job, with `{{placeholders}}`. Each task that adds an AI job adds its prompt file here.
- The quote rule: `quoteAppears` in `_shared/quote-check.ts` and the database trigger `private.verify_question` both collapse runs of spaces, tabs and line breaks to one space and trim the ends before looking for the quote. Change one, change the other.
- `extract-text/`: turns an uploaded file into chunks of text (task A4a).
- `_fixtures/`: sample files and a script for testing by hand.

## Secrets

The functions need two secrets of our own. Supabase gives every function `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` by itself.

- `GEMINI_API_KEY`: the Gemini API key from Google AI Studio.
- `GEMINI_MODEL`: which Gemini model to use. Leave it unset for `gemini-2.5-flash`.

Set them once on the live project (Dev A, from the top folder of the repo, after `npx supabase login` and `npx supabase link`):

```sh
npx supabase secrets set GEMINI_API_KEY=your-key-here
npx supabase secrets set GEMINI_MODEL=gemini-2.5-flash
npx supabase secrets list
```

`supabase/functions/.env.example` lists the same names with empty values. A real `.env` file is never committed.

## Prompt files must ship with their function

A function that calls `askGemini` reads its prompt from `_shared/prompts/`. Add this to `supabase/config.toml` for that function, or the file will be missing when it runs:

```toml
[functions.make-questions]
verify_jwt = true
static_files = ["./functions/_shared/prompts/*.md"]
```

If the files still do not arrive after a deploy (the function fails with "No such file"), fall back to `prompts/<name>.ts` files that export the same text as a string, one file per prompt, and change `loadPrompt` in `ai.ts` to import them.

## Calling a function by hand

Every function except the calendar feed needs a signed-in user's access token. Sign in with a test account to get one:

```sh
SB=https://ialkxvoytoqfuxxnzlaa.supabase.co
KEY=sb_publishable_...   # EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY from apps/app/.env

curl -s "$SB/auth/v1/token?grant_type=password" -H "apikey: $KEY" -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"..."}'
# copy access_token from the answer
TOKEN=eyJ...

curl -s -X POST "$SB/functions/v1/extract-text" -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{"noteId":"<note id>"}'
```

Errors always look like `{"error":{"code":"not_yours","message":"That note belongs to someone else."}}`, with status 400, 401, 403, 404, 409, 500 or 502 (the AI failed). A call with no token at all is refused by Supabase before our code runs, with its own 401 body.

For extract-text, `_fixtures/try-extract.sh` does the whole round trip (sign in, create a note, upload, call, check the file is gone). See `_fixtures/README.md`.

## Type-checking the functions (optional)

Only if Deno is already installed (do not install it just for this). Keep its download cache on D: inside the repo's ignored `.local-deps` folder:

```sh
DENO_DIR=.local-deps/deno deno check --node-modules-dir=none supabase/functions/extract-text/index.ts
```

Do not point it at the `*.test.ts` files: those are for vitest.

## Logs

Supabase dashboard, Edge Functions, pick the function, Logs. `console.error` lines from the code show up there.

## Hand test: read-syllabus (A4)

What it checks: a syllabus with two exam dates gives exactly those two dates, each with a sentence copied from the file, and a syllabus with no dates gives `{ "found": false, "proposals": [] }`. The script also checks that a quiz given only as "Week 7", an assignment date and a "finals week" range are not reported.

One-time setup:

1. Make a test student: in the Supabase dashboard, Authentication, Users, "Add user", with an email and password, and tick "Auto confirm". For a local stack, sign up through the app instead.
2. Create `supabase/functions/_handtests/.env` (it is ignored by git) with:

   ```
   SUPABASE_URL=https://<project-ref>.supabase.co
   SUPABASE_ANON_KEY=<publishable key from the dashboard, API settings>
   TEST_EMAIL=<test student email>
   TEST_PASSWORD=<test student password>
   ```

Run from the repo root:

```sh
node --env-file=supabase/functions/_handtests/.env supabase/functions/_handtests/read-syllabus.mjs
```

It prints both answers and ends with `read-syllabus hand test passed`. It deletes the notes it made. The AI's titles and topic wording can vary between runs; the dates, the number of proposals and the copied sentences cannot.
