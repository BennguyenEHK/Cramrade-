// extract-text: turn an uploaded file into numbered chunks of text (task A4a).
//
// POST { noteId }  with the student's access token.
// The app has already created the note (source 'file', status 'processing')
// and uploaded the file to uploads/<user id>/<note id>/<file name>.
//
// Answers 200 with one of:
//   { status: 'ready',  chunks: n }
//   { status: 'failed', chunks: 0, reason }   (the reason is also saved on the note)
// Errors: 400 bad_input, 401 not_signed_in, 403 guest_not_allowed or
// not_yours, 404 not_found.
//
// The uploaded file is deleted on every path. Calling again for a note that
// already has chunks changes nothing and answers with the same count.

import { requireFullUser } from '../_shared/auth.ts';
import { toChunks } from '../_shared/chunking.ts';
import { db } from '../_shared/db.ts';
import { FAILURE } from '../_shared/extraction.ts';
import { handle, HttpError, json, readJson, requireId } from '../_shared/http.ts';
import { invokeInBackground } from '../_shared/invoke.ts';
import { extractFileText } from './parse.ts';

const BUCKET = 'uploads';

Deno.serve(
  handle(async (req) => {
    if (req.method !== 'POST') throw new HttpError(400, 'bad_input', 'Use POST.');
    const user = await requireFullUser(req);
    const noteId = requireId(await readJson(req), 'noteId');

    const { data: note, error } = await db
      .from('notes')
      .select('id, owner_id, source, status, is_syllabus')
      .eq('id', noteId)
      .maybeSingle();
    if (error) throw error;
    if (!note) throw new HttpError(404, 'not_found', 'That note could not be found.');
    if (note.owner_id !== user.id) throw new HttpError(403, 'not_yours', 'That note belongs to someone else.');
    if (note.source !== 'file') throw new HttpError(400, 'bad_input', 'That note was not uploaded as a file.');

    const folder = `${user.id}/${noteId}`;
    try {
      // Safe to call again: chunks already there means the work is done.
      const existing = await countChunks(noteId);
      if (existing > 0) {
        if (note.status !== 'ready') await markReady(noteId);
        return json({ status: 'ready', chunks: existing });
      }

      const files = await listFolder(folder);
      if (files.length === 0) return await markFailed(noteId, FAILURE.missing);
      const newest = files[0];

      const { data: blob, error: downloadError } = await db.storage.from(BUCKET).download(`${folder}/${newest.name}`);
      if (downloadError || !blob) return await markFailed(noteId, FAILURE.missing);

      const parsed = await extractFileText(new Uint8Array(await blob.arrayBuffer()), newest.name, newest.mimetype);
      if (!parsed.ok) return await markFailed(noteId, parsed.reason);

      const chunks = toChunks(parsed.text);
      if (chunks.length === 0) return await markFailed(noteId, FAILURE.noText);

      const { error: insertError } = await db
        .from('chunks')
        .insert(chunks.map((text, position) => ({ note_id: noteId, position, text })));
      if (insertError) {
        // 23505 (unique note_id + position): a call running at the same time inserted them first.
        if (insertError.code === '23505') return json({ status: 'ready', chunks: await countChunks(noteId) });
        throw insertError;
      }
      await markReady(noteId);

      // A syllabus goes to read-syllabus (the app calls it). Notes get questions.
      if (!note.is_syllabus) invokeInBackground('make-questions', { noteId });
      return json({ status: 'ready', chunks: chunks.length });
    } catch (e) {
      console.error('extract-text failed', e);
      return await markFailed(noteId, FAILURE.serverError);
    } finally {
      // Product rule: only text is stored. The file goes on every path.
      await removeFolder(folder);
    }
  }),
);

async function countChunks(noteId: string): Promise<number> {
  const { count, error } = await db.from('chunks').select('id', { count: 'exact', head: true }).eq('note_id', noteId);
  if (error) throw error;
  return count ?? 0;
}

interface StoredFile {
  name: string;
  mimetype: string | null;
}

