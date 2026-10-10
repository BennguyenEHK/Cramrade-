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
  if (!Array.isArray(made)) {
    console.warn('make-questions: AI returned no questions list');
    return { keep, dropped };
  }

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
