# Sample files for testing the server functions by hand

All text is English and made up for testing.

- `typed-notes.txt`: Biology 101 notes, weeks 1 to 8, 3,341 words. extract-text makes 10 chunks from it. The A6 hand test ("10 pages of notes give at least 20 questions") uses the PDF made from it.
- `typed-notes.pdf`: the same text as a normal (typed) PDF, about 10 pages.
- `typed-notes.docx`: the same text as a Word file.
- `notes-photosynthesis.md`: about 140 words of Markdown. extract-text makes 1 chunk.
- `notes-scanned.pdf`: a PDF that is only a picture of text, with no text layer.
- `try-extract.sh`: sends one file to extract-text as multipart/form-data and shows the note it made. Nothing goes to Storage.

## Making the PDF and Word files

They are binary, so make them once by hand and commit them:

Not in the repo yet: Dev A exports `typed-notes.pdf` and `typed-notes.docx` from `typed-notes.txt` and makes `notes-scanned.pdf`, with the steps below, before the hand test.

1. Open `typed-notes.txt` in Word or Google Docs. Keep the blank lines between paragraphs. Set the text to 12 pt with 1.5 line spacing, which gives about 10 pages.
2. Save as `typed-notes.docx` (Word) here.
3. Save or download as PDF: `typed-notes.pdf` here.
4. For the scanned one: take a screenshot of the first page of the PDF, open the screenshot in the Photos app, print it with "Microsoft Print to PDF", and save it here as `notes-scanned.pdf`. Check it really has no text: in a PDF viewer you cannot select any words.

Keep each file under 1 MB.

## Running a hand test

From the top folder of the repo, in Git Bash, with a test account:

```sh
export CRAMRADE_EMAIL=test@example.com CRAMRADE_PASSWORD=... SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
bash supabase/functions/_fixtures/try-extract.sh supabase/functions/_fixtures/typed-notes.txt text/plain
# with an exam and as a syllabus: ... typed-notes.txt text/plain <exam id> true
# repeat the same upload: UPLOAD_ID=<id from the first run> bash ...
```

The script makes a new upload id (it becomes the note id), sends the file with the student's token, then prints the note row and its chunk count. It does the same as this call:

```sh
curl -s -X POST "$SB/functions/v1/extract-text" -H "Authorization: Bearer $TOKEN" -H "apikey: $KEY" \
  -F "file=@supabase/functions/_fixtures/typed-notes.txt;type=text/plain" -F "uploadId=$UPLOAD_ID"
```

Expected answers:

- `typed-notes.txt`, `typed-notes.pdf`, `typed-notes.docx`: `{"noteId":"<upload id>","status":"ready","chunks":10}`
- `notes-photosynthesis.md`: `{"noteId":"<upload id>","status":"ready","chunks":1}`
- `notes-scanned.pdf`: `{"noteId":"<upload id>","status":"failed","chunks":0,"reason":"no readable text, this looks like a scanned image"}`
- The same upload id a second time: the same answer, and no new chunks.

The A4a plan (`docs/superpowers/plans/2026-10-10-a4a-server-foundation.md`, last task) still shows the older call that read the file from Storage. The answers above replace it.
