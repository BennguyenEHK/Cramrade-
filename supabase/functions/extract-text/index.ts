// extract-text: turn an uploaded file into numbered chunks of text (task A4a,
// merged with Dev B's B4 upload path).
//
// POST multipart/form-data with the student's access token. Fields:
//   file         exactly one file: PDF, Word (.docx), .txt or .md, at most 20 MB
//   uploadId     a UUID v4 the app makes; it becomes the note's id
//   examId       optional: the exam these notes are for (must be the student's)
//   isSyllabus   optional: 'true' or 'false' (default 'false')
//
// Answers 200 with one of:
//   { noteId, status: 'ready',  chunks: n }
//   { noteId, status: 'failed', chunks: 0, reason }   (the reason is also saved on the note)
//   { noteId, status: 'processing', chunks: 0 }       (only when the same upload is still running)
// Errors: 400 bad_input, 401 not_signed_in, 403 guest_not_allowed or
// not_yours, 500 internal. Body: { error: { code, message } }.
//
// The file lives only in this function's memory; nothing goes to Storage.
// Sending the same uploadId again does no new work and answers with the
// note's current state. A note that is not a syllabus starts make-questions.

import { requireFullUser, type AuthedUser } from '../_shared/auth.ts';
import { toChunks } from '../_shared/chunking.ts';
import { db } from '../_shared/db.ts';
import { FAILURE } from '../_shared/extraction.ts';
import { handle, HttpError, json } from '../_shared/http.ts';
import { invokeInBackground } from '../_shared/invoke.ts';
import { extractFileText } from './parse.ts';

/** The largest file we accept. */
const MAX_FILE_BYTES = 20 * 1024 * 1024;
/** Room for the multipart boundaries and the small text fields. */
const FORM_OVERHEAD_BYTES = 64 * 1024;
const TOO_BIG = 'Choose a file smaller than 20 MB.';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Upload {
  file: File;
  filename: string;
  uploadId: string;
  examId: string | null;
  isSyllabus: boolean;
}

interface NoteState {
  owner_id: string;
  source: string;
  status: string;
  failure_reason: string | null;
}

Deno.serve(
  handle(async (req) => {
    if (req.method !== 'POST') throw new HttpError(400, 'bad_input', 'Use POST to upload a file.');
    const user = await requireFullUser(req);
    const upload = readUpload(await readForm(req));

    // Safe to call again: an existing note answers with its current state.
    const existing = await findNote(upload.uploadId);
    if (existing) return await answerExisting(upload.uploadId, existing, user);

    if (upload.examId) await requireOwnExam(upload.examId, user);

    const { error: insertError } = await db.from('notes').insert({
      id: upload.uploadId,
      owner_id: user.id,
      title: titleFrom(upload.filename),
      source: 'file',
      original_filename: upload.filename,
      status: 'processing',
      exam_id: upload.examId,
      is_syllabus: upload.isSyllabus,
    });
    if (insertError) {
      // 23505: a call with the same uploadId inserted the note first.
      if (insertError.code === '23505') {
        const raced = await findNote(upload.uploadId);
        if (raced) return await answerExisting(upload.uploadId, raced, user);
      }
      throw insertError;
    }

    return await extractAndSave(upload);
  }),
);

/** Parse, chunk and save. The note row already exists with status 'processing'. */
async function extractAndSave(upload: Upload): Promise<Response> {
  const noteId = upload.uploadId;
  let count = 0;
  try {
    const bytes = new Uint8Array(await upload.file.arrayBuffer());
    const parsed = await extractFileText(bytes, upload.filename, upload.file.type || null);
    if (!parsed.ok) return await markFailed(noteId, parsed.reason);

    const chunks = toChunks(parsed.text);
    if (chunks.length === 0) return await markFailed(noteId, FAILURE.noText);

    const { error: chunkError } = await db
      .from('chunks')
      .insert(chunks.map((text, position) => ({ note_id: noteId, position, text })));
    if (chunkError) throw chunkError;
    count = chunks.length;

    const { error: readyError } = await db
      .from('notes')
      .update({ status: 'ready', failure_reason: null })
      .eq('id', noteId);
    if (readyError) throw readyError;
  } catch (e) {
    console.error('extract-text failed', e);
    await removeChunks(noteId);
    await markFailed(noteId, FAILURE.serverError);
    throw new HttpError(500, 'internal', 'Something went wrong on the server. Try again in a moment.');
  }

  // A syllabus goes to read-syllabus (the app calls it). Notes get questions.
  if (!upload.isSyllabus) invokeInBackground('make-questions', { noteId });
  return json({ noteId, status: 'ready', chunks: count });
}

