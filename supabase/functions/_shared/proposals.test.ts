import { describe, expect, it } from 'vitest';
import { isRealDate, todayIn, validateProposals } from './proposals.ts';

const TEXT = [
  'BIO 101 Introduction to Biology, Fall 2026.',
  'The Midterm Exam is on Thursday, November 12, 2026, in class.',
  'The Final Exam is on Tuesday,\nDecember 15, 2026, in Hall B.',
].join('\n\n');

const TODAY = '2026-10-10';

function proposal(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Midterm Exam',
    date: '2026-11-12',
    kind: 'exam',
    topics: ['Cell structure', 'Membrane transport'],
    evidence: 'The Midterm Exam is on Thursday, November 12, 2026, in class.',
    ...overrides,
  };
}

describe('isRealDate', () => {
  it('accepts real calendar dates', () => {
    expect(isRealDate('2026-11-12')).toBe(true);
    expect(isRealDate('2028-02-29')).toBe(true); // leap year
  });

  it('rejects dates that do not exist or are not YYYY-MM-DD', () => {
    expect(isRealDate('2026-02-30')).toBe(false);
    expect(isRealDate('2026-02-29')).toBe(false); // not a leap year
    expect(isRealDate('2026-13-01')).toBe(false);
    expect(isRealDate('2026-00-10')).toBe(false);
    expect(isRealDate('2026-11-00')).toBe(false);
    expect(isRealDate('2026-11-1')).toBe(false);
    expect(isRealDate('12/11/2026')).toBe(false);
    expect(isRealDate('2026-11-12T00:00:00Z')).toBe(false);
    expect(isRealDate(20261112)).toBe(false);
    expect(isRealDate(null)).toBe(false);
  });
});

describe('todayIn', () => {
  it('gives the calendar day in the given time zone', () => {
    const now = new Date('2026-10-10T23:30:00Z');
    expect(todayIn('UTC', now)).toBe('2026-10-10');
    expect(todayIn('Asia/Ho_Chi_Minh', now)).toBe('2026-10-11');
    expect(todayIn('America/Los_Angeles', now)).toBe('2026-10-10');
  });

  it('falls back to UTC for an unknown time zone', () => {
    expect(todayIn('Not/A_Zone', new Date('2026-10-10T23:30:00Z'))).toBe('2026-10-10');
  });
});

