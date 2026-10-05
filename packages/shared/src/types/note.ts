import type { Id, Timestamp } from './common';

/** How the text arrived. The file or photo itself is thrown away after the text is pulled out. */
export type NoteSource = 'file' | 'photo' | 'text';

/** Where the note is in the pipeline from upload to questions. */
export type NoteStatus = 'processing' | 'ready' | 'failed';

/**
 * One set of study notes, stored as text only. Never the original file, never
 * a photo. The text itself lives in chunks (see Chunk).
 *
 * Table: notes. Visible to the owner and, when groupId is set, to that group's
 * members. Only the owner can change or delete it.
 */
export interface Note {
  id: Id;
  ownerId: Id;
  /** Set when the note is shared with a study group. Null means private. */
  groupId: Id | null;
  title: string;
  source: NoteSource;
  /** The name of the uploaded file, kept only so the student recognises the note. Null for photos and typed text. */
  originalFilename: string | null;
  /** 'processing' while text is being extracted and questions made, then 'ready' or 'failed'. */
  status: NoteStatus;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/**
 * A numbered piece of a note's text, a paragraph or so. Every question points
 * at exactly one chunk, which is how "show me where this is in my notes" works.
 *
 * Table: chunks. Same visibility as its note.
 */
export interface Chunk {
  id: Id;
  noteId: Id;
  /** Order inside the note, starting at 0. */
  position: number;
  /** The text of this piece, exactly as extracted. The AI never adds to it. */
  text: string;
  createdAt: Timestamp;
}
