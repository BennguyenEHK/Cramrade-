import { describe, expect, it } from 'vitest';
import { fileKind, looksBinary } from './extraction.ts';

describe('fileKind', () => {
  it('picks the parser from the extension, any case', () => {
    expect(fileKind('Week 1.PDF', null)).toBe('pdf');
    expect(fileKind('notes.docx', 'application/octet-stream')).toBe('docx');
    expect(fileKind('notes.txt', null)).toBe('text');
    expect(fileKind('notes.md', null)).toBe('text');
    expect(fileKind('notes.markdown', null)).toBe('text');
  });

  it('uses only the last part of a storage path', () => {
    expect(fileKind('user/note/my.notes.pdf', null)).toBe('pdf');
  });

  it('refuses unknown extensions even when the content type says text', () => {
    expect(fileKind('notes.doc', 'application/msword')).toBeNull();
    expect(fileKind('notes.rtf', 'text/plain')).toBeNull();
    expect(fileKind('photo.jpg', 'image/jpeg')).toBeNull();
  });

  it('falls back to the content type only when there is no extension', () => {
    expect(fileKind('notes', 'text/plain; charset=utf-8')).toBe('text');
    expect(fileKind('notes', 'application/pdf')).toBe('pdf');
    expect(fileKind('notes', null)).toBeNull();
    expect(fileKind('.hidden', 'text/markdown')).toBe('text');
  });
});

describe('looksBinary', () => {
  it('flags text with NUL characters', () => {
    expect(looksBinary('PK\u0003\u0004\u0000\u0000')).toBe(true);
    expect(looksBinary('plain notes')).toBe(false);
  });
});
