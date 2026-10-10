import { describe, expect, it } from 'vitest';
import { examQuestionFilter, pickQuestions, visibleQuestions } from './quiz-pick.ts';

const q = (id: string, chunkId: string) => ({ id, chunkId });

describe('pickQuestions', () => {
  const pool = [
    q('a1', 'A'), q('a2', 'A'), q('a3', 'A'),
    q('b1', 'B'), q('b2', 'B'),
    q('c1', 'C'),
  ];

  it('takes one question from each chunk before taking a second', () => {
    expect(pickQuestions(pool, 3)).toEqual(['a1', 'b1', 'c1']);
    expect(pickQuestions(pool, 5)).toEqual(['a1', 'b1', 'c1', 'a2', 'b2']);
  });

  it('returns everything when count is larger than the pool', () => {
    expect(pickQuestions(pool, 50)).toEqual(['a1', 'b1', 'c1', 'a2', 'b2', 'a3']);
  });

  it('does not depend on the order of the input', () => {
    const shuffled = [pool[5], pool[2], pool[3], pool[0], pool[4], pool[1]];
    expect(pickQuestions(shuffled, 4)).toEqual(pickQuestions(pool, 4));
  });

  it('ignores a question listed twice', () => {
    expect(pickQuestions([q('a1', 'A'), q('a1', 'A'), q('b1', 'B')], 5)).toEqual(['a1', 'b1']);
  });

  it('returns nothing for an empty pool or a count of 0', () => {
    expect(pickQuestions([], 10)).toEqual([]);
    expect(pickQuestions(pool, 0)).toEqual([]);
  });
});

describe('visibleQuestions', () => {
  const rows = [
    { id: 'mine', noteOwnerId: 'me', noteGroupId: null },
    { id: 'group', noteOwnerId: 'friend', noteGroupId: 'g1' },
    { id: 'other-group', noteOwnerId: 'friend', noteGroupId: 'g2' },
    { id: 'friend-private', noteOwnerId: 'friend', noteGroupId: null },
  ];

  it('keeps my notes and notes shared with my groups only', () => {
    const ids = visibleQuestions(rows, 'me', new Set(['g1'])).map((r) => r.id);
    expect(ids).toEqual(['mine', 'group']);
  });
});

describe('examQuestionFilter', () => {
  it('uses only the exam id when no note is linked to the exam', () => {
    expect(examQuestionFilter('e1', [])).toBe('exam_id.eq.e1');
  });

  it('also takes questions from notes linked to the exam, each note once', () => {
    expect(examQuestionFilter('e1', ['n2', 'n1', 'n2'])).toBe('exam_id.eq.e1,note_id.in.(n1,n2)');
  });
});
