// Hand test for read-syllabus (A4 "Done when").
// Uploads both syllabus fixtures as a test student, runs extract-text and
// read-syllabus on each, checks the answers, then deletes the test notes.
//
// Run from the repo root (Node 20 or newer):
//   node --env-file=supabase/functions/_handtests/.env supabase/functions/_handtests/read-syllabus.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const { SUPABASE_URL, SUPABASE_ANON_KEY, TEST_EMAIL, TEST_PASSWORD } = process.env;
for (const [name, value] of Object.entries({ SUPABASE_URL, SUPABASE_ANON_KEY, TEST_EMAIL, TEST_PASSWORD })) {
  if (!value) throw new Error(`${name} is missing from supabase/functions/_handtests/.env`);
}
const FIXTURES = new URL('../_fixtures/', import.meta.url);

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

async function uploadSyllabus(session, fileName) {
  const noteRes = await fetch(`${SUPABASE_URL}/rest/v1/notes`, {
    method: 'POST',
    headers: headers(session.token, { 'Content-Type': 'application/json', Prefer: 'return=representation' }),
    body: JSON.stringify({ title: `Hand test: ${fileName}`, source: 'file', original_filename: fileName, is_syllabus: true }),
  });
  const notes = await noteRes.json();
  if (!noteRes.ok) throw new Error(`creating the note failed: ${JSON.stringify(notes)}`);
  const noteId = notes[0].id;

  const file = await readFile(new URL(fileName, FIXTURES));
  const upRes = await fetch(`${SUPABASE_URL}/storage/v1/object/uploads/${session.userId}/${noteId}/${fileName}`, {
    method: 'POST',
    headers: headers(session.token, { 'Content-Type': 'text/plain' }),
    body: file,
  });
  if (!upRes.ok) throw new Error(`upload failed: ${upRes.status} ${await upRes.text()}`);

  const extracted = await callFunction(session, 'extract-text', { noteId });
  assert.equal(extracted.status, 200, `extract-text answered ${JSON.stringify(extracted)}`);
  assert.equal(extracted.body.status, 'ready', `extract-text failed: ${extracted.body.reason}`);
  console.log(`${fileName}: ${extracted.body.chunks} chunk(s)`);
  return noteId;
}

async function deleteNote(session, noteId) {
  await fetch(`${SUPABASE_URL}/rest/v1/notes?id=eq.${noteId}`, { method: 'DELETE', headers: headers(session.token) });
}

const collapse = (s) => s.replace(/\s+/g, ' ').trim();
const session = await signIn();
const created = [];

try {
  // 1. Syllabus with two dates
  const withDatesId = await uploadSyllabus(session, 'syllabus-with-dates.txt');
  created.push(withDatesId);
  const withDates = await callFunction(session, 'read-syllabus', { noteId: withDatesId });
  console.log('with dates:', JSON.stringify(withDates.body, null, 2));
  assert.equal(withDates.status, 200);
  assert.equal(withDates.body.found, true);
  assert.deepEqual(withDates.body.proposals.map((p) => p.date).sort(), ['2026-11-12', '2026-12-15']);
  const source = collapse(await readFile(new URL('syllabus-with-dates.txt', FIXTURES), 'utf8'));
  for (const p of withDates.body.proposals) {
    assert.ok(source.includes(collapse(p.evidence)), `evidence is not in the file: ${p.evidence}`);
    assert.equal(p.kind, 'exam');
    assert.equal(p.past, false);
  }

  // 2. Syllabus with no dates
  const noDatesId = await uploadSyllabus(session, 'syllabus-no-dates.txt');
  created.push(noDatesId);
  const noDates = await callFunction(session, 'read-syllabus', { noteId: noDatesId });
  console.log('no dates:', JSON.stringify(noDates.body));
  assert.equal(noDates.status, 200);
  assert.deepEqual(noDates.body, { found: false, proposals: [] });

  // 3. A note that is not a syllabus id at all
  const bad = await callFunction(session, 'read-syllabus', { noteId: 'not-a-uuid' });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error.code, 'bad_input');

  console.log('read-syllabus hand test passed');
} finally {
  for (const id of created) await deleteNote(session, id);
}
