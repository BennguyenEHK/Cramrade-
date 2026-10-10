# B1 web trial: result

**Answer: works.** The web version of the Expo app can upload a PDF and can show a wide, full-width screen for hosting a quiz. We keep building on Expo. Next.js is not needed.

Tested on 2026-10-10 with Expo SDK 57, on the dev server, in Microsoft Edge 155. Edge runs the same engine as Chrome (Chromium). Chrome itself was not installed on the test computer.

## What was checked

The test page is at `/trial` (for example http://localhost:8081/trial while `npm run web` is running). It has two parts.

**1. Upload a PDF**

- The "Pick a PDF" button opens the computer's normal file window, set to show PDF files only.
- After picking, the page reads the whole file and checks that it starts the way every PDF does.
- It then sends the file to a web address, the same way the real upload will send it to our server.
- A small test program stood in for the server and compared what arrived with the file on disk.

Results:

- A small PDF arrived whole, byte for byte, at window widths 1920, 1280 and 390 (phone size).
- A 20 MB PDF arrived whole in about one second.
- No errors appeared in the page.

**2. Wide quiz screen**

- A mock-up of the quiz host screen: question, timer bar, four answers, and a score list.
- It stretches from the left edge of the window to the right edge, and reports its own width next to the window's width.
- A "Show full screen" button hides the browser's toolbars, which is how a host would show it on a projector.

Results:

- The mock-up was exactly as wide as the window at 1920, 1280 and 390 pixels. Nothing spilled sideways.
- On wide windows the answers sit in two columns with scores on the right. On a phone they stack.
- The full-screen button worked.

## What this means for later tasks

- **B4 (file upload)** can use the same picker, `expo-document-picker`, which is now installed. In a browser it gives a normal web file that can be sent straight to a Supabase Edge Function.
- **B8 (quiz host screen)** can use a normal full-width layout. It does not need anything special from Expo.
- Not tested here: how large a file an Edge Function can take and turn into text. That belongs to B4 and A4, and the limits in `CLAUDE.md` still apply.

## The test page is throwaway

The trial code is in `apps/app/src/app/trial.tsx` and `apps/app/src/features/web-trial/`. It is hidden from search engines and not linked from the menu. Delete both when the real upload button (B4) is built. This note stays.

To repeat the upload check with a real receiver, open the page with `?receiver=<address>` at the end, and the page sends the file there and shows the answer.
