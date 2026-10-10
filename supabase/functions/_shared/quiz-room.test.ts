import { describe, expect, it } from 'vitest';
import { answerOutcomeError, roomState } from './quiz-room.ts';

const raw = {
  room: {
    id: 'r1',
    host_id: 'h1',
    group_id: null,
    title: 'Biology',
    code: 'ABC234',
    status: 'running',
    mode: 'group',
    seconds_per_question: 20,
    results_seconds: 5,
    current_question_index: 2,
    question_started_at: '2026-10-10T12:00:00.123+00:00',
    created_at: '2026-10-10T11:59:00+00:00',
    updated_at: '2026-10-10T12:00:00+00:00',
  },
  questionCount: 5,
  serverNow: '2026-10-10T12:00:03.000+00:00',
};

describe('roomState', () => {
  it('turns the database row into the camelCase room state', () => {
    expect(roomState(raw)).toEqual({
      id: 'r1',
      code: 'ABC234',
      title: 'Biology',
      hostId: 'h1',
      mode: 'group',
      status: 'running',
      secondsPerQuestion: 20,
      resultsSeconds: 5,
      currentQuestionIndex: 2,
      questionStartedAt: '2026-10-10T12:00:00.123+00:00',
      questionCount: 5,
      serverNow: '2026-10-10T12:00:03.000+00:00',
    });
  });

  it('keeps a null start time for a room in the lobby', () => {
    const lobby = { ...raw, room: { ...raw.room, status: 'lobby', current_question_index: -1, question_started_at: null } };
    expect(roomState(lobby).questionStartedAt).toBeNull();
  });

  it('throws when the room is missing (database returned null)', () => {
    expect(() => roomState(null)).toThrow();
    expect(() => roomState({ room: null, questionCount: 0, serverNow: 'x' })).toThrow();
  });
});

describe('answerOutcomeError', () => {
  it('is null for a scored answer', () => {
    expect(answerOutcomeError('ok')).toBeNull();
  });

  it('maps each refusal to its status', () => {
    expect(answerOutcomeError('no_room')?.status).toBe(404);
    expect(answerOutcomeError('not_player')?.status).toBe(403);
    expect(answerOutcomeError('not_current')).toMatchObject({ status: 409, code: 'not_current_question' });
    expect(answerOutcomeError('too_late')).toMatchObject({ status: 409, code: 'too_late' });
    expect(answerOutcomeError('duplicate')).toMatchObject({ status: 409, code: 'already_answered' });
  });
});
