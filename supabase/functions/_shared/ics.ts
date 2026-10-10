// supabase/functions/_shared/ics.ts
// Builds the text of an iCalendar feed (RFC 5545) from exams and planned
// sessions. Pure: no Deno APIs, so vitest tests it. Calendar apps re-read the
// whole feed every hour; a stable UID per row makes them update an event in
// place instead of adding a copy.

export interface IcsExam {
  id: string;
  title: string;
  /** YYYY-MM-DD */
  examDate: string;
}

export interface IcsSession {
  id: string;
  examTitle: string;
  topicTitles: string[];
  /** ISO instant, for example 2026-10-20T11:00:00.000Z */
  startsAt: string;
  minutes: number;
}

export interface IcsInput {
  calName: string;
  exams: IcsExam[];
  sessions: IcsSession[];
  /** Used for DTSTAMP. Tests pass a fixed time; the function leaves it out. */
  now?: Date;
}

const UID_DOMAIN = 'cramrade.expo.app';
const APP_LINK = 'https://cramrade.expo.app';
const MAX_OCTETS = 75;
const encoder = new TextEncoder();

/** RFC 5545 3.3.11: backslash first, then semicolon, comma and line breaks. */
export function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/**
 * RFC 5545 3.1: lines longer than 75 octets are split, each continuation
 * starting with one space. Counted in UTF-8 bytes and split only between
 * characters, so a Vietnamese letter is never cut in half.
 */
export function foldLine(line: string): string {
  const out: string[] = [];
  let current = '';
  let bytes = 0;
  for (const ch of line) {
    const size = encoder.encode(ch).length;
    if (bytes + size > MAX_OCTETS) {
      out.push(current);
      current = ` ${ch}`;
      bytes = 1 + size;
    } else {
      current += ch;
      bytes += size;
    }
  }
  out.push(current);
  return out.join('\r\n');
}

/** 2026-10-20T11:00:00.000Z -> 20261020T110000Z */
function utcStamp(ms: number): string {
  return new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** 2026-10-31 -> 20261031 */
function dateValue(date: string): string {
  return date.replace(/-/g, '');
}

function nextDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

export function buildIcs(input: IcsInput): string {
  const stamp = utcStamp((input.now ?? new Date()).getTime());
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Cramrade//Calendar feed//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(input.calName)}`,
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H',
  ];

  for (const exam of input.exams) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${exam.id}@${UID_DOMAIN}`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${dateValue(exam.examDate)}`,
      `DTEND;VALUE=DATE:${dateValue(nextDay(exam.examDate))}`, // all-day: the end date is exclusive
      `SUMMARY:${escapeText(`Exam: ${exam.title}`)}`,
      'TRANSP:TRANSPARENT', // an all-day marker should not show the student as busy
      'END:VEVENT',
    );
  }

  for (const session of input.sessions) {
    const start = Date.parse(session.startsAt);
    const topics = session.topicTitles.length > 0 ? session.topicTitles.join(', ') : 'mixed review';
    lines.push(
      'BEGIN:VEVENT',
      `UID:${session.id}@${UID_DOMAIN}`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${utcStamp(start)}`,
      `DTEND:${utcStamp(start + session.minutes * 60_000)}`,
      `SUMMARY:${escapeText(`Study: ${session.examTitle}`)}`,
      `DESCRIPTION:${escapeText(`Topics: ${topics}\nOpen Cramrade to start: ${APP_LINK}`)}`,
      'END:VEVENT',
    );
  }

  lines.push('END:VCALENDAR');
  return `${lines.map(foldLine).join('\r\n')}\r\n`;
}
