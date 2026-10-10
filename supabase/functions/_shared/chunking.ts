// Note text -> numbered chunks of about 300 to 500 words (spec section 3).
// Pure and deterministic: no Deno APIs, no randomness, tested with vitest.
//
export const MIN_WORDS = 300;
export const MAX_WORDS = 500;
export const LONG_PARAGRAPH_WORDS = 600;

export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed === '' ? 0 : trimmed.split(/\s+/).length;
}

function toParagraphs(text: string): string[] {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/\f/g, '\n\n')
    .replace(/[\u200b\u200c\u200d\u2060\ufeff]/g, '')
    .replace(/[\u00a0\u2000-\u200a\u202f\u205f\u3000]/g, ' ')
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter((p) => p !== '');
}

function hardSplit(sentence: string): string[] {
  const words = sentence.split(' ');
  const pieces: string[] = [];
  for (let i = 0; i < words.length; i += MAX_WORDS) {
    pieces.push(words.slice(i, i + MAX_WORDS).join(' '));
  }
  return pieces;
}

function splitLongParagraph(paragraph: string): string[] {
  if (countWords(paragraph) <= LONG_PARAGRAPH_WORDS) return [paragraph];
  const sentences = paragraph.split(/(?<=[.!?]["'\u201d\u2019)\]]*) /);
  const pieces: string[] = [];
  let current = '';
  for (const sentence of sentences) {
    if (countWords(sentence) > MAX_WORDS) {
      if (current !== '') pieces.push(current);
      current = '';
      pieces.push(...hardSplit(sentence));
      continue;
    }
    if (current === '') current = sentence;
    else if (countWords(current) + countWords(sentence) <= MAX_WORDS) current += ' ' + sentence;
    else {
      pieces.push(current);
      current = sentence;
    }
  }
  if (current !== '') pieces.push(current);
  return pieces;
}

export function toChunks(text: string): string[] {
  const pieces = toParagraphs(text).flatMap(splitLongParagraph);
  const chunks: string[] = [];
  let current = '';
  for (const piece of pieces) {
    if (current === '') current = piece;
    else if (countWords(current) + countWords(piece) <= MAX_WORDS) current += '\n\n' + piece;
    else {
      chunks.push(current);
      current = piece;
    }
    if (countWords(current) >= MIN_WORDS) {
      chunks.push(current);
      current = '';
    }
  }
  if (current !== '') chunks.push(current);
  return chunks;
}