/** Bound the body while streaming, even when Content-Length is missing or false. */
async function readForm(req: Request): Promise<FormData> {
  const limit = MAX_FILE_BYTES + FORM_OVERHEAD_BYTES;
  const contentType = req.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
    throw new HttpError(400, 'bad_input', 'Send the file as multipart/form-data.');
  }
  if (Number(req.headers.get('content-length')) > limit) throw new HttpError(400, 'bad_input', TOO_BIG);
  const reader = req.body?.getReader();
  if (!reader) throw new HttpError(400, 'bad_input', 'Choose a file to upload.');

  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) {
        await reader.cancel();
        throw new HttpError(400, 'bad_input', TOO_BIG);
      }
      parts.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    body.set(part, offset);
    offset += part.length;
  }
  try {
    return await new Response(body, { headers: { 'Content-Type': contentType } }).formData();
  } catch {
    throw new HttpError(400, 'bad_input', 'The upload was incomplete. Choose the file and try again.');
  }
}

/** Check every form field and pull out what the rest of the function needs. */
function readUpload(form: FormData): Upload {
  const files = form.getAll('file');
  const file = files[0];
  if (files.length !== 1 || !(file instanceof File)) {
    throw new HttpError(400, 'bad_input', 'Choose exactly one file.');
  }
  if (file.size > MAX_FILE_BYTES) throw new HttpError(400, 'bad_input', TOO_BIG);

  // Keep only the base name: some browsers send a path.
  const filename = (file.name.split(/[\\/]/).pop() ?? '').trim();
  if (filename.length < 1 || filename.length > 255) {
    throw new HttpError(400, 'bad_input', 'Use a file name with 1 to 255 characters.');
  }

  const uploadId = form.get('uploadId');
  if (typeof uploadId !== 'string' || !UUID_V4.test(uploadId)) {
    throw new HttpError(400, 'bad_input', 'uploadId must be a UUID v4. Choose the file again.');
  }

  const examField = form.get('examId');
  let examId: string | null = null;
  if (examField !== null && examField !== '') {
    if (typeof examField !== 'string' || !UUID.test(examField)) {
      throw new HttpError(400, 'bad_input', 'examId must be an id.');
    }
    examId = examField.toLowerCase();
  }

  const syllabusField = form.get('isSyllabus');
  if (syllabusField !== null && syllabusField !== 'true' && syllabusField !== 'false') {
    throw new HttpError(400, 'bad_input', "isSyllabus must be 'true' or 'false'.");
  }

  return { file, filename, uploadId: uploadId.toLowerCase(), examId, isSyllabus: syllabusField === 'true' };
}

/** 403 unless the exam exists and belongs to the caller. */
async function requireOwnExam(examId: string, user: AuthedUser): Promise<void> {
  const { data, error } = await db.from('exams').select('owner_id').eq('id', examId).maybeSingle();
  if (error) throw error;
  if (!data || data.owner_id !== user.id) {
    throw new HttpError(403, 'not_yours', 'That exam is not yours.');
  }
}

/** Note title: the file name without its extension, at most 120 characters. */
function titleFrom(filename: string): string {
  return filename.replace(/\.[^.]+$/, '').trim().slice(0, 120).trim() || 'Uploaded notes';
}

async function findNote(noteId: string): Promise<NoteState | null> {
  const { data, error } = await db
    .from('notes')
    .select('owner_id, source, status, failure_reason')
    .eq('id', noteId)
    .maybeSingle();
  if (error) throw error;
  return data as NoteState | null;
}

/** The answer for an uploadId that already has a note. */
async function answerExisting(noteId: string, note: NoteState, user: AuthedUser): Promise<Response> {
  if (note.owner_id !== user.id || note.source !== 'file') {
    throw new HttpError(403, 'not_yours', 'That upload id belongs to someone else. Choose the file again.');
  }
  if (note.status === 'ready') return json({ noteId, status: 'ready', chunks: await countChunks(noteId) });
  if (note.status === 'failed') {
    return json({ noteId, status: 'failed', chunks: 0, reason: note.failure_reason ?? FAILURE.serverError });
  }
  return json({ noteId, status: 'processing', chunks: 0 });
}

async function countChunks(noteId: string): Promise<number> {
  const { count, error } = await db.from('chunks').select('id', { count: 'exact', head: true }).eq('note_id', noteId);
  if (error) throw error;
  return count ?? 0;
}

async function removeChunks(noteId: string): Promise<void> {
  const { error } = await db.from('chunks').delete().eq('note_id', noteId);
  if (error) console.error('could not remove chunks of a failed note', error);
}

async function markFailed(noteId: string, reason: string): Promise<Response> {
  const { error } = await db.from('notes').update({ status: 'failed', failure_reason: reason }).eq('id', noteId);
  if (error) console.error('could not mark the note failed', error);
  return json({ noteId, status: 'failed', chunks: 0, reason });
}
