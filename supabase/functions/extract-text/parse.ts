// The only file that touches the PDF and Word libraries. Bytes in, text out.

import { extractText, getDocumentProxy } from 'npm:unpdf@1.8.1';
import mammoth from 'npm:mammoth@1.12.0';
import { Buffer } from 'node:buffer';
import { FAILURE, fileKind, looksBinary, MAX_PDF_PAGES } from '../_shared/extraction.ts';

export type ParseResult = { ok: true; text: string } | { ok: false; reason: string };

/** Pull the plain text out of an uploaded file. Never throws. */
export async function extractFileText(
  bytes: Uint8Array,
  filename: string,
  contentType: string | null,
): Promise<ParseResult> {
  const kind = fileKind(filename, contentType);
  if (!kind) return { ok: false, reason: FAILURE.unsupported };
  try {
    if (kind === 'pdf') {
      const pdf = await getDocumentProxy(bytes);
      if (pdf.numPages > MAX_PDF_PAGES) return { ok: false, reason: FAILURE.tooLong };
      const { text } = await extractText(pdf, { mergePages: false });
      // A blank line between pages, so a page never runs into the next one.
      return { ok: true, text: text.join('\n\n') };
    }
    if (kind === 'docx') {
      const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
      return { ok: true, text: value };
    }
    const text = new TextDecoder('utf-8').decode(bytes);
    if (looksBinary(text)) return { ok: false, reason: FAILURE.unreadable };
    return { ok: true, text };
  } catch (e) {
    console.error(`could not parse ${kind} file`, e);
    return { ok: false, reason: FAILURE.unreadable };
  }
}
