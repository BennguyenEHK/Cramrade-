-- A8 quiz server: the steps that must happen in one go on the database.
--
-- The Edge Functions quiz-create, quiz-start, quiz-answer and quiz-advance
-- check who is calling, then call these functions with the service role.
-- Each decision that depends on time ("is the question still open?", "is
-- it time to move on?") is made here with the database clock, inside the
-- same statement that writes the result, so two requests can never both
-- win and no client clock is ever trusted.
--
-- They live in public because the API only exposes public; execute is
-- revoked from every app role at the bottom of this file.

-- Points for one answer. Twin of points() in
-- supabase/functions/_shared/scoring.ts; change both together.
-- 1000 at an instant answer, 500 at the last moment, 0 when wrong.
create or replace function private.quiz_points(correct boolean, ms_taken bigint, ms_allowed bigint)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case
    when not correct then 0
    -- numeric division, so an exact half rounds away from zero like Math.round
    else round(1000 - (500 * least(greatest(ms_taken, 0), ms_allowed))::numeric / ms_allowed)::integer
  end;
$$;

-- The room as the quiz functions return it, plus the question count and
-- the database clock. Null when the room does not exist.
create or replace function public.quiz_room_state(p_room_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'room', to_jsonb(r),
    'questionCount', (select count(*) from public.quiz_room_questions q where q.room_id = r.id),
    'serverNow', now()
  )
  from public.quiz_rooms r
  where r.id = p_room_id;
$$;

-- Start a room: lobby to running, first question, clock starts now.
-- Only a room in the lobby with at least one player and one question starts.
create or replace function public.start_quiz_room(p_room_id uuid)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_moved integer;
begin
  update public.quiz_rooms r
  set status = 'running',
      current_question_index = 0,
      question_started_at = now()
  where r.id = p_room_id
    and r.status = 'lobby'
    and exists (select 1 from public.quiz_players p where p.room_id = r.id)
    and exists (select 1 from public.quiz_room_questions q where q.room_id = r.id);
  get diagnostics v_moved = row_count;

  return jsonb_build_object('started', v_moved > 0) || public.quiz_room_state(p_room_id);
end;
$$;

-- Record one answer and add its points to the player's score.
--
-- p_is_correct is worked out by the Edge Function (isCorrectAnswer in
-- scoring.ts), because it only compares text. Everything that depends on
-- time or on earlier answers is decided here:
--   - the room is running and p_question_id is the question at the
--     current position
--   - now() is before question_started_at + seconds_per_question
--   - the player has not answered this question before
-- The room row is locked for share, so an advance (which updates that row)
-- waits until this answer is written, and this answer never lands on a
-- question that has just been replaced.
create or replace function public.submit_quiz_answer(
  p_room_id uuid,
  p_user_id uuid,
  p_question_id uuid,
  p_answer text,
  p_is_correct boolean
)
returns jsonb
language plpgsql
set search_path = ''
as $$
-- Variables start with v_ so none shares a name with a column (plpgsql
-- would call that ambiguous, for example in the on conflict list).
declare
  v_room public.quiz_rooms;
  v_player_id uuid;
  v_answered_at timestamptz := now();
  v_ms_allowed bigint;
  v_ms_taken bigint;
  v_points integer;
  v_score integer;
begin
  select r.* into v_room
  from public.quiz_rooms r
  where r.id = p_room_id
  for share;

  if v_room.id is null then
    return jsonb_build_object('outcome', 'no_room');
  end if;

  select p.id into v_player_id
  from public.quiz_players p
  where p.room_id = p_room_id and p.user_id = p_user_id;

  if v_player_id is null then
    return jsonb_build_object('outcome', 'not_player');
  end if;

  if v_room.status <> 'running'
     or v_room.question_started_at is null
     or not exists (
       select 1 from public.quiz_room_questions rq
       where rq.room_id = v_room.id
         and rq.position = v_room.current_question_index
         and rq.question_id = p_question_id
     ) then
    return jsonb_build_object('outcome', 'not_current');
  end if;

  v_ms_allowed := v_room.seconds_per_question::bigint * 1000;
  v_ms_taken := floor(extract(epoch from (v_answered_at - v_room.question_started_at)) * 1000)::bigint;

  if v_ms_taken >= v_ms_allowed then
    return jsonb_build_object('outcome', 'too_late');
  end if;

  v_points := private.quiz_points(p_is_correct, v_ms_taken, v_ms_allowed);

  insert into public.quiz_answers (room_id, player_id, question_id, answer, is_correct, answered_at, points)
  values (p_room_id, v_player_id, p_question_id, p_answer, p_is_correct, v_answered_at, v_points)
  on conflict (player_id, question_id) do nothing;

  if not found then
    return jsonb_build_object('outcome', 'duplicate');
  end if;

  update public.quiz_players p
  set score = p.score + v_points
  where p.id = v_player_id
  returning p.score into v_score;

  return jsonb_build_object('outcome', 'ok', 'isCorrect', p_is_correct, 'points', v_points, 'score', v_score);
end;
$$;

-- Move the room to the next question, or finish it after the last one.
--
-- One conditional update: it only matches while the room is still on
-- p_expected_index and the answering and results phases are both over.
-- When five clients call at the same moment, the first update changes the
-- index, the row no longer matches for the others, and they change
-- nothing. Every caller gets the room as it is now.
create or replace function public.advance_quiz_room(p_room_id uuid, p_expected_index integer)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_question_count integer;
  v_is_last boolean;
  v_moved integer;
begin
  select count(*) into v_question_count
  from public.quiz_room_questions q
  where q.room_id = p_room_id;

  v_is_last := p_expected_index + 1 >= v_question_count;

  update public.quiz_rooms r
  set current_question_index = case when v_is_last then r.current_question_index else p_expected_index + 1 end,
      question_started_at = case when v_is_last then r.question_started_at else now() end,
      status = case when v_is_last then 'finished' else 'running' end
  where r.id = p_room_id
    and r.status = 'running'
    and r.current_question_index = p_expected_index
    and now() >= r.question_started_at
                 + make_interval(secs => r.seconds_per_question + r.results_seconds);
  get diagnostics v_moved = row_count;

  return jsonb_build_object('advanced', v_moved > 0) || public.quiz_room_state(p_room_id);
end;
$$;

-- Only the service role (the Edge Functions) may run these.
revoke execute on function
  private.quiz_points(boolean, bigint, bigint),
  public.quiz_room_state(uuid),
  public.start_quiz_room(uuid),
  public.submit_quiz_answer(uuid, uuid, uuid, text, boolean),
  public.advance_quiz_room(uuid, integer)
from public, anon, authenticated;

grant execute on function
  private.quiz_points(boolean, bigint, bigint),
  public.quiz_room_state(uuid),
  public.start_quiz_room(uuid),
  public.submit_quiz_answer(uuid, uuid, uuid, text, boolean),
  public.advance_quiz_room(uuid, integer)
to service_role;

-- Answers now go only through quiz-answer, which scores them. Before this,
-- a client could insert into quiz_answers directly: that row had no score,
-- and it blocked the player's real answer as a duplicate. Remove that path.
drop policy if exists "quiz_answers: player answers current question" on public.quiz_answers;
revoke insert (room_id, player_id, question_id, answer) on public.quiz_answers from authenticated;
revoke insert on public.quiz_answers from anon, authenticated;
