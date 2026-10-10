import { describe, expect, it } from 'vitest';
import { gapDays } from './gap';

describe('gapDays (rule 2)', () => {
  it('is 1 day in the last week', () => {
    for (const left of [0, 1, 3, 7]) expect(gapDays(left)).toBe(1);
  });

  it('is about a fifth of the days left after that', () => {
    expect(gapDays(8)).toBe(2);
    expect(gapDays(14)).toBe(3);
    expect(gapDays(30)).toBe(6);
    expect(gapDays(60)).toBe(12);
  });

  it('never goes above 14 days', () => {
    expect(gapDays(70)).toBe(14);
    expect(gapDays(90)).toBe(14);
    expect(gapDays(365)).toBe(14);
  });
});
