// A8 "Done when": five players join one room, play five questions, and all
// see the same final scores. Runs against the live Supabase project.
//
// Before the first run:
//   1. Anonymous sign-in is on (Supabase dashboard > Authentication > Sign In / Providers).
//   2. A host account exists with a password, and scripts/quiz-e2e-seed.sql
//      has been run for it in the SQL editor.
//   3. scripts/.env.quiz-e2e is filled in (see scripts/quiz-e2e.env.example).
//
// Run from the repo root (Node 22 or newer):
//   node --env-file=apps/app/.env --env-file=scripts/.env.quiz-e2e scripts/quiz-e2e.mjs
//
// It takes about two minutes. Exit code 0 means every check passed.

import { createClient } from '@supabase/supabase-js';

const URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const KEY = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const HOST_EMAIL = process.env.QUIZ_E2E_HOST_EMAIL;
const HOST_PASSWORD = process.env.QUIZ_E2E_HOST_PASSWORD;
const NOTE_ID = process.env.QUIZ_E2E_NOTE_ID;

const PLAYERS = 5;
const QUESTIONS = 5;
const SECONDS_PER_QUESTION = 15;
const DELAYS_MS = [0, 2500, 5000, 7500, 10000];
const WRONG_PLAYER = 4; // answers question 0 wrong
const LATE_PLAYER = 3; // answers question 1 after the time is up
const REJOIN_PLAYER = 2; // reloads before question 2
const MARGIN_MS = 400; // wait a little past each server deadline

for (const [name, value] of Object.entries({ URL, KEY, HOST_EMAIL, HOST_PASSWORD, NOTE_ID })) {
  if (!value) {
    console.error(`Missing setting ${name}. See the comment at the top of scripts/quiz-e2e.mjs.`);
    process.exit(2);
  }
}

let failures = 0;
function check(condition, message) {
  if (condition) {
    console.log(`  ok    ${message}`);
  } else {
    failures++;
    console.error(`  FAIL  ${message}`);
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));

