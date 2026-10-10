// Answers, errors and CORS for every function. No Deno-only API, so vitest
// can test it.
//
// Every error answer has the body { error: { code, message } }. The code is a
// short snake_case word the app can switch on; the message is a sentence a
// student can read. The codes are fixed by spec section 10:
//   400 bad_input, 401 not_signed_in, 403 guest_not_allowed or not_yours,
//   404 not_found, 409 a conflict word (for example too_late),
//   500 internal, 502 ai_failed.

import { AiError } from './gemini.ts';

/** The browser app calls functions from another origin, so every answer carries these. */
export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

/** Throw this anywhere inside a handler to answer with an error. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

/** A JSON answer with CORS headers. */
export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/** An error answer: { error: { code, message } }. */
export function error(code: string, status: number, message: string): Response {
  return json({ error: { code, message } }, status);
}

/** Read the request body as a JSON object, or throw a 400. */
export async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    if (body && typeof body === 'object' && !Array.isArray(body)) return body as Record<string, unknown>;
  } catch {
    // fall through to the 400 below
  }
  throw new HttpError(400, 'bad_input', 'Send a JSON object as the request body.');
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** body[field] as a row id, or throw a 400 naming the field. */
export function requireId(body: Record<string, unknown>, field: string): string {
  const value = body[field];
  if (typeof value !== 'string' || !UUID.test(value)) {
    throw new HttpError(400, 'bad_input', `${field} must be an id.`);
  }
  return value;
}

/**
 * Wrap a handler: answers the browser's OPTIONS check, turns HttpError and
 * AiError into proper answers, and anything else into a logged 500.
 */
export function handle(fn: (req: Request) => Promise<Response>): (req: Request) => Promise<Response> {
  return async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
    try {
      return await fn(req);
    } catch (e) {
      if (e instanceof HttpError) return error(e.code, e.status, e.message);
      if (e instanceof AiError) {
        console.error('AI call failed', e.code, e.message);
        return error('ai_failed', 502, 'The AI did not answer properly. Try again in a minute.');
      }
      console.error('unexpected error', e);
      return error('internal', 500, 'Something went wrong on the server. Try again in a moment.');
    }
  };
}
