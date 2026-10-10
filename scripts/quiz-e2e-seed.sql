-- Test data for scripts/quiz-e2e.mjs. Run once in the Supabase dashboard
-- SQL editor, after creating the host account (Authentication > Users >
-- Add user, with a password). Replace the email on the first line of the
-- block with that account's email.
--
-- It makes one note with three chunks and six questions. Questions are
-- normally made only by the server; the SQL editor runs as the database
-- owner, so it can insert them. The verify_question trigger still checks
-- each quote is inside its chunk: all six must come out verified.
do $$
declare
  host_email text := 'quiz-host@example.com';
  host uuid;
  note uuid;
  c1 uuid;
  c2 uuid;
  c3 uuid;
begin
  select u.id into host from auth.users u where u.email = host_email;
  if host is null then
    raise exception 'no user with email %, create the host account first', host_email;
  end if;

  insert into public.notes (owner_id, title, source, status)
  values (host, 'Quiz e2e test note', 'text', 'ready')
  returning id into note;

  insert into public.chunks (note_id, position, text) values
    (note, 0, 'Photosynthesis happens in the chloroplast. During photosynthesis plants take in carbon dioxide and release oxygen.')
    returning id into c1;
  insert into public.chunks (note_id, position, text) values
    (note, 1, 'The mitochondria is the powerhouse of the cell. It turns glucose into energy the cell can use.')
    returning id into c2;
  insert into public.chunks (note_id, position, text) values
    (note, 2, 'Water boils at 100 degrees Celsius at sea level. At higher altitude it boils at a lower temperature.')
    returning id into c3;

  insert into public.questions (note_id, chunk_id, kind, prompt, choices, answer, source_quote) values
    (note, c1, 'multiple_choice', 'Which gas do plants take in during photosynthesis?',
       '["Oxygen", "Carbon dioxide", "Nitrogen", "Helium"]', 'Carbon dioxide',
       'plants take in carbon dioxide and release oxygen'),
    (note, c1, 'short_answer', 'Where in the cell does photosynthesis happen?', null, 'the chloroplast',
       'Photosynthesis happens in the chloroplast'),
    (note, c2, 'multiple_choice', 'Which part is the powerhouse of the cell?',
       '["Nucleus", "Ribosome", "Mitochondria", "Membrane"]', 'Mitochondria',
       'The mitochondria is the powerhouse of the cell'),
    (note, c2, 'flashcard', 'What does the mitochondria turn glucose into?', null, 'energy',
       'It turns glucose into energy the cell can use'),
    (note, c3, 'short_answer', 'At what temperature in Celsius does water boil at sea level?', null, '100 degrees',
       'Water boils at 100 degrees Celsius at sea level'),
    (note, c3, 'multiple_choice', 'At higher altitude, water boils at a temperature that is…',
       '["Higher", "Lower", "The same", "Unpredictable"]', 'Lower',
       'At higher altitude it boils at a lower temperature');
end $$;

-- Copy the note id from this result into scripts/.env.quiz-e2e.
select n.id as quiz_e2e_note_id,
       count(*) filter (where q.verified) as verified_questions
from public.notes n
join public.questions q on q.note_id = n.id
where n.title = 'Quiz e2e test note'
group by n.id;