/** Files (not sub-folders) in the note's upload folder, newest first. */
async function listFolder(folder: string): Promise<StoredFile[]> {
  const { data, error } = await db.storage
    .from(BUCKET)
    .list(folder, { limit: 100, sortBy: { column: 'created_at', order: 'desc' } });
  if (error) throw error;
  return (data ?? [])
    .filter((f) => f.id !== null)
    .map((f) => ({ name: f.name, mimetype: (f.metadata?.mimetype as string | undefined) ?? null }));
}

async function removeFolder(folder: string): Promise<void> {
  try {
    const files = await listFolder(folder);
    if (files.length === 0) return;
    const { error } = await db.storage.from(BUCKET).remove(files.map((f) => `${folder}/${f.name}`));
    if (error) console.error(`could not delete uploads in ${folder}`, error);
  } catch (e) {
    console.error(`could not delete uploads in ${folder}`, e);
  }
}

async function markReady(noteId: string): Promise<void> {
  const { error } = await db.from('notes').update({ status: 'ready', failure_reason: null }).eq('id', noteId);
  if (error) throw error;
}

async function markFailed(noteId: string, reason: string): Promise<Response> {
  const { error } = await db.from('notes').update({ status: 'failed', failure_reason: reason }).eq('id', noteId);
  if (error) console.error('could not mark the note failed', error);
  return json({ status: 'failed', chunks: 0, reason });
}
import { createClient } from '@supabase/supabase-js';
import { extractFile, MAX_FILE_BYTES, UploadError } from './extract.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

/** Bound the body while streaming, even when Content-Length is absent or false. */
async function readForm(request: Request): Promise<FormData> {
  const limit = MAX_FILE_BYTES + 64 * 1024;
  if (Number(request.headers.get('content-length')) > limit)
    throw new UploadError('Choose a file smaller than 4 MB.', 413);
  if (!request.headers.get('content-type')?.startsWith('multipart/form-data'))
    throw new UploadError('Send a file using multipart/form-data.', 400);
  const reader = request.body?.getReader();
  if (!reader) throw new UploadError('Choose a file to upload.', 400);
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) {
        await reader.cancel();
        throw new UploadError('Choose a file smaller than 4 MB.', 413);
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
    return await new Response(body, {
      headers: { 'Content-Type': request.headers.get('content-type')! },
    }).formData();
  } catch {
    throw new UploadError('The upload was incomplete. Choose the file and try again.', 400);
  }
}

export async function handler(request: Request): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (request.method !== 'POST') return json({ error: 'Use POST to upload a file.' }, 405);
  const authorization = request.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer '))
    return json({ error: 'Sign in before uploading notes.' }, 401);
  try {
    // Use the student's JWT and RLS throughout. No service-role access is needed.
    const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const {
      data: { user },
      error: authError,
    } = await client.auth.getUser(authorization.slice(7));
    if (authError || !user) return json({ error: 'Your sign-in has expired. Sign in again.' }, 401);
    if (user.is_anonymous) return json({ error: 'Create an account before uploading notes.' }, 403);
    const form = await readForm(request);
    const file = form.get('file');
    const id = form.get('uploadId');
    if (!(file instanceof File) || form.getAll('file').length !== 1)
      throw new UploadError('Choose exactly one file.', 400);
    if (
      typeof id !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
    )
      throw new UploadError('The upload identifier is invalid. Choose the file again.', 400);
    const filename = file.name.split(/[\\/]/).pop() ?? '';
    if (!filename || filename.length > 255)
      throw new UploadError('Use a filename with 1 to 255 characters.', 400);
    const chunks = await extractFile(filename, new Uint8Array(await file.arrayBuffer()));
    const title =
      filename
        .replace(/\.[^.]+$/, '')
        .trim()
        .slice(0, 120) || 'Uploaded notes';
    const { data: noteId, error } = await client.rpc('save_uploaded_note', {
      p_id: id,
      p_title: title,
      p_filename: filename,
      p_chunks: chunks,
    });
    if (error)
      return json(
        {
          error: 'Could not save your notes. Retry the upload; it will not create a duplicate.',
        },
        503,
      );
    return json({ noteId });
  } catch (error) {
    if (error instanceof UploadError) return json({ error: error.message }, error.status);
    return json({ error: 'The upload could not finish. Try again in a moment.' }, 500);
  }
}

if (import.meta.main) Deno.serve(handler);
