# B3 exam screen

The Workspace page now lists your exams in date order. You can add, edit and delete exams, quizzes and competitions. Dates can be typed or chosen from the calendar. Saving uses the existing Supabase tables and access rules. No database changes are needed.

The screen only shows exams owned by the signed-in account. Changing accounts remounts the screen so a previous account's exams are not left visible. Delete asks for confirmation and explains that linked topics and sessions are removed too.

## Checks to repeat

- Sign in and open Workspace.
- Add an exam, choose a day from the calendar, and reload. The exam should stay.
- Edit its name, type and date. Reload and check the changes stayed.
- Cancel a delete, then confirm it. Reload and check the exam is gone.
- Try an empty name and February 30. Neither should save.
- Disconnect the network and try saving. The form should keep your changes and offer a retry.
- Sign out. Workspace should ask you to sign in.

Automated calendar validation: `node --experimental-strip-types --test apps/app/src/features/exams/dates.test.mjs`.
Verified on 2026-10-10 against the live Supabase project with a signed-in account: creating an exam survived reload, editing its name and date survived reload, and deleting it with the user's permission stayed deleted after reload. The temporary test exam was removed. Calendar selection and empty-name validation also passed in the browser; automated date checks covered invalid dates and leap years. Both 390px and 1280px layouts fit without horizontal overflow. Type checking, app lint and the production web export passed. Native devices and the disconnected-network checklist above have not been tested.

