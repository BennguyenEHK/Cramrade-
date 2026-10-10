// Database calls the four quiz functions share. Uses the service-role
// client, which skips Row Level Security, so every caller check happens in
// the function before these are called. Not unit tested (needs a
// database); covered by scripts/quiz-e2e.mjs.

import { db } from './db.ts';
import { HttpError } from './http.ts';
import { roomState, serverError, type QuizRoomState } from './quiz-room.ts';

export async function loadRoom(roomId: string): Promise<QuizRoomState> {
  const { data, error } = await db.rpc('quiz_room_state', { p_room_id: roomId });
  if (error) throw serverError('quiz_room_state', error);
  if (!data) throw new HttpError(404, 'room_not_found', 'No quiz room with that id.');
  return roomState(data);
}

export async function isRoomMember(
  roomId: string,
  userId: string,
): Promise<{ host: boolean; player: boolean }> {
  const [room, player] = await Promise.all([
    db.from('quiz_rooms').select('host_id').eq('id', roomId).maybeSingle(),
    db.from('quiz_players').select('id').eq('room_id', roomId).eq('user_id', userId).maybeSingle(),
  ]);
  if (room.error) throw serverError('read room host', room.error);
  if (player.error) throw serverError('read room player', player.error);
  if (!room.data) throw new HttpError(404, 'room_not_found', 'No quiz room with that id.');
  return { host: room.data.host_id === userId, player: player.data !== null };
}

export async function startRoom(roomId: string): Promise<{ started: boolean; room: QuizRoomState }> {
  const { data, error } = await db.rpc('start_quiz_room', { p_room_id: roomId });
  if (error) throw serverError('start_quiz_room', error);
  return { started: data.started === true, room: roomState(data) };
}

export async function groupIdsOf(userId: string): Promise<Set<string>> {
  const { data, error } = await db.from('group_members').select('group_id').eq('user_id', userId);
  if (error) throw serverError('read group memberships', error);
  return new Set((data ?? []).map((row: { group_id: string }) => row.group_id));
}
