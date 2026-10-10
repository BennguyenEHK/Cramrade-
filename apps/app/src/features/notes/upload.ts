import { fetch } from 'expo/fetch';
import type { DocumentPickerAsset } from 'expo-document-picker';
import { supabase } from '@/lib/supabase';
import { supabaseConfig } from '@/lib/supabase-config';
import { appendFile } from './picked-file';
import { readUploadResponse, type UploadResult } from './upload-response';

export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

export async function uploadNotes(
  asset: DocumentPickerAsset,
  uploadId: string,
  signal: AbortSignal,
  options: { examId: string | null; isSyllabus: boolean } = { examId: null, isSyllabus: false },
): Promise<UploadResult> {
  const {
    data: { session },
    error,
  } = await supabase.auth.getSession();
  if (error || !session) throw new Error('Sign in before uploading notes.');
  const form = new FormData();
  appendFile(form, asset);
  form.append('uploadId', uploadId);
  if (options.examId) form.append('examId', options.examId);
  form.append('isSyllabus', String(options.isSyllabus));
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
  return readUploadResponse(await response.json().catch(() => null), response.ok);
}
