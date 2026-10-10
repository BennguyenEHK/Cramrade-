-- B4: save the extracted text and its note together, or save neither.
-- SECURITY INVOKER keeps the existing ownership and guest RLS rules in force.
create or replace function public.save_uploaded_note(
  p_id uuid, p_title text, p_filename text, p_chunks text[]
) returns uuid
language plpgsql security invoker set search_path = ''
as $$
declare
  inserted_id uuid;
begin
  if auth.uid() is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'Sign in with an account before uploading' using errcode = '42501';
  end if;
  if p_id is null or p_title is null or char_length(trim(p_title)) not between 1 and 120
     or p_filename is null or char_length(p_filename) not between 1 and 255
     or p_chunks is null or cardinality(p_chunks) not between 1 and 100
     or exists (select 1 from unnest(p_chunks) t where t is null or char_length(t) not between 1 and 3000)
     or (select sum(char_length(t)) from unnest(p_chunks) t) > 200000
     or trim(array_to_string(p_chunks, '')) = '' then
    raise exception 'Invalid extracted note' using errcode = '22023';
  end if;

  insert into public.notes (id, owner_id, title, source, original_filename, status)
  values (p_id, auth.uid(), trim(p_title), 'file', p_filename, 'ready')
  on conflict (id) do nothing
  returning id into inserted_id;

  if inserted_id is null then
    -- Retrying the same upload is safe, but never reuse another owner's ID.
    if not exists (select 1 from public.notes where id = p_id and owner_id = auth.uid() and source = 'file') then
      raise exception 'Upload identifier unavailable' using errcode = '42501';
    end if;
    return p_id;
  end if;

  insert into public.chunks (note_id, position, text)
  select p_id, (ordinality - 1)::integer, text
  from unnest(p_chunks) with ordinality as pieces(text, ordinality);
  return p_id;
end;
$$;

revoke all on function public.save_uploaded_note(uuid, text, text, text[]) from public, anon;
grant execute on function public.save_uploaded_note(uuid, text, text, text[]) to authenticated;
