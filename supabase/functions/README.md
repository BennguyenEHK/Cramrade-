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

## build-schedule (A5)

Builds and saves a student's study plan. A student calls it with their login; `make-questions` calls it with the service key and `{ "examId" }`. Test it on the live project after the pull request merges.

What you need: a test account `schedule-test@example.com` (dashboard, Authentication, Add user, "Auto confirm" on), the project ref, the anon key, the service role key (Project Settings, API), and the Gemini secrets set.

1. Seed an exam 14 days away, two topics (one with no difficulty), one note and 9 verified questions. Run this in the SQL editor:

   ```sql
   do $$
   declare
     uid uuid := (select id from auth.users where email = 'schedule-test@example.com');
     texts text[] := array[
       'Cells are the basic unit of life. The cell membrane controls what enters and leaves the cell.',
       'Mitochondria release energy from glucose during cellular respiration. This energy is stored as ATP.',
       'Genes are sections of DNA. Each gene carries the instructions for making one protein.'
     ];
     ex uuid; t1 uuid; t2 uuid; n uuid; c uuid;
   begin
     insert into public.exams (owner_id, title, exam_date) values (uid, 'Schedule test exam', current_date + 14) returning id into ex;
     insert into public.topics (exam_id, title, position, difficulty) values (ex, 'Cells', 0, 3) returning id into t1;
     insert into public.topics (exam_id, title, position) values (ex, 'Genes', 1) returning id into t2;
     insert into public.notes (owner_id, title, source, status, exam_id) values (uid, 'Schedule test notes', 'text', 'ready', ex) returning id into n;
     for i in 1..3 loop
       insert into public.chunks (note_id, position, text) values (n, i - 1, texts[i]) returning id into c;
       insert into public.questions (note_id, chunk_id, exam_id, topic_id, kind, prompt, answer, source_quote)
       select n, c, ex, case when i < 3 then t1 else t2 end, 'flashcard',
              'Question ' || k || ' on chunk ' || i, 'Answer ' || k, split_part(texts[i], '.', 1)
       from generate_series(1, 3) as k;
     end loop;
     raise notice 'exam id: %', ex;
   end $$;
   ```

2. Sign in and call the function:

   ```bash
   REF=<project ref>
   ANON=<anon key>
   TOKEN=$(curl -s "https://$REF.supabase.co/auth/v1/token?grant_type=password" \
     -H "apikey: $ANON" -H "Content-Type: application/json" \
     -d '{"email":"schedule-test@example.com","password":"<password>"}' | node -pe "JSON.parse(require('fs').readFileSync(0)).access_token")
   curl -s -X POST "https://$REF.supabase.co/functions/v1/build-schedule" \
     -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{}'
   ```

   You should get `sessions`, `warnings` and `rated: 1`.

3. Check the plan in the SQL editor:

   ```sql
   select (s.scheduled_for at time zone 'UTC')::date as day, s.status, s.is_final_pass,
          count(sq.question_id) as questions, e.exam_date
   from public.study_sessions s
   join public.exams e on e.id = s.exam_id
   left join public.session_questions sq on sq.session_id = s.id
   where e.title = 'Schedule test exam'
   group by s.id, e.exam_date
   order by s.scheduled_for;
   ```

   Every day is before the exam date. The last one is the day before, with `is_final_pass` true. Nothing is on the exam date. Normal sessions have 5 to 7 questions. The topic "Genes" now has a difficulty from 1 to 5.

4. Skip the first planned session, call the function again (step 2), and rerun the query in step 3:

   ```sql
   update public.study_sessions set status = 'skipped'
   where id = (
     select s.id from public.study_sessions s join public.exams e on e.id = s.exam_id
     where e.title = 'Schedule test exam' and s.status = 'planned'
     order by s.scheduled_for limit 1
   );
   ```

   The skipped session is still there, no planned session shares its day, and the rest of the plan has new ids.

5. Errors: no login gives 401; `{"examId":"nope"}` gives 400 `bad_input`; an unknown exam id gives 404 `exam_not_found`.

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" -X POST "https://$REF.supabase.co/functions/v1/build-schedule" -d '{}'
   curl -s -X POST "https://$REF.supabase.co/functions/v1/build-schedule" -H "Authorization: Bearer $TOKEN" -d '{"examId":"nope"}'
   curl -s -X POST "https://$REF.supabase.co/functions/v1/build-schedule" -H "Authorization: Bearer $TOKEN" -d '{"examId":"00000000-0000-0000-0000-000000000000"}'
   ```

6. Service key, the way `make-questions` calls it. Keep the key in a shell variable only, never in a file:

   ```bash
   SERVICE=<service role key>
   EXAM_ID=<exam id from step 1>
   curl -s -X POST "https://$REF.supabase.co/functions/v1/build-schedule" \
     -H "Authorization: Bearer $SERVICE" -H "Content-Type: application/json" -d "{\"examId\":\"$EXAM_ID\"}"
   curl -s -X POST "https://$REF.supabase.co/functions/v1/build-schedule" \
     -H "Authorization: Bearer $SERVICE" -H "Content-Type: application/json" -d '{}'
   unset SERVICE
   ```

   The first call returns the student's sessions. The second returns 400 `bad_input`.

7. Clean up:

   ```sql
   delete from public.notes where title = 'Schedule test notes';
   delete from public.exams where title = 'Schedule test exam';
   ```
