-- Removes the test data made by quiz-e2e-seed.sql and the rooms the script
-- made from it. Run in the Supabase dashboard SQL editor when done.
-- Deleting the note removes its chunks and questions; deleting a question
-- removes it from any room, so rooms are deleted first by title and host.
delete from public.quiz_rooms r
using public.notes n
where n.title = 'Quiz e2e test note'
  and r.host_id = n.owner_id
  and r.title = 'Quiz e2e test note';

delete from public.notes where title = 'Quiz e2e test note';

-- The five guest players stay in Authentication > Users as anonymous users.
-- The script prints their ids; delete them there if you want them gone.
