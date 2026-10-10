import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  addDays,
  isValidTimeZone,
  localDateOf,
  normalizeSettings,
  zonedToUtcIso,
} from './schedule-input.ts';

describe('addDays', () => {
  it('crosses month and year ends', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-10-10', -10)).toBe('2026-09-30');
  });
});

describe('localDateOf', () => {
  it('gives the calendar day in the student time zone', () => {
    expect(localDateOf('2026-10-09T20:00:00Z', 'UTC')).toBe('2026-10-09');
    expect(localDateOf('2026-10-09T20:00:00Z', 'Asia/Ho_Chi_Minh')).toBe('2026-10-10');
    expect(localDateOf('2026-10-10T02:00:00Z', 'America/New_York')).toBe('2026-10-09');
  });

  it('accepts a Date', () => {
    expect(localDateOf(new Date('2026-10-10T12:00:00Z'), 'UTC')).toBe('2026-10-10');
  });
});

describe('zonedToUtcIso', () => {
  it('UTC is unchanged', () => {
    expect(zonedToUtcIso('2026-10-20', '18:00', 'UTC')).toBe('2026-10-20T18:00:00.000Z');
  });

  it('Asia/Ho_Chi_Minh is UTC+7 all year', () => {
    expect(zonedToUtcIso('2026-10-20', '18:00', 'Asia/Ho_Chi_Minh')).toBe('2026-10-20T11:00:00.000Z');
    expect(zonedToUtcIso('2026-10-20', '03:00', 'Asia/Ho_Chi_Minh')).toBe('2026-10-19T20:00:00.000Z');
  });

  it('follows daylight saving time', () => {
    // New York leaves daylight saving time on 2026-11-01.
    expect(zonedToUtcIso('2026-10-20', '18:00', 'America/New_York')).toBe('2026-10-20T22:00:00.000Z');
    expect(zonedToUtcIso('2026-11-02', '18:00', 'America/New_York')).toBe('2026-11-02T23:00:00.000Z');
  });

  it('reads the HH:MM:SS form Postgres returns', () => {
    expect(zonedToUtcIso('2026-10-20', '18:00:00', 'UTC')).toBe('2026-10-20T18:00:00.000Z');
  });
});

describe('isValidTimeZone', () => {
  it('knows real zones and rejects made-up ones', () => {
    expect(isValidTimeZone('Asia/Ho_Chi_Minh')).toBe(true);
    expect(isValidTimeZone('Mars/Base')).toBe(false);
  });
});

describe('normalizeSettings', () => {
  it('uses defaults when the student has no settings row', () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS).toEqual({ pace: 'normal', daysOff: [], sessionTime: '18:00', timeZone: 'UTC' });
  });

  it('keeps valid values', () => {
    const s = { pace: 'heavy' as const, daysOff: [0, 6], sessionTime: '07:30:00', timeZone: 'Asia/Ho_Chi_Minh' };
    expect(normalizeSettings(s)).toEqual(s);
  });

  it('replaces broken values with defaults instead of failing', () => {
    expect(
      normalizeSettings({
        pace: 'crazy' as never,
        daysOff: [0, 7, -1, 3, 3],
        sessionTime: '6pm',
        timeZone: 'Mars/Base',
      }),
    ).toEqual({ pace: 'normal', daysOff: [0, 3], sessionTime: '18:00', timeZone: 'UTC' });
  });
});
