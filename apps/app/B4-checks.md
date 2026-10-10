# B4 file upload

Workspace links to Your notes. Choose a PDF, Word (.docx), UTF-8 text or Markdown file, then press Upload notes. Saved notes can be opened to read their extracted text. The list comes from Supabase, so it remains after reloading.

Files go to the `extract-text` Edge Function. It checks the student's sign-in, extracts text in memory and calls `save_uploaded_note` to save a note and its numbered chunks in one transaction. It uses the student's access permissions, not a service-role key. Original files never go to Storage. The phone's temporary picker copy is removed after success, removal or leaving the page. A failed upload keeps the selected file only for an explicit retry.

## Current limits

- At most 4 MB and 5 PDF pages per upload. Split larger documents before uploading. This bounds each extraction request; it does not promise that every complex PDF fits the hosted CPU limit.
- Scanned PDF pages, handwriting, images, Word headers/footers, comments and embedded objects are not read. A PDF with a page containing no selectable text is rejected rather than saved incompletely.
- Word means `.docx`. Save older `.doc` files as `.docx` first.
- No AI is used during extraction. This task does not generate questions.
- A retry of the same selected upload reuses its ID and cannot create a duplicate note. After closing the page, check Saved notes before uploading the same document again.

## Dev A review and deployment

- Review `supabase/migrations/20261010190000_save_uploaded_note.sql`, the `extract-text` function and its entry in `supabase/config.toml`.
- The handler calls Supabase Auth to verify every bearer token before reading files. Gateway JWT verification is off because the handler supports both legacy and asymmetric signing keys.
- Merge through the usual reviewed pull request. The existing Supabase integration should apply the migration and deploy the function. No manual production deploy was run.
- With the deployed backend, upload an ordinary PDF and Word file, open their saved text, and reload. B4 is not DONE until that live check passes.
- The UI reports that the upload service could not be reached when an undeployed function rejects browser preflight requests. If a readable HTTP 404 is returned, it reports that uploads are unavailable.

## Repeatable local checks

- `npm run typecheck`
- `npm run lint -w app`
- From `apps/app`: `npx expo export --platform web`
- With Deno installed: `deno test --allow-env=SUPABASE_URL,SUPABASE_ANON_KEY --config supabase/functions/extract-text/deno.json supabase/functions/extract-text/extract_test.ts`
- Install the isolated database test tool once with `npm install --prefix .local-deps/tools @electric-sql/pglite`, then run `node supabase/functions/extract-text/save-note.test.mjs` from the repo root. This uses an in-memory database and the actual migrations; it never connects to production.

The extraction fixtures contain only synthetic text. They cover readable PDF/Word extraction, exact Unicode preservation across chunks, malformed files, inflated Word size, PDF page limits, missing/guest/invalid authentication and save failures. Database checks cover atomic saves, safe retries, account isolation, guest rejection and rollback if a chunk insert fails.

Verified on 2026-10-10: typecheck, lint, production web export, all eight extraction/HTTP tests, and all four database checks passed. The real browser picker selected a PDF. The live endpoint returned NOT_FOUND to preflight, so no file was saved to production. The layout had no horizontal overflow at 390 and 1280 pixels. Native device behavior remains to be tested.
