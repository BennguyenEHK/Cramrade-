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
