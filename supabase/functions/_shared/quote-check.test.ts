// These tests mirror the database trigger private.verify_question, which
// (after the server_side migration) does
//   position(trim(regexp_replace(quote, '[ \t\n\r\f\v]+', ' ', 'g'))
//            in trim(regexp_replace(chunk_text, '[ \t\n\r\f\v]+', ' ', 'g'))) > 0
// and refuses an empty quote. Each expected value here is what the live
// database answered for the same input on 2026-10-10.
import { describe, expect, it } from 'vitest';
import { collapseWhitespace, quoteAppears } from './quote-check.ts';

const chunk = 'Mitosis has four phases.\n\nIn prophase the chromosomes condense and become visible.';

describe('collapseWhitespace (same as the trigger)', () => {
  it('turns runs of spaces, tabs and line breaks into one space and trims the ends', () => {
    expect(collapseWhitespace('  a \t\n b\r\n\f\vc  ')).toBe('a b c');
  });
  it('leaves no-break, em-space and next-line characters alone, as the trigger does', () => {
    expect(collapseWhitespace('a\u00a0b\u2003c\u0085d')).toBe('a\u00a0b\u2003c\u0085d');
    expect(collapseWhitespace('a \u00a0 b')).toBe('a \u00a0 b');
  });
  it('leaves the byte-order mark and zero-width space alone', () => {
    expect(collapseWhitespace('a\ufeffb\u200bc')).toBe('a\ufeffb\u200bc');
  });
});

describe('quoteAppears', () => {
  it('finds an exact substring', () => {
    expect(quoteAppears('the chromosomes condense', chunk)).toBe(true);
  });
  it('accepts the whole chunk', () => {
    expect(quoteAppears(chunk, chunk)).toBe(true);
  });
  it('is case-sensitive', () => {
    expect(quoteAppears('The chromosomes condense', chunk)).toBe(false);
  });
  it('ignores differences in whitespace, including a line break the AI copied', () => {
    expect(quoteAppears('the  chromosomes\ncondense', chunk)).toBe(true);
    expect(quoteAppears('  In prophase the chromosomes ', chunk)).toBe(true);
  });
  it('matches across a paragraph break, as the trigger does', () => {
    expect(quoteAppears('four phases. In prophase', chunk)).toBe(true);
  });
  it('treats straight and curly apostrophes as different characters', () => {
    expect(quoteAppears('it\u2019s', "it's here")).toBe(false);
  });
  it('rejects a quote that is empty or only whitespace', () => {
    expect(quoteAppears('', chunk)).toBe(false);
    expect(quoteAppears(' \n\t', chunk)).toBe(false);
  });
  it('rejects words that are not in the chunk', () => {
    expect(quoteAppears('chromosomes divide', chunk)).toBe(false);
  });
});
