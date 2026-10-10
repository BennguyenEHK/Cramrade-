import { describe, expect, it } from 'vitest';
import { compareDue, isDue, isSecure, recordVisit, takeQuestion } from './chunk-state';
import { chunk, day, topic, working } from './fixtures';

/** Working chunks for one exam on day(30) with the given topics and chunks. */
function chunks(topics = [topic('t1')], list = [chunk('c1', 't1')]) {
  return working({ id: 'e', examDate: day(30), topics, chunks: list });
}

describe('isDue (rules 2 and 3)', () => {
  // The exam is on day(30), so from day(0) there are 30 days left.

  it('is due when never seen', () => {
    const [c] = chunks();
    expect(isDue(c.history, day(0), 30)).toBe(true);
  });

  it('is due when the last answer was wrong, even if seen yesterday', () => {
    const [c] = chunks(undefined, [chunk('c1', 't1', { correctSessions: 1, lastSeen: day(-1), lastCorrect: false })]);
    expect(isDue(c.history, day(0), 30)).toBe(true);
  });

  it('waits gapDays after a correct answer', () => {
    // 30 days left: gap is 6.
    const [c] = chunks(undefined, [chunk('c1', 't1', { correctSessions: 1, lastSeen: day(-5), lastCorrect: true })]);
    expect(isDue(c.history, day(0), 30)).toBe(false);
    expect(isDue(c.history, day(1), 29)).toBe(true);
  });

  it('is never due once secure (3 correct sessions)', () => {
    const [c] = chunks(undefined, [chunk('c1', 't1', { correctSessions: 3, lastSeen: day(-60), lastCorrect: true })]);
    expect(isSecure(c)).toBe(true);
    expect(isDue(c.history, day(0), 30)).toBe(false);
  });
});

describe('compareDue (rules 4 and 5)', () => {
  it('orders wrong last time, then due again, then never seen', () => {
    const list = chunks(
      [topic('t1')],
      [
        chunk('new', 't1'),
        chunk('again', 't1', { correctSessions: 1, lastSeen: day(-20), lastCorrect: true }),
        chunk('wrong', 't1', { correctSessions: 1, lastSeen: day(-1), lastCorrect: false }),
      ],
    );
    expect(list.sort(compareDue).map((c) => c.id)).toEqual(['wrong', 'again', 'new']);
  });

  it('puts never-seen chunks of hard topics first and easy last, null as 3', () => {
    const list = chunks(
      [topic('easy', 1), topic('unrated', null), topic('hard', 5), topic('mid', 3)],
      [chunk('e1', 'easy'), chunk('u1', 'unrated'), chunk('h1', 'hard'), chunk('m1', 'mid')],
    );
    expect(list.sort(compareDue).map((c) => c.id)).toEqual(['h1', 'u1', 'm1', 'e1']);
  });

  it('counts a chunk whose topic is not in the exam as difficulty 3', () => {
    const list = chunks([topic('hard', 5), topic('easy', 1)], [chunk('e1', 'easy'), chunk('x1', 'gone'), chunk('h1', 'hard')]);
    expect(list.sort(compareDue).map((c) => c.id)).toEqual(['h1', 'x1', 'e1']);
  });

  it('ignores the rating once a chunk has history', () => {
    const list = chunks(
      [topic('easy', 1), topic('hard', 5)],
      [chunk('h1', 'hard'), chunk('e1', 'easy', { correctSessions: 1, lastSeen: day(-20), lastCorrect: true })],
    );
    expect(list.sort(compareDue).map((c) => c.id)).toEqual(['e1', 'h1']);
  });
});

describe('takeQuestion and recordVisit', () => {
  it('starts with the least recently asked question and rotates', () => {
    const [c] = chunks(undefined, [chunk('c1', 't1', { questions: 2 })]);
    expect([takeQuestion(c), takeQuestion(c), takeQuestion(c)]).toEqual(['c1-q1', 'c1-q2', 'c1-q1']);
  });

  it('assumes a planned visit is answered correctly', () => {
    const [c] = chunks();
    recordVisit(c, day(0));
    expect(c.history).toEqual({ correctSessions: 1, lastSeen: day(0), lastCorrect: true });
  });
});
