-- Cramrade: first set of tables (task A2).
--
-- One database for every student. Row Level Security (RLS) on every table
-- makes sure a student only sees their own rows, plus rows shared with a study
-- group they belong to. Server code (Edge Functions using the service role)
-- bypasses RLS and is the only writer of questions, scores and quiz timing.
--
-- Reading guide:
--   1. the private schema and two small helpers
--   2. tables, one block each, with indexes
--   3. helper functions that read tables (used by the policies)
--   4. triggers (updated_at, new user profile, group owner, question check)
--   5. RLS policies, one block per table
--   6. functions the app calls directly (join_group, join_quiz_room)
--
-- Policy style follows https://supabase.com/docs/guides/database/postgres/row-level-security:
--   - every policy names its role ("to authenticated")
--   - auth.uid() is wrapped as (select auth.uid()) so Postgres runs it once per query
--   - helper functions live in the "private" schema, which the API does not expose,
--     run as "security definer" with an empty search_path, and are granted only
--     to the roles that need them
--   - every column a policy filters on has an index


-- ---------------------------------------------------------------------------
-- 1. Schema and small helpers
-- ---------------------------------------------------------------------------

create schema if not exists private;

-- The authenticated role runs the policies and column defaults, so it must be
-- able to reach the helpers. service_role runs the Edge Functions.
-- supabase_auth_admin fires the new-user trigger.
grant usage on schema private to authenticated, service_role, supabase_auth_admin;

-- A short code for inviting people: 6 characters from an alphabet without
-- look-alikes (no 0/O, 1/I/L). About one billion combinations.
create or replace function private.generate_short_code()
returns text
language sql
volatile
set search_path = ''
as $$
  select string_agg(
    substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 1 + floor(random() * 31)::int, 1),
    ''
  )
  from generate_series(1, 6);
$$;

-- True when the current user signed in as a guest (anonymous sign-in).
-- Guests can play quizzes but cannot create exams, notes, groups or rooms.
create or replace function private.is_guest()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false);
$$;


-- ---------------------------------------------------------------------------
-- 2. Tables
-- ---------------------------------------------------------------------------

