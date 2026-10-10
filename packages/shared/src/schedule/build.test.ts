import { describe, expect, it } from 'vitest';
import type { ScheduleInput } from '../types';
import { buildSchedule } from './build';
import { assertInvariants, chunk, chunksIn, day, daysOf, exam, input, topic } from './fixtures';

/** Runs the engine and checks the rules every output must keep. */
function run(inp: ScheduleInput) {
  const out = buildSchedule(inp);
  assertInvariants(inp, out);
  return out;
}

describe('buildSchedule: one exam', () => {
  it('exam tomorrow: only a final pass today', () => {
    const out = run(input({ exams: [exam('e', day(1))] }));
    expect(out.sessions).toHaveLength(1);
    expect(out.sessions[0]).toMatchObject({ scheduledFor: day(0), isFinalPass: true });
    expect(out.warnings).toEqual([{ code: 'not_enough_days', examId: 'e' }]);
  });

  it('exam today: nothing, and a warning', () => {
    const out = run(input({ exams: [exam('e', day(0))] }));
    expect(out.sessions).toEqual([]);
    expect(out.warnings).toEqual([{ code: 'not_enough_days', examId: 'e' }]);
  });

  it('exam in 14 days: sessions every gapDays until secure, final pass the day before', () => {
    const out = run(input({ exams: [exam('e', day(14))] }));
    expect(daysOf(out, 'e')).toEqual([day(0), day(3), day(5), day(13)]);
    expect(out.sessions.map((s) => s.isFinalPass)).toEqual([false, false, false, true]);
    expect(out.warnings).toEqual([]);
  });

  it('exam in 3 months: sparse far out, final pass the day before', () => {
    const out = run(input({ exams: [exam('e', day(90), 4, 5)] }));
    const days = daysOf(out, 'e');
    expect(days.slice(0, 3)).toEqual([day(0), day(14), day(28)]);
    expect(days.filter((d) => d < day(30))).toHaveLength(3);
    expect(days.at(-1)).toBe(day(89));
    expect(out.sessions.at(-1)!.isFinalPass).toBe(true);
    expect(out.warnings).toEqual([]);
  });

  it('exam past: no sessions for it, a warning, other exams still planned', () => {
    const out = run(input({ exams: [exam('old', day(-1)), exam('e', day(14))] }));
    expect(daysOf(out, 'old')).toEqual([]);
    expect(daysOf(out, 'e').length).toBeGreaterThan(0);
    expect(out.warnings).toEqual([{ code: 'exam_past', examId: 'old' }]);
  });

  it('final pass is present and the exam day is empty', () => {
    const out = run(input({ exams: [exam('e', day(20))] }));
    const finals = out.sessions.filter((s) => s.isFinalPass);
    expect(finals).toHaveLength(1);
    expect(finals[0].scheduledFor).toBe(day(19));
    expect(finals[0].topicIds).toEqual(['e-t1', 'e-t2', 'e-t3']);
    expect(out.sessions.some((s) => s.scheduledFor >= day(20))).toBe(false);
  });

  it('more material than the rhythm holds: extra sessions every day, load_increased', () => {
    const out = run(input({ exams: [exam('e', day(14), 3, 10)] }));
    expect(daysOf(out, 'e')).toHaveLength(14);
    expect(out.warnings).toEqual([{ code: 'load_increased', examId: 'e' }]);
  });

  it('more material than the days hold: not_enough_days as well', () => {
    const out = run(input({ exams: [exam('e', day(14), 3, 15)] }));
    expect(daysOf(out, 'e')).toHaveLength(14);
    expect(out.warnings).toEqual([
      { code: 'load_increased', examId: 'e' },
      { code: 'not_enough_days', examId: 'e' },
    ]);
  });

  it('far exam: new material keeps arriving, every chunk first seen at least 3 weeks before the exam', () => {
    const out = run(input({ exams: [exam('e', day(90), 4, 5)] }));
    const firstSeen = new Map<string, string>();
    for (const s of out.sessions) for (const c of chunksIn(s)) if (!firstSeen.has(c)) firstSeen.set(c, s.scheduledFor);
    expect(firstSeen.size).toBe(20);
    for (const d of firstSeen.values()) expect(d <= day(69)).toBe(true);
    for (const s of out.sessions.slice(1, 6)) expect(chunksIn(s).some((c) => firstSeen.get(c) === s.scheduledFor)).toBe(true);
  });
});