describe('validateProposals', () => {
  it('keeps a valid proposal and marks it not past', () => {
    const out = validateProposals({ found: true, proposals: [proposal()] }, TEXT, TODAY);
    expect(out).toEqual({
      found: true,
      proposals: [{ ...proposal(), past: false }],
    });
  });

  it('drops a proposal whose date is not a real date', () => {
    const out = validateProposals({ found: true, proposals: [proposal({ date: '2026-02-30' })] }, TEXT, TODAY);
    expect(out).toEqual({ found: false, proposals: [] });
  });

  it('drops a proposal whose evidence is not in the text', () => {
    const out = validateProposals(
      { found: true, proposals: [proposal({ evidence: 'The midterm is in week 7.' })] },
      TEXT,
      TODAY,
    );
    expect(out).toEqual({ found: false, proposals: [] });
  });

  it('accepts evidence copied across a line break', () => {
    const out = validateProposals(
      {
        found: true,
        proposals: [
          proposal({
            title: 'Final Exam',
            date: '2026-12-15',
            evidence: 'The Final Exam is on Tuesday, December 15, 2026, in Hall B.',
          }),
        ],
      },
      TEXT,
      TODAY,
    );
    expect(out.found).toBe(true);
    expect(out.proposals[0].date).toBe('2026-12-15');
  });

  it('keeps a past date but flags it', () => {
    const out = validateProposals({ found: true, proposals: [proposal()] }, TEXT, '2026-12-01');
    expect(out.proposals).toHaveLength(1);
    expect(out.proposals[0].past).toBe(true);
  });

  it('does not flag a date that is today', () => {
    const out = validateProposals({ found: true, proposals: [proposal()] }, TEXT, '2026-11-12');
    expect(out.proposals[0].past).toBe(false);
  });

  it('removes duplicate topics and blank topics, keeping the first spelling and order', () => {
    const out = validateProposals(
      {
        found: true,
        proposals: [proposal({ topics: ['Cell structure', ' cell  structure ', '', 'Genetics', 'Cell Structure', 42] })],
      },
      TEXT,
      TODAY,
    );
    expect(out.proposals[0].topics).toEqual(['Cell structure', 'Genetics']);
  });

  it('caps topics at 30 and drops topics longer than 120 characters', () => {
    const many = Array.from({ length: 40 }, (_, i) => `Topic ${i + 1}`);
    const out = validateProposals(
      { found: true, proposals: [proposal({ topics: ['x'.repeat(121), ...many] })] },
      TEXT,
      TODAY,
    );
    expect(out.proposals[0].topics).toHaveLength(30);
    expect(out.proposals[0].topics[0]).toBe('Topic 1');
  });

  it('drops a proposal with an empty or too long title, and trims a good one', () => {
    expect(validateProposals({ proposals: [proposal({ title: '   ' })] }, TEXT, TODAY).found).toBe(false);
    expect(validateProposals({ proposals: [proposal({ title: 'x'.repeat(121) })] }, TEXT, TODAY).found).toBe(false);
    expect(validateProposals({ proposals: [proposal({ title: '  Midterm Exam ' })] }, TEXT, TODAY).proposals[0].title).toBe(
      'Midterm Exam',
    );
  });

  it('drops a proposal with an unknown kind', () => {
    const out = validateProposals({ found: true, proposals: [proposal({ kind: 'assignment' })] }, TEXT, TODAY);
    expect(out.found).toBe(false);
  });

  it('drops a proposal whose topics is not a list', () => {
    const out = validateProposals({ found: true, proposals: [proposal({ topics: 'Cells' })] }, TEXT, TODAY);
    expect(out.found).toBe(false);
  });

  it('keeps only the first of two proposals with the same title and date', () => {
    const out = validateProposals({ found: true, proposals: [proposal(), proposal({ topics: [] })] }, TEXT, TODAY);
    expect(out.proposals).toHaveLength(1);
    expect(out.proposals[0].topics).toEqual(['Cell structure', 'Membrane transport']);
  });

  it('gives found false for an empty list, even when the AI said found true', () => {
    expect(validateProposals({ found: true, proposals: [] }, TEXT, TODAY)).toEqual({ found: false, proposals: [] });
  });

  it('gives found false for answers with the wrong shape', () => {
    for (const bad of [null, undefined, 'text', 42, [], { found: true }, { proposals: 'none' }, { proposals: [null, 'x', 3] }]) {
      expect(validateProposals(bad, TEXT, TODAY)).toEqual({ found: false, proposals: [] });
    }
  });
});

describe('date must appear in the evidence', () => {
  const text = ['Midterm on November 12 at 9am.', 'Quiz 1 is in Week 7.', 'Exam on 12/11/2026 in Hall B.'].join(' ');
  const run = (p: Record<string, unknown>) => validateProposals({ proposals: [proposal(p)] }, text, TODAY).proposals;

  it('passes when the evidence has the day number', () => {
    expect(run({ evidence: 'Midterm on November 12 at 9am' })).toHaveLength(1);
  });

  it('drops evidence that does not mention the date', () => {
    expect(run({ title: 'Quiz 1', date: '2026-10-20', evidence: 'Quiz 1 is in Week 7' })).toHaveLength(0);
  });

  it('passes a numeric date such as 12/11/2026', () => {
    expect(run({ evidence: 'Exam on 12/11/2026 in Hall B' })).toHaveLength(1);
  });
});
