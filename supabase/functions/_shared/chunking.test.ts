import { describe, expect, it } from 'vitest';
import { countWords, toChunks } from './chunking.ts';

/** n distinct words: "w0 w1 w2 ...", prefixed so paragraphs differ. */
const words = (n: number, prefix = 'w') => Array.from({ length: n }, (_, i) => `${prefix}${i}`).join(' ');
/** One sentence of n words ending with a full stop. */
const sentence = (n: number, prefix: string) => `${words(n, prefix)}.`;

describe('toChunks', () => {
  it('gives no chunks for empty or blank text', () => {
    expect(toChunks('')).toEqual([]);
    expect(toChunks('  \n\n \t\r\n')).toEqual([]);
  });

  it('keeps a short note as one chunk, paragraphs separated by a blank line', () => {
    expect(toChunks('Cells divide.\n\nThey grow.')).toEqual(['Cells divide.\n\nThey grow.']);
  });

  it('normalises whitespace inside paragraphs and drops invisible characters', () => {
    const text = 'Hello   world\nagain\r\n\r\n\r\n\tNext\u00a0 para\u200b';
    expect(toChunks(text)).toEqual(['Hello world again\n\nNext para']);
  });

  it('treats a page break (form feed) as a paragraph break', () => {
    expect(toChunks('Page one text.\fPage two text.')).toEqual(['Page one text.\n\nPage two text.']);
  });

  it('merges small paragraphs until a chunk reaches 300 words', () => {
    const text = Array.from({ length: 10 }, (_, i) => words(100, `p${i}w`)).join('\n\n');
    expect(toChunks(text).map(countWords)).toEqual([300, 300, 300, 100]);
  });

  it('never cuts a paragraph of 600 words or fewer, even above 500', () => {
    const text = [words(100, 'a'), words(550, 'b'), words(100, 'c')].join('\n\n');
    expect(toChunks(text).map(countWords)).toEqual([100, 550, 100]);
  });

  it('splits a paragraph over 600 words at sentence ends', () => {
    const text = Array.from({ length: 60 }, (_, i) => sentence(20, `s${i}w`)).join(' ');
    const chunks = toChunks(text);
    expect(chunks.map(countWords)).toEqual([500, 500, 200]);
    for (const chunk of chunks) expect(chunk.endsWith('.')).toBe(true);
  });

  it('cuts a sentence longer than 500 words into 500-word pieces', () => {
    expect(toChunks(words(1300)).map(countWords)).toEqual([500, 500, 300]);
  });

  it('loses no words and changes no word', () => {
    const text = [words(250, 'a'), sentence(30, 'b'), words(700, 'c'), 'tail end'].join('\n\n');
    const before = text.split(/\s+/).filter(Boolean);
    const after = toChunks(text).join(' ').split(/\s+/).filter(Boolean);
    expect(after).toEqual(before);
  });

  it('is deterministic', () => {
    const text = [words(120, 'x'), sentence(700, 'y'), words(40, 'z')].join('\n\n');
    expect(toChunks(text)).toEqual(toChunks(text));
  });
});
