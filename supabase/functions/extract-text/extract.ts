import { getDocumentProxy } from 'unpdf';
import { unzipSync } from 'fflate';
import { SaxesParser } from 'saxes';

export const MAX_FILE_BYTES = 4 * 1024 * 1024;
export const MAX_TEXT_CHARS = 200_000;
export const MAX_PDF_PAGES = 5;
const MAX_WORD_XML_BYTES = 1024 * 1024;

export class UploadError extends Error {
  constructor(
    message: string,
    public status = 422,
  ) {
    super(message);
  }
}

export function chunkText(text: string): string[] {
  const chunks: string[] = [];
  for (let start = 0; start < text.length;) {
    let end = Math.min(start + 3000, text.length);
    // Never split a Unicode surrogate pair. Preserve every character for citations.
    if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end--;
    chunks.push(text.slice(start, end));
    start = end;
  }
  return chunks;
}

function validateText(text: string): string {
  if (!text.trim())
    throw new UploadError(
      'No readable text was found. Scanned pages and images need text recognition; upload a document with selectable text.',
    );
  if (text.length > MAX_TEXT_CHARS)
    throw new UploadError('There is too much text. Split the document into smaller files.', 413);
  if (text.includes('\0'))
    throw new UploadError('This file contains binary data instead of readable text.');
  return text;
}

function wordText(bytes: Uint8Array): string {
  let found = false;
  const entries = unzipSync(bytes, {
    filter: (entry) => {
      if (entry.name !== 'word/document.xml') return false;
      if (found) throw new UploadError('This Word file contains duplicate document parts.');
      found = true;
      if (entry.originalSize > MAX_WORD_XML_BYTES)
        throw new UploadError(
          'This Word document is too large after extraction. Split it into smaller files.',
          413,
        );
      return true;
    },
  });
  const document = entries['word/document.xml'];
  if (!document)
    throw new UploadError('This is not a Word .docx document. Save it as .docx and try again.');
  const xml = new TextDecoder('utf-8', { fatal: true }).decode(document);
  if (/<!DOCTYPE|<!ENTITY/i.test(xml))
    throw new UploadError(
      'This Word file uses unsupported XML declarations. Save a fresh .docx copy.',
    );
  const parser = new SaxesParser({ xmlns: true });
  const wordNamespaces = new Set([
    'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
    'http://purl.oclc.org/ooxml/wordprocessingml/main',
  ]);
  let inText = false;
  let text = '';
  parser.on('opentag', (tag) => {
    if (!wordNamespaces.has(tag.uri)) return;
    if (tag.local === 't') inText = true;
    if (tag.local === 'tab') text += '\t';
    if (tag.local === 'br' || tag.local === 'cr') text += '\n';
  });
  parser.on('text', (value) => {
    if (inText) text += value;
  });
  parser.on('closetag', (tag) => {
    if (!wordNamespaces.has(tag.uri)) return;
    if (tag.local === 't') inText = false;
    if (tag.local === 'p') text += '\n';
    if (tag.local === 'tc') text += '\t';
  });
  parser.write(xml).close();
  return text;
}

export async function extractFile(filename: string, bytes: Uint8Array): Promise<string[]> {
  if (!bytes.length) throw new UploadError('This file is empty. Choose another file.');
  if (bytes.length > MAX_FILE_BYTES) throw new UploadError('Choose a file smaller than 4 MB.', 413);
  const extension = filename.toLowerCase().split('.').pop();
  try {
    let text: string;
    if (extension === 'pdf') {
      if (new TextDecoder().decode(bytes.subarray(0, 5)) !== '%PDF-')
        throw new UploadError('This file is not a valid PDF.');
      const pdf = await getDocumentProxy(bytes);
      try {
        if (pdf.numPages > MAX_PDF_PAGES)
          throw new UploadError(
            'Upload at most 5 PDF pages at a time. Split this PDF into smaller files.',
            413,
          );
        const pages: string[] = [];
        for (let number = 1; number <= pdf.numPages; number++) {
          const page = await pdf.getPage(number);
          const content = await page.getTextContent();
          const pageText = content.items
            .map((item) => ('str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : ''))
            .join('');
          if (!pageText.trim())
            throw new UploadError(
              `Page ${number} has no selectable text. Upload a text-based PDF; scanned pages cannot be read yet.`,
            );
          pages.push(pageText);
          if (pages.reduce((size, value) => size + value.length, 0) > MAX_TEXT_CHARS)
            throw new UploadError(
              'This PDF contains too much text. Split it into smaller files.',
              413,
            );
          page.cleanup();
        }
        text = pages.join('\n\n');
      } finally {
        await pdf.loadingTask.destroy();
      }
    } else if (extension === 'docx') {
      text = wordText(bytes);
    } else if (extension === 'txt' || extension === 'md' || extension === 'markdown') {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } else {
      throw new UploadError(
        'Choose a PDF, Word .docx, UTF-8 text or Markdown file. Older .doc files must be saved as .docx first.',
        415,
      );
    }
    return chunkText(validateText(text));
  } catch (error) {
    if (error instanceof UploadError) throw error;
    throw new UploadError(
      'This file could not be read. It may be damaged, password-protected or use unsupported text encoding. Save a new copy and try again.',
    );
  }
}