describe('buildSchedule: the student days', () => {
  it('busy week: nothing on busy days, the plan starts after them', () => {
    const busyDays = [0, 1, 2, 3, 4, 5, 6].map(day);
    const out = run(input({ exams: [exam('e', day(14))], busyDays }));
    expect(daysOf(out, 'e')).toEqual([day(7), day(8), day(9), day(13)]);
  });

  it('busy day before the exam: final pass moves one day earlier', () => {
    const out = run(input({ exams: [exam('e', day(14))], busyDays: [day(13)] }));
    expect(out.sessions.find((s) => s.isFinalPass)!.scheduledFor).toBe(day(12));
  });

  it('two exams in one week, pace normal: both planned, never over 2 a day', () => {
    const out = run(input({ exams: [exam('b', day(6)), exam('a', day(5))], pace: 'normal' }));
    expect(daysOf(out, 'a')).toEqual([day(0), day(1), day(2), day(4)]);
    expect(daysOf(out, 'b')).toEqual([day(0), day(1), day(2), day(5)]);
  });

  it('pace light: the closer exam wins the day, the other moves to the next free day', () => {
    const out = run(input({ exams: [exam('far', day(20)), exam('near', day(5))], pace: 'light' }));
    expect(daysOf(out, 'near')).toEqual([day(0), day(1), day(2), day(4)]);
    expect(daysOf(out, 'far')[0]).toBe(day(3));
  });

  it('no day goes over the pace cap with many exams', () => {
    const exams = [exam('a', day(4)), exam('b', day(6)), exam('c', day(9)), exam('d', day(12))];
    for (const pace of ['light', 'normal', 'heavy'] as const) run(input({ exams, pace }));
  });
});

describe('buildSchedule: answers drive the plan', () => {
  it('skipped session reflow: kept day stays taken, unseen chunks come back next day', () => {
    // Plan made on day 0 had sessions on day 0, 3 and 5. Day 0 was done (all correct);
    // the day 3 session is skipped, and the plan is rebuilt on day 3.
    const e = exam('e', day(14));
    e.chunks = e.chunks.map((c) => ({ ...c, history: { correctSessions: 1, lastSeen: day(0), lastCorrect: true } }));
    const out = run(
      input({ today: day(3), exams: [e], keep: [{ examId: 'e', scheduledFor: day(3) }] }),
    );
    const days = daysOf(out, 'e');
    expect(days).not.toContain(day(3));
    expect(days[0]).toBe(day(4));
    expect(chunksIn(out.sessions[0]).sort()).toEqual(e.chunks.map((c) => c.id).sort());
  });

  it('a chunk with 3 correct sessions leaves the plan until the final pass', () => {
    const e = exam('e', day(20));
    e.chunks[0] = chunk('e-t1-c1', 'e-t1', { correctSessions: 3, lastSeen: day(-1), lastCorrect: true });
    const out = run(input({ exams: [e] }));
    for (const s of out.sessions.filter((x) => !x.isFinalPass)) expect(chunksIn(s)).not.toContain('e-t1-c1');
    expect(chunksIn(out.sessions.find((s) => s.isFinalPass)!)).toContain('e-t1-c1');
  });

  it('a wrong answer brings the chunk back first in the next session', () => {
    const e = exam('e', day(30));
    e.chunks = e.chunks.map((c) => ({ ...c, history: { correctSessions: 1, lastSeen: day(-1), lastCorrect: true } }));
    e.chunks[3] = { ...e.chunks[3], history: { correctSessions: 1, lastSeen: day(-1), lastCorrect: false } };
    const out = run(input({ exams: [e] }));
    expect(out.sessions[0].scheduledFor).toBe(day(0));
    expect(chunksIn(out.sessions[0])[0]).toBe(e.chunks[3].id);
  });

  it('a topic with no questions warns, and its chunks are never planned', () => {
    const e = exam('e', day(14));
    e.topics.push(topic('empty'));
    e.chunks.push(chunk('blank', 'empty', { questions: 0 }));
    const out = run(input({ exams: [e] }));
    expect(out.warnings).toEqual([
      { code: 'no_questions', examId: 'e' },
      { code: 'no_questions', examId: 'e', chunkId: 'blank' },
    ]);
    for (const s of out.sessions) expect(s.topicIds).not.toContain('empty');
  });

  it('an exam with no questions at all gets no sessions', () => {
    const e = { id: 'e', examDate: day(14), topics: [topic('t')], chunks: [] };
    const out = run(input({ exams: [e] }));
    expect(out).toEqual({ sessions: [], warnings: [{ code: 'no_questions', examId: 'e' }] });
  });

  it('difficulty prior: with no history, hard topics come first and easy last', () => {
    const e = {
      id: 'e',
      examDate: day(30),
      topics: [topic('easy', 1), topic('mid'), topic('hard', 5)],
      chunks: [chunk('e1', 'easy'), chunk('e2', 'easy'), chunk('m1', 'mid'), chunk('m2', 'mid'), chunk('h1', 'hard'), chunk('h2', 'hard')],
    };
    const out = run(input({ exams: [e] }));
    expect(chunksIn(out.sessions[0])).toEqual(['h1', 'h2', 'm1', 'm2', 'e1', 'e2']);
  });
});

