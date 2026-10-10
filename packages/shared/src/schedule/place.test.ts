import { describe, expect, it } from 'vitest';
import { canPlace, isBehind, makeCalendar, reserveFinalPass, rhythmDaysLeft, take } from './place';
import { day, input } from './fixtures';

describe('calendar (rule 6)', () => {
  it('refuses busy days', () => {
    const cal = makeCalendar(input({ exams: [], busyDays: [day(1)] }));
    expect(canPlace(cal, 'a', day(1))).toBe(false);
    expect(canPlace(cal, 'a', day(2))).toBe(true);
  });

  it('allows one session per exam per day and counts kept sessions toward the cap', () => {
    const cal = makeCalendar(input({ exams: [], pace: 'normal', keep: [{ examId: 'a', scheduledFor: day(0) }] }));
    expect(canPlace(cal, 'a', day(0))).toBe(false);
    expect(canPlace(cal, 'b', day(0))).toBe(true);
    take(cal, 'b', day(0));
    expect(canPlace(cal, 'c', day(0))).toBe(false);
  });

  it('ignores kept sessions before today', () => {
    const cal = makeCalendar(input({ exams: [], pace: 'light', keep: [{ examId: 'a', scheduledFor: day(-1) }] }));
    expect(cal.load.size).toBe(0);
  });
});

describe('reserveFinalPass (rule 8)', () => {
  it('books the day before the exam', () => {
    const cal = makeCalendar(input({ exams: [] }));
    expect(reserveFinalPass(cal, 'a', day(0), day(10))).toBe(day(9));
  });

  it('moves earlier when the day before is busy', () => {
    const cal = makeCalendar(input({ exams: [], busyDays: [day(9)] }));
    expect(reserveFinalPass(cal, 'a', day(0), day(10))).toBe(day(8));
  });

  it('returns null when no day is left before the exam', () => {
    const cal = makeCalendar(input({ exams: [] }));
    expect(reserveFinalPass(cal, 'a', day(0), day(0))).toBeNull();
  });
});

describe('rhythm (rule 7)', () => {
  it('counts on-rhythm days: sparse far out, daily in the last week', () => {
    // Exam on day 14: rhythm days 0, 3, 5, 7, 8, ..., 13 before the exam.
    expect(rhythmDaysLeft(day(0), day(14), day(14))).toBe(10);
    expect(rhythmDaysLeft(day(7), day(14), day(14))).toBe(7);
    expect(rhythmDaysLeft(day(14), day(14), day(14))).toBe(0);
  });

  it('is behind when the recalls needed exceed 6 per session left', () => {
    expect(isBehind(18, 3)).toBe(false);
    expect(isBehind(19, 3)).toBe(true);
    expect(isBehind(1, 0)).toBe(true);
  });
});
