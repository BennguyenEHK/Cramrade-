import { describe, expect, it } from 'vitest';
import { isCorrectAnswer, points } from './scoring.ts';

describe('points', () => {
  it('gives 1000 for an instant correct answer', () => {
    expect(points(true, 0, 20_000)).toBe(1000);
  });

  it('gives 500 at the last moment', () => {
    expect(points(true, 20_000, 20_000)).toBe(500);
  });

  it('gives 750 at half time', () => {
    expect(points(true, 10_000, 20_000)).toBe(750);
  });

  it('clamps answers after the time limit to 500', () => {
    expect(points(true, 25_000, 20_000)).toBe(500);
  });

  it('clamps a negative time (clock rounding) to 1000', () => {
    expect(points(true, -50, 20_000)).toBe(1000);
  });

  it('gives 0 for a wrong answer at any time', () => {
    expect(points(false, 0, 20_000)).toBe(0);
    expect(points(false, 20_000, 20_000)).toBe(0);
  });

  // 999.5 exactly. The SQL twin rounds half away from zero, so must this.
  it('rounds an exact half up, the same as the database', () => {
    expect(points(true, 20, 20_000)).toBe(1000);
    expect(points(true, 60, 20_000)).toBe(999);
  });

  // The same table the SQL twin is checked against in Task 6, step 3.
  it.each([
    [0, 15_000, 1000],
    [1, 15_000, 1000],
    [2_500, 15_000, 917],
    [5_000, 15_000, 833],
    [7_500, 15_000, 750],
    [10_000, 15_000, 667],
    [14_999, 15_000, 500],
  ])('ms %i of %i gives %i', (ms, allowed, expected) => {
    expect(points(true, ms, allowed)).toBe(expected);
  });

  it('refuses a zero or negative time limit', () => {
    expect(() => points(true, 0, 0)).toThrow(RangeError);
  });
});

describe('isCorrectAnswer', () => {
  it('multiple choice: exact text after trimming', () => {
    expect(isCorrectAnswer('multiple_choice', '  Carbon dioxide ', 'Carbon dioxide')).toBe(true);
    expect(isCorrectAnswer('multiple_choice', 'carbon dioxide', 'Carbon dioxide')).toBe(false);
    expect(isCorrectAnswer('multiple_choice', 'Carbon  dioxide', 'Carbon dioxide')).toBe(false);
  });

  it('flashcard: exact text after trimming', () => {
    expect(isCorrectAnswer('flashcard', 'Mitochondria\n', 'Mitochondria')).toBe(true);
    expect(isCorrectAnswer('flashcard', 'mitochondria', 'Mitochondria')).toBe(false);
  });

  it('short answer: ignores case and collapses whitespace', () => {
    expect(isCorrectAnswer('short_answer', '  Carbon \t  DIOXIDE ', 'carbon dioxide')).toBe(true);
    expect(isCorrectAnswer('short_answer', 'carbon\ndioxide', 'Carbon Dioxide')).toBe(true);
  });

  it('short answer: different words are wrong', () => {
    expect(isCorrectAnswer('short_answer', 'oxygen', 'carbon dioxide')).toBe(false);
    expect(isCorrectAnswer('short_answer', 'carbondioxide', 'carbon dioxide')).toBe(false);
  });

  it('a blank answer is never right', () => {
    expect(isCorrectAnswer('short_answer', '   ', 'x')).toBe(false);
  });
});
