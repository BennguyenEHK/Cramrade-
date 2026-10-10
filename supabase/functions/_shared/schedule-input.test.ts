import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  addDays,
  isValidTimeZone,
  localDateOf,
  normalizeSettings,
  parseDifficulty,
  toScheduleInput,
  toSessionRows,
  topicsToRate,
  zonedToUtcIso,
  type ScheduleRows,
  type ScheduleSettings,
} from './schedule-input.ts';
import type { ScheduleOutput } from './engine.ts';

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

const UTC: ScheduleSettings = { pace: 'normal', daysOff: [], sessionTime: '18:00', timeZone: 'UTC' };
const HCM: ScheduleSettings = { ...UTC, timeZone: 'Asia/Ho_Chi_Minh' };
const TODAY = '2026-10-10'; // a Saturday

const EMPTY: ScheduleRows = { exams: [], topics: [], chunks: [], questions: [], attempts: [], sessions: [] };

function rows(over: Partial<ScheduleRows> = {}): ScheduleRows {
  return {
    exams: [{ id: 'e1', title: 'Biology', exam_date: '2026-10-24' }],
    topics: [
      { id: 't2', exam_id: 'e1', title: 'Genes', position: 1, difficulty: null },
      { id: 't1', exam_id: 'e1', title: 'Cells', position: 0, difficulty: 4 },
    ],
    chunks: [
      { id: 'c2', note_id: 'n1', exam_id: 'e1', position: 1 },
      { id: 'c1', note_id: 'n1', exam_id: 'e1', position: 0 },
    ],
    questions: [
      { id: 'q1', chunk_id: 'c1', topic_id: 't1', created_at: '2026-10-01T00:00:00Z' },
      { id: 'q2', chunk_id: 'c1', topic_id: 't1', created_at: '2026-10-01T00:00:01Z' },
      { id: 'q3', chunk_id: 'c1', topic_id: 't2', created_at: '2026-10-01T00:00:02Z' },
      { id: 'q4', chunk_id: 'c2', topic_id: 't2', created_at: '2026-10-01T00:00:00Z' },
    ],
    attempts: [],
    sessions: [],
    ...over,
  };
}

function attempt(id: string, question_id: string, session_id: string | null, is_correct: boolean, answered_at: string) {
  return { id, question_id, session_id, is_correct, answered_at };
}

