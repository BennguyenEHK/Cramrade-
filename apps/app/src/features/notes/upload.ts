import { fetch } from 'expo/fetch';
import type { DocumentPickerAsset } from 'expo-document-picker';
import { supabase } from '@/lib/supabase';
import { supabaseConfig } from '@/lib/supabase-config';
import { appendFile } from './picked-file';

export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

export async function uploadNotes(
  asset: DocumentPickerAsset,
  uploadId: string,
  signal: AbortSignal,
): Promise<string> {
  const {
    data: { session },
    error,
  } = await supabase.auth.getSession();
  if (error || !session) throw new Error('Sign in before uploading notes.');
  const form = new FormData();
  appendFile(form, asset);
  form.append('uploadId', uploadId);
  let response: Response;
  try {
    response = await fetch(`${supabaseConfig.url}/functions/v1/extract-text`, {
      method: 'POST',
      signal,
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        apikey: supabaseConfig.publishableKey,
      },
      body: form,
    });
  } catch {
    throw new Error(
      'Could not reach the upload service. Check your connection or try again later. Refresh your notes before retrying to check whether they saved.',
    );
  }
  if (response.status === 404)
    throw new Error('File uploads are not available on the server yet. Please try again later.');
  const result = (await response.json().catch(() => null)) as {
    error?: string;
    noteId?: string;
  } | null;
  if (!response.ok)
    throw new Error(result?.error ?? 'The upload could not finish. Please try again.');
  if (!result?.noteId)
    throw new Error(
      'The server did not confirm your upload. Refresh your notes before trying again.',
    );
  return result.noteId;
}
