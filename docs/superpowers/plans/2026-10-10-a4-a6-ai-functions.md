# A4 Syllabus Reader and A6 Question Maker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the two Edge Functions that use the AI: `read-syllabus` (finds exam dates in a syllabus and returns them for the student to confirm) and `make-questions` (turns a note's chunks into verified questions, in batches).

**Architecture:** Each function has a thin Deno `index.ts` (check the caller, load rows, call pure code, write rows, answer) and one pure TypeScript file in `supabase/functions/_shared` that vitest tests from the repo root. The words the AI sees live in Markdown prompt files under `supabase/functions/_shared/prompts/`, so Dev A can tune them without touching code. Every AI answer is checked by code. Anything that fails a check is dropped, never repaired.

**Tech Stack:** Supabase Edge Functions (Deno 2), `@supabase/supabase-js` through the foundation's `db.ts`, the Gemini REST API through the foundation's `askGemini`, vitest for pure code, Node 20+ scripts for the hand tests.

**Spec:** `docs/superpowers/specs/2026-10-10-server-side-design.md`, sections 3, 5, 7 and 10. Read sections 3, 5 and 10 before Part 1, and sections 3, 7 and 10 before Part 2.

This plan has two parts. Each part is one branch and one pull request. The two parts do not depend on each other and can be built at the same time, by two different people or agents.

- **Part 1:** branch `a4-syllabus-reader`. Done when the syllabus hand test passes.
- **Part 2:** branch `a6-question-maker`. Done when 10 pages of typed notes give at least 20 verified questions.

## Before you start: what the foundation branch gives you

Both parts are built after branch `a4a-server-foundation`. Start each branch from `main` once `a4a-server-foundation` is merged. If it is not merged yet, start from `a4a-server-foundation` and rebase onto `main` after it merges.

This plan assumes the foundation files export the names below. The first step of each part is to open these files and check. If a name or signature differs, use the real one everywhere this plan uses the assumed one. Do not edit the foundation files in these branches: both branches run at the same time, and two branches changing the same shared file cause merge conflicts. If something you need is missing, stop and tell Dev A.

- `supabase/functions/_shared/ai.ts`: `askGemini<T>(promptName: string, variables: Record<string, string>, jsonSchema: object, options?: { temperature?: number }): Promise<T>` and `class AiError extends Error`. It loads `prompts/<promptName>.md`, fills `{{name}}` placeholders, calls Gemini `generateContent` with plain `fetch` (JSON mode, the schema as `responseSchema`), and throws `AiError` on a failed call or malformed JSON.
- `supabase/functions/_shared/auth.ts`: `requireUser(req)` and `requireFullUser(req)`, both returning `Promise<{ id: string; isAnonymous: boolean }>` and throwing `HttpError` (401 no valid login; `requireFullUser` also 403 for a guest). Also `isServiceCall(req: Request): boolean`, true when the bearer token equals `SUPABASE_SERVICE_ROLE_KEY`.
- `supabase/functions/_shared/db.ts`: `db`, the service-role Supabase client (`npm:@supabase/supabase-js@2`). It ignores Row Level Security, so every function checks ownership itself.
- `supabase/functions/_shared/http.ts`: `class HttpError extends Error { constructor(status: number, code: string, message: string) }`, `json(body: unknown, status?: number): Response`, `corsHeaders`, and `handle(fn: (req: Request) => Promise<Response>): (req: Request) => Promise<Response>`. `handle` answers the CORS preflight, turns a thrown `HttpError` into `{ error: { code, message } }` with its status, a thrown `AiError` into 502, and anything else into 500.
- `supabase/functions/_shared/quote-check.ts`: `quoteAppears(quote: string, chunkText: string): boolean`. On both sides, every run of the characters in the explicit class `[ \t\n\r\f\v]+` becomes one space and the ends are trimmed; case is kept. The foundation migration changes the trigger `private.verify_question` to the same explicit class on both sides. It does not use `\s`, because Postgres and JavaScript disagree on what `\s` matches. So a quote that passes `quoteAppears` is also verified by the database.
- `supabase/functions/_shared/prompts/`: the folder exists. It may hold short placeholder versions of `read-syllabus.md` and `make-questions.md`. This plan replaces them with the full text.
- The section 11 migration is applied: `notes.exam_id`, `notes.is_syllabus`, `notes.failure_reason`, `study_settings.time_zone`, and the private Storage bucket `uploads`.
- `extract-text` works: it turns an uploaded file into chunks, sets the note to `ready`, and for a non-syllabus note calls `make-questions` with the service key.
- A root `vitest.config.mts` (created by the `a5-schedule-engine` branch, which also makes vitest a root dev dependency) includes `supabase/functions/_shared/**/*.test.ts`, so `npx vitest run <file>` from the repo root runs those tests. If it is missing, create it as shown in Task 1.1 Step 1 (or Task 2.1 Step 1).
- `supabase/config.toml` has a `[functions.extract-text]` block. Copy its layout for the new blocks.

Every `index.ts` in this plan uses the same skeleton: `Deno.serve(handle(async (req) => { ... return json(body); }))`. `handle` already answers an `AiError` with 502; the functions in this plan still catch it and throw `HttpError(502, 'ai_failed', ...)` so the student sees a message that says what to do next. Errors always have the body `{ error: { code, message } }`, with the messages written so a student can read them.

Edge Function `index.ts` files are not unit tested and are not type-checked locally (do not install Deno). They are tested by hand, as the last task of each part says, and the deploy on merge type-checks them.

## Global Constraints

- AI provider is Gemini, called only through `askGemini`. Model name comes from the `GEMINI_MODEL` secret. No SDK.
- Temperature 0.2 for the syllabus reader, 0.7 for the question maker, passed as the fourth `askGemini` argument `{ temperature }`.
- Do not install Deno or any global tool. Keep downloads on D:.
- Field names are camelCase in TypeScript and snake_case in the database. Allowed-value lists are exported `as const` arrays with the type derived from them.
- Pure files in `_shared` use no Deno API and no `npm:` or `jsr:` import. Imports between them use the `.ts` extension (`./quote-check.ts`) so Deno and vitest both resolve them.
- `index.ts` files stay thin: read the request, check the caller, load rows, call pure code, write rows, answer.
- Error status codes: 400 bad input, 401 no user, 403 not yours or guest, 404 not found, 409 not ready or duplicate, 502 AI failed, 500 everything else.
- Each function run must finish well inside 150 seconds wall clock and 2 seconds CPU. Each AI call has a 60-second timeout inside `askGemini`.
- A syllabus date is returned, never saved. Nothing in Part 1 writes to the database.
- Every question names its chunk and quotes it. Questions that fail a check are dropped, never repaired or padded.
- English prompts and test files.
- No secrets in the repo. Hand-test logins go in `supabase/functions/_handtests/.env`, which `.gitignore` already ignores (it ignores every `.env`).
- One branch per part, never push to `main`, pull request reviewed by the other developer.
- Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Pull request bodies end with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

## Review Focus

These are the inputs most likely to break things for a real student that the spec does not spell out. Each has a test in the task named.

1. **The AI answers with the wrong shape** (missing fields, `proposals` not a list, a number where text belongs). Expected: no crash, the bad item is dropped, and an all-bad answer gives `found: false` or zero questions. Tests in Task 1.1 and Task 2.1.
2. **The AI copies a sentence across a line break**, so its whitespace differs from the notes. Expected: the syllabus evidence and the question quote still count as found, and the database verifies the question too, because the trigger and `quoteAppears` use the same whitespace rule. As a safety net, any row the database still leaves unverified is deleted and counted as dropped. Tests in Task 1.1 and Task 2.1 (line break), and the hand test in Task 2.4 (no unverified rows left).
3. **A multiple-choice answer that differs from its choice only by case or a space.** Expected: dropped, because the quiz server scores multiple choice by exact match. Test in Task 2.1.
4. **A chunk where every question is dropped.** Expected: the batch chain still moves forward and ends; it does not pick the same chunk forever. Test in Task 2.1 (`pickBatch`).
5. **Empty strings in prompt, answer or choices.** Expected: dropped before insert, because one row breaking a database check would make the whole batch insert fail. Test in Task 2.1.

---

# Part 1: Syllabus reader (branch `a4-syllabus-reader`)

