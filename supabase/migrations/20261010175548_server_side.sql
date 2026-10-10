-- Cramrade: server-side additions (task A4a, spec section 11).
--
-- Adds what the text extractor, syllabus reader, schedule engine and quiz
-- server need. Same style as the initial migration: every policy names its
-- role, auth.uid() is wrapped in (select ...), helpers live in "private",
-- every filtered column has an index.
--
-- Reading guide:
--   1. new columns on existing tables
--   2. new tables: study_settings, busy_days
--   3. notes policies: a note may only link to an exam the student can see
--   4. current_quiz_question(): what a player may see of the current question
--   5. Realtime for the live quiz
--   6. the private "uploads" bucket and its policies
--   7. the quote check ignores differences in whitespace


-- ---------------------------------------------------------------------------
-- 1. New columns
-- ---------------------------------------------------------------------------

-- notes: which exam the notes are for, whether the file is a syllabus, and
-- the one-line reason shown when text extraction failed.
alter table public.notes
  add column exam_id uuid references public.exams (id) on delete set null,
  add column is_syllabus boolean not null default false,
  add column failure_reason text check (failure_reason is null or char_length(failure_reason) between 1 and 300);
create index notes_exam_id_idx on public.notes (exam_id);

-- topics: the AI's starting guess at difficulty, 1 (easy) to 5 (hard).
-- Only used until the student has answered questions on the topic.
alter table public.topics
  add column difficulty smallint check (difficulty between 1 and 5);

-- study_sessions: the last session before an exam touches every topic once.
alter table public.study_sessions
  add column is_final_pass boolean not null default false;

-- quiz_rooms: group (live, with a lobby) or solo (one player, starts at once),
-- and how long the right answer shows before the next question.
-- Not added to the host's column grant (title, status, seconds_per_question),
-- so only server code can set them.
alter table public.quiz_rooms
  add column mode text not null default 'group' check (mode in ('group', 'solo')),
  add column results_seconds integer not null default 5 check (results_seconds between 0 and 60);

-- quiz_answers: points for this answer, set by server code from its own
-- clock. Not in the players' insert grant (room_id, player_id, question_id,
-- answer), so a client cannot set it.
alter table public.quiz_answers
  add column points integer not null default 0 check (points >= 0);


-- ---------------------------------------------------------------------------
-- 2. New tables
-- ---------------------------------------------------------------------------

-- study_settings: one row per student, made by the app on first use. When
-- the row is missing, the server uses the column defaults.
-- days_off holds weekday numbers, 0 = Sunday to 6 = Saturday.
create table public.study_settings (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  pace text not null default 'normal' check (pace in ('light', 'normal', 'heavy')),
  days_off smallint[] not null default '{}' check (days_off <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[]),
  session_time time not null default '18:00',
  time_zone text not null default 'UTC' check (char_length(time_zone) between 1 and 64),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_updated_at before update on public.study_settings
  for each row execute function private.set_updated_at();

-- busy_days: dates the student cannot study, from_date to to_date inclusive.
create table public.busy_days (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  from_date date not null,
  to_date date not null,
  reason text check (reason is null or char_length(reason) between 1 and 120),
  created_at timestamptz not null default now(),
  check (to_date >= from_date),
  check (to_date - from_date <= 366)
);
create index busy_days_user_id_idx on public.busy_days (user_id, from_date);

alter table public.study_settings enable row level security;
alter table public.busy_days enable row level security;

-- Both are private to the student. Guests cannot create them.
create policy "study_settings: own read" on public.study_settings
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy "study_settings: own insert" on public.study_settings
  for insert to authenticated
  with check (user_id = (select auth.uid()) and not private.is_guest());

create policy "study_settings: own update" on public.study_settings
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "study_settings: own delete" on public.study_settings
  for delete to authenticated
  using (user_id = (select auth.uid()));

create policy "busy_days: own read" on public.busy_days
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy "busy_days: own insert" on public.busy_days
  for insert to authenticated
  with check (user_id = (select auth.uid()) and not private.is_guest());

create policy "busy_days: own update" on public.busy_days
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "busy_days: own delete" on public.busy_days
  for delete to authenticated
  using (user_id = (select auth.uid()));


-- ---------------------------------------------------------------------------
-- 3. Notes policies: exam_id must point at an exam the student can see
-- ---------------------------------------------------------------------------
-- Same as the initial policies plus one line, so nobody can attach notes to
-- another student's exam. The exams subquery runs under the exams read
-- policy, so "can see" means owner or member of the exam's group.

drop policy "notes: owner creates" on public.notes;
create policy "notes: owner creates" on public.notes
  for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and not private.is_guest()
    and (group_id is null or private.is_group_member(group_id))
    and (exam_id is null or exists (select 1 from public.exams e where e.id = notes.exam_id))
  );

