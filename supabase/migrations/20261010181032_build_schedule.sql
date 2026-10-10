-- A5 build-schedule: two functions the build-schedule Edge Function calls.
--
-- schedule_rows reads everything the schedule engine needs for one student
-- in one call, so the function is not limited by the API's 1000-row cap.
-- replace_planned_sessions swaps the student's planned sessions in one
-- transaction, so a failure never leaves half a plan.
--
-- Both run as the caller (security invoker) and only service_role may call
-- them. service_role bypasses Row Level Security, so each function checks
-- that every row it touches belongs to p_owner.

create or replace function public.schedule_rows(p_owner uuid, p_today date, p_exam_id uuid default null)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with ex as (
    -- upcoming exams; a named past exam is included so the engine can warn about it
    select e.id, e.title, e.exam_date
    from public.exams e
    where e.owner_id = p_owner
      and (e.exam_date >= p_today or e.id = p_exam_id)
  ),
  ch as (
    select c.id, c.note_id, n.exam_id, c.position
    from public.chunks c
    join public.notes n on n.id = c.note_id
    where n.owner_id = p_owner
      and n.status = 'ready'
      and n.exam_id in (select id from ex)
  ),
  qu as (
    select q.id, q.chunk_id, q.topic_id, q.created_at
    from public.questions q
    where q.verified
      and q.chunk_id in (select id from ch)
  )
  select jsonb_build_object(
    'exams', coalesce((select jsonb_agg(to_jsonb(ex)) from ex), '[]'::jsonb),
    'topics', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id, 'exam_id', t.exam_id, 'title', t.title,
        'position', t.position, 'difficulty', t.difficulty))
      from public.topics t
      where t.exam_id in (select id from ex)
    ), '[]'::jsonb),
    'chunks', coalesce((select jsonb_agg(to_jsonb(ch)) from ch), '[]'::jsonb),
    'questions', coalesce((select jsonb_agg(to_jsonb(qu)) from qu), '[]'::jsonb),
    'attempts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'question_id', a.question_id, 'session_id', a.session_id,
        'is_correct', a.is_correct, 'answered_at', a.answered_at))
      from public.attempts a
      where a.user_id = p_owner
        and a.question_id in (select id from qu)
    ), '[]'::jsonb),
    'sessions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'exam_id', s.exam_id, 'scheduled_for', s.scheduled_for, 'status', s.status,
        'has_attempts', exists (select 1 from public.attempts a where a.session_id = s.id)))
      from public.study_sessions s
      where s.owner_id = p_owner
        and s.exam_id in (select id from ex)
    ), '[]'::jsonb)
  );
$$;

create or replace function public.replace_planned_sessions(
  p_owner uuid,
  p_exam_ids uuid[],
  p_from timestamptz,
  p_sessions jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  s jsonb;
  new_id uuid;
  result jsonb := '[]'::jsonb;
begin
  -- Two runs for the same student at once (the app and the question maker)
  -- would otherwise both delete and both insert, doubling the plan.
  perform pg_advisory_xact_lock(hashtextextended('replace_planned_sessions:' || p_owner::text, 0));

  if exists (
    select 1 from unnest(p_exam_ids) as e(id)
    where not exists (select 1 from public.exams x where x.id = e.id and x.owner_id = p_owner)
  ) then
    raise exception 'replace_planned_sessions: exam not owned by %', p_owner using errcode = '42501';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_sessions) as ps(value)
    where not ((ps.value ->> 'exam_id')::uuid = any (p_exam_ids))
  ) then
    raise exception 'replace_planned_sessions: session for an exam outside p_exam_ids' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_sessions) as ps(value)
    cross join lateral jsonb_array_elements_text(ps.value -> 'question_ids') as q(id)
    where not exists (
      select 1 from public.questions qq
      join public.notes n on n.id = qq.note_id
      where qq.id = q.id::uuid and qq.verified and n.owner_id = p_owner
    )
  ) then
    raise exception 'replace_planned_sessions: question not usable by %', p_owner using errcode = '42501';
  end if;

  -- A planned session the student already answered in counts as done
  -- (spec 6.3 rule 10). It must not be deleted: attempts cascade on delete.
  update public.study_sessions ss
  set status = 'done'
  where ss.owner_id = p_owner
    and ss.status = 'planned'
    and exists (select 1 from public.attempts a where a.session_id = ss.id);

  -- A planned session from before p_from that was never answered is over:
  -- mark it skipped so the schedule never shows a stale planned session in the past.
  update public.study_sessions ss
  set status = 'skipped'
  where ss.owner_id = p_owner
    and ss.status = 'planned'
    and ss.exam_id = any (p_exam_ids)
    and ss.scheduled_for < p_from
    and not exists (select 1 from public.attempts a where a.session_id = ss.id);

  -- Only future planned sessions are replaced. Done and skipped stay.
  delete from public.study_sessions ss
  where ss.owner_id = p_owner
    and ss.status = 'planned'
    and ss.exam_id = any (p_exam_ids)
    and ss.scheduled_for >= p_from;

  for s in select value from jsonb_array_elements(p_sessions) loop
    insert into public.study_sessions (owner_id, exam_id, scheduled_for, is_final_pass)
    values (
      p_owner,
      (s ->> 'exam_id')::uuid,
      (s ->> 'scheduled_for')::timestamptz,
      coalesce((s ->> 'is_final_pass')::boolean, false)
    )
    returning id into new_id;

    insert into public.session_questions (session_id, question_id, position)
    select new_id, q.id::uuid, (q.ord - 1)::integer
    from jsonb_array_elements_text(s -> 'question_ids') with ordinality as q(id, ord);

    result := result || jsonb_build_array(s || jsonb_build_object('id', new_id));
  end loop;

  return result;
end;
$$;

-- New functions in public are executable by anon and authenticated by
-- default in Supabase. These two are server-only.
revoke execute on function public.schedule_rows(uuid, date, uuid) from public, anon, authenticated;
revoke execute on function public.replace_planned_sessions(uuid, uuid[], timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.schedule_rows(uuid, date, uuid) to service_role;
grant execute on function public.replace_planned_sessions(uuid, uuid[], timestamptz, jsonb) to service_role;
