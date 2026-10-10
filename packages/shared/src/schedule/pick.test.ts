import { describe, expect, it } from 'vitest';
import { pickFinalPass, pickSession } from './pick';
import { chunk, day, exam, topic, working } from './fixtures';

const examDate = day(30);

describe('pickSession (rule 5)', () => {
  it('returns null when nothing is due', () => {
    const e = exam('e', examDate, 1, 2);
    e.chunks = e.chunks.map((c) => ({ ...c, history: { correctSessions: 3, lastSeen: day(-1), lastCorrect: true } }));
    expect(pickSession(working(e), day(0), examDate)).toBeNull();
  });

  it('takes 5 to 7 questions from at most 3 topics', () => {
    const picked = pickSession(working(exam('e', examDate, 5, 4)), day(0), examDate)!;
    expect(picked.questionIds).toHaveLength(7);
    expect(picked.topicIds).toEqual(['e-t1', 'e-t2', 'e-t3']);
  });

  it('mixes topics: one topic cannot fill the session when another has due chunks', () => {
    const e = {
      id: 'e',
      examDate,
      topics: [topic('a'), topic('b')],
      chunks: [...['a1', 'a2', 'a3', 'a4', 'a5', 'a6'].map((id) => chunk(id, 'a')), chunk('b1', 'b'), chunk('b2', 'b')],
    };
    const picked = pickSession(working(e), day(0), examDate)!;
    expect(picked.topicIds).toEqual(['a', 'b']);
    expect(picked.questionIds).toEqual(['a1-q1', 'a2-q1', 'a3-q1', 'a4-q1', 'a5-q1', 'b1-q1', 'b2-q1']);
  });

  it('gives a hard topic one extra slot for never-seen chunks (rule 4)', () => {
    const e = {
      id: 'e',
      examDate,
      topics: [topic('hard', 5), topic('mid'), topic('easy', 1)],
      chunks: [
        ...['h1', 'h2', 'h3', 'h4', 'h5'].map((id) => chunk(id, 'hard')),
        ...['m1', 'm2', 'm3', 'm4'].map((id) => chunk(id, 'mid')),
        chunk('e1', 'easy'),
      ],
    };
    const picked = pickSession(working(e), day(0), examDate)!;
    // Cap is 3 per topic with 3 topics; hard gets a 4th slot; mid fills the rest.
    expect(picked.questionIds).toEqual(['h1-q1', 'h2-q1', 'h3-q1', 'h4-q1', 'm1-q1', 'm2-q1', 'm3-q1']);
  });

  it('asks wrong-last-time chunks first, then due again, then new', () => {
    const e = {
      id: 'e',
      examDate,
      topics: [topic('a'), topic('b')],
      chunks: [
        chunk('new1', 'a'),
        chunk('again', 'b', { correctSessions: 1, lastSeen: day(-20), lastCorrect: true }),
        chunk('wrong', 'a', { correctSessions: 0, lastSeen: day(-1), lastCorrect: false }),
        chunk('new2', 'b'),
        chunk('new3', 'a'),
      ],
    };
    const picked = pickSession(working(e), day(0), examDate)!;
    expect(picked.questionIds).toEqual(['wrong-q1', 'again-q1', 'new1-q1', 'new2-q1', 'new3-q1']);
  });

  it('keeps 2 slots for never-seen chunks even when many chunks are due again', () => {
    const seen = { correctSessions: 1, lastSeen: day(-20), lastCorrect: true };
    const e = {
      id: 'e',
      examDate,
      topics: [topic('a'), topic('b')],
      chunks: [
        ...['a1', 'a2', 'a3', 'a4', 'b1', 'b2', 'b3', 'b4'].map((id) => chunk(id, id[0], seen)),
        chunk('newA', 'a'),
        chunk('newB', 'b'),
        chunk('newC', 'b'),
      ],
    };
    const picked = pickSession(working(e), day(0), examDate)!;
    expect(picked.questionIds).toHaveLength(7);
    expect(picked.questionIds.slice(-2)).toEqual(['newA-q1', 'newB-q1']);
  });

  it('with 20 unseen and 10 overdue chunks, a 7-question session holds at least 2 unseen', () => {
    const seen = { correctSessions: 1, lastSeen: day(-20), lastCorrect: true };
    const e = {
      id: 'e',
      examDate,
      topics: [topic('a'), topic('b')],
      chunks: [
        ...Array.from({ length: 10 }, (_, i) => chunk(`old${i}`, i % 2 ? 'a' : 'b', seen)),
        ...Array.from({ length: 20 }, (_, i) => chunk(`new${i}`, i % 2 ? 'a' : 'b')),
      ],
    };
    const picked = pickSession(working(e), day(0), examDate)!;
    expect(picked.questionIds).toHaveLength(7);
    expect(picked.questionIds.filter((q) => q.startsWith('new')).length).toBeGreaterThanOrEqual(2);
  });

  it('shrinks the new-chunk reserve to what exists', () => {
    const seen = { correctSessions: 1, lastSeen: day(-20), lastCorrect: true };
    const e = {
      id: 'e',
      examDate,
      topics: [topic('a')],
      chunks: [...['o1', 'o2', 'o3', 'o4', 'o5', 'o6', 'o7'].map((id) => chunk(id, 'a', seen)), chunk('only', 'a')],
    };
    const picked = pickSession(working(e), day(0), examDate)!;
    expect(picked.questionIds).toHaveLength(7);
    expect(picked.questionIds.filter((q) => q.startsWith('only'))).toEqual(['only-q1']);
  });

  it('tops a small session up to 5 with a secure chunk, then repeats', () => {
    const e = {
      id: 'e',
      examDate,
      topics: [topic('a')],
      chunks: [chunk('due', 'a'), chunk('safe', 'a', { correctSessions: 3, lastSeen: day(-9), lastCorrect: true })],
    };
    const picked = pickSession(working(e), day(0), examDate)!;
    expect(picked.questionIds).toEqual(['due-q1', 'safe-q1', 'due-q2', 'safe-q2', 'due-q3']);
  });

  it('stays under 5 only when the exam has fewer than 5 questions', () => {
    const e = { id: 'e', examDate, topics: [topic('a')], chunks: [chunk('c1', 'a', { questions: 2 }), chunk('c2', 'a', { questions: 1 })] };
    const picked = pickSession(working(e), day(0), examDate)!;
    expect(picked.questionIds).toEqual(['c1-q1', 'c2-q1', 'c1-q2']);
  });
});

