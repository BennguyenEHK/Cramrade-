export type UploadResult = {
  noteId: string;
  status: 'ready' | 'processing' | 'failed';
  reason?: string;
};

export function readUploadResponse(body: unknown, ok: boolean): UploadResult {
  const value = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  if (!ok) {
    const error = value.error;
    const message =
      typeof error === 'string'
        ? error
        : error && typeof error === 'object' && 'message' in error
          ? error.message
          : null;
    throw new Error(
      typeof message === 'string' && message.trim()
        ? message
        : 'The upload could not finish. Please try again.',
    );
  }
  if (
    typeof value.noteId !== 'string' ||
    !value.noteId.trim() ||
    !['ready', 'processing', 'failed'].includes(String(value.status))
  ) {
    throw new Error(
      'The server did not confirm your upload. Refresh your notes before trying again.',
    );
  }
  return {
    noteId: value.noteId,
    status: value.status as UploadResult['status'],
    reason: typeof value.reason === 'string' ? value.reason : undefined,
  };
}
