import { supabase } from './supabase';

/** Keep the server's useful failure message, including non-2xx responses. */
export async function invoke<T>(name: string, body: object): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    const response = error.context;
    if (response instanceof Response) {
      const details = await response.json().catch(() => null);
      if (details?.error?.message) throw new Error(details.error.message);
    }
    throw new Error(error.message || 'Could not reach the server. Try again.');
  }
  if (data?.error) throw new Error(data.error.message || 'The request failed. Try again.');
  return data as T;
}

export function errorMessage(cause: unknown): string {
  return cause instanceof Error
    ? cause.message
    : 'Could not save your changes. Check your connection and try again.';
}
