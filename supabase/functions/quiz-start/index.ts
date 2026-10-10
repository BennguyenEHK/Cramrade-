// quiz-start: the host starts a room that is waiting in the lobby. The
// database sets the first question and its start time (spec 9.1).

import { requireFullUser } from '../_shared/auth.ts';
import { db } from '../_shared/db.ts';
import { HttpError, handle, json } from '../_shared/http.ts';
import { parseRoomInput } from '../_shared/quiz-input.ts';
import { isRoomMember, loadRoom, startRoom } from '../_shared/quiz-db.ts';

Deno.serve(
  handle(async (req) => {
    if (req.method !== 'POST') throw new HttpError(400, 'bad_input', 'Use POST.');
    // Hosts are full users (quiz-create requires it), so a guest can never be one.
    const user = await requireFullUser(req);
    const parsed = parseRoomInput(await req.json().catch(() => null));
    if (!parsed.ok) throw new HttpError(400, 'bad_input', parsed.message);
    const { roomId } = parsed.value;

    const member = await isRoomMember(roomId, user.id);
    if (!member.host) throw new HttpError(403, 'not_host', 'Only the host can start the quiz.');

    const before = await loadRoom(roomId);
    if (before.status !== 'lobby') throw new HttpError(409, 'not_in_lobby', 'This quiz has already started.');

    const { count, error } = await db
      .from('quiz_players')
      .select('id', { count: 'exact', head: true })
      .eq('room_id', roomId);
    if (error) throw new HttpError(500, 'internal', error.message);
    if (!count) throw new HttpError(409, 'no_players', 'Wait for at least one player to join.');

    const { started, room } = await startRoom(roomId);
    // Another start request won the race between our checks and the update.
    if (!started) throw new HttpError(409, 'not_in_lobby', 'This quiz has already started.');
    return json({ room });
  }),
);
