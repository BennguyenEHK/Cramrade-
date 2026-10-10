// Rules for the text extractor that need no parser: which files we read and
// the reasons a student sees when we cannot. Pure, tested with vitest.

export type FileKind = 'pdf' | 'docx' | 'text';

/** A PDF longer than this is refused, to stay inside the 2-second CPU limit. */
export const MAX_PDF_PAGES = 100;

/** One-line reasons saved in notes.failure_reason and shown on the screen. */
export const FAILURE = {
  unsupported: 'file type not supported, use PDF, Word (.docx), .txt or .md',
  noText: 'no readable text, this looks like a scanned image',
  unreadable: 'the file could not be read, it may be damaged or password protected',
  missing: 'the uploaded file was not found, upload it again',
  tooLong: `the file has more than ${MAX_PDF_PAGES} pages, split it into smaller files`,
  serverError: 'something went wrong on our side, upload the file again',
} as const;

const BY_EXTENSION: Record<string, FileKind> = {
  pdf: 'pdf',
  docx: 'docx',
  txt: 'text',
  md: 'text',
  markdown: 'text',
};

const BY_CONTENT_TYPE: Record<string, FileKind> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'text/plain': 'text',
  'text/markdown': 'text',
  'text/x-markdown': 'text',
};

/**
 * Which parser to use. The file name's extension decides when there is one;
 * an unknown extension (.doc, .rtf, .pages) is not supported even if the
 * content type claims text. Only a name with no extension falls back to the
 * content type. Null means "not supported".
 */
export function fileKind(filename: string, contentType: string | null): FileKind | null {
  const base = filename.split('/').pop() ?? '';
  const dot = base.lastIndexOf('.');
  if (dot > 0) return BY_EXTENSION[base.slice(dot + 1).toLowerCase()] ?? null;
  const type = (contentType ?? '').split(';')[0].trim().toLowerCase();
  return BY_CONTENT_TYPE[type] ?? null;
}

/** A "text" file that contains NUL characters is really a binary file renamed. */
export function looksBinary(text: string): boolean {
  return text.includes('\u0000');
}
