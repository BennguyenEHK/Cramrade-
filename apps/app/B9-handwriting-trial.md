# B9: handwriting trial, waiting for real notes

This trial has not run. Dev B said on 2026-10-10 that the 20 real note photos and a phone for the checks are not available yet. No accuracy or speed result is claimed, and no reader has been chosen.

## Run when the photos are available

- Ask students to choose 20 pages of their own notes. Include handwriting and print, and the languages the intended students use. Do not scan a device for files.
- Give each page a number from 1 to 20. Keep a checked transcription for comparison. Avoid names and other personal information in the sample.
- Record the phone model, operating system, reader and language. Use the phone's built-in reader first; record seconds per page and whether its text is correct enough to study from.
- With permission to send these specific photos to Gemini, run the same pages through Gemini vision on the server. Dev A holds the key; never add it to the app. Ask for transcription only, with unclear words flagged rather than guessed.
- Use the same correctness standard for both methods: no missing study facts, changed numbers, invented words or unmarked unreadable text. Keep the original and each transcription together while checking.
- Record failures as failures, including timeouts. Record seconds per page, not just the total time. Record Gemini input/output token usage and calculate cost using the model and price at the time of the trial.
- Remove temporary photo copies from the trial server afterwards. Do not delete students' originals.

## One-page result to fill in

- Sample: 20 pages; handwritten count, printed count, and languages.
- Phone reader: name/version; correct pages out of 20; average and slowest seconds per page; recurring errors.
- Gemini: model/version; correct pages out of 20; average and slowest seconds per page; recurring errors; measured cost per page.
- Decision: chosen method, why it meets the needs of these notes, and how unclear text will be shown to the student.
- Check: both developers review the results before B11 uses the chosen reader.

Until these measurements exist, B9 remains pending and B11 cannot be completed.