describe('toScheduleInput', () => {
  it('turns an empty database into an empty input', () => {
    expect(toScheduleInput(EMPTY, TODAY, UTC, [])).toEqual({
      today: TODAY,
      exams: [],
      pace: 'normal',
      busyDays: [],
      keep: [],
    });
  });

  it('maps exams, topics and chunks in a stable order', () => {
    const input = toScheduleInput(rows(), TODAY, UTC, []);
    expect(input.exams).toHaveLength(1);
    const exam = input.exams[0];
    expect(exam.id).toBe('e1');
    expect(exam.examDate).toBe('2026-10-24');
    expect(exam.topics).toEqual([
      { id: 't1', difficulty: 4 },
      { id: 't2', difficulty: null },
    ]);
    expect(exam.chunks.map((c) => c.id)).toEqual(['c1', 'c2']);
    expect(exam.chunks[0]).toEqual({
      id: 'c1',
      topicId: 't1', // two questions on t1, one on t2
      questionIds: ['q1', 'q2', 'q3'], // none asked yet: oldest made first
      history: { correctSessions: 0, lastSeen: null, lastCorrect: null },
    });
    expect(exam.chunks[1].topicId).toBe('t2');
  });

  it('gives the same input whatever order the rows come in', () => {
    const a = rows();
    const b = rows({
      topics: [...a.topics].reverse(),
      chunks: [...a.chunks].reverse(),
      questions: [...a.questions].reverse(),
    });
    expect(toScheduleInput(b, TODAY, UTC, [])).toEqual(toScheduleInput(a, TODAY, UTC, []));
  });

  it('turns a stored difficulty outside 1 to 5 into null', () => {
    const r = rows({ topics: [{ id: 't1', exam_id: 'e1', title: 'Cells', position: 0, difficulty: 0 }] });
    expect(toScheduleInput(r, TODAY, UTC, []).exams[0].topics).toEqual([{ id: 't1', difficulty: null }]);
  });

  it('ignores a question topic that belongs to another exam', () => {
    const r = rows({ questions: [{ id: 'q4', chunk_id: 'c2', topic_id: 'tX', created_at: '2026-10-01T00:00:00Z' }] });
    expect(toScheduleInput(r, TODAY, UTC, []).exams[0].chunks[1].topicId).toBeNull();
  });

  it('builds chunk history from attempts', () => {
    const r = rows({
      attempts: [
        attempt('a1', 'q1', 's1', true, '2026-10-02T10:00:00Z'),
        attempt('a2', 'q2', 's1', true, '2026-10-02T10:01:00Z'), // same session: counts once
        attempt('a3', 'q1', 's2', true, '2026-10-05T10:00:00Z'),
        attempt('a4', 'q3', 's3', false, '2026-10-08T10:00:00Z'), // latest answer is wrong
      ],
    });
    const c1 = toScheduleInput(r, TODAY, UTC, []).exams[0].chunks[0];
    expect(c1.history).toEqual({ correctSessions: 2, lastSeen: '2026-10-08', lastCorrect: false });
    // least recently asked first: q2 (10-02), q1 (10-05), q3 (10-08)
    expect(c1.questionIds).toEqual(['q2', 'q1', 'q3']);
  });

  it('puts never-asked questions before asked ones', () => {
    const r = rows({ attempts: [attempt('a1', 'q1', 's1', true, '2026-10-02T10:00:00Z')] });
    expect(toScheduleInput(r, TODAY, UTC, []).exams[0].chunks[0].questionIds).toEqual(['q2', 'q3', 'q1']);
  });

  it('counts reviews outside the plan once per day', () => {
    const r = rows({
      attempts: [
        attempt('a1', 'q1', null, true, '2026-10-02T08:00:00Z'),
        attempt('a2', 'q2', null, true, '2026-10-02T09:00:00Z'),
        attempt('a3', 'q1', null, true, '2026-10-03T08:00:00Z'),
      ],
    });
    expect(toScheduleInput(r, TODAY, UTC, []).exams[0].chunks[0].history.correctSessions).toBe(2);
  });

  it('reads lastSeen in the student time zone', () => {
    const r = rows({ attempts: [attempt('a1', 'q4', 's1', true, '2026-10-09T20:00:00Z')] });
    expect(toScheduleInput(r, TODAY, UTC, []).exams[0].chunks[1].history.lastSeen).toBe('2026-10-09');
    expect(toScheduleInput(r, TODAY, HCM, []).exams[0].chunks[1].history.lastSeen).toBe('2026-10-10');
  });

  it('expands days off and busy ranges inside the horizon', () => {
    const settings = { ...UTC, daysOff: [0] }; // Sundays
    const busy = [
      { fromDate: '2026-10-08', toDate: '2026-10-12' }, // starts before today: clipped
      { fromDate: '2026-10-30', toDate: '2026-11-02' }, // after the last exam: dropped
    ];
    expect(toScheduleInput(rows(), TODAY, settings, busy).busyDays).toEqual([
      '2026-10-10',
      '2026-10-11',
      '2026-10-12',
      '2026-10-18',
    ]);
  });

  it('ignores a busy range typed backwards', () => {
    expect(toScheduleInput(rows(), TODAY, UTC, [{ fromDate: '2026-10-15', toDate: '2026-10-13' }]).busyDays).toEqual([]);
  });

  it('keeps done, skipped and already-answered sessions from today on', () => {
    const r = rows({
      sessions: [
        { id: 's1', exam_id: 'e1', scheduled_for: '2026-10-11T11:00:00Z', status: 'done', has_attempts: true },
        { id: 's2', exam_id: 'e1', scheduled_for: '2026-10-12T11:00:00Z', status: 'skipped', has_attempts: false },
        { id: 's3', exam_id: 'e1', scheduled_for: '2026-10-13T11:00:00Z', status: 'planned', has_attempts: false },
        { id: 's4', exam_id: 'e1', scheduled_for: '2026-10-14T11:00:00Z', status: 'planned', has_attempts: true },
        { id: 's5', exam_id: 'e1', scheduled_for: '2026-10-05T11:00:00Z', status: 'done', has_attempts: true },
        { id: 's6', exam_id: 'eX', scheduled_for: '2026-10-15T11:00:00Z', status: 'done', has_attempts: true },
      ],
    });
    expect(toScheduleInput(r, TODAY, UTC, []).keep).toEqual([
      { examId: 'e1', scheduledFor: '2026-10-11' },
      { examId: 'e1', scheduledFor: '2026-10-12' },
      { examId: 'e1', scheduledFor: '2026-10-14' },
    ]);
  });

  it('reads kept session days in the student time zone', () => {
    const r = rows({
      sessions: [{ id: 's1', exam_id: 'e1', scheduled_for: '2026-10-09T18:00:00Z', status: 'done', has_attempts: true }],
    });
    expect(toScheduleInput(r, TODAY, UTC, []).keep).toEqual([]);
    expect(toScheduleInput(r, TODAY, HCM, []).keep).toEqual([{ examId: 'e1', scheduledFor: '2026-10-10' }]);
  });

  it('passes the pace through', () => {
    expect(toScheduleInput(EMPTY, TODAY, { ...UTC, pace: 'light' }, []).pace).toBe('light');
  });
});

