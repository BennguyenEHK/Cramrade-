# Dev B: remaining phase 1 work

Implemented on `dev-b`, 2026-10-10. This extends B1–B4. No backend, deployment or shared data shapes were changed. The root lockfile adds only Expo's SDK 57 clipboard package.

## Screens

- `/syllabus`: select an uploaded syllabus, read dates through `read-syllabus`, edit the suggestions and explicitly confirm each exam and its topics. Suggestions are not saved on reading. Failed topic saves can be retried using the same exam/topic ids. If no dates are found, a link opens manual exam entry.
- `/schedule`: read the server plan, show due and upcoming sessions and the exam for each, show final passes and history, skip and rebuild, refresh and copy a calendar subscription link. Exam edits rebuild the plan, with a retry message when rebuilding fails.
- `/study`: scheduled sessions and on-demand quizzes or flashcards use only verified questions. Every question can open its exact source chunk and quote. Short answers ignore case and extra whitespace but otherwise require exact text; flashcards use the student's self-assessment. Attempts use stable ids for network retries, and a reload resumes unanswered scheduled questions. Finishing marks the session done and rebuilds the plan.
- `/quiz`: create a room from an exam or note, join using a code and nickname, or start solo with one button. Group hosting is web-only and uses the full page width. The full-screen button calls the browser's full-screen API. Questions, timing and scores come from the server. Realtime updates plus polling recover missed events; repeated advance requests are safe on the server. A reload reads the existing player's answers and score.
- `/settings`: save pace, weekdays off, the usual time and a valid time zone; add or remove busy date ranges. Each save asks `build-schedule` to rebuild. If rebuilding fails after a save, the screen says the settings were saved and explains how to retry.

## Live checks passed

- Uploaded a synthetic syllabus as a syllabus note. `read-syllabus` returned October 24, 2026 and the topics photosynthesis and cellular respiration. Changed the title to “Phase 1 Biology verification” and the date to October 25 before confirming. The exam and topics saved and the exam appeared in Workspace.
- A second uploaded synthetic syllabus with no dates returned “No dates found” and a manual-entry link.
- Uploaded the approved synthetic biology note linked to the new exam. Question generation and plan rebuilding produced real saved sessions.
- Saved light pace and October 15 as a synthetic busy day. Both survived reload. The plan had sessions on October 10, 13, 16 and a final pass on October 24, with no session on October 15.
- Played a scheduled session with three available verified questions. Answered the first question, reloaded, and saw only the remaining two questions. Finished them; Schedule showed the session as done. The small fixture has three questions, so this does not test a full five-to-seven-question pool.
- Played a quick review and a flashcard review using the earlier note. Source text opened, answers saved, and starting another review worked after a state-reset fix.
- Moved the exam to October 26. The final pass moved to October 25, and the completed session remained in the plan.
- Created a private calendar link and checked that Copy calendar link put the expected URL format on the browser clipboard. No token is recorded here or in source control.
- Started a two-question solo quiz. A correct answer received 738 points from the server. Reload preserved that score. The quiz advanced to question two and finished automatically without a Next button. Evidence: ignored local screenshot `.local-deps/phase1-solo-finished.png`.
- Created a two-question group lobby. Start stays disabled until a player joins. The host content uses the full page width. Full-screen was requested, but the browser tool did not confirm full-screen state; check this in Chrome.
- Mobile settings and schedule checked at 390 px, including DOM checks for controls extending beyond the viewport. Temporary viewport overrides were reset.
- Restored the original normal pace, 18:00 time, UTC time zone and no weekdays off. With the user's permission, removed the October 15 “Phase 1 verification” busy day and verified that the plan rebuilt successfully.

## Automated checks

- `npm run typecheck` passed for the app and shared package.
- `npm run lint -w app` passed, including the final rerun.
- `npm test`: 260 tests passed across 22 files. The sandbox run could not read Vitest's temporary files; the normal host run passed after restoring the declared `ical.js` dependency from main.
- `node --test apps/app/src/features/exams/dates.test.mjs apps/app/src/features/notes/upload-response.test.mjs apps/app/src/features/study/answers.test.mjs apps/app/src/features/quiz/clock.test.mjs`: six tests passed, including quiz deadline boundaries and short-answer grading.
- Final `npx expo export --platform web` from `apps/app` passed and exported all 11 routes. A sandbox rerun initially failed writing the existing `dist` folder; the normal host rerun completed successfully.

## Still needed before all phase 1 checks pass

- B5: repeat the live syllabus flow with a real student's syllabus. Current live checks used synthetic text.
- B8: use a separate signed-out browser or Incognito session to join as a guest, submit an answer, reload while running and finish with the same score. The user reported no response after pressing Join quiz. The live public Auth settings returned `external.anonymous_users: false`: Dev A needs to enable anonymous sign-ins in the Supabase dashboard before guest testing can pass. Join errors now appear beside the button, with a “Joining…” label while pending and a sign-in alternative when guest access is unavailable. The host account was kept signed in.
- B14: replace the link, confirm the old link stops working, then subscribe to the new link in Google Calendar and see exam dates and sessions. Apple Calendar is the corresponding A7 integration check. The app has the controls, but an external calendar subscription is not yet verified.
- B9: 20 real note photos and a phone are unavailable. Follow `B9-handwriting-trial.md` when they are ready; do not invent accuracy or speed results.
- T4: the separate joint task with ten real students has not been run.
- Native Android and iPhone checks have not run; phase 1 checks here are web checks.
- Synthetic notes, exam and quiz records remain in the test account as approved. Temporary study settings and the test busy day have been restored or removed.

Calendar instructions were checked against [Google's subscription help](https://support.google.com/calendar/answer/37100) and [Apple's calendar subscription instructions](https://support.apple.com/en-us/102301). No access to the student's calendar is requested by the app.
