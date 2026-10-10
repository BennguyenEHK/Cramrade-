# B2 sign-in checks

Verified on 2026-10-10 with live Supabase. The user signed out and created an account with a different email they control, completed any requested email confirmation, and reported that Workspace opened. Passwords were entered only in the app.

A browser tab opened Workspace while signed in, was closed, and was reopened at Workspace. The account remained signed in and the protected exam screen loaded. Earlier live checks also restored the session after reloading. This meets B2's sign-up and tab-reopen check.

Earlier stand-in server checks covered sign-up, sign-in, sign-out, validation and whole-browser restart (16 passing checks). Whole-browser restart has not been repeated with live Supabase. Native devices and the hosted app's environment configuration have not been verified here.

To repeat, create an account with an email you control, confirm the email if requested, sign in, close the tab and reopen Workspace. It should open without asking for the password again. Sign out through Account when finished.
