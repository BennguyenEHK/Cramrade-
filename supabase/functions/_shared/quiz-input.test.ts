import { describe, expect, it } from 'vitest';
// Only the test imports the shared package; quiz-input.ts itself must not.
import { QUIZ_MODES as SHARED_QUIZ_MODES } from '@cramrade/shared';
import {
  QUIZ_MODES,
  parseAdvanceInput,
  parseAnswerInput,
  parseCreateInput,
  parseRoomInput,
} from './quiz-input.ts';

const ID = '3f1c2a8e-5b7d-4c1e-9a2b-1c2d3e4f5a6b';
const ID2 = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

describe('QUIZ_MODES', () => {
  // Edge Functions cannot import packages/shared once deployed, so the list
  // is copied. This test fails if the two copies drift apart.
  it('matches packages/shared', () => {
    expect([...QUIZ_MODES]).toEqual([...SHARED_QUIZ_MODES]);
  });
});

describe('parseCreateInput', () => {
  it('fills in the defaults', () => {
    expect(parseCreateInput({ source: { examId: ID }, mode: 'group' })).toEqual({
      ok: true,
      value: { source: { kind: 'exam', examId: ID }, count: 10, secondsPerQuestion: 20, mode: 'group' },
    });
  });

  it('accepts a note source and explicit numbers', () => {
    const r = parseCreateInput({ source: { noteId: ID }, mode: 'solo', count: 50, secondsPerQuestion: 5 });
    expect(r).toEqual({
      ok: true,
      value: { source: { kind: 'note', noteId: ID }, count: 50, secondsPerQuestion: 5, mode: 'solo' },
    });
  });

  it.each([
    ['no body', null],
    ['no source', { mode: 'group' }],
    ['both sources', { source: { examId: ID, noteId: ID2 }, mode: 'group' }],
    ['bad id', { source: { examId: 'abc' }, mode: 'group' }],
    ['no mode', { source: { examId: ID } }],
    ['unknown mode', { source: { examId: ID }, mode: 'team' }],
    ['count 0', { source: { examId: ID }, mode: 'group', count: 0 }],
    ['count 51', { source: { examId: ID }, mode: 'group', count: 51 }],
    ['count 2.5', { source: { examId: ID }, mode: 'group', count: 2.5 }],
    ['seconds 4', { source: { examId: ID }, mode: 'group', secondsPerQuestion: 4 }],
    ['seconds 301', { source: { examId: ID }, mode: 'group', secondsPerQuestion: 301 }],
    ['seconds as text', { source: { examId: ID }, mode: 'group', secondsPerQuestion: '20' }],
  ])('refuses %s', (_name, body) => {
    expect(parseCreateInput(body).ok).toBe(false);
  });
});

describe('parseRoomInput', () => {
  it('reads a room id', () => {
    expect(parseRoomInput({ roomId: ID })).toEqual({ ok: true, value: { roomId: ID } });
  });
  it('refuses a missing or bad id', () => {
    expect(parseRoomInput({}).ok).toBe(false);
    expect(parseRoomInput({ roomId: 42 }).ok).toBe(false);
  });
});

describe('parseAnswerInput', () => {
  it('reads room, question and answer', () => {
    expect(parseAnswerInput({ roomId: ID, questionId: ID2, answer: 'Paris' })).toEqual({
      ok: true,
      value: { roomId: ID, questionId: ID2, answer: 'Paris' },
    });
  });
  it.each([
    ['blank answer', { roomId: ID, questionId: ID2, answer: '   ' }],
    ['answer not text', { roomId: ID, questionId: ID2, answer: 3 }],
    ['answer over 500 characters', { roomId: ID, questionId: ID2, answer: 'x'.repeat(501) }],
    ['no question', { roomId: ID, answer: 'Paris' }],
  ])('refuses %s', (_name, body) => {
    expect(parseAnswerInput(body).ok).toBe(false);
  });
});

describe('parseAdvanceInput', () => {
  it('reads room and expected index', () => {
    expect(parseAdvanceInput({ roomId: ID, expectedIndex: 0 })).toEqual({
      ok: true,
      value: { roomId: ID, expectedIndex: 0 },
    });
  });
  it.each([
    ['negative index', { roomId: ID, expectedIndex: -1 }],
    ['fraction', { roomId: ID, expectedIndex: 1.5 }],
    ['missing index', { roomId: ID }],
  ])('refuses %s', (_name, body) => {
    expect(parseAdvanceInput(body).ok).toBe(false);
  });
});
