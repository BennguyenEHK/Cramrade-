// supabase/functions/_shared/ics.test.ts
import ICAL from 'ical.js';
import { describe, expect, it } from 'vitest';
import { buildIcs, escapeText, foldLine, type IcsInput } from './ics.ts';

const NOW = new Date('2026-10-10T08:00:00Z');
const encoder = new TextEncoder();

const input: IcsInput = {
  calName: 'Cramrade',
  now: NOW,
  exams: [{ id: 'exam-1', title: 'Biology', examDate: '2026-10-31' }],
  sessions: [
    {
      id: 'sess-1',
      examTitle: 'Biology',
      topicTitles: ['Cells', 'Genes'],
      startsAt: '2026-10-20T11:00:00.000Z',
      minutes: 20,
    },
  ],
};

function events(text: string) {
  return new ICAL.Component(ICAL.parse(text)).getAllSubcomponents('vevent');
}

function physicalLines(text: string): string[] {
  return text.split('\r\n').slice(0, -1); // the text ends with CRLF
}

describe('buildIcs', () => {
  it('has the calendar frame, CRLF endings and refresh hints', () => {
    const text = buildIcs(input);
    expect(text.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(true);
    expect(text.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(/(^|[^\r])\n/.test(text)).toBe(false); // no bare LF
    expect(text).toContain('\r\nX-WR-CALNAME:Cramrade\r\n');
    expect(text).toContain('\r\nREFRESH-INTERVAL;VALUE=DURATION:PT1H\r\n');
    expect(text).toContain('\r\nX-PUBLISHED-TTL:PT1H\r\n');
  });

  it('writes an exam as an all-day event ending the next day', () => {
    const text = buildIcs(input);
    expect(text).toContain('\r\nUID:exam-1@cramrade.expo.app\r\n');
    expect(text).toContain('\r\nDTSTART;VALUE=DATE:20261031\r\n');
    expect(text).toContain('\r\nDTEND;VALUE=DATE:20261101\r\n'); // across a month end
    expect(text).toContain('\r\nDTSTAMP:20261010T080000Z\r\n');
  });

  it('writes a session in UTC with its length', () => {
    const text = buildIcs(input);
    expect(text).toContain('\r\nUID:sess-1@cramrade.expo.app\r\n');
    expect(text).toContain('\r\nDTSTART:20261020T110000Z\r\n');
    expect(text).toContain('\r\nDTEND:20261020T112000Z\r\n');
  });

  it('parses with a strict parser and keeps the text', () => {
    const [exam, session] = events(buildIcs(input));
    expect(exam.getFirstPropertyValue('summary')).toBe('Exam: Biology');
    expect(session.getFirstPropertyValue('summary')).toBe('Study: Biology');
    expect(session.getFirstPropertyValue('description')).toBe(
      'Topics: Cells, Genes\nOpen Cramrade to start: https://cramrade.expo.app',
    );
  });

  it('escapes commas, semicolons and line breaks in titles', () => {
    const title = 'Bio; part 1, cells\nand more';
    const text = buildIcs({ ...input, exams: [{ id: 'exam-1', title, examDate: '2026-10-31' }] });
    expect(text).toContain('SUMMARY:Exam: Bio\\; part 1\\, cells\\nand more');
    expect(events(text)[0].getFirstPropertyValue('summary')).toBe(`Exam: ${title}`);
  });

  it('folds a long description at 75 bytes and unfolds back to the same text', () => {
    const topicTitles = Array.from({ length: 30 }, (_, i) => `Photosynthesis part ${i}`);
    const text = buildIcs({ ...input, sessions: [{ ...input.sessions[0], topicTitles }] });
    for (const line of physicalLines(text)) expect(encoder.encode(line).length).toBeLessThanOrEqual(75);
    expect(text).toContain('\r\n '); // at least one continuation line
    expect(events(text)[1].getFirstPropertyValue('description')).toBe(
      `Topics: ${topicTitles.join(', ')}\nOpen Cramrade to start: https://cramrade.expo.app`,
    );
  });

  it('folds Vietnamese text without cutting a letter in half', () => {
    const title = 'Sinh học tế bào và di truyền '.repeat(6).trim();
    const text = buildIcs({ ...input, exams: [{ id: 'exam-1', title, examDate: '2026-10-31' }] });
    for (const line of physicalLines(text)) expect(encoder.encode(line).length).toBeLessThanOrEqual(75);
    expect(events(text)[0].getFirstPropertyValue('summary')).toBe(`Exam: ${title}`);
  });

  it('keeps the same UID when the feed is built again later', () => {
    const uids = (text: string) => physicalLines(text).filter((l) => l.startsWith('UID:'));
    const first = buildIcs(input);
    const later = buildIcs({ ...input, now: new Date('2026-10-11T08:00:00Z') });
    expect(uids(later)).toEqual(uids(first));
    expect(later).not.toEqual(first); // only DTSTAMP changed
  });

  it('says "mixed review" when a session has no topics', () => {
    const text = buildIcs({ ...input, sessions: [{ ...input.sessions[0], topicTitles: [] }] });
    expect(events(text)[1].getFirstPropertyValue('description')).toBe(
      'Topics: mixed review\nOpen Cramrade to start: https://cramrade.expo.app',
    );
  });

  it('is still a valid calendar with nothing in it', () => {
    const text = buildIcs({ calName: 'Cramrade', exams: [], sessions: [], now: NOW });
    expect(events(text)).toHaveLength(0);
    expect(text.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(text.endsWith('END:VCALENDAR\r\n')).toBe(true);
  });
});

describe('escapeText', () => {
  it('escapes backslash first, then ; , and line breaks', () => {
    expect(escapeText('a;b,c\\d\ne\r\nf')).toBe('a\\;b\\,c\\\\d\\ne\\nf');
  });
});

describe('foldLine', () => {
  it('leaves a 75-byte line alone and folds a 76-byte one', () => {
    expect(foldLine('x'.repeat(75))).toBe('x'.repeat(75));
    expect(foldLine('x'.repeat(76))).toBe(`${'x'.repeat(75)}\r\n x`);
  });
});