-- profiles: one per auth user, created by trigger (see section 4).
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (display_name is null or char_length(display_name) between 1 and 60),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- groups: a few classmates who share exams, notes and quizzes.
create table public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  join_code text not null unique default private.generate_short_code(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index groups_owner_id_idx on public.groups (owner_id);

-- group_members: who is in which group. The owner's row is added by trigger.
create table public.group_members (
  group_id uuid not null references public.groups (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
create index group_members_user_id_idx on public.group_members (user_id);

-- exams: a dated test. Every row here has been confirmed by the student;
-- dates the syllabus reader proposes are never saved until then.
create table public.exams (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  group_id uuid references public.groups (id) on delete set null,
  title text not null check (char_length(title) between 1 and 120),
  exam_date date not null,
  kind text not null default 'exam' check (kind in ('exam', 'quiz', 'competition')),
  source text not null default 'manual' check (source in ('manual', 'syllabus')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index exams_owner_id_idx on public.exams (owner_id);
create index exams_group_id_idx on public.exams (group_id);

-- topics: subject areas inside an exam.
create table public.topics (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.exams (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  position integer not null default 0,
  created_at timestamptz not null default now()
);
create index topics_exam_id_idx on public.topics (exam_id);

-- notes: one set of notes, as text only. The text is in chunks.
create table public.notes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  group_id uuid references public.groups (id) on delete set null,
  title text not null check (char_length(title) between 1 and 120),
  source text not null check (source in ('file', 'photo', 'text')),
  original_filename text,
  status text not null default 'processing' check (status in ('processing', 'ready', 'failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index notes_owner_id_idx on public.notes (owner_id);
create index notes_group_id_idx on public.notes (group_id);

-- chunks: numbered pieces of a note's text. Questions point at these.
-- The unique constraint doubles as the index on note_id.
create table public.chunks (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references public.notes (id) on delete cascade,
  position integer not null,
  text text not null,
  created_at timestamptz not null default now(),
  unique (note_id, position)
);

-- questions: made by the server from chunks. "verified" is set by trigger
-- (section 4) and means source_quote really appears in the chunk's text.
create table public.questions (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references public.notes (id) on delete cascade,
  chunk_id uuid not null references public.chunks (id) on delete cascade,
  exam_id uuid references public.exams (id) on delete set null,
  topic_id uuid references public.topics (id) on delete set null,
  kind text not null check (kind in ('multiple_choice', 'short_answer', 'flashcard')),
  prompt text not null check (char_length(prompt) > 0),
  choices jsonb check (choices is null or jsonb_typeof(choices) = 'array'),
  answer text not null check (char_length(answer) > 0),
  source_quote text not null check (char_length(source_quote) > 0),
  verified boolean not null default false,
  created_at timestamptz not null default now(),
  -- a multiple-choice question must have choices; the other kinds must not
  check ((kind = 'multiple_choice') = (choices is not null))
);
create index questions_note_id_idx on public.questions (note_id);
create index questions_chunk_id_idx on public.questions (chunk_id);
create index questions_exam_id_idx on public.questions (exam_id);
create index questions_topic_id_idx on public.questions (topic_id);

-- study_sessions: the plan. One row per short session on the way to an exam.
create table public.study_sessions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  exam_id uuid not null references public.exams (id) on delete cascade,
  scheduled_for timestamptz not null,
  status text not null default 'planned' check (status in ('planned', 'done', 'skipped')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index study_sessions_owner_id_idx on public.study_sessions (owner_id, scheduled_for);
create index study_sessions_exam_id_idx on public.study_sessions (exam_id);

-- session_questions: which questions a session asks, in order.
create table public.session_questions (
  session_id uuid not null references public.study_sessions (id) on delete cascade,
  question_id uuid not null references public.questions (id) on delete cascade,
  position integer not null default 0,
  primary key (session_id, question_id)
);
create index session_questions_question_id_idx on public.session_questions (question_id);

-- attempts: answers given while studying alone. session_id is null for an
-- on-demand review outside the plan.
create table public.attempts (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references public.study_sessions (id) on delete cascade,
  question_id uuid not null references public.questions (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  answer text,
  is_correct boolean not null,
  answered_at timestamptz not null default now()
);
create index attempts_user_id_idx on public.attempts (user_id);
create index attempts_session_id_idx on public.attempts (session_id);
create index attempts_question_id_idx on public.attempts (question_id);

-- quiz_rooms: one live group quiz. Timing columns are written by the server only.
create table public.quiz_rooms (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  group_id uuid references public.groups (id) on delete set null,
  title text not null default 'Quiz' check (char_length(title) between 1 and 120),
  code text not null unique default private.generate_short_code(),
  status text not null default 'lobby' check (status in ('lobby', 'running', 'finished')),
  seconds_per_question integer not null default 20 check (seconds_per_question between 5 and 300),
  current_question_index integer not null default -1,
  question_started_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index quiz_rooms_host_id_idx on public.quiz_rooms (host_id);
create index quiz_rooms_group_id_idx on public.quiz_rooms (group_id);

-- quiz_room_questions: the room's question list. Host only, so players
-- cannot read ahead.
create table public.quiz_room_questions (
  room_id uuid not null references public.quiz_rooms (id) on delete cascade,
  question_id uuid not null references public.questions (id) on delete cascade,
  position integer not null,
  primary key (room_id, position),
  unique (room_id, question_id)
);

-- quiz_players: one row per player per room. Made by join_quiz_room().
-- user_id is set for everyone (guests sign in anonymously) and only becomes
-- null if the account is deleted later, so old scoreboards survive.
create table public.quiz_players (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.quiz_rooms (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  nickname text not null check (char_length(nickname) between 1 and 24),
  score integer not null default 0,
  joined_at timestamptz not null default now()
);
create index quiz_players_room_id_idx on public.quiz_players (room_id);
create index quiz_players_user_id_idx on public.quiz_players (user_id);
create unique index quiz_players_room_user_uniq on public.quiz_players (room_id, user_id)
  where user_id is not null;

-- quiz_answers: one answer per player per question. answered_at comes from
-- the database clock; is_correct is filled in by the server.
create table public.quiz_answers (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.quiz_rooms (id) on delete cascade,
  player_id uuid not null references public.quiz_players (id) on delete cascade,
  question_id uuid not null references public.questions (id) on delete cascade,
  answer text not null,
  is_correct boolean,
  answered_at timestamptz not null default now(),
  unique (player_id, question_id)
);
create index quiz_answers_room_id_idx on public.quiz_answers (room_id);
create index quiz_answers_question_id_idx on public.quiz_answers (question_id);

-- calendar_feeds: the secret behind a student's calendar link.
create table public.calendar_feeds (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  token text not null unique default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  created_at timestamptz not null default now()
);


-- ---------------------------------------------------------------------------
-- 3. Helper functions that read tables
-- ---------------------------------------------------------------------------
-- All "security definer": they read the tables as their owner, not as the
-- caller, so a policy on group_members can ask "is this user a member"
-- without going through the group_members policies again (which would loop).

-- True when the current user belongs to the given group.
create or replace function private.is_group_member(gid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.group_members gm
    where gm.group_id = gid
      and gm.user_id = (select auth.uid())
  );
$$;

-- True when the current user owns the given group.
create or replace function private.is_group_owner(gid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.groups g
    where g.id = gid
      and g.owner_id = (select auth.uid())
  );
$$;

-- True when the current user and the other user are in at least one group
-- together. Used so group members can see each other's names.
create or replace function private.shares_group_with(other uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.group_members mine
    join public.group_members theirs on theirs.group_id = mine.group_id
    where mine.user_id = (select auth.uid())
      and theirs.user_id = other
  );
$$;

-- True when the current user hosts the given quiz room.
create or replace function private.is_quiz_host(rid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.quiz_rooms r
    where r.id = rid
      and r.host_id = (select auth.uid())
  );
$$;

-- True when the current user is a player in the given quiz room.
create or replace function private.is_quiz_player(rid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.quiz_players p
    where p.room_id = rid
      and p.user_id = (select auth.uid())
  );
$$;

-- True when the given question is the one the room is showing right now and
-- the quiz is running. This is the only moment a player may answer it.
create or replace function private.is_current_quiz_question(rid uuid, qid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.quiz_rooms r
    join public.quiz_room_questions rq
      on rq.room_id = r.id
     and rq.position = r.current_question_index
    where r.id = rid
      and r.status = 'running'
      and rq.question_id = qid
  );
$$;

revoke execute on function
  private.generate_short_code(),
  private.is_guest(),
  private.is_group_member(uuid),
  private.is_group_owner(uuid),
  private.shares_group_with(uuid),
  private.is_quiz_host(uuid),
  private.is_quiz_player(uuid),
  private.is_current_quiz_question(uuid, uuid)
from public;

grant execute on function
  private.generate_short_code(),
  private.is_guest(),
  private.is_group_member(uuid),
  private.is_group_owner(uuid),
  private.shares_group_with(uuid),
  private.is_quiz_host(uuid),
  private.is_quiz_player(uuid),
  private.is_current_quiz_question(uuid, uuid)
to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 4. Triggers
-- ---------------------------------------------------------------------------

-- Keep updated_at honest.
create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_updated_at before update on public.profiles
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.groups
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.exams
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.notes
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.study_sessions
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.quiz_rooms
  for each row execute function private.set_updated_at();

-- A profile row for every new account. The sign-up form can pass
-- display_name in the user metadata (options.data); otherwise it stays empty.
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, nullif(left(trim(new.raw_user_meta_data ->> 'display_name'), 60), ''));
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

-- The owner is the first member of a new group.
create or replace function private.handle_new_group()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.group_members (group_id, user_id, role)
  values (new.id, new.owner_id, 'owner');
  return new;
end;
$$;

create trigger on_group_created after insert on public.groups
  for each row execute function private.handle_new_group();

-- Every question must trace to its chunk. The database, not the caller,
-- decides "verified": true only when source_quote is found word for word in
-- the chunk's text. A chunk from another note is refused outright.
create or replace function private.verify_question()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  chunk_text text;
begin
  select c.text into chunk_text
  from public.chunks c
  where c.id = new.chunk_id
    and c.note_id = new.note_id;

  if chunk_text is null then
    raise exception 'question chunk % does not belong to note %', new.chunk_id, new.note_id;
  end if;

  new.verified = position(new.source_quote in chunk_text) > 0;
  return new;
end;
$$;

create trigger verify_question before insert or update of chunk_id, note_id, source_quote
  on public.questions
  for each row execute function private.verify_question();

-- When a student fixes the text of a chunk, re-check every question made
-- from it. A question whose quote no longer appears becomes unverified and
-- the app stops showing it.
create or replace function private.reverify_chunk_questions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.questions q
  set verified = position(q.source_quote in new.text) > 0
  where q.chunk_id = new.id;
  return new;
end;
$$;

create trigger reverify_chunk_questions after update of text on public.chunks
  for each row execute function private.reverify_chunk_questions();

revoke execute on function
  private.set_updated_at(),
  private.handle_new_user(),
  private.handle_new_group(),
  private.verify_question(),
  private.reverify_chunk_questions()
from public;
grant execute on function
  private.set_updated_at(),
  private.handle_new_group(),
  private.verify_question(),
  private.reverify_chunk_questions()
to authenticated, service_role;
grant execute on function private.handle_new_user() to supabase_auth_admin;


-- ---------------------------------------------------------------------------
-- 5. Row Level Security
-- ---------------------------------------------------------------------------
-- With RLS on and no matching policy, a request gets nothing. The service
-- role used by Edge Functions bypasses RLS. Guests (anonymous sign-in) are
-- "authenticated" too, so is_guest() is checked where it matters.

alter table public.profiles enable row level security;
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.exams enable row level security;
alter table public.topics enable row level security;
alter table public.notes enable row level security;
alter table public.chunks enable row level security;
alter table public.questions enable row level security;
alter table public.study_sessions enable row level security;
alter table public.session_questions enable row level security;
alter table public.attempts enable row level security;
alter table public.quiz_rooms enable row level security;
alter table public.quiz_room_questions enable row level security;
alter table public.quiz_players enable row level security;
alter table public.quiz_answers enable row level security;
alter table public.calendar_feeds enable row level security;

-- profiles: see yourself and your group mates; edit only yourself.
create policy "profiles: read own or group mates" on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or private.shares_group_with(id));

create policy "profiles: update own" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- groups: members read; the owner creates, renames and deletes.
-- Joining happens through join_group() (section 6), not a policy.
create policy "groups: owner or members read" on public.groups
  for select to authenticated
  using (owner_id = (select auth.uid()) or private.is_group_member(id));

create policy "groups: owner creates" on public.groups
  for insert to authenticated
  with check (owner_id = (select auth.uid()) and not private.is_guest());

create policy "groups: owner updates" on public.groups
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy "groups: owner deletes" on public.groups
  for delete to authenticated
  using (owner_id = (select auth.uid()));

-- group_members: members see the list; a member can leave; the owner can
-- remove anyone but themselves. No insert policy: rows come from the
-- new-group trigger and from join_group().
create policy "group_members: members read" on public.group_members
  for select to authenticated
  using (private.is_group_member(group_id));

create policy "group_members: leave or owner removes" on public.group_members
  for delete to authenticated
  using (
    role <> 'owner'
    and (user_id = (select auth.uid()) or private.is_group_owner(group_id))
  );

-- exams: owner does everything; group members read.
create policy "exams: owner or group reads" on public.exams
  for select to authenticated
  using (owner_id = (select auth.uid()) or private.is_group_member(group_id));

create policy "exams: owner creates" on public.exams
  for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and not private.is_guest()
    and (group_id is null or private.is_group_member(group_id))
  );

create policy "exams: owner updates" on public.exams
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (
    owner_id = (select auth.uid())
    and (group_id is null or private.is_group_member(group_id))
  );

create policy "exams: owner deletes" on public.exams
  for delete to authenticated
  using (owner_id = (select auth.uid()));

-- topics: follow the exam.
create policy "topics: read with exam" on public.topics
  for select to authenticated
  using (exists (
    select 1 from public.exams e
    where e.id = topics.exam_id
      and (e.owner_id = (select auth.uid()) or private.is_group_member(e.group_id))
  ));

create policy "topics: exam owner writes" on public.topics
  for all to authenticated
  using (exists (
    select 1 from public.exams e
    where e.id = topics.exam_id and e.owner_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from public.exams e
    where e.id = topics.exam_id and e.owner_id = (select auth.uid())
  ));

-- notes: owner does everything; group members read.
create policy "notes: owner or group reads" on public.notes
  for select to authenticated
  using (owner_id = (select auth.uid()) or private.is_group_member(group_id));

create policy "notes: owner creates" on public.notes
  for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and not private.is_guest()
    and (group_id is null or private.is_group_member(group_id))
  );

create policy "notes: owner updates" on public.notes
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (
    owner_id = (select auth.uid())
    and (group_id is null or private.is_group_member(group_id))
  );

create policy "notes: owner deletes" on public.notes
  for delete to authenticated
  using (owner_id = (select auth.uid()));

-- chunks: follow the note. The owner may insert chunks (typed notes; the
-- server inserts them for uploads) and fix their text (unclear words from a
-- photo). Deleting the note deletes them.
create policy "chunks: read with note" on public.chunks
  for select to authenticated
  using (exists (
    select 1 from public.notes n
    where n.id = chunks.note_id
      and (n.owner_id = (select auth.uid()) or private.is_group_member(n.group_id))
  ));

create policy "chunks: note owner inserts" on public.chunks
  for insert to authenticated
  with check (exists (
    select 1 from public.notes n
    where n.id = chunks.note_id and n.owner_id = (select auth.uid())
  ));

create policy "chunks: note owner updates" on public.chunks
  for update to authenticated
  using (exists (
    select 1 from public.notes n
    where n.id = chunks.note_id and n.owner_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from public.notes n
    where n.id = chunks.note_id and n.owner_id = (select auth.uid())
  ));

-- questions: follow the note. Only the server inserts (so the trace to the
-- notes is always checked). The note's owner can delete a bad one.
create policy "questions: read with note" on public.questions
  for select to authenticated
  using (exists (
    select 1 from public.notes n
    where n.id = questions.note_id
      and (n.owner_id = (select auth.uid()) or private.is_group_member(n.group_id))
  ));

create policy "questions: note owner deletes" on public.questions
  for delete to authenticated
  using (exists (
    select 1 from public.notes n
    where n.id = questions.note_id and n.owner_id = (select auth.uid())
  ));

-- study_sessions and session_questions: private to the owner.
create policy "study_sessions: owner all" on public.study_sessions
  for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy "session_questions: owner all" on public.session_questions
  for all to authenticated
  using (exists (
    select 1 from public.study_sessions s
    where s.id = session_questions.session_id and s.owner_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from public.study_sessions s
    where s.id = session_questions.session_id and s.owner_id = (select auth.uid())
  ));

-- attempts: the student writes their own, once, and reads them back.
create policy "attempts: own read" on public.attempts
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy "attempts: own insert" on public.attempts
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (session_id is null or exists (
      select 1 from public.study_sessions s
      where s.id = attempts.session_id and s.owner_id = (select auth.uid())
    ))
  );

-- quiz_rooms: host and players read. The host creates and deletes. The host
-- may update title, status and seconds_per_question only (column grant
-- below); current_question_index and question_started_at are server-only,
-- so a client cannot move the clock.
create policy "quiz_rooms: host or player reads" on public.quiz_rooms
  for select to authenticated
  using (host_id = (select auth.uid()) or private.is_quiz_player(id));

create policy "quiz_rooms: host creates" on public.quiz_rooms
  for insert to authenticated
  with check (
    host_id = (select auth.uid())
    and not private.is_guest()
    and (group_id is null or private.is_group_member(group_id))
  );

create policy "quiz_rooms: host updates" on public.quiz_rooms
  for update to authenticated
  using (host_id = (select auth.uid()))
  with check (host_id = (select auth.uid()));

create policy "quiz_rooms: host deletes" on public.quiz_rooms
  for delete to authenticated
  using (host_id = (select auth.uid()));

revoke update on public.quiz_rooms from anon, authenticated;
grant update (title, status, seconds_per_question) on public.quiz_rooms to authenticated;

-- quiz_room_questions: host only. Players get questions over the live
-- channel one at a time and cannot read ahead.
create policy "quiz_room_questions: host all" on public.quiz_room_questions
  for all to authenticated
  using (private.is_quiz_host(room_id))
  with check (private.is_quiz_host(room_id));

-- quiz_players: everyone in the room sees the scoreboard. No insert or
-- update for clients: join_quiz_room() adds players and the server sets
-- score. The host can remove a player.
create policy "quiz_players: room reads" on public.quiz_players
  for select to authenticated
  using (private.is_quiz_host(room_id) or private.is_quiz_player(room_id));

create policy "quiz_players: host removes" on public.quiz_players
  for delete to authenticated
  using (private.is_quiz_host(room_id));

-- quiz_answers: a player writes their own answer to the current question,
-- once. The player sees their own answers; the host sees all. The column
-- grant below stops a client from setting answered_at or is_correct.
create policy "quiz_answers: own or host reads" on public.quiz_answers
  for select to authenticated
  using (
    private.is_quiz_host(room_id)
    or exists (
      select 1 from public.quiz_players p
      where p.id = quiz_answers.player_id and p.user_id = (select auth.uid())
    )
  );

create policy "quiz_answers: player answers current question" on public.quiz_answers
  for insert to authenticated
  with check (
    exists (
      select 1 from public.quiz_players p
      where p.id = quiz_answers.player_id
        and p.room_id = quiz_answers.room_id
        and p.user_id = (select auth.uid())
    )
    and private.is_current_quiz_question(room_id, question_id)
  );

revoke insert on public.quiz_answers from anon, authenticated;
grant insert (room_id, player_id, question_id, answer) on public.quiz_answers to authenticated;

-- calendar_feeds: private to the student. Delete and insert again to get a
-- fresh secret. The calendar Edge Function reads by token with the service role.
create policy "calendar_feeds: own read" on public.calendar_feeds
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy "calendar_feeds: own insert" on public.calendar_feeds
  for insert to authenticated
  with check (user_id = (select auth.uid()) and not private.is_guest());

create policy "calendar_feeds: own delete" on public.calendar_feeds
  for delete to authenticated
  using (user_id = (select auth.uid()));


-- ---------------------------------------------------------------------------
-- 6. Functions the app calls (supabase.rpc)
-- ---------------------------------------------------------------------------

-- Join a study group with its code. Returns the group id. Joining twice is
-- harmless. Guests cannot join groups.
create or replace function public.join_group(code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  gid uuid;
begin
  if uid is null then
    raise exception 'not signed in';
  end if;
  if private.is_guest() then
    raise exception 'guests cannot join groups';
  end if;

  select g.id into gid
  from public.groups g
  where g.join_code = upper(trim(join_group.code));

  if gid is null then
    raise exception 'no group with that code';
  end if;

  insert into public.group_members (group_id, user_id, role)
  values (gid, uid, 'member')
  on conflict (group_id, user_id) do nothing;

  return gid;
end;
$$;

-- Join a quiz room with its code and a nickname. Returns the player row.
-- A player who already joined this room (same account, or same browser
-- session for a guest) gets their existing row back, score included, which
-- is how rejoining works. Rooms that have finished cannot be joined.
create or replace function public.join_quiz_room(code text, nickname text)
returns public.quiz_players
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  rid uuid;
  player public.quiz_players;
begin
  if uid is null then
    raise exception 'not signed in';
  end if;

  select r.id into rid
  from public.quiz_rooms r
  where r.code = upper(trim(join_quiz_room.code))
    and r.status <> 'finished';

  if rid is null then
    raise exception 'no open quiz with that code';
  end if;

  select p.* into player
  from public.quiz_players p
  where p.room_id = rid and p.user_id = uid;

  if player.id is not null then
    return player;
  end if;

  insert into public.quiz_players (room_id, user_id, nickname)
  values (rid, uid, trim(join_quiz_room.nickname))
  returning * into player;

  return player;
end;
$$;

revoke execute on function public.join_group(text), public.join_quiz_room(text, text) from public, anon;
grant execute on function public.join_group(text), public.join_quiz_room(text, text) to authenticated;
