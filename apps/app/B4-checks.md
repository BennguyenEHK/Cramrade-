# B4 file upload

Workspace links to Your notes. Choose PDF, Word (.docx), UTF-8 text or Markdown, then press Upload notes. Ready notes can be opened to read their extracted text. Saved notes come from Supabase after reloading.

Files go to Dev A's authenticated extract-text function. It extracts text in memory and saves a note with numbered chunks. Originals never go to Storage. On phones, the temporary picker copy is removed after a response, removal or leaving the page. A network failure keeps the selection for an explicit retry. The student's original file stays on their device.

## Current contract and limits

- Before picking a file, optionally choose an exam and whether the file is study notes or a syllabus. Only the student's exams are offered. A syllabus upload saves text without saving proposed exam dates or starting question generation.
- The app accepts files up to 4 MB. The current backend permits up to 20 MB and 100 PDF pages; the app keeps its smaller file limit. Split long or complex documents before uploading.
- Word means .docx; save older .doc files as .docx. Images and handwriting are not read. Check the extracted text before studying from it.
- Text extraction does not use AI. The backend can start question generation from saved study notes. The app tells the student that saved text can be used for AI study questions.
- A ready response confirms saved readable text. Processing asks the student to refresh. Failed shows the reason and asks for a corrected file. Failed or unfinished notes never display a success message.
- Repeating the same upload ID returns its existing state. For a failed extraction, choose the corrected file again to create a new upload ID. After a network error or closing the page, check saved notes before uploading the same document again.
- Structured server errors display their message. Read controls stay disabled until a note is ready. Failed notes display their saved failure reason.

## Checks

- npm run typecheck
- npm run lint -w app
- npm test (shared schedule and pure backend helpers)
- node --experimental-strip-types --test apps/app/src/features/notes/upload-response.test.mjs
- From apps/app: npx expo export --platform web
- Upload a readable PDF and Word document, open each text, reload, and open each text again. Both must still be readable. Upload an image-only or blank PDF and check that its failure reason appears instead of a success message.

On 2026-10-10, the earlier B4 implementation passed eight extraction/HTTP tests and four isolated database checks. Live PDF and Word uploads saved readable text that survived reload. The approved synthetic files were b4-fixture.pdf and b4-fixture.docx; their saved notes were left in the user's account.

Dev A subsequently replaced the extraction implementation on main. Its pure helper tests now run through npm test; the older Deno and isolated database test files were removed. Dev B updated the app for the ready/processing/failed responses and structured errors, with three passing response-contract tests. Native device behavior remains to be tested.

Final live recheck on 2026-10-10 against Dev A's updated extraction backend: PDF and Word uploads both returned ready and showed their expected text. Both notes remained after reload. An approved image-only PDF produced a failed note with the reason "no readable text, this looks like a scanned image" and a disabled read button, with no success message. The two readable notes and one failed note were left in the user's account. All 112 repository tests and the three upload response tests passed; typecheck and lint passed.
The final production web export also passed after the temporary trial route was removed.
