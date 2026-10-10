// quiz-advance: any player or the host asks the server to move on once the
// answering and results phases are over. The database decides whether it
// is time, and only the first caller for a question moves the room; the
// rest get advanced: false and the same room (spec 9.1).

import { requireUser } from '../_shared/auth.ts';
import { db } from '../_shared/db.ts';
import { HttpError, handle, json } from '../_shared/http.ts';
import { parseAdvanceInput } from '../_shared/quiz-input.ts';
import { isRoomMember } from '../_shared/quiz-db.ts';
import { roomState } from '../_shared/quiz-room.ts';

Deno.serve(
  handle(async (req) => {
    if (req.method !== 'POST') throw new HttpError(400, 'bad_input', 'Use POST.');
    const user = await requireUser(req);
    const parsed = parseAdvanceInput(await req.json().catch(() => null));
    if (!parsed.ok) throw new HttpError(400, 'bad_input', parsed.message);
    const { roomId, expectedIndex } = parsed.value;

    const member = await isRoomMember(roomId, user.id);
    if (!member.host && !member.player) throw new HttpError(403, 'not_in_room', 'Join the room first.');

    const { data, error } = await db.rpc('advance_quiz_room', {
      p_room_id: roomId,
      p_expected_index: expectedIndex,
    });
    if (error) throw new HttpError(500, 'internal', error.message);
    return json({ advanced: data.advanced === true, room: roomState(data) });
  }),
);