describe('buildSchedule: inputs the screens can produce', () => {
  it('two exams on the same day: both planned, each gets its own final pass', () => {
    const out = run(input({ exams: [exam('y', day(10)), exam('x', day(10))], pace: 'normal' }));
    const finals = out.sessions.filter((s) => s.isFinalPass);
    expect(finals.map((s) => [s.examId, s.scheduledFor])).toEqual([
      ['x', day(9)],
      ['y', day(9)],
    ]);
  });

  it('two exams on the same day with pace light: the second final pass moves a day earlier', () => {
    const out = run(input({ exams: [exam('y', day(10)), exam('x', day(10))], pace: 'light' }));
    const finals = out.sessions.filter((s) => s.isFinalPass);
    expect(finals.map((s) => [s.examId, s.scheduledFor])).toEqual([
      ['y', day(8)],
      ['x', day(9)],
    ]);
  });

  it('chunks with no topic are planned, and no null topic id is listed', () => {
    const e = { id: 'e', examDate: day(14), topics: [], chunks: [chunk('n1', null), chunk('n2', null), chunk('n3', null)] };
    const out = run(input({ exams: [e] }));
    expect(out.sessions.length).toBeGreaterThan(0);
    for (const s of out.sessions) expect(s.topicIds).toEqual([]);
    expect(out.warnings).toEqual([]);
  });

  it('an exam a year away plans sparse sessions and a final pass', () => {
    const out = run(input({ exams: [exam('e', day(365), 4, 5)] }));
    const days = daysOf(out, 'e');
    expect(days[1]).toBe(day(14));
    expect(days.at(-1)).toBe(day(364));
  });

  it('refuses a date that is not YYYY-MM-DD instead of planning around it', () => {
    expect(() => buildSchedule(input({ exams: [exam('e', '2026-13-01')] }))).toThrow(/2026-13-01/);
    expect(() => buildSchedule(input({ today: '2026-11-2', exams: [exam('e', day(5))] }))).toThrow();
  });
});

describe('buildSchedule: warnings name the exam', () => {
  it('each exam gets its own warnings, sorted by code then exam', () => {
    const out = run(
      input({ exams: [exam('z', day(1)), exam('old', day(-3)), exam('a', day(1)), exam('fine', day(20))] }),
    );
    expect(out.warnings).toEqual([
      { code: 'exam_past', examId: 'old' },
      { code: 'not_enough_days', examId: 'a' },
      { code: 'not_enough_days', examId: 'z' },
    ]);
  });
});

describe('buildSchedule: deterministic (rule 11)', () => {
  const make = (): ScheduleInput =>
    input({
      exams: [exam('a', day(9), 2, 4), exam('b', day(30), 4, 3), exam('c', day(-2))],
      pace: 'normal',
      busyDays: [day(2), day(6)],
      keep: [{ examId: 'a', scheduledFor: day(0) }],
    });

  it('gives equal output for equal input', () => {
    expect(buildSchedule(make())).toEqual(buildSchedule(make()));
  });

  it('does not depend on the order of the exams', () => {
    const reversed = make();
    reversed.exams.reverse();
    expect(buildSchedule(reversed)).toEqual(buildSchedule(make()));
  });

  it('does not change its input', () => {
    const inp = make();
    const copy = structuredClone(inp);
    run(inp);
    expect(inp).toEqual(copy);
  });
});
