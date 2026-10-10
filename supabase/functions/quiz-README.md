# Live quiz: how the app talks to the server

For Dev B, building the quiz host and play screens (B8). Server side is task A8.

The server owns the clock and the scores. The app never sends a time or a score. It shows what the server says and asks the server to move on when the time is up.

## The pieces

- Four server functions, called with `supabase.functions.invoke(name, { body })` while signed in: `quiz-create`, `quiz-start`, `quiz-answer`, `quiz-advance`.
- Two database functions, called with `supabase.rpc(name, args)`: `join_quiz_room(code, nickname)` and `current_quiz_question(room_id)`.
- Two live tables, watched with Realtime: `quiz_rooms` (one row per room) and `quiz_players` (one row per player, with the score).

Every function failure looks like `{ "error": { "code": "too_late", "message": "Time is up for this question." } }`. Show the message; use the code to decide what to do.

## The room state

`quiz-create`, `quiz-start` and `quiz-advance` all return the room like this:

```json
{
  "id": "…", "code": "ABC234", "title": "Biology", "hostId": "…",
  "mode": "group", "status": "running",
  "secondsPerQuestion": 20, "resultsSeconds": 5,
  "currentQuestionIndex": 2, "questionStartedAt": "2026-10-10T12:00:00.123+00:00",
  "questionCount": 10, "serverNow": "2026-10-10T12:00:03.000+00:00"
}
```

`serverNow` is the server's clock when it answered. Work out how far the phone or browser clock is off, once per answer, and use that for every countdown:

```ts
const offsetMs = Date.parse(room.serverNow) - Date.now(); // add to Date.now() to get server time
const serverNowMs = () => Date.now() + offsetMs;
```

## Host flow (web only)

1. Call `quiz-create` with `{ source: { examId } }` or `{ source: { noteId } }`, `mode: "group"`, and optionally `count` (1 to 50, default 10) and `secondsPerQuestion` (5 to 300, default 20). The answer has `roomId` and `code`.
2. Show the code (and a join link with it) so players can join.
3. Watch `quiz_players` for the room to show who has joined.
4. Call `quiz-start` with `{ roomId }`. It refuses with `no_players` until someone has joined.
5. From here the host screen runs exactly like a player screen, without the answer buttons.

Solo mode: call `quiz-create` with `mode: "solo"`. The student is added as the only player and the quiz starts at once (`status` is `running`). Go straight to the play screen.

## Player flow (web and phone)

1. Sign in. Guests use `supabase.auth.signInAnonymously()`.
2. Call `supabase.rpc('join_quiz_room', { code, nickname })`. It returns the player row (`id`, `score`). Calling it again with the same login returns the same row and score, which is how a player who reloads the page gets back in.
3. Subscribe to the room row and the players:

```ts
supabase
  .channel(`quiz:${roomId}`)
  .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'quiz_rooms', filter: `id=eq.${roomId}` },
      (payload) => onRoom(payload.new))
  .on('postgres_changes', { event: '*', schema: 'public', table: 'quiz_players', filter: `room_id=eq.${roomId}` },
      (payload) => onPlayer(payload))
  .subscribe();
```

   The Realtime row uses database names (`current_question_index`, `question_started_at`, `seconds_per_question`, `results_seconds`, `status`). Realtime does not carry `serverNow`; keep the offset from the last function answer, or call `quiz-advance` once on joining (it is harmless and returns the room with `serverNow`).
4. Whenever `current_question_index` changes, call `supabase.rpc('current_quiz_question', { room_id: roomId })`. It returns `question_id`, `prompt`, `kind` and `choices`. Players never read the question list directly, so nobody can read ahead.
5. Work out the phase from three numbers, all in server time:
   - answering: from `question_started_at` until `question_started_at + seconds_per_question`
   - results: from there until `+ results_seconds` more
   - then the next question, or the end when `status` becomes `finished`
6. During answering, send the player's choice once: `quiz-answer` with `{ roomId, questionId, answer }`. For multiple choice, send the choice text exactly as shown. The answer is `{ isCorrect, points, score }`. Points are 1000 for an instant right answer, falling to 500 at the last moment, and 0 when wrong.
7. When answering ends, call `current_quiz_question` again: it now includes `answer`, so the results phase can show the right answer.
8. When the results phase ends on the local timer, call `quiz-advance` with `{ roomId, expectedIndex: current_question_index }`. Every client may do this; the server moves the room once and the others get `advanced: false`. If a call comes a little early, it changes nothing; the Realtime update or the next timer tick fixes it.
9. When `status` is `finished`, show the final scores from `quiz_players`.

## Refusals from quiz-answer

- `too_late`: the answering time ran out before the answer reached the server. No points.
- `already_answered`: the player already answered this question. Only the first answer counts.
- `not_current_question`: the room has moved on. Fetch the current question.
- `not_a_player`: join the room first.

## Checking it end to end

`scripts/quiz-e2e.mjs` at the repo root plays a whole quiz with five guest players against the live project. How to run it is at the top of that file.