drop policy "notes: owner updates" on public.notes;
create policy "notes: owner updates" on public.notes
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (
    owner_id = (select auth.uid())
    and (group_id is null or private.is_group_member(group_id))
    and (exam_id is null or exists (select 1 from public.exams e where e.id = notes.exam_id))
  );


-- ---------------------------------------------------------------------------
-- 4. current_quiz_question(room_id)
-- ---------------------------------------------------------------------------
-- Players never read quiz_room_questions (host only). They call this instead.
-- It returns the question the room is showing now, and the answer only once
-- the answering time is over (server clock). No row when the room is not
-- running. Refuses callers who are neither a player nor the host.

create or replace function public.current_quiz_question(room_id uuid)
returns table (
  question_id uuid,
  question_index integer,
  prompt text,
  kind text,
  choices jsonb,
  answer text,
  question_started_at timestamptz,
  seconds_per_question integer,
  results_seconds integer,
  server_now timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  rid uuid := current_quiz_question.room_id;
begin
  if (select auth.uid()) is null then
    raise exception 'not signed in';
  end if;
  if not (private.is_quiz_player(rid) or private.is_quiz_host(rid)) then
    raise exception 'not in this quiz';
  end if;

  return query
  select
    q.id,
    r.current_question_index,
    q.prompt,
    q.kind,
    q.choices,
    case
      when now() >= r.question_started_at + r.seconds_per_question * interval '1 second' then q.answer
    end,
    r.question_started_at,
    r.seconds_per_question,
    r.results_seconds,
    now() -- the server's clock, so a screen can correct its own countdown
  from public.quiz_rooms r
  join public.quiz_room_questions rq
    on rq.room_id = r.id
   and rq.position = r.current_question_index
  join public.questions q on q.id = rq.question_id
  where r.id = rid
    and r.status = 'running'
    and r.question_started_at is not null;
end;
$$;

revoke execute on function public.current_quiz_question(uuid) from public, anon;
grant execute on function public.current_quiz_question(uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- 5. Realtime
-- ---------------------------------------------------------------------------
-- Players follow their room (status, index, start time) and the scoreboard.
-- Row Level Security still decides who receives which row.
-- quiz_answers stays off Realtime.

alter publication supabase_realtime add table public.quiz_rooms, public.quiz_players;


-- ---------------------------------------------------------------------------
-- 6. The "uploads" bucket
-- ---------------------------------------------------------------------------
-- Private. Files live at <user id>/<note id>/<file name> for a few seconds:
-- extract-text deletes them once the text is out. The same settings are in
-- supabase/config.toml for local stacks; this insert is what creates the
-- bucket on the live project.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'uploads',
  'uploads',
  false,
  20971520, -- 20 MiB
  array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
    'text/markdown',
    'text/x-markdown'
  ]
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- A student may add, see and remove files only in their own folder.
-- Guests cannot upload.
create policy "uploads: own folder insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'uploads'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and not private.is_guest()
  );

create policy "uploads: own folder read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'uploads'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "uploads: own folder delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'uploads'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );


-- ---------------------------------------------------------------------------
-- 7. Quote check: ignore differences in whitespace
-- ---------------------------------------------------------------------------
-- The initial trigger wanted the quote character for character, so a quote
-- the AI copied across a line break failed. Spec section 3 sets the rule
-- "whitespace collapsed, case kept". Both sides are normalised the same way
-- as quoteAppears() in supabase/functions/_shared/quote-check.ts: every run of
-- ASCII whitespace (space, tab, line feed, carriage return, form feed,
-- vertical tab) becomes one space, then the ends are trimmed. The class is
-- spelled out instead of \s because \s differs between Postgres and
-- JavaScript (U+FEFF, U+0085); with the explicit class both sides agree.

create or replace function private.collapse_whitespace(t text)
returns text
language sql
immutable
set search_path = ''
as $$
  select trim(regexp_replace(t, '[ \t\n\r\f\v]+', ' ', 'g'));
$$;

-- True when quote appears in chunk_text after both are collapsed. An empty
-- quote is never found (position() would say 1).
create or replace function private.quote_in_chunk(quote text, chunk_text text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select private.collapse_whitespace(quote) <> ''
     and position(private.collapse_whitespace(quote) in private.collapse_whitespace(chunk_text)) > 0;
$$;

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

  new.verified = private.quote_in_chunk(new.source_quote, chunk_text);
  return new;
end;
$$;

create or replace function private.reverify_chunk_questions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.questions q
  set verified = private.quote_in_chunk(q.source_quote, new.text)
  where q.chunk_id = new.id;
  return new;
end;
$$;

revoke execute on function
  private.collapse_whitespace(text),
  private.quote_in_chunk(text, text)
from public;
grant execute on function
  private.collapse_whitespace(text),
  private.quote_in_chunk(text, text)
to authenticated, service_role;