describe('pickFinalPass (rule 8)', () => {
  it('touches every topic once, missed and hardest first, at most 7', () => {
    const e = {
      id: 'e',
      examDate,
      topics: [topic('t1', 2), topic('t2', 5), topic('t3'), topic('t4')],
      chunks: [
        chunk('a1', 't1', { correctSessions: 3, lastSeen: day(-2), lastCorrect: true }),
        chunk('a2', 't1', { correctSessions: 3, lastSeen: day(-2), lastCorrect: true }),
        chunk('b1', 't2', { correctSessions: 3, lastSeen: day(-2), lastCorrect: true }),
        chunk('c1', 't3', { correctSessions: 1, lastSeen: day(-2), lastCorrect: false }),
        chunk('d1', 't4', { correctSessions: 2, lastSeen: day(-2), lastCorrect: true }),
        ...['d2', 'd3', 'd4', 'd5'].map((id) => chunk(id, 't4', { correctSessions: 3, lastSeen: day(-2), lastCorrect: true })),
      ],
    };
    const picked = pickFinalPass(working(e))!;
    expect(picked.questionIds).toHaveLength(7);
    expect(picked.questionIds.slice(0, 3)).toEqual(['c1-q1', 'd1-q1', 'b1-q1']);
    expect(new Set(picked.topicIds)).toEqual(new Set(['t1', 't2', 't3', 't4']));
  });
});
