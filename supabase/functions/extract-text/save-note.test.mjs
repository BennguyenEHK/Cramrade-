import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '../../../.local-deps/tools/node_modules/@electric-sql/pglite/dist/index.js';

// Run from the repository root. Uses an isolated in-memory PostgreSQL instance.
const db = new PGlite();
try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls; create role supabase_auth_admin;
    create schema auth;
    create table auth.users (id uuid primary key, raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
    grant usage on schema auth, public to authenticated, anon;
    alter default privileges in schema public grant all on tables to authenticated;
  `);
  await db.exec(await readFile('supabase/migrations/20261005120000_initial_schema.sql', 'utf8'));
  await db.exec(
    await readFile('supabase/migrations/20261010190000_save_uploaded_note.sql', 'utf8'),
  );
  const owner = '11111111-1111-4111-8111-111111111111';
  const other = '22222222-2222-4222-8222-222222222222';
  const note = '33333333-3333-4333-8333-333333333333';
  await db.query('insert into auth.users(id) values ($1), ($2)', [owner, other]);
  await db.exec('set role authenticated');
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [owner]);
  const save = (id, chunks) =>
    db.query('select public.save_uploaded_note($1, $2, $3, $4::text[]) as id', [
      id,
      'Biology',
      'biology.pdf',
      chunks,
    ]);
  await save(note, ['Cells ', 'release energy.']);
  assert.equal((await db.query('select * from notes')).rows.length, 1);
  assert.deepEqual((await db.query('select position, text from chunks order by position')).rows, [
    { position: 0, text: 'Cells ' },
    { position: 1, text: 'release energy.' },
  ]);
  await save(note, ['Retry text must not overwrite']);
  assert.equal((await db.query('select * from notes')).rows.length, 1);
  assert.equal((await db.query('select * from chunks')).rows.length, 2);
  console.log('PASS atomic save and idempotent retry');
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [other]);
  assert.equal((await db.query('select * from notes')).rows.length, 0);
  assert.equal((await db.query('select * from chunks')).rows.length, 0);
  await assert.rejects(() => save(note, ['Other user']));
  console.log('PASS cross-account isolation and duplicate-ID protection');
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [owner]);
  await db.query("select set_config('request.jwt.claims', $1, false)", ['{"is_anonymous":true}']);
  await assert.rejects(() => save('44444444-4444-4444-8444-444444444444', ['Guest']));
  await db.query("select set_config('request.jwt.claims', '{}', false)");
  for (const chunks of [[], [null], [''], ['x'.repeat(3001)]])
    await assert.rejects(() => save('44444444-4444-4444-8444-444444444444', chunks));
  console.log('PASS guest denial and invalid-input rejection');
  await db.exec(
    "reset role; alter table chunks add constraint test_failure check (text <> 'force failure'); set role authenticated;",
  );
  await assert.rejects(() =>
    save('55555555-5555-4555-8555-555555555555', ['good', 'force failure']),
  );
  assert.equal((await db.query('select * from notes')).rows.length, 1);
  assert.equal((await db.query('select * from chunks')).rows.length, 2);
  console.log('PASS chunk failure rolls back the entire note');
} finally {
  await db.close();
}
