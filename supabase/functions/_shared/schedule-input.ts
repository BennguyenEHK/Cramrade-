// Turns database rows into the schedule engine's input, and the engine's
// output back into rows to save. Pure: no Deno APIs and no network, so
// vitest tests it. Every "which day is it" question is answered in the
// student's own time zone, because a session at 18:00 in Hanoi is 11:00 UTC.
import { PACES } from './engine.ts';
import type { BusyDay, DateOnly, StudySettings } from './engine.ts';

export type ScheduleSettings = Pick<StudySettings, 'pace' | 'daysOff' | 'sessionTime' | 'timeZone'>;
export type BusyRange = Pick<BusyDay, 'fromDate' | 'toDate'>;

export const DEFAULT_SETTINGS: ScheduleSettings = {
  pace: 'normal',
  daysOff: [],
  sessionTime: '18:00',
  timeZone: 'UTC',
};

const DAY_MS = 86_400_000;

/** Days since 1970-01-01 for a YYYY-MM-DD date. Plain integers make ranges easy. */
export function dayNumber(date: DateOnly): number {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / DAY_MS;
}

export function fromDayNumber(n: number): DateOnly {
  return new Date(n * DAY_MS).toISOString().slice(0, 10);
}

export function addDays(date: DateOnly, days: number): DateOnly {
  return fromDayNumber(dayNumber(date) + days);
}

/** 0 = Sunday ... 6 = Saturday, the same numbering as study_settings.days_off. */
export function weekdayOf(date: DateOnly): number {
  return new Date(dayNumber(date) * DAY_MS).getUTCDay();
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

interface WallClock {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
  s: number;
}

/** What a wall clock in `timeZone` shows at this instant. No library: Intl knows every zone. */
function wallClock(instantMs: number, timeZone: string): WallClock {
  const parts: Record<string, string> = {};
  const format = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23', // avoids "24:00" at midnight
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  for (const part of format.formatToParts(new Date(instantMs))) parts[part.type] = part.value;
  return { y: +parts.year, mo: +parts.month, d: +parts.day, h: +parts.hour, mi: +parts.minute, s: +parts.second };
}

export function localDateOf(instant: string | Date, timeZone: string): DateOnly {
  const ms = typeof instant === 'string' ? Date.parse(instant) : instant.getTime();
  const c = wallClock(ms, timeZone);
  return `${c.y}-${String(c.mo).padStart(2, '0')}-${String(c.d).padStart(2, '0')}`;
}

/** How far the zone's wall clock is ahead of UTC at this instant, in ms. */
function offsetMs(utcMs: number, timeZone: string): number {
  const c = wallClock(utcMs, timeZone);
  return Date.UTC(c.y, c.mo - 1, c.d, c.h, c.mi, c.s) - utcMs;
}

/**
 * The UTC instant at which the wall clock in `timeZone` shows `date time`.
 * Two passes, because the offset itself can change on a daylight saving day.
 */
export function zonedToUtcIso(date: DateOnly, time: string, timeZone: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm, ss = 0] = time.split(':').map(Number);
  const wall = Date.UTC(y, m - 1, d, hh, mm, ss);
  let utc = wall - offsetMs(wall, timeZone);
  utc = wall - offsetMs(utc, timeZone);
  return new Date(utc).toISOString();
}

/**
 * Settings as stored, made safe. A bad value never stops the plan: it falls
 * back to the default, because a plan with a default is better than no plan.
 */
export function normalizeSettings(stored: Partial<ScheduleSettings> | null): ScheduleSettings {
  const pace =
    stored?.pace && (PACES as readonly string[]).includes(stored.pace) ? stored.pace : DEFAULT_SETTINGS.pace;
  const daysOff = [...new Set((stored?.daysOff ?? []).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))];
  const sessionTime =
    stored?.sessionTime && /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(stored.sessionTime)
      ? stored.sessionTime
      : DEFAULT_SETTINGS.sessionTime;
  const timeZone =
    stored?.timeZone && isValidTimeZone(stored.timeZone) ? stored.timeZone : DEFAULT_SETTINGS.timeZone;
  return { pace, daysOff, sessionTime, timeZone };
}
