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