function newClient() {
  return createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function token(client) {
  const { data } = await client.auth.getSession();
  return data.session.access_token;
}

// Plain fetch instead of functions.invoke, so a 409 comes back as data.
async function call(client, name, body) {
  const res = await fetch(`${URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${await token(client)}`,
      apikey: KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    // empty body
  }
  return { status: res.status, body: json };
}

// The server's clock, estimated from the last serverNow it sent.
let offsetMs = 0;
function syncClock(room) {
  offsetMs = Date.parse(room.serverNow) - Date.now();
}
const serverNow = () => Date.now() + offsetMs;
const waitUntilServer = (ms) => sleep(ms - serverNow() + MARGIN_MS);

async function currentQuestion(client, roomId) {
  const { data, error } = await client.rpc('current_quiz_question', { room_id: roomId });
  if (error) throw new Error(`current_quiz_question: ${error.message}`);
  return Array.isArray(data) ? data[0] : data;
}

// Each player watches the room row over Realtime, like a browser would.
function watchRoom(player, roomId) {
  return new Promise((resolve, reject) => {
    player.seen = player.seen ?? [];
    player.channel = player.client
      .channel(`quiz-e2e:${roomId}:${player.index}:${Date.now()}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'quiz_rooms', filter: `id=eq.${roomId}` },
        (payload) => player.seen.push({ status: payload.new.status, index: payload.new.current_question_index }),
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') resolve();
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') reject(new Error(`Realtime ${status}`));
      });
  });
}

async function main() {
  console.log('Signing in the host');
  const host = newClient();
  const signIn = await host.auth.signInWithPassword({ email: HOST_EMAIL, password: HOST_PASSWORD });
  if (signIn.error) throw new Error(`host sign-in: ${signIn.error.message}`);

  // The host owns the note, so Row Level Security lets it read the answers.
  const { data: questionRows, error: qError } = await host
    .from('questions')
    .select('id, answer')
    .eq('note_id', NOTE_ID)
    .eq('verified', true);
  if (qError) throw new Error(`reading questions: ${qError.message}`);
  const answers = new Map(questionRows.map((row) => [row.id, row.answer]));
  check(answers.size >= QUESTIONS, `the note has at least ${QUESTIONS} verified questions (${answers.size})`);

  console.log('Signing in five guest players');
  const players = [];
  for (let i = 0; i < PLAYERS; i++) {
    const client = newClient();
    const { data, error } = await client.auth.signInAnonymously();
    if (error) throw new Error(`guest ${i + 1} sign-in: ${error.message}`);
    client.realtime.setAuth(data.session.access_token);
    players.push({ index: i, client, userId: data.user.id, pointsTotal: 0 });
  }
  console.log(`  guest user ids: ${players.map((p) => p.userId).join(', ')}`);

  console.log('Creating the room');
  const guestCreate = await call(players[0].client, 'quiz-create', { source: { noteId: NOTE_ID }, mode: 'group' });
  check(guestCreate.status === 403, `a guest cannot create a room (got ${guestCreate.status})`);

  const created = await call(host, 'quiz-create', {
    source: { noteId: NOTE_ID },
    count: QUESTIONS,
    secondsPerQuestion: SECONDS_PER_QUESTION,
    mode: 'group',
  });
  if (created.status !== 200) throw new Error(`quiz-create: ${created.status} ${JSON.stringify(created.body)}`);
  const { roomId, code } = created.body;
  check(created.body.status === 'lobby', 'a group room starts in the lobby');
  check(created.body.questionCount === QUESTIONS, `the room has ${QUESTIONS} questions`);
  console.log(`  room ${roomId}, code ${code}`);

  const earlyStart = await call(host, 'quiz-start', { roomId });
  check(earlyStart.status === 409, `starting with no players is refused (got ${earlyStart.status})`);

  console.log('Joining five players');
  for (const player of players) {
    const { data, error } = await player.client.rpc('join_quiz_room', { code, nickname: `Player ${player.index + 1}` });
    if (error) throw new Error(`join ${player.index + 1}: ${error.message}`);
    player.playerId = data.id;
    check(data.score === 0, `player ${player.index + 1} joins with score 0`);
    await watchRoom(player, roomId);
  }

  const playerStart = await call(players[0].client, 'quiz-start', { roomId });
  check(playerStart.status === 403, `a player cannot start the quiz (got ${playerStart.status})`);

  console.log('Starting');
  const started = await call(host, 'quiz-start', { roomId });
  if (started.status !== 200) throw new Error(`quiz-start: ${started.status} ${JSON.stringify(started.body)}`);
  let room = started.body.room;
  syncClock(room);
  check(room.status === 'running' && room.currentQuestionIndex === 0, 'the room is running on question 0');

  for (let q = 0; q < QUESTIONS; q++) {
    console.log(`Question ${q + 1}`);
    check(room.currentQuestionIndex === q, `room is on question index ${q}`);
    const startedAt = Date.parse(room.questionStartedAt);
    const answerEnd = startedAt + room.secondsPerQuestion * 1000;
    const resultsEnd = answerEnd + room.resultsSeconds * 1000;

    if (q === 2) {
      // Player 3 "reloads the page": a new client with the same session.
      const old = players[REJOIN_PLAYER];
      const { data: before } = await old.client.from('quiz_players').select('score').eq('id', old.playerId).single();
      const { data: session } = await old.client.auth.getSession();
      await old.client.removeChannel(old.channel);
      const client = newClient();
      const restored = await client.auth.setSession({
        access_token: session.session.access_token,
        refresh_token: session.session.refresh_token,
      });
      if (restored.error) throw new Error(`rejoin session: ${restored.error.message}`);
      client.realtime.setAuth(session.session.access_token);
      const { data: again, error } = await client.rpc('join_quiz_room', { code, nickname: 'Player 3 again' });
      if (error) throw new Error(`rejoin: ${error.message}`);
      check(again.id === old.playerId, 'the rejoining player gets the same player row');
      check(again.score === before.score, `the rejoining player keeps their score (${again.score})`);
      players[REJOIN_PLAYER] = { ...old, client, seen: [...old.seen] };
      await watchRoom(players[REJOIN_PLAYER], roomId);
    }

    const shown = await Promise.all(players.map((p) => currentQuestion(p.client, roomId)));
    const questionId = shown[0].question_id;
    check(shown.every((s) => s.question_id === questionId), 'all five see the same question');
    check(shown.every((s) => s.answer === null || s.answer === undefined), 'the answer is hidden while answering');
    const rightAnswer = answers.get(questionId);

    await Promise.all(
      players.map(async (player) => {
        if (q === 1 && player.index === LATE_PLAYER) return; // answers late, below
        await sleep(startedAt + DELAYS_MS[(player.index + q) % PLAYERS] - serverNow());
        const wrong = q === 0 && player.index === WRONG_PLAYER;
        const res = await call(player.client, 'quiz-answer', {
          roomId,
          questionId,
          answer: wrong ? 'definitely not the answer' : rightAnswer,
        });
        check(res.status === 200, `player ${player.index + 1} answer accepted (got ${res.status})`);
        if (res.status !== 200) return;
        check(res.body.isCorrect === !wrong, `player ${player.index + 1} marked ${wrong ? 'wrong' : 'right'}`);
        const inRange = wrong ? res.body.points === 0 : res.body.points >= 500 && res.body.points <= 1000;
        check(inRange, `player ${player.index + 1} got ${res.body.points} points`);
        player.pointsTotal += res.body.points;
      }),
    );

    const duplicate = await call(players[0].client, 'quiz-answer', { roomId, questionId, answer: rightAnswer });
    check(duplicate.status === 409 && duplicate.body?.error?.code === 'already_answered', 'a second answer is refused');

    await waitUntilServer(answerEnd);

    if (q === 1) {
      const late = await call(players[LATE_PLAYER].client, 'quiz-answer', { roomId, questionId, answer: rightAnswer });
      check(late.status === 409 && late.body?.error?.code === 'too_late', 'an answer after the time limit is refused');
    }

    const revealed = await currentQuestion(players[1].client, roomId);
    check(revealed.answer === rightAnswer, 'the answer is shown once answering is over');

    const early = await call(players[1].client, 'quiz-advance', { roomId, expectedIndex: q });
    check(early.status === 200 && early.body.advanced === false, 'advancing during the results phase does nothing');

    await waitUntilServer(resultsEnd);

    // All five timers run out together and all five ask to advance.
    const advances = await Promise.all(players.map((p) => call(p.client, 'quiz-advance', { roomId, expectedIndex: q })));
    check(advances.every((a) => a.status === 200), 'every advance call is answered');
    const movers = advances.filter((a) => a.body?.advanced === true).length;
    check(movers === 1, `exactly one call moved the room (got ${movers})`);
    room = advances[0].body.room;
    syncClock(room);
    const last = q === QUESTIONS - 1;
    check(
      advances.every((a) => a.body.room.currentQuestionIndex === room.currentQuestionIndex && a.body.room.status === room.status),
      'every caller sees the same room afterwards',
    );
    check(last ? room.status === 'finished' : room.currentQuestionIndex === q + 1, last ? 'the room is finished' : 'the room moved to the next question');
  }

  console.log('Final scores');
  await sleep(2000); // let the last Realtime messages arrive
  const boards = await Promise.all(
    players.map(async (p) => {
      const { data, error } = await p.client.from('quiz_players').select('id, nickname, score').eq('room_id', roomId).order('id');
      if (error) throw new Error(`scoreboard for player ${p.index + 1}: ${error.message}`);
      return data;
    }),
  );
  const first = JSON.stringify(boards[0]);
  check(boards.every((b) => JSON.stringify(b) === first), 'all five see the same final scores');
  check(boards[0].length === PLAYERS, `the scoreboard has ${PLAYERS} players`);
  for (const player of players) {
    const row = boards[0].find((r) => r.id === player.playerId);
    check(row?.score === player.pointsTotal, `player ${player.index + 1} score ${row?.score} equals the points they were given (${player.pointsTotal})`);
    check(player.seen.some((s) => s.status === 'finished'), `player ${player.index + 1} saw the finish over Realtime`);
  }
  console.table(boards[0].map(({ nickname, score }) => ({ nickname, score })));

  for (const player of players) await player.client.removeAllChannels();
  const { error: deleteError } = await host.from('quiz_rooms').delete().eq('id', roomId);
  if (deleteError) console.warn(`could not delete room ${roomId}: ${deleteError.message}`);
}

main()
  .then(() => {
    console.log(failures === 0 ? '\nPASS: every check passed' : `\nFAIL: ${failures} check(s) failed`);
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch((error) => {
    console.error(`\nERROR: ${error.message}`);
    process.exit(1);
  });
