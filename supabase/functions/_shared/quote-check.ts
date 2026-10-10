// Does a question's quote really appear in its chunk?
//
// This mirrors the database trigger private.verify_question (changed by the
// server_side migration). The database does, on both the quote and the
// chunk text:
//   trim(regexp_replace(x, '[ \t\n\r\f\v]+', ' ', 'g'))
// then position(quote in chunk) > 0, and an empty quote never counts.
// So: every run of ASCII whitespace (space, tab, line feed, carriage return,
// form feed, vertical tab) becomes one space, the ends are trimmed, and the
// test is a case-sensitive substring match.
//
// The class is spelled out on both sides instead of \s because \s means
// different things in the two engines (checked on the live database on
// 2026-10-10: U+FEFF is whitespace only in JavaScript, U+0085 only in
// Postgres). With the explicit class both sides leave every non-ASCII
// character alone, including no-break spaces, so they always agree.
// Postgres trim() removes only spaces, and after collapsing any whitespace
// at the ends is a single space, so the code removes one space at each end
// instead of calling .trim(), which would also remove other characters.

const WHITESPACE_RUN = /[ \t\n\r\f\v]+/g;

/** Collapse whitespace runs to one space and trim spaces at the ends, exactly as the trigger does. */
export function collapseWhitespace(text: string): string {
  return text.replace(WHITESPACE_RUN, ' ').replace(/^ /, '').replace(/ $/, '');
}

/**
 * True when the quote appears in the chunk once whitespace is collapsed on
 * both sides. Case-sensitive. A quote that is empty after collapsing is false
 * (Postgres would find '' at position 1, so the trigger checks this too).
 */
export function quoteAppears(quote: string, chunkText: string): boolean {
  const needle = collapseWhitespace(quote);
  if (needle === '') return false;
  return collapseWhitespace(chunkText).includes(needle);
}