describe('toSessionRows', () => {
  const output: ScheduleOutput = {
    sessions: [
      { examId: 'e1', scheduledFor: '2026-10-20', questionIds: ['q1', 'q2'], isFinalPass: false, topicIds: ['t1'] },
      { examId: 'e1', scheduledFor: '2026-10-23', questionIds: ['q3'], isFinalPass: true, topicIds: ['t1', 't2'] },
    ],
    warnings: [],
  };

  it('puts each session at the student session time, in UTC', () => {
    expect(toSessionRows(output, HCM)).toEqual([
      { exam_id: 'e1', scheduled_for: '2026-10-20T11:00:00.000Z', is_final_pass: false, question_ids: ['q1', 'q2'] },
      { exam_id: 'e1', scheduled_for: '2026-10-23T11:00:00.000Z', is_final_pass: true, question_ids: ['q3'] },
    ]);
    expect(toSessionRows(output, UTC)[0].scheduled_for).toBe('2026-10-20T18:00:00.000Z');
  });
});

describe('topicsToRate', () => {
  it('picks unrated topics that have questions, with up to 3 sample chunks', () => {
    expect(topicsToRate(rows())).toEqual([{ topicId: 't2', title: 'Genes', chunkIds: ['c1', 'c2'] }]);
  });

  it('skips a topic with no questions', () => {
    const r = rows({ questions: rows().questions.filter((q) => q.topic_id !== 't2') });
    expect(topicsToRate(r)).toEqual([]);
  });

  it('rates at most `limit` topics, closest exam and first topic first', () => {
    const topics = Array.from({ length: 12 }, (_, i) => ({
      id: `t${String(i).padStart(2, '0')}`,
      exam_id: 'e1',
      title: `Topic ${i}`,
      position: i,
      difficulty: null,
    }));
    const questions = topics.map((t, i) => ({ id: `q${i}`, chunk_id: 'c1', topic_id: t.id, created_at: '2026-10-01T00:00:00Z' }));
    const picked = topicsToRate(rows({ topics, questions }), 10);
    expect(picked).toHaveLength(10);
    expect(picked[0].topicId).toBe('t00');
    expect(picked[9].topicId).toBe('t09');
  });
});

describe('parseDifficulty', () => {
  it('accepts a whole number from 1 to 5', () => {
    expect(parseDifficulty({ difficulty: 1 })).toBe(1);
    expect(parseDifficulty({ difficulty: 5 })).toBe(5);
  });

  it('rejects anything else', () => {
    expect(parseDifficulty({ difficulty: 0 })).toBeNull();
    expect(parseDifficulty({ difficulty: 6 })).toBeNull();
    expect(parseDifficulty({ difficulty: 2.5 })).toBeNull();
    expect(parseDifficulty({ difficulty: '4' })).toBeNull();
    expect(parseDifficulty(null)).toBeNull();
    expect(parseDifficulty('3')).toBeNull();
  });
});
