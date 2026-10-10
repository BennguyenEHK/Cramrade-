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
- `extract-text/`: turns an uploaded file into chunks of text (task A4a, merged with Dev B's B4 upload). The app sends the file itself in the request; nothing goes to Storage. `parse.ts` is the only file that uses the PDF and Word libraries.
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

UPLOAD_ID=$(node -e "console.log(crypto.randomUUID())")
curl -s -X POST "$SB/functions/v1/extract-text" -H "Authorization: Bearer $TOKEN" -H "apikey: $KEY" \
  -F "file=@supabase/functions/_fixtures/typed-notes.txt;type=text/plain" \
  -F "uploadId=$UPLOAD_ID"
# optional fields: -F "examId=<exam id>"  -F "isSyllabus=true"
```

extract-text takes multipart/form-data, not JSON. Its fields:

- `file`: exactly one file, PDF, Word (.docx), .txt or .md, at most 20 MB.
- `uploadId`: a new UUID v4 made by the caller. It becomes the note's id. Sending the same one again does no new work and answers with the note as it is.
- `examId` (optional): an exam the caller owns.
- `isSyllabus` (optional): `true` or `false`, default `false`. A syllabus does not start make-questions.

Expected answers, all with status 200:

```json
{"noteId":"<uploadId>","status":"ready","chunks":10}
{"noteId":"<uploadId>","status":"failed","chunks":0,"reason":"no readable text, this looks like a scanned image"}
```

Errors always look like `{"error":{"code":"not_yours","message":"That exam is not yours."}}`, with status 400, 401, 403, 404, 409, 500 or 502 (the AI failed). A call with no token at all is refused by Supabase before our code runs, with its own 401 body.

For extract-text, `_fixtures/try-extract.sh` does the whole round trip (sign in, send the file, show the note row and its chunk count). See `_fixtures/README.md`.

## Type-checking the functions (optional)

Only if Deno is already installed (do not install it just for this). Keep its download cache on D: inside the repo's ignored `.local-deps` folder:

```sh
DENO_DIR=.local-deps/deno deno check --node-modules-dir=none supabase/functions/extract-text/index.ts
```

Do not point it at the `*.test.ts` files: those are for vitest.

## Logs

Supabase dashboard, Edge Functions, pick the function, Logs. `console.error` lines from the code show up there.

## calendar-feed (A7)

Sends a student's exams and planned study sessions to Google Calendar or Apple Calendar as a subscription link. It is public: the long random token in the link is the only key. Cramrade never reads the calendar. Test it on the live project after the pull request merges.

1. Give the test account a feed. If it has no plan yet, run the build-schedule test first, or add one exam and one session:

   ```sql
   with u as (select id from auth.users where email = 'schedule-test@example.com'),
   ex as (
     insert into public.exams (owner_id, title, exam_date)
     select id, 'Calendar test exam', current_date + 7 from u returning id, owner_id
   )
   insert into public.study_sessions (owner_id, exam_id, scheduled_for)
   select owner_id, id, (current_date + 2) + time '18:00' from ex;

   insert into public.calendar_feeds (user_id)
   select id from auth.users where email = 'schedule-test@example.com'
   on conflict (user_id) do nothing;

   select token from public.calendar_feeds
   where user_id = (select id from auth.users where email = 'schedule-test@example.com');
   ```

2. Fetch it:

   ```bash
   REF=<project ref>
   FEED_TOKEN=<token from step 1>
   curl -i "https://$REF.supabase.co/functions/v1/calendar-feed?token=$FEED_TOKEN"
   curl -s -o /dev/null -w "%{http_code} %{size_download}\n" "https://$REF.supabase.co/functions/v1/calendar-feed?token=$(printf 'f%.0s' {1..64})"
   ```

   The first call gives 200 with `content-type: text/calendar; charset=utf-8`, one "Exam:" event and the "Study:" events. The second call, an unknown token, gives `404 0`.

3. Paste the body of the first call into https://icalendar.org/validator.html. It should report no errors.

4. Google Calendar: "Other calendars", "+", "From URL", paste the link. A "Cramrade" calendar appears with the exam as an all-day event and each session at the student's session time. Google refreshes on its own schedule, often every few hours.

5. Apple Calendar: on a Mac, File, New Calendar Subscription; on an iPhone, Settings, Calendar, Accounts, Add Account, Other, Add Subscribed Calendar. Paste the link. The same events appear.

6. Clean up: remove the subscriptions, then run

   ```sql
   delete from public.exams where title in ('Calendar test exam', 'Schedule test exam');
   ```
## Hand test: make-questions (A6)

What it checks: 10 pages of typed notes give at least 20 verified questions, no unverified question is left in the table, and calling `make-questions` again is safe.

One-time setup (the read-syllabus hand test uses the same two steps, so skip them if you already did them there):
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
node --env-file=supabase/functions/_handtests/.env supabase/functions/_handtests/make-questions.mjs
```

It uploads `_fixtures/typed-notes.pdf`, waits until the question count stops growing (a few minutes), and ends with `make-questions hand test passed: <n> verified questions for note <id>`. Pass another fixture name as the last argument to try a different file. The note is kept, so the quiz tests can use its questions.

`typed-notes.pdf` is not in the repo until Dev A makes it (see `_fixtures/README.md`). Until then, run the same test on the text version by adding `typed-notes.txt` as the last argument. It gives the same 10 chunks.

To double-check in the database, open the Supabase dashboard, SQL Editor, and run (with the note id the script printed):

```sql
select count(*) from questions where note_id = '<note id>' and verified;
select kind, count(*) from questions where note_id = '<note id>' group by kind;
```

The first number must be at least 20. The second shows the mix of question kinds.

To see what was dropped and why, open the dashboard, Edge Functions, make-questions, Logs. Each batch writes one line with how many questions were made and dropped.

## How Dev A tunes the questions

The words the AI sees are in `supabase/functions/_shared/prompts/make-questions.md`. It is a plain text file: changing it changes the questions, with no code change.

1. Edit the file. Typical changes: more or fewer short-answer questions, harder wrong options, a stricter rule on what a good quote is. Keep the field names (`chunkPosition`, `kind`, `prompt`, `choices`, `answer`, `sourceQuote`, `topicTitle`) and the three placeholders (`{{chunks}}`, `{{topics}}`, `{{questionsPerChunk}}`) exactly as they are; the code depends on them.
2. Try it before merging, on a local stack: `npx supabase start`, then `npx supabase functions serve --env-file supabase/functions/.env`, then run the hand test with the local address in `_handtests/.env`. The local functions read the prompt file straight from your folder, so each edit takes effect on the next run.
3. Run the hand test again. It always uploads a new copy of the notes, so you compare a fresh set of questions each time. Read the five sample questions it prints and check the count.
4. When you like the result, open a pull request with the prompt change. Merging it to `main` deploys it.

Other knobs, all in code or secrets rather than the prompt: questions per chunk and chunks per batch are `QUESTIONS_PER_CHUNK` and `BATCH_SIZE` in `_shared/questions.ts`; the temperature is the `{ temperature: 0.7 }` argument in `make-questions/index.ts`; the model is the `GEMINI_MODEL` secret (`npx supabase secrets set GEMINI_MODEL=<model name>`).

Questions already made are not remade when the prompt changes. A note only gets new questions for chunks that have none.
node --env-file=supabase/functions/_handtests/.env supabase/functions/_handtests/read-syllabus.mjs
```

It prints both answers and ends with `read-syllabus hand test passed`. It deletes the notes it made. The AI's titles and topic wording can vary between runs; the dates, the number of proposals and the copied sentences should not.
