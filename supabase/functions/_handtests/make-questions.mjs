// Hand test for make-questions (A6 "Done when": 10 pages of notes give at
// least 20 verified questions).
// Uploads the typed-notes fixture as a test student, runs extract-text (which
// starts make-questions by itself), waits until the question count stops
// growing, and checks the count. The note is kept so it can feed the quiz
// tests (A8); its id is printed.
//
// Run from the repo root (Node 20 or newer):
//   node --env-file=supabase/functions/_handtests/.env supabase/functions/_handtests/make-questions.mjs [fixture-file-name]
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';

const { SUPABASE_URL, SUPABASE_ANON_KEY, TEST_EMAIL, TEST_PASSWORD } = process.env;
for (const [name, value] of Object.entries({ SUPABASE_URL, SUPABASE_ANON_KEY, TEST_EMAIL, TEST_PASSWORD })) {
  if (!value) throw new Error(`${name} is missing from supabase/functions/_handtests/.env`);
}
const FIXTURES = new URL('../_fixtures/', import.meta.url);
const FILE_NAME = process.argv[2] ?? 'typed-notes.pdf';
const MIN_QUESTIONS = 20;
const POLL_MS = 15_000;
const STABLE_POLLS = 4; // count unchanged for one minute means the chain has finished
const MAX_WAIT_MS = 10 * 60_000;
const CONTENT_TYPES = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain',
  md: 'text/markdown',
};

function headers(token, extra = {}) {
  return { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}`, ...extra };
}

async function signIn() {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`sign-in failed: ${JSON.stringify(body)}`);
  return { token: body.access_token, userId: body.user.id };
}

async function callFunction(session, name, payload) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: headers(session.token, { 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function countRows(session, path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: headers(session.token, { Prefer: 'count=exact', Range: '0-0' }),
  });
  if (!res.ok) throw new Error(`count failed: ${res.status} ${await res.text()}`);
  return Number((res.headers.get('content-range') ?? '*/0').split('/')[1]);
}

const session = await signIn();

// 1. Note row, then the file, then extract-text.
const noteRes = await fetch(`${SUPABASE_URL}/rest/v1/notes`, {
  method: 'POST',
  headers: headers(session.token, { 'Content-Type': 'application/json', Prefer: 'return=representation' }),
  body: JSON.stringify({ title: `Hand test: ${FILE_NAME}`, source: 'file', original_filename: FILE_NAME }),
});
const notes = await noteRes.json();
if (!noteRes.ok) throw new Error(`creating the note failed: ${JSON.stringify(notes)}`);
const noteId = notes[0].id;
console.log(`note ${noteId}`);

const extension = FILE_NAME.split('.').pop().toLowerCase();
const file = await readFile(new URL(FILE_NAME, FIXTURES));
const upRes = await fetch(`${SUPABASE_URL}/storage/v1/object/uploads/${session.userId}/${noteId}/${FILE_NAME}`, {
  method: 'POST',
  headers: headers(session.token, { 'Content-Type': CONTENT_TYPES[extension] ?? 'application/octet-stream' }),
  body: file,
});
if (!upRes.ok) throw new Error(`upload failed: ${upRes.status} ${await upRes.text()}`);

const extracted = await callFunction(session, 'extract-text', { noteId });
assert.equal(extracted.status, 200, `extract-text answered ${JSON.stringify(extracted)}`);
assert.equal(extracted.body.status, 'ready', `extract-text failed: ${extracted.body.reason}`);
console.log(`extract-text: ${extracted.body.chunks} chunks; make-questions started by itself`);

// 2. Wait until the verified count stops growing.
const started = Date.now();
let last = -1;
let stable = 0;
let verified = 0;
while (Date.now() - started < MAX_WAIT_MS && stable < STABLE_POLLS) {
  await sleep(POLL_MS);
  verified = await countRows(session, `questions?note_id=eq.${noteId}&verified=eq.true&select=id`);
  stable = verified === last && verified > 0 ? stable + 1 : 0;
  last = verified;
  console.log(`${Math.round((Date.now() - started) / 1000)}s: ${verified} verified questions`);
}

// 3. The checks.
const unverified = await countRows(session, `questions?note_id=eq.${noteId}&verified=eq.false&select=id`);
assert.equal(unverified, 0, 'unverified questions were left in the table; they should have been deleted');
assert.ok(verified >= MIN_QUESTIONS, `only ${verified} verified questions, expected at least ${MIN_QUESTIONS}`);

// 4. Calling again as the student is safe: nothing new to do for chunks that have questions.
const again = await callFunction(session, 'make-questions', { noteId });
assert.equal(again.status, 200, `re-run answered ${JSON.stringify(again)}`);
console.log(`re-run: ${JSON.stringify({ made: again.body.made, dropped: again.body.dropped.length, remaining: again.body.remaining })}`);

// 5. Show a few questions to read by eye.
const sample = await fetch(
  `${SUPABASE_URL}/rest/v1/questions?note_id=eq.${noteId}&select=kind,prompt,choices,answer,source_quote&limit=5`,
  { headers: headers(session.token) },
).then((r) => r.json());
console.log(JSON.stringify(sample, null, 2));

console.log(`make-questions hand test passed: ${verified} verified questions for note ${noteId}`);