Spec section 5. The student uploads a syllabus, `extract-text` turns it into chunks, then the app calls `read-syllabus` with the note id. The function asks Gemini for dated assessments, checks every answer, and returns proposals for the confirm screen (Dev B's B5). It saves nothing.

**Files in this part:**

- Create: `supabase/functions/_shared/proposals.ts` (types, the Gemini schema, date check, validation)
- Create: `supabase/functions/_shared/proposals.test.ts`
- Create or replace: `supabase/functions/_shared/prompts/read-syllabus.md`
- Create: `supabase/functions/read-syllabus/index.ts`
- Modify: `supabase/config.toml` (add `[functions.read-syllabus]`)
- Create: `supabase/functions/_fixtures/syllabus-with-dates.txt`
- Create: `supabase/functions/_fixtures/syllabus-no-dates.txt`
- Create: `supabase/functions/_handtests/read-syllabus.mjs`
- Modify: `supabase/functions/README.md` (add a "read-syllabus hand test" section)

### Task 1.1: Proposal validation (pure code)

**Files:**
- Create: `supabase/functions/_shared/proposals.ts`
- Test: `supabase/functions/_shared/proposals.test.ts`

**Interfaces:**
- Consumes: `quoteAppears(quote: string, chunkText: string): boolean` from `./quote-check.ts`.
- Produces (used by Task 1.3):
  - `type ProposalKind = 'exam' | 'quiz' | 'competition'`, `PROPOSAL_KINDS`
  - `interface SyllabusProposal { title: string; date: string; kind: ProposalKind; topics: string[]; evidence: string }`
  - `interface SyllabusResult { found: boolean; proposals: SyllabusProposal[] }`
  - `interface ValidatedProposal extends SyllabusProposal { past: boolean }`
  - `SYLLABUS_SCHEMA` (the Gemini `responseSchema` object)
  - `isRealDate(value: unknown): value is string`
  - `todayIn(timeZone: string, now?: Date): string` (YYYY-MM-DD)
  - `validateProposals(result: unknown, sourceText: string, today: string): { found: boolean; proposals: ValidatedProposal[] }`

- [ ] **Step 1: Create the branch and check the foundation names**

```bash
git switch main
git pull
git switch -c a4-syllabus-reader
```

Open `supabase/functions/_shared/ai.ts`, `auth.ts`, `db.ts`, `http.ts` and `quote-check.ts`. Compare their exports with the list under "Before you start". Note any difference; use the real names in every step below.

Check that the root test config exists: `ls vitest.config.mts`. If it does not, create `vitest.config.mts` at the repo root with:

```ts
import { defineConfig } from 'vitest/config';

// One vitest run covers the shared package and the pure server code.
export default defineConfig({
  test: {
    include: ['packages/shared/src/**/*.test.ts', 'supabase/functions/_shared/**/*.test.ts'],
    passWithNoTests: true,
  },
});
```

- [ ] **Step 2: Write the failing tests**

Create `supabase/functions/_shared/proposals.test.ts`:

```ts
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
```

- [ ] **Step 3: Run the tests to see them fail**

Run: `npx vitest run supabase/functions/_shared/proposals.test.ts`
Expected: FAIL, because `./proposals.ts` does not exist.

- [ ] **Step 4: Write `proposals.ts`**

Create `supabase/functions/_shared/proposals.ts`:

```ts
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
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `npx vitest run supabase/functions/_shared/proposals.test.ts`
Expected: PASS, all tests green.

If "accepts evidence copied across a line break" fails, the foundation's `quoteAppears` does not collapse whitespace as the spec says. Stop and tell Dev A; do not work around it here.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/_shared/proposals.ts supabase/functions/_shared/proposals.test.ts
git commit -m "A4: syllabus proposal validation with tests

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 1.2: The syllabus prompt

**Files:**
- Create or replace: `supabase/functions/_shared/prompts/read-syllabus.md`

**Interfaces:**
- Consumes: placeholders `{{text}}` and `{{today}}`, filled by `askGemini`.
- Produces: the prompt file `read-syllabus`, loaded by `askGemini('read-syllabus', ...)` in Task 1.3. Field names must match `SYLLABUS_SCHEMA` from Task 1.1.

- [ ] **Step 1: Write the prompt file**

Write exactly this to `supabase/functions/_shared/prompts/read-syllabus.md`:

```markdown
You read a course syllabus and list the dated assessments in it, so a student can plan their study. A student will check every date you report before anything is saved, but a wrong or invented date still wastes their time. When in doubt, leave it out.

Today's date is {{today}}.

## What to report

Report every exam, quiz and competition that has a calendar date written in the text.

- kind "exam": midterms, finals, tests, exams.
- kind "quiz": quizzes and short tests.
- kind "competition": olympiads, contests, competitions.

Do not report homework, assignments, essays, projects, labs, presentations, lectures, holidays or registration deadlines, even when they have dates.

## Rules for dates

1. Only report a date that is written in the text. Never work a date out yourself.
2. Do not turn "week 7", "the third Friday of term", "two weeks after the midterm" or "during finals week" into a date. Report such an assessment only if the text also gives its calendar date somewhere else.
3. A range with no single day ("December 14 to 18", "finals week") is not a date. Do not report it.
4. Write the date as YYYY-MM-DD. If the text gives the day and month but no year, use the year of the term when the text names it (for example "Fall 2026"). If the text names no year at all, use the first such day on or after today.
5. If the same assessment is listed twice with different dates, report neither and let the student enter it by hand.

## Rules for the other fields

- title: the short name the syllabus uses, for example "Midterm Exam" or "Quiz 2". At most 120 characters.
- evidence: copy the sentence or line that contains the date, character for character, exactly as it appears in the text. Do not fix spelling, do not shorten it, do not add "...", do not join two sentences.
- topics: the topics the text says this assessment covers, in the order the text lists them, as short headings copied from the text (for example "Cell division"). Use an empty list when the text does not say what the assessment covers. Never invent topics. At most 30.

## When nothing is found

If the text has no dated exam, quiz or competition, or you are unsure about every one of them, answer with found false and an empty proposals list. That is a correct and useful answer.

Answer only with JSON that matches the given schema.

## Syllabus text

<<<
{{text}}
>>>
```

- [ ] **Step 2: Check the placeholders and field names**

Run: `grep -o "{{[a-z]*}}" supabase/functions/_shared/prompts/read-syllabus.md | sort -u`
Expected output, exactly:

```
{{text}}
{{today}}
```

Check by eye that the prompt names the fields `found`, `proposals`, `title`, `date`, `kind`, `topics`, `evidence`, and the kinds `exam`, `quiz`, `competition`, the same as `SYLLABUS_SCHEMA`.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/_shared/prompts/read-syllabus.md
git commit -m "A4: read-syllabus prompt

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 1.3: The `read-syllabus` function

**Files:**
- Create: `supabase/functions/read-syllabus/index.ts` (make the folder by hand with `mkdir -p supabase/functions/read-syllabus`. Do not run `npx supabase functions new`: it appends its own `[functions.read-syllabus]` block and a `deno.json`, and a second block for the same function makes `config.toml` fail to parse.)
- Modify: `supabase/config.toml` (add a block after `[functions.extract-text]`)

**Interfaces:**
- Consumes: `askGemini`, `AiError` from `../_shared/ai.ts`; `requireFullUser` from `../_shared/auth.ts`; `db` from `../_shared/db.ts`; `handle`, `HttpError`, `json` from `../_shared/http.ts`; `SYLLABUS_SCHEMA`, `todayIn`, `validateProposals`, `SyllabusResult` from `../_shared/proposals.ts`.
- Produces: `POST /functions/v1/read-syllabus` with body `{ noteId: string }`. Answers 200 `{ found: boolean, proposals: ValidatedProposal[] }`. Errors:
  - 400 `bad_input`: no body, or `noteId` is not a UUID.
  - 400 `not_a_syllabus`: the note is not marked as a syllabus.
  - 401 / 403 from `requireFullUser` (no login, or a guest).
  - 403 `not_yours`: the note belongs to someone else.
  - 404 `not_found`.
  - 409 `note_not_ready`: the note's status is `processing` or `failed`.
  - 502 `ai_failed`.
  - 500 `internal`.

- [ ] **Step 1: Write the function**

Create `supabase/functions/read-syllabus/index.ts`:

```ts
// read-syllabus (A4): finds exam, quiz and competition dates in a syllabus
// note and returns them for the student to confirm. Saves nothing: the
// confirm screen saves exams and topics itself once the student agrees.
import { AiError, askGemini } from '../_shared/ai.ts';
import { requireFullUser } from '../_shared/auth.ts';
import { db } from '../_shared/db.ts';
import { handle, HttpError, json } from '../_shared/http.ts';
import { SYLLABUS_SCHEMA, type SyllabusResult, todayIn, validateProposals } from '../_shared/proposals.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_CHUNKS = 40; // a syllabus is short; this is far more than any real one

Deno.serve(
  handle(async (req) => {
    if (req.method !== 'POST') throw new HttpError(400, 'bad_input', 'Use POST.');
    const user = await requireFullUser(req);

    const body = await req.json().catch(() => null);
    const noteId = body?.noteId;
    if (typeof noteId !== 'string' || !UUID.test(noteId)) {
      throw new HttpError(400, 'bad_input', 'Send { "noteId": "<note id>" }.');
    }

    const { data: note, error: noteError } = await db
      .from('notes')
      .select('id, owner_id, is_syllabus, status')
      .eq('id', noteId)
      .maybeSingle();
    if (noteError) throw new HttpError(500, 'internal', noteError.message);
    if (!note) throw new HttpError(404, 'not_found', 'That syllabus could not be found.');
    if (note.owner_id !== user.id) throw new HttpError(403, 'not_yours', 'That syllabus belongs to someone else.');
    if (!note.is_syllabus) throw new HttpError(400, 'not_a_syllabus', 'That note was not uploaded as a syllabus.');
    if (note.status !== 'ready') {
      throw new HttpError(409, 'note_not_ready', 'The syllabus text is not ready yet. Try again in a moment.');
    }

    const { data: chunks, error: chunksError } = await db
      .from('chunks')
      .select('text')
      .eq('note_id', noteId)
      .order('position')
      .limit(MAX_CHUNKS);
    if (chunksError) throw new HttpError(500, 'internal', chunksError.message);
    // No text means no dates. Say so rather than asking the AI to guess.
    if (!chunks || chunks.length === 0) return json({ found: false, proposals: [] });

    const text = chunks.map((c) => c.text).join('\n\n');

    // "past" is judged by the student's own calendar day, not the server's.
    const { data: settings } = await db
      .from('study_settings')
      .select('time_zone')
      .eq('user_id', user.id)
      .maybeSingle();
    const today = todayIn(settings?.time_zone ?? 'UTC');

    let answer: SyllabusResult;
    try {
      answer = await askGemini<SyllabusResult>('read-syllabus', { text, today }, SYLLABUS_SCHEMA, { temperature: 0.2 });
    } catch (e) {
      if (e instanceof AiError) {
        console.error('read-syllabus: AI failed', e);
        throw new HttpError(502, 'ai_failed', 'Reading the syllabus failed. Try again in a minute, or enter the dates by hand.');
      }
      throw e;
    }

    return json(validateProposals(answer, text, today));
  }),
);
```

- [ ] **Step 2: Register the function in `supabase/config.toml`**

Add this block right after the `[functions.extract-text]` block. First run `grep -n "functions.read-syllabus" supabase/config.toml` and expect no output; there must be exactly one block per function. Match the key names the foundation used there; if it used a different key for prompt files, use that key here.

```toml
[functions.read-syllabus]
enabled = true
verify_jwt = true
static_files = ["./functions/_shared/prompts/read-syllabus.md"]
```

- [ ] **Step 3: Check the imports by eye**

Edge Functions are not type-checked locally (no Deno install). Run:

```bash
grep -n "from '" supabase/functions/read-syllabus/index.ts
```

Expected: five imports, all from `../_shared/`, each ending in `.ts`, naming only exports that exist in those files (checked in Task 1.1 Step 1). The deploy on merge type-checks the function; a type error there shows in the Supabase dashboard's deploy log and in the hand test of Task 1.4.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/read-syllabus/index.ts supabase/config.toml
git commit -m "A4: read-syllabus function

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 1.4: Fixtures and the hand test (A4 "Done when")

**Files:**
- Create: `supabase/functions/_fixtures/syllabus-with-dates.txt`
- Create: `supabase/functions/_fixtures/syllabus-no-dates.txt`
- Create: `supabase/functions/_handtests/read-syllabus.mjs`
- Modify: `supabase/functions/README.md`

**Interfaces:**
- Consumes: the live or local `extract-text` and `read-syllabus` functions; the `uploads` bucket; the `notes` table.
- Produces: a script that exits 0 when both syllabuses give the expected answer.

- [ ] **Step 1: Write the syllabus with two dates**

Create `supabase/functions/_fixtures/syllabus-with-dates.txt`. It has two real exam dates, plus three traps the reader must skip: a quiz given only by week, an assignment with a date, and a finals-week range.

```text
BIO 101: Introduction to Cell Biology
Fall 2026, Riverside Community College
Instructor: Dr. Maya Okafor. Office hours: Mondays 2 to 4 pm, Room S-214.

Course description
This course introduces the structure and function of cells. We study how cells are built, how they move materials across their membranes, how they release energy from food, how plants capture energy from light, and how cells divide.

Units
Unit 1: Cell structure
Unit 2: Membrane transport
Unit 3: Cellular respiration
Unit 4: Photosynthesis
Unit 5: Cell division

Assessments
Quiz 1 takes place in class in Week 7 and covers Unit 1.
Assignment 2 (lab report on osmosis) is due on October 30, 2026.
The Midterm Exam is on Thursday, November 12, 2026, in class. It covers Unit 1: Cell structure, Unit 2: Membrane transport and Unit 3: Cellular respiration.
The Final Exam is on Tuesday, December 15, 2026, from 9:00 to 11:00 in Hall B. It covers all units, with extra weight on Unit 4: Photosynthesis and Unit 5: Cell division.
Make-up exams are held during finals week, December 14 to 18, by appointment only.

Grading
Quizzes 10 percent, lab reports 20 percent, midterm 30 percent, final exam 40 percent.

Policies
Late lab reports lose 10 percent per day. Bring a calculator to every exam. Phones must be switched off during exams.
```

Expected answer from `read-syllabus` for this file (titles and topic wording may differ slightly; the dates, the count and the evidence rule must not):

```json
{
  "found": true,
  "proposals": [
    {
      "title": "Midterm Exam",
      "date": "2026-11-12",
      "kind": "exam",
      "topics": ["Cell structure", "Membrane transport", "Cellular respiration"],
      "evidence": "The Midterm Exam is on Thursday, November 12, 2026, in class.",
      "past": false
    },
    {
      "title": "Final Exam",
      "date": "2026-12-15",
      "kind": "exam",
      "topics": ["Cell structure", "Membrane transport", "Cellular respiration", "Photosynthesis", "Cell division"],
      "evidence": "The Final Exam is on Tuesday, December 15, 2026, from 9:00 to 11:00 in Hall B.",
      "past": false
    }
  ]
}
```

- [ ] **Step 2: Write the syllabus with no dates**

Create `supabase/functions/_fixtures/syllabus-no-dates.txt`:

```text
HIS 210: World History Since 1900
Spring term, Riverside Community College
Instructor: Prof. Daniel Reyes. Office hours by appointment.

Course description
This course follows the major political, economic and social changes of the twentieth century, from the end of empires to the digital age. Students read primary sources each week and discuss them in seminar.

Topics
The First World War and its aftermath
The Great Depression
The Second World War
Decolonisation
The Cold War
Globalisation and the digital age

Assessments
There will be a midterm exam and a final exam. Dates will be announced in class once the room schedule is confirmed.
Weekly reading responses are due before each seminar.
A research essay of 2,000 words is due near the end of term.

Grading
Reading responses 20 percent, research essay 30 percent, midterm 20 percent, final exam 30 percent.

Policies
Essays are submitted online. Extensions are given for documented illness.
```

Expected answer:

```json
{ "found": false, "proposals": [] }
```

- [ ] **Step 3: Write the hand-test script**

Create `supabase/functions/_handtests/read-syllabus.mjs`:

```js
// Hand test for read-syllabus (A4 "Done when").
// Uploads both syllabus fixtures as a test student, runs extract-text and
// read-syllabus on each, checks the answers, then deletes the test notes.
//
// Run from the repo root (Node 20 or newer):
//   node --env-file=supabase/functions/_handtests/.env supabase/functions/_handtests/read-syllabus.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const { SUPABASE_URL, SUPABASE_ANON_KEY, TEST_EMAIL, TEST_PASSWORD } = process.env;
for (const [name, value] of Object.entries({ SUPABASE_URL, SUPABASE_ANON_KEY, TEST_EMAIL, TEST_PASSWORD })) {
  if (!value) throw new Error(`${name} is missing from supabase/functions/_handtests/.env`);
}
const FIXTURES = new URL('../_fixtures/', import.meta.url);

function headers(token, extra = {}) {
  return { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}`, ...extra };
}

async function signIn() {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`sign-in failed: ${JSON.stringify(body)}`);
  return { token: body.access_token, userId: body.user.id };
}

async function callFunction(session, name, payload) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: headers(session.token, { 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function uploadSyllabus(session, fileName) {
  const noteRes = await fetch(`${SUPABASE_URL}/rest/v1/notes`, {
    method: 'POST',
    headers: headers(session.token, { 'Content-Type': 'application/json', Prefer: 'return=representation' }),
    body: JSON.stringify({ title: `Hand test: ${fileName}`, source: 'file', original_filename: fileName, is_syllabus: true }),
  });
  const notes = await noteRes.json();
  if (!noteRes.ok) throw new Error(`creating the note failed: ${JSON.stringify(notes)}`);
  const noteId = notes[0].id;

  const file = await readFile(new URL(fileName, FIXTURES));
  const upRes = await fetch(`${SUPABASE_URL}/storage/v1/object/uploads/${session.userId}/${noteId}/${fileName}`, {
    method: 'POST',
    headers: headers(session.token, { 'Content-Type': 'text/plain' }),
    body: file,
  });
  if (!upRes.ok) throw new Error(`upload failed: ${upRes.status} ${await upRes.text()}`);

  const extracted = await callFunction(session, 'extract-text', { noteId });
  assert.equal(extracted.status, 200, `extract-text answered ${JSON.stringify(extracted)}`);
  assert.equal(extracted.body.status, 'ready', `extract-text failed: ${extracted.body.reason}`);
  console.log(`${fileName}: ${extracted.body.chunks} chunk(s)`);
  return noteId;
}

async function deleteNote(session, noteId) {
  await fetch(`${SUPABASE_URL}/rest/v1/notes?id=eq.${noteId}`, { method: 'DELETE', headers: headers(session.token) });
}

const collapse = (s) => s.replace(/\s+/g, ' ').trim();
const session = await signIn();
const created = [];

try {
  // 1. Syllabus with two dates
  const withDatesId = await uploadSyllabus(session, 'syllabus-with-dates.txt');
  created.push(withDatesId);
  const withDates = await callFunction(session, 'read-syllabus', { noteId: withDatesId });
  console.log('with dates:', JSON.stringify(withDates.body, null, 2));
  assert.equal(withDates.status, 200);
  assert.equal(withDates.body.found, true);
  assert.deepEqual(withDates.body.proposals.map((p) => p.date).sort(), ['2026-11-12', '2026-12-15']);
  const source = collapse(await readFile(new URL('syllabus-with-dates.txt', FIXTURES), 'utf8'));
  for (const p of withDates.body.proposals) {
    assert.ok(source.includes(collapse(p.evidence)), `evidence is not in the file: ${p.evidence}`);
    assert.equal(p.kind, 'exam');
    assert.equal(p.past, false);
  }

  // 2. Syllabus with no dates
  const noDatesId = await uploadSyllabus(session, 'syllabus-no-dates.txt');
  created.push(noDatesId);
  const noDates = await callFunction(session, 'read-syllabus', { noteId: noDatesId });
  console.log('no dates:', JSON.stringify(noDates.body));
  assert.equal(noDates.status, 200);
  assert.deepEqual(noDates.body, { found: false, proposals: [] });

  // 3. A note that is not a syllabus id at all
  const bad = await callFunction(session, 'read-syllabus', { noteId: 'not-a-uuid' });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error.code, 'bad_input');

  console.log('read-syllabus hand test passed');
} finally {
  for (const id of created) await deleteNote(session, id);
}
```

- [ ] **Step 4: Document the hand test**

Add this section to the end of `supabase/functions/README.md`:

````markdown
## Hand test: read-syllabus (A4)

What it checks: a syllabus with two exam dates gives exactly those two dates, each with a sentence copied from the file, and a syllabus with no dates gives `{ "found": false, "proposals": [] }`. The script also checks that a quiz given only as "Week 7", an assignment date and a "finals week" range are not reported.

One-time setup:

1. Make a test student: in the Supabase dashboard, Authentication, Users, "Add user", with an email and password, and tick "Auto confirm". For a local stack, sign up through the app instead.
2. Create `supabase/functions/_handtests/.env` (it is ignored by git) with:

   ```
   SUPABASE_URL=https://<project-ref>.supabase.co
   SUPABASE_ANON_KEY=<publishable key from the dashboard, API settings>
   TEST_EMAIL=<test student email>
   TEST_PASSWORD=<test student password>
   ```

Run from the repo root:

```sh
node --env-file=supabase/functions/_handtests/.env supabase/functions/_handtests/read-syllabus.mjs
```

It prints both answers and ends with `read-syllabus hand test passed`. It deletes the notes it made. The AI's titles and topic wording can vary between runs; the dates, the number of proposals and the copied sentences cannot.
````

- [ ] **Step 5: Run the hand test**

Where to run it: task branches deploy nothing live. Run it against a local stack if Docker is available:

```bash
npx supabase start
npx supabase functions serve --env-file supabase/functions/.env
```

with `SUPABASE_URL=http://127.0.0.1:54321` and the local anon key (printed by `npx supabase start`) in the hand-test `.env`. If Docker is not available, run it against the live project right after the pull request merges, and post the output as a comment on the merged pull request.

Run: `node --env-file=supabase/functions/_handtests/.env supabase/functions/_handtests/read-syllabus.mjs`
Expected: both JSON answers printed, then `read-syllabus hand test passed`, exit code 0.

If the "with dates" check fails because the AI reported the Week 7 quiz, the assignment or the finals-week range, the fix is in the prompt (Task 1.2), not in the code. Adjust the wording, re-run, and note the change in the pull request.

- [ ] **Step 6: Run all tests and commit**

Run: `npm test` and `npx vitest run supabase/functions/_shared`
Expected: all PASS.

```bash
git add supabase/functions/_fixtures/syllabus-with-dates.txt supabase/functions/_fixtures/syllabus-no-dates.txt supabase/functions/_handtests/read-syllabus.mjs supabase/functions/README.md
git commit -m "A4: syllabus fixtures and hand test

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Step 7: Open the pull request**

Before pushing, run `git diff main --stat` and `git diff main | grep -iE "key|secret|password" ` and confirm no secret is in the diff (the `.env` file must not appear).

config.toml: other branches append blocks at the end of this file too; resolve merge conflicts by keeping both blocks.

```bash
git push -u origin a4-syllabus-reader
gh pr create --base main --head a4-syllabus-reader --title "A4: syllabus reader" --body "$(cat <<'EOF'
What this adds
- read-syllabus Edge Function: finds dated exams, quizzes and competitions in a syllabus note and returns them for the student to confirm. It saves nothing.
- proposals.ts: checks every date the AI proposes. A date must be a real calendar date, its sentence must appear in the syllabus, and its title must be 1 to 120 characters. Topics are cleaned and capped at 30. Past dates are kept but marked past. Anything that fails is dropped.
- read-syllabus.md: the prompt, editable without touching code.
- Two fixture syllabuses and a hand-test script.

For Dev B (confirm screen, B5)
- Call POST /functions/v1/read-syllabus with { noteId } after extract-text finishes on a note uploaded with is_syllabus = true.
- Answer: { found: boolean, proposals: { title, date (YYYY-MM-DD), kind, topics: string[], evidence, past: boolean }[] }.
- Errors: { error: { code, message } } with codes bad_input, not_a_syllabus, not_yours, not_found, note_not_ready, ai_failed, internal. The message is safe to show.

Checks
- Unit tests: <paste vitest summary>
- Hand test (A4 Done when): <paste the script output, or say it will run against live right after merge>

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

# Part 2: Question maker (branch `a6-question-maker`)

Spec section 7. When `extract-text` finishes a normal note it calls `make-questions` with the service key. The function takes up to 6 chunks that have no questions yet, asks Gemini for about 3 questions per chunk, checks every question against its chunk, inserts the good ones, deletes any the database did not verify, and then calls itself for the next 6 chunks. When the last batch is done and the note is linked to an exam, it asks `build-schedule` to refresh the plan.

Two ways in:

- **From another function (service key).** The bearer token equals `SUPABASE_SERVICE_ROLE_KEY`. The function answers 202 `{ accepted: true }` at once and does the batch in the background. This keeps every link of the chain short: the caller waits only for the 202, never for the whole chain.
- **From the app (student's login).** The caller must be a full user who owns the note. The function does the batch and answers `{ made, dropped, remaining }`. It still chains the rest in the background.

**Files in this part:**

- Create: `supabase/functions/_shared/questions.ts` (types, the Gemini schema, prompt formatting, batch picking, filtering)
- Create: `supabase/functions/_shared/questions.test.ts`
- Create or replace: `supabase/functions/_shared/prompts/make-questions.md`
- Create: `supabase/functions/make-questions/index.ts`
- Modify: `supabase/config.toml` (add `[functions.make-questions]`)
- Create: `supabase/functions/_handtests/make-questions.mjs`
- Modify: `supabase/functions/README.md` (hand test section and the tuning note)

### Task 2.1: Question filtering and batch picking (pure code)

**Files:**
- Create: `supabase/functions/_shared/questions.ts`
- Test: `supabase/functions/_shared/questions.test.ts`

**Interfaces:**
- Consumes: `quoteAppears(quote: string, chunkText: string): boolean` from `./quote-check.ts`.
- Produces (used by Task 2.3):
  - `QUESTIONS_PER_CHUNK = 3`, `BATCH_SIZE = 6`
  - `type MadeKind = 'multiple_choice' | 'short_answer' | 'flashcard'`, `MADE_KINDS`
  - `interface MadeQuestion { chunkPosition: number; kind: MadeKind; prompt: string; choices: string[] | null; answer: string; sourceQuote: string; topicTitle: string | null }`
  - `interface MadeQuestionsAnswer { questions: MadeQuestion[] }`
  - `interface ChunkForQuestions { id: string; position: number; text: string }`
  - `interface TopicRef { id: string; title: string }`
  - `interface InsertableQuestion { chunkId: string; topicId: string | null; kind: MadeKind; prompt: string; choices: string[] | null; answer: string; sourceQuote: string }`
  - `type DropReasonCode = 'malformed' | 'unknown_chunk' | 'quote_not_in_chunk' | 'kind_choices_mismatch' | 'answer_not_in_choices' | 'chunk_already_has_questions' | 'not_verified_by_database'`
  - `interface DropReason { index: number | null; chunkPosition: number | null; reason: DropReasonCode }`
  - `MADE_QUESTIONS_SCHEMA` (Gemini `responseSchema` for `MadeQuestionsAnswer`)
  - `formatChunksForPrompt(chunks: ChunkForQuestions[]): string`
  - `formatTopicsForPrompt(topics: TopicRef[]): string`
  - `pickBatch<T extends { id: string; position: number }>(chunks: T[], doneChunkIds: ReadonlySet<string>, start: number, size?: number): { batch: T[]; nextStart: number; remaining: number }`
  - `filterMadeQuestions(made: unknown, chunks: ChunkForQuestions[], topics: TopicRef[]): { keep: InsertableQuestion[]; dropped: DropReason[] }`

The Gemini answer is wrapped as `{ questions: [...] }` rather than a bare list, because a top-level object is the most reliable shape for Gemini's JSON mode. `filterMadeQuestions` takes the inner list.

- [ ] **Step 1: Create the branch and check the foundation names**

```bash
git switch main
git pull
git switch -c a6-question-maker
```

Open `supabase/functions/_shared/ai.ts`, `auth.ts`, `db.ts`, `http.ts`, `quote-check.ts` and `supabase/functions/extract-text/index.ts`. Compare their exports with the list under "Before you start". In `extract-text`, check how it calls `make-questions`: it must send `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>` and the body `{ noteId }`. If it sends something else, tell Dev A before going on.

Check that the root test config exists: `ls vitest.config.mts`. If it does not, create `vitest.config.mts` at the repo root with:

```ts
import { defineConfig } from 'vitest/config';

// One vitest run covers the shared package and the pure server code.
export default defineConfig({
  test: {
    include: ['packages/shared/src/**/*.test.ts', 'supabase/functions/_shared/**/*.test.ts'],
    passWithNoTests: true,
  },
});
```

- [ ] **Step 2: Write the failing tests**

Create `supabase/functions/_shared/questions.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  filterMadeQuestions,
  formatChunksForPrompt,
  formatTopicsForPrompt,
  pickBatch,
  type ChunkForQuestions,
  type TopicRef,
} from './questions.ts';

const CHUNKS: ChunkForQuestions[] = [
  {
    id: 'chunk-a',
    position: 0,
    text: 'Mitochondria release energy from glucose through cellular respiration. The process needs oxygen and produces carbon dioxide and water.',
  },
  {
    id: 'chunk-b',
    position: 1,
    text: 'During mitosis a single cell divides into two identical daughter cells.\nEach daughter cell has the same number of chromosomes as the parent.',
  },
];

const TOPICS: TopicRef[] = [
  { id: 'topic-resp', title: 'Cellular respiration' },
  { id: 'topic-div', title: 'Cell division' },
];

function mc(overrides: Record<string, unknown> = {}) {
  return {
    chunkPosition: 0,
    kind: 'multiple_choice',
    prompt: 'What does cellular respiration need?',
    choices: ['Oxygen', 'Nitrogen', 'Sunlight', 'Chlorophyll'],
    answer: 'Oxygen',
    sourceQuote: 'The process needs oxygen and produces carbon dioxide and water.',
    topicTitle: 'Cellular respiration',
    ...overrides,
  };
}

function flash(overrides: Record<string, unknown> = {}) {
  return {
    chunkPosition: 1,
    kind: 'flashcard',
    prompt: 'What does mitosis produce?',
    choices: null,
    answer: 'Two identical daughter cells.',
    sourceQuote: 'During mitosis a single cell divides into two identical daughter cells.',
    topicTitle: 'Cell division',
    ...overrides,
  };
}

describe('filterMadeQuestions', () => {
  it('keeps a good multiple-choice question and maps chunk and topic', () => {
    const { keep, dropped } = filterMadeQuestions([mc()], CHUNKS, TOPICS);
    expect(dropped).toEqual([]);
    expect(keep).toEqual([
      {
        chunkId: 'chunk-a',
        topicId: 'topic-resp',
        kind: 'multiple_choice',
        prompt: 'What does cellular respiration need?',
        choices: ['Oxygen', 'Nitrogen', 'Sunlight', 'Chlorophyll'],
        answer: 'Oxygen',
        sourceQuote: 'The process needs oxygen and produces carbon dioxide and water.',
      },
    ]);
  });

  it('keeps a flashcard and a short answer with no choices', () => {
    const short = flash({ kind: 'short_answer', answer: 'Two', prompt: 'How many daughter cells does mitosis make?' });
    const { keep, dropped } = filterMadeQuestions([flash(), short], CHUNKS, TOPICS);
    expect(dropped).toEqual([]);
    expect(keep.map((q) => [q.kind, q.choices, q.chunkId])).toEqual([
      ['flashcard', null, 'chunk-b'],
      ['short_answer', null, 'chunk-b'],
    ]);
  });

  it('treats an empty choices list on a non multiple-choice question as no choices', () => {
    const { keep } = filterMadeQuestions([flash({ choices: [] })], CHUNKS, TOPICS);
    expect(keep[0].choices).toBeNull();
  });

  it('accepts a quote copied across a line break', () => {
    const quote = 'two identical daughter cells. Each daughter cell has the same number of chromosomes';
    const { keep } = filterMadeQuestions([flash({ sourceQuote: quote })], CHUNKS, TOPICS);
    expect(keep).toHaveLength(1);
  });

  it('drops a question whose quote is not in its chunk', () => {
    const { keep, dropped } = filterMadeQuestions(
      [mc({ sourceQuote: 'Mitochondria are the powerhouse of the cell.' })],
      CHUNKS,
      TOPICS,
    );
    expect(keep).toEqual([]);
    expect(dropped).toEqual([{ index: 0, chunkPosition: 0, reason: 'quote_not_in_chunk' }]);
  });

  it('drops a question whose quote is in a different chunk', () => {
    const { dropped } = filterMadeQuestions(
      [mc({ sourceQuote: 'During mitosis a single cell divides into two identical daughter cells.' })],
      CHUNKS,
      TOPICS,
    );
    expect(dropped[0].reason).toBe('quote_not_in_chunk');
  });

  it('drops a question that points at a chunk not in the batch', () => {
    const { dropped } = filterMadeQuestions([mc({ chunkPosition: 7 })], CHUNKS, TOPICS);
    expect(dropped).toEqual([{ index: 0, chunkPosition: 7, reason: 'unknown_chunk' }]);
  });

  it('drops multiple choice without exactly 4 distinct choices', () => {
    const cases = [
      mc({ choices: null }),
      mc({ choices: ['Oxygen', 'Nitrogen', 'Sunlight'] }),
      mc({ choices: ['Oxygen', 'Nitrogen', 'Sunlight', 'Chlorophyll', 'Water'] }),
      mc({ choices: ['Oxygen', 'Oxygen', 'Sunlight', 'Chlorophyll'] }),
      mc({ choices: ['Oxygen', '', 'Sunlight', 'Chlorophyll'] }),
    ];
    const { keep, dropped } = filterMadeQuestions(cases, CHUNKS, TOPICS);
    expect(keep).toEqual([]);
    expect(dropped.map((d) => d.reason)).toEqual(Array(5).fill('kind_choices_mismatch'));
  });

  it('drops a flashcard or short answer that has choices', () => {
    const { dropped } = filterMadeQuestions(
      [flash({ choices: ['a', 'b', 'c', 'd'] }), flash({ kind: 'short_answer', choices: ['a'] })],
      CHUNKS,
      TOPICS,
    );
    expect(dropped.map((d) => d.reason)).toEqual(['kind_choices_mismatch', 'kind_choices_mismatch']);
  });

  it('drops multiple choice whose answer is not exactly one of the choices', () => {
    const { dropped } = filterMadeQuestions(
      [mc({ answer: 'oxygen' }), mc({ answer: 'Oxygen ' }), mc({ answer: 'Carbon dioxide' })],
      CHUNKS,
      TOPICS,
    );
    expect(dropped.map((d) => d.reason)).toEqual(Array(3).fill('answer_not_in_choices'));
  });

  it('sets topicId to null when the topic title is not an exact match or is null', () => {
    const { keep } = filterMadeQuestions(
      [mc({ topicTitle: 'cellular respiration' }), mc({ topicTitle: null }), mc({ topicTitle: 'Genetics' })],
      CHUNKS,
      TOPICS,
    );
    expect(keep.map((q) => q.topicId)).toEqual([null, null, null]);
  });

  it('drops malformed items, including blank prompt, answer or quote and unknown kinds', () => {
    const { keep, dropped } = filterMadeQuestions(
      [
        null,
        'a question',
        mc({ prompt: '   ' }),
        mc({ answer: '' }),
        flash({ sourceQuote: '' }),
        mc({ kind: 'true_false' }),
        mc({ chunkPosition: '0' }),
        mc({ chunkPosition: 0.5 }),
      ],
      CHUNKS,
      TOPICS,
    );
    expect(keep).toEqual([]);
    expect(dropped.map((d) => d.reason)).toEqual(Array(8).fill('malformed'));
    expect(dropped.map((d) => d.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('gives nothing for an answer that is not a list', () => {
    for (const bad of [null, undefined, {}, 'x', 3]) {
      expect(filterMadeQuestions(bad, CHUNKS, TOPICS)).toEqual({ keep: [], dropped: [] });
    }
  });

  it('trims the prompt and the quote but never changes the answer or choices', () => {
    const { keep } = filterMadeQuestions(
      [mc({ prompt: '  What does cellular respiration need?  ', sourceQuote: ' The process needs oxygen ' })],
      CHUNKS,
      TOPICS,
    );
    expect(keep[0].prompt).toBe('What does cellular respiration need?');
    expect(keep[0].sourceQuote).toBe('The process needs oxygen');
    expect(keep[0].answer).toBe('Oxygen');
  });
});

describe('pickBatch', () => {
  const chunks = Array.from({ length: 10 }, (_, i) => ({ id: `c${i}`, position: i }));

  it('takes the first chunks without questions, in position order', () => {
    const shuffled = [...chunks].reverse();
    const out = pickBatch(shuffled, new Set(['c0', 'c2']), 0, 6);
    expect(out.batch.map((c) => c.id)).toEqual(['c1', 'c3', 'c4', 'c5', 'c6', 'c7']);
    expect(out.nextStart).toBe(8);
    expect(out.remaining).toBe(2);
  });

  it('starts at the given position, so a chunk whose questions were all dropped is not picked again', () => {
    // c0 to c5 were the last batch and all their questions were dropped: none is in doneChunkIds.
    const out = pickBatch(chunks, new Set(), 6, 6);
    expect(out.batch.map((c) => c.id)).toEqual(['c6', 'c7', 'c8', 'c9']);
    expect(out.remaining).toBe(0);
  });

  it('gives an empty batch when nothing is left, and keeps the start', () => {
    const all = new Set(chunks.map((c) => c.id));
    expect(pickBatch(chunks, all, 0, 6)).toEqual({ batch: [], nextStart: 0, remaining: 0 });
    expect(pickBatch(chunks, new Set(), 10, 6)).toEqual({ batch: [], nextStart: 10, remaining: 0 });
  });

  it('jumps nextStart past gaps in positions', () => {
    const gappy = [{ id: 'x', position: 3 }, { id: 'y', position: 9 }];
    expect(pickBatch(gappy, new Set(), 0, 1)).toEqual({ batch: [gappy[0]], nextStart: 4, remaining: 1 });
  });
});

describe('prompt formatting', () => {
  it('numbers chunks by their position', () => {
    expect(formatChunksForPrompt(CHUNKS.slice(0, 1))).toBe(`[Chunk 0]\n${CHUNKS[0].text}`);
    expect(formatChunksForPrompt(CHUNKS)).toContain('\n\n[Chunk 1]\n');
  });

  it('lists topics one per line, or says there are none', () => {
    expect(formatTopicsForPrompt(TOPICS)).toBe('- Cellular respiration\n- Cell division');
    expect(formatTopicsForPrompt([])).toBe('(no topics: set topicTitle to null for every question)');
  });
});
```

- [ ] **Step 3: Run the tests to see them fail**

Run: `npx vitest run supabase/functions/_shared/questions.test.ts`
Expected: FAIL, because `./questions.ts` does not exist.

- [ ] **Step 4: Write `questions.ts`**

Create `supabase/functions/_shared/questions.ts`:

```ts
// Question maker: the shape Gemini answers with, the schema we send it, how
// chunks are shown to it, which chunks go in the next batch, and the checks
// every question must pass before it is inserted.
// A question that fails a check is dropped, never repaired.
// Pure code: no Deno API and no npm import, so vitest can test it.
import { quoteAppears } from './quote-check.ts';

export const QUESTIONS_PER_CHUNK = 3;
export const BATCH_SIZE = 6;

export const MADE_KINDS = ['multiple_choice', 'short_answer', 'flashcard'] as const;
export type MadeKind = (typeof MADE_KINDS)[number];

/** One question as the AI writes it. */
export interface MadeQuestion {
  chunkPosition: number;
  kind: MadeKind;
  prompt: string;
  /** 4 for multiple choice, the answer among them. Null for the other kinds. */
  choices: string[] | null;
  answer: string;
  /** Copied exactly from the chunk. */
  sourceQuote: string;
  /** One of the exam's topic titles, or null. */
  topicTitle: string | null;
}

export interface MadeQuestionsAnswer {
  questions: MadeQuestion[];
}

export interface ChunkForQuestions {
  id: string;
  position: number;
  text: string;
}

export interface TopicRef {
  id: string;
  title: string;
}

/** A question that passed every check. index.ts adds note_id and exam_id. */
export interface InsertableQuestion {
  chunkId: string;
  topicId: string | null;
  kind: MadeKind;
  prompt: string;
  choices: string[] | null;
  answer: string;
  sourceQuote: string;
}

export type DropReasonCode =
  | 'malformed'
  | 'unknown_chunk'
  | 'quote_not_in_chunk'
  | 'kind_choices_mismatch'
  | 'answer_not_in_choices'
  | 'chunk_already_has_questions'
  | 'not_verified_by_database';

export interface DropReason {
  /** Place in the AI's list, or null when the drop happened at the database. */
  index: number | null;
  chunkPosition: number | null;
  reason: DropReasonCode;
}

const QUESTION_FIELDS = ['chunkPosition', 'kind', 'prompt', 'choices', 'answer', 'sourceQuote', 'topicTitle'];

/** Gemini responseSchema for MadeQuestionsAnswer. */
export const MADE_QUESTIONS_SCHEMA = {
  type: 'OBJECT',
  properties: {
    questions: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          chunkPosition: { type: 'INTEGER', description: 'The number N from the [Chunk N] header.' },
          kind: { type: 'STRING', enum: [...MADE_KINDS] },
          prompt: { type: 'STRING' },
          choices: {
            type: 'ARRAY',
            items: { type: 'STRING' },
            nullable: true,
            description: 'Exactly 4 for multiple_choice. null for the other kinds.',
          },
          answer: { type: 'STRING' },
          sourceQuote: { type: 'STRING', description: '5 to 30 words copied exactly from the chunk.' },
          topicTitle: { type: 'STRING', nullable: true },
        },
        required: QUESTION_FIELDS,
        propertyOrdering: QUESTION_FIELDS,
      },
    },
  },
  required: ['questions'],
};

/** The chunks as the prompt shows them: a [Chunk N] header, then the text. */
export function formatChunksForPrompt(chunks: ChunkForQuestions[]): string {
  return chunks.map((c) => `[Chunk ${c.position}]\n${c.text}`).join('\n\n');
}

/** The exam's topics as the prompt shows them. */
export function formatTopicsForPrompt(topics: TopicRef[]): string {
  if (topics.length === 0) return '(no topics: set topicTitle to null for every question)';
  return topics.map((t) => `- ${t.title}`).join('\n');
}

/**
 * The next chunks to make questions for: chunks at or after `start` that have
 * no questions yet, in position order, at most `size`. `nextStart` is one past
 * the last chunk taken, so a chunk whose questions were all dropped is not
 * picked again by the same chain (the app can re-run from 0 to retry it).
 * `remaining` counts the chunks after this batch that still need questions.
 */
export function pickBatch<T extends { id: string; position: number }>(
  chunks: T[],
  doneChunkIds: ReadonlySet<string>,
  start: number,
  size: number = BATCH_SIZE,
): { batch: T[]; nextStart: number; remaining: number } {
  const todo = chunks
    .filter((c) => c.position >= start && !doneChunkIds.has(c.id))
    .sort((a, b) => a.position - b.position);
  const batch = todo.slice(0, size);
  const nextStart = batch.length > 0 ? batch[batch.length - 1].position + 1 : start;
  return { batch, nextStart, remaining: todo.length - batch.length };
}

/**
 * Checks each question the AI made against the batch's chunks and the exam's
 * topics. A question is kept only when: its fields have the right types and
 * no blank text; its chunkPosition is a chunk in this batch; its quote appears
 * in that chunk; multiple choice has exactly 4 distinct non-blank choices and
 * the answer is exactly one of them; the other kinds have no choices (null,
 * missing or an empty list). topicTitle maps to a topic id only on an exact
 * title match, otherwise null.
 */
export function filterMadeQuestions(
  made: unknown,
  chunks: ChunkForQuestions[],
  topics: TopicRef[],
): { keep: InsertableQuestion[]; dropped: DropReason[] } {
  const keep: InsertableQuestion[] = [];
  const dropped: DropReason[] = [];
  if (!Array.isArray(made)) return { keep, dropped };

  const chunkByPosition = new Map(chunks.map((c) => [c.position, c]));
  const topicIdByTitle = new Map(topics.map((t) => [t.title, t.id]));

  made.forEach((item, index) => {
    const drop = (reason: DropReasonCode, chunkPosition: number | null = null) =>
      dropped.push({ index, chunkPosition, reason });

    if (!isObject(item)) return drop('malformed');
    const { chunkPosition, kind, prompt, choices, answer, sourceQuote, topicTitle } = item;
    const position = typeof chunkPosition === 'number' && Number.isInteger(chunkPosition) ? chunkPosition : null;

    if (position === null || !isKind(kind) || !isFilled(prompt) || !isFilled(answer) || !isFilled(sourceQuote)) {
      return drop('malformed', position);
    }

    const chunk = chunkByPosition.get(position);
    if (!chunk) return drop('unknown_chunk', position);

    const quote = sourceQuote.trim();
    if (!quoteAppears(quote, chunk.text)) return drop('quote_not_in_chunk', position);

    let cleanChoices: string[] | null = null;
    if (kind === 'multiple_choice') {
      if (
        !Array.isArray(choices) ||
        choices.length !== 4 ||
        !choices.every(isFilled) ||
        new Set(choices).size !== 4
      ) {
        return drop('kind_choices_mismatch', position);
      }
      if (!choices.includes(answer)) return drop('answer_not_in_choices', position);
      cleanChoices = [...choices];
    } else if (!(choices === null || choices === undefined || (Array.isArray(choices) && choices.length === 0))) {
      return drop('kind_choices_mismatch', position);
    }

    keep.push({
      chunkId: chunk.id,
      topicId: typeof topicTitle === 'string' ? (topicIdByTitle.get(topicTitle) ?? null) : null,
      kind,
      prompt: prompt.trim(),
      choices: cleanChoices,
      answer,
      sourceQuote: quote,
    });
  });

  return { keep, dropped };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFilled(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isKind(value: unknown): value is MadeKind {
  return typeof value === 'string' && (MADE_KINDS as readonly string[]).includes(value);
}
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `npx vitest run supabase/functions/_shared/questions.test.ts`
Expected: PASS, all tests green.

If "accepts a quote copied across a line break" fails, the foundation's `quoteAppears` does not collapse whitespace. Stop and tell Dev A.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/_shared/questions.ts supabase/functions/_shared/questions.test.ts
git commit -m "A6: question filtering and batch picking with tests

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 2.2: The question prompt

**Files:**
- Create or replace: `supabase/functions/_shared/prompts/make-questions.md`

**Interfaces:**
- Consumes: placeholders `{{chunks}}` (from `formatChunksForPrompt`), `{{topics}}` (from `formatTopicsForPrompt`), `{{questionsPerChunk}}` (the string `"3"`), filled by `askGemini`.
- Produces: the prompt file `make-questions`, loaded by `askGemini('make-questions', ...)` in Task 2.3. Field names must match `MADE_QUESTIONS_SCHEMA`.

- [ ] **Step 1: Write the prompt file**

Write exactly this to `supabase/functions/_shared/prompts/make-questions.md`:

```markdown
You write study questions for a student, using only the student's own notes. The student will answer these questions while revising for an exam, and every question shows the student where in their notes the answer comes from. A question that uses a fact the notes do not contain is worse than no question.

## The notes

The notes are split into numbered chunks. Each chunk starts with a header like [Chunk 4]. Write questions for every chunk below.

{{chunks}}

## The exam's topics

{{topics}}

## How many and what kind

- Write up to {{questionsPerChunk}} questions for each chunk.
- Across all chunks, aim for roughly half multiple_choice, a quarter short_answer and a quarter flashcard.
- If a chunk is unclear, garbled, very short, or has little to learn (a table of contents, a reference list, page headers, a list of names with no explanation), write fewer questions for it, or none. Never guess what unclear text meant.

## Rules for every question

1. Use only facts stated in that chunk. Do not add facts from your own knowledge, even true ones. Do not combine facts from two chunks in one question.
2. chunkPosition is the number N from the [Chunk N] header of the chunk the question comes from.
3. sourceQuote is 5 to 30 words copied character for character from that same chunk: same spelling, same capitals, same punctuation, no "...", no words left out or added. Choose the words that show the answer is right.
4. Test understanding, not copying: ask why, how, what causes what, what is the difference, what happens if. Avoid "fill in the missing word" questions.
5. Each question must make sense on its own. Do not write "according to the text", "in this chunk" or "in the notes".
6. Write in clear, plain English.
7. topicTitle is one of the exam's topic titles above, copied exactly, when the question clearly belongs to it. Otherwise null.

## Rules for each kind

- multiple_choice: choices has exactly 4 different options. Exactly one is correct according to the chunk. answer is that correct option, copied exactly, character for character, from choices. The 3 wrong options are plausible to a student who has not studied, similar in length and form to the correct one, and clearly wrong according to the chunk. No "all of the above" or "none of the above".
- short_answer: the answer is a short phrase of 1 to 5 words, or a number with its unit, that a student could type. choices is null.
- flashcard: prompt is a term or a question for the front of the card; answer is the back, at most 2 sentences. choices is null.

Answer only with JSON that matches the given schema.
```

- [ ] **Step 2: Check the placeholders and field names**

Run: `grep -o "{{[a-zA-Z]*}}" supabase/functions/_shared/prompts/make-questions.md | sort -u`
Expected output, exactly:

```
{{chunks}}
{{questionsPerChunk}}
{{topics}}
```

Check by eye that the prompt names `chunkPosition`, `kind`, `prompt`, `choices`, `answer`, `sourceQuote`, `topicTitle`, and the kinds `multiple_choice`, `short_answer`, `flashcard`, the same as `MADE_QUESTIONS_SCHEMA`.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/_shared/prompts/make-questions.md
git commit -m "A6: make-questions prompt

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 2.3: The `make-questions` function

**Files:**
- Create: `supabase/functions/make-questions/index.ts` (make the folder by hand with `mkdir -p supabase/functions/make-questions`. Do not run `npx supabase functions new`: it appends its own `[functions.make-questions]` block and a `deno.json`, and a second block for the same function makes `config.toml` fail to parse.)
- Modify: `supabase/config.toml` (add a block after the last function block)

**Interfaces:**
- Consumes: `askGemini`, `AiError` from `../_shared/ai.ts`; `isServiceCall`, `requireFullUser` from `../_shared/auth.ts`; `db` from `../_shared/db.ts`; `handle`, `HttpError`, `json` from `../_shared/http.ts`; `invokeInBackground(name: string, body: unknown): void` from `../_shared/invoke.ts` (it sends the service key and keeps the worker alive with `EdgeRuntime.waitUntil` itself); everything listed as "Produces" in Task 2.1 from `../_shared/questions.ts`.
- Produces: `POST /functions/v1/make-questions` with body `{ noteId: string, batchStart?: number }`.
  - Student call: 200 `{ made: number, dropped: DropReason[], remaining: number }`.
  - Service-key call: 202 `{ accepted: true }`, work continues in the background and is logged.
  - Errors: 400 `bad_input`, 401/403 from `requireFullUser`, 403 `not_yours`, 404 `not_found`, 409 `note_not_ready`, 502 `ai_failed`, 500 `internal`.
  - When the last batch is done and the note has an `exam_id`, it calls `POST /functions/v1/build-schedule` with the service key and `{ examId }`. Any answer, including 404 because `build-schedule` does not exist yet, is logged and ignored.

How the batch chain stays safe:

- `batchStart` is a position cursor. Each link passes `nextStart` (one past its last chunk) to the next, so a chunk whose questions were all dropped is skipped by the chain rather than retried forever. The app retries those by calling again without `batchStart`.
- Just before inserting, the function looks again for questions on the batch's chunks and skips any chunk that got questions from a parallel run in the meantime, so a double call does not double the questions.
- After insert, rows the database trigger did not mark verified are deleted and counted as dropped. This covers any difference between `quoteAppears` and the trigger's own rule.

- [ ] **Step 1: Write the function**

Create `supabase/functions/make-questions/index.ts`:

```ts
// make-questions (A6): turns a note's chunks into questions, 6 chunks per run.
// Every question names its chunk and quotes it; questions that fail a check
// are dropped, never repaired. Runs chain themselves until every chunk has
// been tried once, then the study plan is refreshed when the note belongs to
// an exam.
//
// Two callers:
// - another function, with the service key: answer 202 at once, work in the
//   background (keeps each link of the chain short);
// - the app, with the student's login: do the batch, answer the counts.
import { AiError, askGemini } from '../_shared/ai.ts';
import { isServiceCall, requireFullUser } from '../_shared/auth.ts';
import { db } from '../_shared/db.ts';
import { handle, HttpError, json } from '../_shared/http.ts';
import { invokeInBackground } from '../_shared/invoke.ts';
import {
  BATCH_SIZE,
  type DropReason,
  filterMadeQuestions,
  formatChunksForPrompt,
  formatTopicsForPrompt,
  MADE_QUESTIONS_SCHEMA,
  type MadeQuestionsAnswer,
  pickBatch,
  QUESTIONS_PER_CHUNK,
} from '../_shared/questions.ts';

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface NoteRow {
  id: string;
  owner_id: string;
  exam_id: string | null;
  status: string;
}

interface BatchResult {
  made: number;
  dropped: DropReason[];
  remaining: number;
}

function readInput(body: unknown): { noteId: string; batchStart: number } {
  const input = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  const noteId = input.noteId;
  const batchStart = input.batchStart ?? 0;
  if (typeof noteId !== 'string' || !UUID.test(noteId)) {
    throw new HttpError(400, 'bad_input', 'Send { "noteId": "<note id>" }.');
  }
  if (typeof batchStart !== 'number' || !Number.isInteger(batchStart) || batchStart < 0) {
    throw new HttpError(400, 'bad_input', 'batchStart must be a whole number, 0 or more.');
  }
  return { noteId, batchStart };
}

async function loadNote(noteId: string): Promise<NoteRow> {
  const { data, error: e } = await db
    .from('notes')
    .select('id, owner_id, exam_id, status')
    .eq('id', noteId)
    .maybeSingle();
  if (e) throw new HttpError(500, 'internal', e.message);
  if (!data) throw new HttpError(404, 'not_found', 'That note could not be found.');
  return data as NoteRow;
}

async function runBatch(note: NoteRow, batchStart: number): Promise<BatchResult> {
  const [chunksRes, askedRes] = await Promise.all([
    db.from('chunks').select('id, position, text').eq('note_id', note.id).gte('position', batchStart).order('position'),
    db.from('questions').select('chunk_id').eq('note_id', note.id),
  ]);
  if (chunksRes.error) throw new HttpError(500, 'internal', chunksRes.error.message);
  if (askedRes.error) throw new HttpError(500, 'internal', askedRes.error.message);

  const done = new Set((askedRes.data ?? []).map((r) => r.chunk_id as string));
  const { batch, nextStart, remaining } = pickBatch(chunksRes.data ?? [], done, batchStart, BATCH_SIZE);
  if (batch.length === 0) return { made: 0, dropped: [], remaining: 0 };

  let topics: { id: string; title: string }[] = [];
  if (note.exam_id) {
    const { data, error: e } = await db.from('topics').select('id, title').eq('exam_id', note.exam_id).order('position');
    if (e) throw new HttpError(500, 'internal', e.message);
    topics = data ?? [];
  }

  let answer: MadeQuestionsAnswer;
  try {
    answer = await askGemini<MadeQuestionsAnswer>(
      'make-questions',
      {
        chunks: formatChunksForPrompt(batch),
        topics: formatTopicsForPrompt(topics),
        questionsPerChunk: String(QUESTIONS_PER_CHUNK),
      },
      MADE_QUESTIONS_SCHEMA,
      { temperature: 0.7 },
    );
  } catch (e) {
    if (e instanceof AiError) {
      // Stop the chain here. The note keeps the questions made so far and the
      // app can call again; chunks without questions are picked up then.
      console.error(`make-questions: AI failed for note ${note.id} at ${batchStart}`, e);
      throw new HttpError(502, 'ai_failed', 'Making questions failed for now. Try again in a minute.');
    }
    throw e;
  }

  const { keep, dropped } = filterMadeQuestions(answer?.questions, batch, topics);
  const positionOf = new Map(batch.map((c) => [c.id, c.position]));

  // A parallel run may have filled some of these chunks while the AI was busy.
  const { data: nowAsked, error: nowAskedError } = await db
    .from('questions')
    .select('chunk_id')
    .in('chunk_id', batch.map((c) => c.id));
  if (nowAskedError) throw new HttpError(500, 'internal', nowAskedError.message);
  const taken = new Set((nowAsked ?? []).map((r) => r.chunk_id as string));

  const rows = [];
  for (const q of keep) {
    if (taken.has(q.chunkId)) {
      dropped.push({ index: null, chunkPosition: positionOf.get(q.chunkId) ?? null, reason: 'chunk_already_has_questions' });
      continue;
    }
    rows.push({
      note_id: note.id,
      chunk_id: q.chunkId,
      exam_id: note.exam_id,
      topic_id: q.topicId,
      kind: q.kind,
      prompt: q.prompt,
      choices: q.choices,
      answer: q.answer,
      source_quote: q.sourceQuote,
    });
  }

  let made = 0;
  if (rows.length > 0) {
    const { data: inserted, error: insertError } = await db.from('questions').insert(rows).select('id, chunk_id, verified');
    if (insertError) throw new HttpError(500, 'internal', insertError.message);
    const unverified = (inserted ?? []).filter((r) => !r.verified);
    made = (inserted ?? []).length - unverified.length;
    if (unverified.length > 0) {
      const { error: deleteError } = await db.from('questions').delete().in('id', unverified.map((r) => r.id));
      if (deleteError) console.error('make-questions: deleting unverified questions failed', deleteError);
      for (const r of unverified) {
        dropped.push({ index: null, chunkPosition: positionOf.get(r.chunk_id) ?? null, reason: 'not_verified_by_database' });
      }
    }
  }

  console.log(
    JSON.stringify({ fn: 'make-questions', noteId: note.id, batchStart, chunks: batch.length, made, dropped: dropped.length, remaining }),
  );

  if (remaining > 0) {
    invokeInBackground('make-questions', { noteId: note.id, batchStart: nextStart });
  } else if (note.exam_id) {
    // build-schedule may not exist yet; invokeInBackground logs the 404 and moves on.
    invokeInBackground('build-schedule', { examId: note.exam_id });
  }

  return { made, dropped, remaining };
}

Deno.serve(
  handle(async (req) => {
    if (req.method !== 'POST') throw new HttpError(400, 'bad_input', 'Use POST.');

    if (isServiceCall(req)) {
      const { noteId, batchStart } = readInput(await req.json().catch(() => null));
      EdgeRuntime.waitUntil(
        (async () => {
          try {
            const note = await loadNote(noteId);
            if (note.status !== 'ready') {
              console.warn(`make-questions: note ${noteId} is ${note.status}, nothing to do`);
              return;
            }
            await runBatch(note, batchStart);
          } catch (e) {
            console.error(`make-questions: background batch failed for note ${noteId} at ${batchStart}`, e);
          }
        })(),
      );
      return json({ accepted: true }, 202);
    }

    const user = await requireFullUser(req);
    const { noteId, batchStart } = readInput(await req.json().catch(() => null));
    const note = await loadNote(noteId);
    if (note.owner_id !== user.id) throw new HttpError(403, 'not_yours', 'That note belongs to someone else.');
    if (note.status !== 'ready') {
      throw new HttpError(409, 'note_not_ready', 'The note text is not ready yet. Try again in a moment.');
    }
    return json(await runBatch(note, batchStart));
  }),
);
```

- [ ] **Step 2: Register the function in `supabase/config.toml`**

Add this block after the last `[functions.*]` block. First run `grep -n "functions.make-questions" supabase/config.toml` and expect no output; there must be exactly one block per function. Match the key names the foundation used for `extract-text`.

```toml
[functions.make-questions]
enabled = true
verify_jwt = true
static_files = ["./functions/_shared/prompts/make-questions.md"]
```

Keep `verify_jwt = true`. Service calls are recognised by `isServiceCall`, which compares the bearer token to `SUPABASE_SERVICE_ROLE_KEY`. If the project moves to the new `sb_secret_...` keys, switch this block to `verify_jwt = false` and keep the same bearer check; student calls are still checked by `requireFullUser`.

- [ ] **Step 3: Check the imports by eye**

Edge Functions are not type-checked locally (no Deno install). Run:

```bash
grep -n "from '" supabase/functions/make-questions/index.ts
```

Expected: six imports, all from `../_shared/`, each ending in `.ts`, naming only exports that exist in those files (checked in Task 2.1 Step 1). There is no local `callFunction` or `fetch` to other functions; every follow-up call goes through `invokeInBackground`. The deploy on merge type-checks the function; a type error there shows in the Supabase dashboard's deploy log and in the hand test of Task 2.4.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/make-questions/index.ts supabase/config.toml
git commit -m "A6: make-questions function with batch chain

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 2.4: Hand test (A6 "Done when") and the tuning note

**Files:**
- Create: `supabase/functions/_handtests/make-questions.mjs`
- Modify: `supabase/functions/README.md`

**Interfaces:**
- Consumes: the typed-notes fixture committed by the foundation branch in `supabase/functions/_fixtures/` (assumed name `typed-notes.pdf`, about 10 pages; check the real name in that folder), `extract-text`, `make-questions`, the `questions` table read as the student.
- Produces: a script that exits 0 when the note has at least 20 verified questions.

- [ ] **Step 1: Write the hand-test script**

Create `supabase/functions/_handtests/make-questions.mjs`:

```js
// Hand test for make-questions (A6 "Done when": 10 pages of notes give at
// least 20 verified questions).
// Uploads the typed-notes fixture as a test student, runs extract-text (which
// starts make-questions by itself), waits until the question count stops
// growing, and checks the count. The note is kept so it can feed the quiz
// tests (A8); its id is printed.
//
// Run from the repo root (Node 20 or newer):
//   node --env-file=supabase/functions/_handtests/.env supabase/functions/_handtests/make-questions.mjs [fixture-file-name]
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';

const { SUPABASE_URL, SUPABASE_ANON_KEY, TEST_EMAIL, TEST_PASSWORD } = process.env;
for (const [name, value] of Object.entries({ SUPABASE_URL, SUPABASE_ANON_KEY, TEST_EMAIL, TEST_PASSWORD })) {
  if (!value) throw new Error(`${name} is missing from supabase/functions/_handtests/.env`);
}
const FIXTURES = new URL('../_fixtures/', import.meta.url);
const FILE_NAME = process.argv[2] ?? 'typed-notes.pdf';
const MIN_QUESTIONS = 20;
const POLL_MS = 15_000;
const STABLE_POLLS = 4; // count unchanged for one minute means the chain has finished
const MAX_WAIT_MS = 10 * 60_000;
const CONTENT_TYPES = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain',
  md: 'text/markdown',
};

function headers(token, extra = {}) {
  return { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}`, ...extra };
}

async function signIn() {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`sign-in failed: ${JSON.stringify(body)}`);
  return { token: body.access_token, userId: body.user.id };
}

async function callFunction(session, name, payload) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: headers(session.token, { 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function countRows(session, path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: headers(session.token, { Prefer: 'count=exact', Range: '0-0' }),
  });
  if (!res.ok) throw new Error(`count failed: ${res.status} ${await res.text()}`);
  return Number((res.headers.get('content-range') ?? '*/0').split('/')[1]);
}

const session = await signIn();

// 1. Note row, then the file, then extract-text.
const noteRes = await fetch(`${SUPABASE_URL}/rest/v1/notes`, {
  method: 'POST',
  headers: headers(session.token, { 'Content-Type': 'application/json', Prefer: 'return=representation' }),
  body: JSON.stringify({ title: `Hand test: ${FILE_NAME}`, source: 'file', original_filename: FILE_NAME }),
});
const notes = await noteRes.json();
if (!noteRes.ok) throw new Error(`creating the note failed: ${JSON.stringify(notes)}`);
const noteId = notes[0].id;
console.log(`note ${noteId}`);

const extension = FILE_NAME.split('.').pop().toLowerCase();
const file = await readFile(new URL(FILE_NAME, FIXTURES));
const upRes = await fetch(`${SUPABASE_URL}/storage/v1/object/uploads/${session.userId}/${noteId}/${FILE_NAME}`, {
  method: 'POST',
  headers: headers(session.token, { 'Content-Type': CONTENT_TYPES[extension] ?? 'application/octet-stream' }),
  body: file,
});
if (!upRes.ok) throw new Error(`upload failed: ${upRes.status} ${await upRes.text()}`);

const extracted = await callFunction(session, 'extract-text', { noteId });
assert.equal(extracted.status, 200, `extract-text answered ${JSON.stringify(extracted)}`);
assert.equal(extracted.body.status, 'ready', `extract-text failed: ${extracted.body.reason}`);
console.log(`extract-text: ${extracted.body.chunks} chunks; make-questions started by itself`);

// 2. Wait until the verified count stops growing.
const started = Date.now();
let last = -1;
let stable = 0;
let verified = 0;
while (Date.now() - started < MAX_WAIT_MS && stable < STABLE_POLLS) {
  await sleep(POLL_MS);
  verified = await countRows(session, `questions?note_id=eq.${noteId}&verified=eq.true&select=id`);
  stable = verified === last && verified > 0 ? stable + 1 : 0;
  last = verified;
  console.log(`${Math.round((Date.now() - started) / 1000)}s: ${verified} verified questions`);
}

// 3. The checks.
const unverified = await countRows(session, `questions?note_id=eq.${noteId}&verified=eq.false&select=id`);
assert.equal(unverified, 0, 'unverified questions were left in the table; they should have been deleted');
assert.ok(verified >= MIN_QUESTIONS, `only ${verified} verified questions, expected at least ${MIN_QUESTIONS}`);

// 4. Calling again as the student is safe: nothing new to do for chunks that have questions.
const again = await callFunction(session, 'make-questions', { noteId });
assert.equal(again.status, 200, `re-run answered ${JSON.stringify(again)}`);
console.log(`re-run: ${JSON.stringify({ made: again.body.made, dropped: again.body.dropped.length, remaining: again.body.remaining })}`);

// 5. Show a few questions to read by eye.
const sample = await fetch(
  `${SUPABASE_URL}/rest/v1/questions?note_id=eq.${noteId}&select=kind,prompt,choices,answer,source_quote&limit=5`,
  { headers: headers(session.token) },
).then((r) => r.json());
console.log(JSON.stringify(sample, null, 2));

console.log(`make-questions hand test passed: ${verified} verified questions for note ${noteId}`);
```

- [ ] **Step 2: Document the hand test and how to tune the prompt**

Add this section to the end of `supabase/functions/README.md` (if Part 1 merged first, add it after the read-syllabus section):

````markdown
## Hand test: make-questions (A6)

What it checks: 10 pages of typed notes give at least 20 verified questions, no unverified question is left in the table, and calling `make-questions` again is safe.

Setup is the same as the read-syllabus hand test: a test student and `supabase/functions/_handtests/.env`.

Run from the repo root:

```sh
node --env-file=supabase/functions/_handtests/.env supabase/functions/_handtests/make-questions.mjs
```

It uploads `_fixtures/typed-notes.pdf`, waits until the question count stops growing (a few minutes), and ends with `make-questions hand test passed: <n> verified questions for note <id>`. Pass another fixture name as the last argument to try a different file. The note is kept, so the quiz tests can use its questions.

To double-check in the database, open the Supabase dashboard, SQL Editor, and run (with the note id the script printed):

```sql
select count(*) from questions where note_id = '<note id>' and verified;
select kind, count(*) from questions where note_id = '<note id>' group by kind;
```

The first number must be at least 20. The second shows the mix of question kinds.

To see what was dropped and why, open the dashboard, Edge Functions, make-questions, Logs. Each batch writes one line with how many questions were made and dropped.

## How Dev A tunes the questions

The words the AI sees are in `supabase/functions/_shared/prompts/make-questions.md`. It is a plain text file: changing it changes the questions, with no code change.

1. Edit the file. Typical changes: more or fewer short-answer questions, harder wrong options, a stricter rule on what a good quote is. Keep the field names (`chunkPosition`, `kind`, `prompt`, `choices`, `answer`, `sourceQuote`, `topicTitle`) and the three placeholders (`{{chunks}}`, `{{topics}}`, `{{questionsPerChunk}}`) exactly as they are; the code depends on them.
2. Try it before merging, on a local stack: `npx supabase start`, then `npx supabase functions serve --env-file supabase/functions/.env`, then run the hand test with the local address in `_handtests/.env`. The local functions read the prompt file straight from your folder, so each edit takes effect on the next run.
3. Run the hand test again. It always uploads a new copy of the notes, so you compare a fresh set of questions each time. Read the five sample questions it prints and check the count.
4. When you like the result, open a pull request with the prompt change. Merging it to `main` deploys it.

Other knobs, all in code or secrets rather than the prompt: questions per chunk and chunks per batch are `QUESTIONS_PER_CHUNK` and `BATCH_SIZE` in `_shared/questions.ts`; the temperature is the `{ temperature: 0.7 }` argument in `make-questions/index.ts`; the model is the `GEMINI_MODEL` secret (`npx supabase secrets set GEMINI_MODEL=<model name>`).

Questions already made are not remade when the prompt changes. A note only gets new questions for chunks that have none.
````

- [ ] **Step 3: Run the hand test**

Same place as Part 1: a local stack if Docker is available, otherwise the live project right after the pull request merges (post the output as a comment on the merged pull request).

Run: `node --env-file=supabase/functions/_handtests/.env supabase/functions/_handtests/make-questions.mjs`
Expected: progress lines every 15 seconds, the re-run line, five sample questions, then `make-questions hand test passed: <n> verified questions for note <id>` with n at least 20, exit code 0.

Then run the two SQL lines from the README in the dashboard, or with the Supabase MCP `execute_sql` tool, and confirm the first count is at least 20.

Margin to know about: the typed-notes fixture gives about 10 chunks, or 8 to 12 from the PDF, depending on its paragraph breaks. That is not the 25 chunks the spec guessed for 10 pages. At 3 questions per chunk the most possible is about 30, or 24 with 8 chunks. So the 20-question check fails if more than about a fifth to a third of the questions are dropped. If it fails narrowly with few drops, the AI is writing fewer than 3 per chunk. Check the prompt's "up to" wording first. Raising `QUESTIONS_PER_CHUNK` to 4 is the next knob, but the spec says 3, so Dev A decides.

If the count is below 20, read the make-questions logs. Mostly `quote_not_in_chunk` means the quote rule in the prompt needs to be stricter. Mostly `not_verified_by_database` means `quoteAppears` and the database trigger disagree about whitespace: tell Dev A, because that is a foundation fix, not a prompt fix.

- [ ] **Step 4: Run all tests and commit**

Run: `npm test` and `npx vitest run supabase/functions/_shared`
Expected: all PASS.

```bash
git add supabase/functions/_handtests/make-questions.mjs supabase/functions/README.md
git commit -m "A6: make-questions hand test and tuning notes

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Step 5: Open the pull request**

Before pushing, run `git diff main --stat` and confirm no `.env` file or key is in the diff.

config.toml: other branches append blocks at the end of this file too; resolve merge conflicts by keeping both blocks.

```bash
git push -u origin a6-question-maker
gh pr create --base main --head a6-question-maker --title "A6: question maker" --body "$(cat <<'EOF'
What this adds
- make-questions Edge Function: turns a note's chunks into questions, 6 chunks per run, chaining itself until every chunk has been tried. Started by extract-text with the service key; the app can also call it to retry.
- questions.ts: checks every question. The quote must appear in its chunk; multiple choice needs exactly 4 different choices with the answer among them word for word; other kinds have no choices; the topic is matched by exact title. Anything that fails is dropped. Rows the database does not verify are deleted after insert.
- make-questions.md: the prompt, editable without touching code. README explains how to tune it.
- A hand-test script for the A6 Done when.

For Dev B
- Questions appear by themselves after upload. While a note has chunks without questions, show "questions are still being made".
- To retry, call POST /functions/v1/make-questions with { noteId }. Answer: { made, dropped, remaining }.

For build-schedule (A5)
- When the last batch for a note linked to an exam is done, this calls build-schedule with the service key and { examId }. build-schedule must accept that call and find the student from the exam. Until build-schedule exists, the 404 is logged and ignored.

Checks
- Unit tests: <paste vitest summary>
- Hand test (A6 Done when): <paste the script output and the SQL count, or say it will run against live right after merge>

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Notes for the reviewer and for Dev A

- **Quote rule (decided).** The live trigger `private.verify_question` used an exact match. The foundation migration changes it to collapse whitespace on both sides, the same rule as `quoteAppears`. Part 2 still deletes any row the database leaves unverified, as a safety net, and the hand test checks that none are left.
- **`build-schedule` accepts service-key calls (decided)** with `{ examId }` and works out the owner from the exam, because `make-questions` has no student login when it runs in the background.
- **Both branches touch `supabase/config.toml` and `supabase/functions/README.md`.** Each adds its own block or section at the end. Whichever merges second will need a small, obvious merge fix.
- **The confirm screen (B5) needs the proposal shape.** It lives in `proposals.ts` for now. If Dev B wants it in `packages/shared`, that is a shared-types change both developers agree on, in its own pull request.
- **Not enforced in code, only asked in the prompt:** the 5 to 30 word length of a quote, and the mix of question kinds. A very short quote such as one word still traces to the chunk but shows the student less. If the hand test shows many one-word quotes, add a minimum word count to `filterMadeQuestions` with its own test.
