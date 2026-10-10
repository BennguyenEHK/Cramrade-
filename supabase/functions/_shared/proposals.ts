// Syllabus reader: the shape Gemini answers with, the schema we send it, and
// the checks every proposed date must pass before the student sees it.
// Proposals that fail a check are dropped, never repaired.
// Pure code: no Deno API and no npm import, so vitest can test it.
import { quoteAppears } from './quote-check.ts';

export const PROPOSAL_KINDS = ['exam', 'quiz', 'competition'] as const;
export type ProposalKind = (typeof PROPOSAL_KINDS)[number];

/** One dated assessment the AI says it found in the syllabus. */
export interface SyllabusProposal {
  title: string;
  /** YYYY-MM-DD */
  date: string;
  kind: ProposalKind;
  /** In syllabus order. */
  topics: string[];
  /** The sentence the date came from, copied from the syllabus. */
  evidence: string;
}

export interface SyllabusResult {
  found: boolean;
  proposals: SyllabusProposal[];
}

/** A proposal that passed every check. past is true when the date is before today. */
export interface ValidatedProposal extends SyllabusProposal {
  past: boolean;
}

export const MAX_TITLE_LENGTH = 120; // same as the exams.title and topics.title checks
export const MAX_TOPICS = 30;

/** Gemini responseSchema for SyllabusResult. */
export const SYLLABUS_SCHEMA = {
  type: 'OBJECT',
  properties: {
    found: { type: 'BOOLEAN' },
    proposals: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          title: { type: 'STRING', description: 'Short name as the syllabus calls it, for example "Midterm Exam".' },
          date: { type: 'STRING', description: 'The date written in the syllabus, as YYYY-MM-DD.' },
          kind: { type: 'STRING', enum: [...PROPOSAL_KINDS] },
          topics: { type: 'ARRAY', items: { type: 'STRING' } },
          evidence: { type: 'STRING', description: 'The sentence or line the date came from, copied exactly.' },
        },
        required: ['title', 'date', 'kind', 'topics', 'evidence'],
        propertyOrdering: ['title', 'date', 'kind', 'topics', 'evidence'],
      },
    },
  },
  required: ['found', 'proposals'],
  propertyOrdering: ['found', 'proposals'],
};

/** True only for a YYYY-MM-DD string that names a day that exists (2026-02-30 is false). */
export function isRealDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1000 || month < 1 || month > 12 || day < 1) return false;
  // Day 0 of the next month is the last day of this month.
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= daysInMonth;
}

/** Today's calendar day (YYYY-MM-DD) in a time zone. Unknown zones fall back to UTC. */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(now);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
    return `${get('year')}-${get('month')}-${get('day')}`;
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

/**
 * Checks the AI's answer against the syllabus text. Keeps a proposal only when
 * its title is 1 to 120 characters, its date is a real date, its kind is known,
 * its topics is a list, and its evidence appears in the text. Topics are
 * cleaned (blank, too long and duplicate entries removed, at most 30). The
 * AI's own found flag is ignored: found is true when at least one proposal
 * survives.
 */
export function validateProposals(
  result: unknown,
  sourceText: string,
  today: string,
): { found: boolean; proposals: ValidatedProposal[] } {
  const raw = isObject(result) && Array.isArray(result.proposals) ? result.proposals : [];
  const proposals: ValidatedProposal[] = [];
  const seen = new Set<string>();

  for (const item of raw) {
    const checked = checkProposal(item, sourceText);
    if (!checked) continue;
    const key = `${checked.title.toLowerCase()}|${checked.date}`;
    if (seen.has(key)) continue;
    seen.add(key);
    proposals.push({ ...checked, past: checked.date < today });
  }

  return { found: proposals.length > 0, proposals };
}

function checkProposal(item: unknown, sourceText: string): SyllabusProposal | null {
  if (!isObject(item)) return null;
  const { title, date, kind, topics, evidence } = item;

  if (typeof title !== 'string') return null;
  const cleanTitle = title.trim();
  if (cleanTitle.length < 1 || cleanTitle.length > MAX_TITLE_LENGTH) return null;

  if (!isRealDate(date)) return null;
  if (typeof kind !== 'string' || !(PROPOSAL_KINDS as readonly string[]).includes(kind)) return null;
  if (!Array.isArray(topics)) return null;

  if (typeof evidence !== 'string') return null;
  const cleanEvidence = evidence.trim();
  if (cleanEvidence.length === 0 || !quoteAppears(cleanEvidence, sourceText)) return null;
  // date_not_in_evidence: the sentence must mention the date it is said to prove.
  if (!evidenceMentionsDate(cleanEvidence, date)) return null;

  return {
    title: cleanTitle,
    date,
    kind: kind as ProposalKind,
    topics: cleanTopics(topics),
    evidence: cleanEvidence,
  };
}

function cleanTopics(topics: unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const topic of topics) {
    if (typeof topic !== 'string') continue;
    const title = topic.replace(/\s+/g, ' ').trim();
    if (title.length === 0 || title.length > MAX_TITLE_LENGTH) continue;
    const key = title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(title);
    if (out.length === MAX_TOPICS) break;
  }
  return out;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** True when the text holds the ISO date, or the day number as a whole number (12 in "November 12" or "12/11"). */
export function evidenceMentionsDate(evidence: string, date: string): boolean {
  if (evidence.includes(date)) return true;
  const day = String(Number(date.slice(8, 10)));
  const token = new RegExp('(?<!\\d)0?' + day + '(?!\\d)');
  return token.test(evidence);
}
