# Space study optimization (beta)

Date: 2026-10-10. Status: design agreed in conversation by Dev A, waiting for Dev A's review of this file. Built after phase 1 (A4 to A8 and B1 to B8), as an optional beta.

## 1. What it is, in one paragraph

When a student starts a study session or a solo quiz, the app asks one question: "Where are you studying?" with five chips: home, library, café, outdoors, commute. The answer changes **how** the session is run, not **what** is studied. Noisy or short-attention places get the lighter format (flashcards and multiple choice, fewer new chunks). Quiet places get the harder work (new chunks, short answers). After several sessions in one place the app nudges the student to try another spot. A one-line reason under the suggestion is written by the AI from a fixed research summary. The whole feature sits behind a switch in study settings, off by default.

## 2. Why it is worth building, and the limits of the evidence

- Studying the same material in two different rooms gave better recall than twice in the same room (Smith, Glenberg and Bjork 1978). Later meta-analysis found environmental context effects on memory are real but modest (Smith and Vela 2001).
- Moderate background noise, café level, suits light or creative work but hurts hard new learning (Mehta, Zhu and Cheema 2012; the effect is contested and small).
- Time in nature restores attention (Berman, Jonides and Kaplan 2008).
- Nothing in this research says which **subject** to study where. So the feature never picks the subject or the exam. The schedule engine already decided that.

Expected result: a small gain in recall from varied places, and sessions that feel doable in a noisy place instead of being skipped. This is a convenience and habit feature. It must never change the plan's dates or the three-recall rule.

## 3. Decisions

- **The student says where they are. No GPS, no permission, no tracking.** One tap on a chip, or skip. The app remembers the last answer and offers it first. Works on web and phone alike. A later "remember this spot as home" shortcut using location may be added only as a separate, opt-in feature; background location is never used.
- **Beta switch**: `study_settings.place_aware` boolean, default false. Off means the question never appears and nothing changes.
- **Rules are plain code**, same style as the schedule engine. The AI only writes the one-line reason text.
- **Place categories** are fixed: `PLACES = ['home', 'library', 'cafe', 'outdoors', 'commute'] as const`. Each has a profile: `quiet` (home, library) or `busy` (cafe, outdoors, commute).

## 4. What changes in a session

The engine's planned session is kept as is: same exam, same chunks, same questions. The place changes only the order and the kinds shown:

- **Quiet place**: the session runs as planned. New chunks first, short-answer questions allowed.
- **Busy place**: questions are reordered so flashcards and multiple choice come first, short-answer questions last. If the session has more than 2 new chunks, the extras move to the end so the student can stop after the known material and still count the session as done. Nothing is dropped; the plan does not change.
- **Nudge**: when the last 4 completed sessions were all in the same place, show once: "You have studied here 4 times in a row. A different spot helps recall." Dismissable. Not shown more than once a week.
- **Reason line**: under the chips, one sentence explaining the format for that place, for example "Café: quick recall first, hard new material later, because background noise makes new learning harder." The sentences are generated once per place by an Edge Function from the research summary in section 2 and cached in a table, not called per session.

## 5. Pieces

- `packages/shared/src/types/place.ts`: `PLACES`, `Place`, `PlaceProfile`, `PLACE_PROFILES`.
- `packages/shared/src/place/`: `orderForPlace(questions, place): Question[]` (pure, tested) and `shouldNudge(recentPlaces: Place[], lastNudgeAt: DateOnly | null, today: DateOnly): boolean` (pure, tested).
- Database: `study_settings.place_aware boolean not null default false`, `study_settings.last_place text`, `study_settings.last_place_nudge_at date`; `study_sessions.place text` (set when the session starts); new table `place_reasons (place text primary key, reason text, generated_at timestamptz)`, readable by everyone signed in, written by the server only.
- Edge Function `place-reasons` (Dev A): fills `place_reasons` once with `askGemini('place-reason', { place, research })`, re-run by hand when the prompt changes. Prompt file `supabase/functions/_shared/prompts/place-reason.md`.
- Screens (Dev B): the chip prompt on session start and solo quiz start, the beta switch in study settings (B13), the nudge banner, the reason line.

## 6. Data the feature records, and privacy

- Only the chosen chip per session. No coordinates, no addresses, no times of arrival. The chip is the student's own word.
- The place column is visible to the student only (same Row Level Security as sessions).
- Switching the beta off stops the question; past place values stay on past sessions.

## 7. Testing

- `orderForPlace`: busy place puts flashcards and multiple choice before short answer and moves extra new chunks to the end; quiet place keeps the plan order; the set of questions is identical before and after.
- `shouldNudge`: four same places in a row triggers; three does not; a nudge within the last 7 days blocks; a different place in the last four resets.
- Manual: with the beta on, the chip prompt appears on session start; with it off, it does not. The reason line shows the cached sentence. Solo quiz asks the same question.

## 8. Not in this feature

GPS or any location permission, picking the subject by place, changing session dates, reading the calendar, sound-level detection from the microphone, and any per-session AI call.

## 9. Tasks to add to split_work.md (after phase 1)

- **A13. Place rules and reasons (server)**: types, `orderForPlace`, `shouldNudge` with tests, the migration, the `place-reasons` function and prompt. Done when: tests pass and `place_reasons` holds five sentences.
- **B15. Place prompt and nudge (screens)**: the chips on session and solo quiz start, the beta switch, the nudge banner, the reason line. Done when: a tester can switch the beta on, pick café, and see flashcards first.
