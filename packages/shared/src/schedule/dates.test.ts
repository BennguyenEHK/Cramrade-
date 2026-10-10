import { describe, expect, it } from 'vitest';
import { addDays, dayToMs, daysBetween, isoDate } from './dates';

describe('dates', () => {
  it('adds days across month, year and leap day', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-11-02', -2)).toBe('2026-10-31');
  });

  it('ignores daylight saving changes', () => {
    expect(addDays('2026-03-28', 1)).toBe('2026-03-29');
    expect(addDays('2026-10-24', 1)).toBe('2026-10-25');
    expect(daysBetween('2026-03-01', '2026-04-01')).toBe(31);
  });

  it('counts whole days, negative when going back', () => {
    expect(daysBetween('2026-11-02', '2026-11-03')).toBe(1);
    expect(daysBetween('2026-11-02', '2026-11-02')).toBe(0);
    expect(daysBetween('2026-11-03', '2026-11-02')).toBe(-1);
  });

  it('round-trips through milliseconds', () => {
    expect(isoDate(dayToMs('2026-11-02'))).toBe('2026-11-02');
  });

  it('refuses text that is not a real YYYY-MM-DD date', () => {
    expect(() => dayToMs('2026-02-30')).toThrow();
    expect(() => dayToMs('2026-11-2')).toThrow();
    expect(() => dayToMs('2026-11-02T00:00:00Z')).toThrow();
  });
});
