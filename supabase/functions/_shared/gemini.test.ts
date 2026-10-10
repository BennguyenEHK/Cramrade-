import { describe, expect, it, vi } from 'vitest';
import { AiError, callGemini, type GeminiRequest } from './gemini.ts';

/** A Gemini answer whose text is the given string. */
function answer(text: string, finishReason = 'STOP'): Response {
  return new Response(JSON.stringify({ candidates: [{ finishReason, content: { parts: [{ text }] } }] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function request(fetchFn: typeof fetch, extra: Partial<GeminiRequest> = {}): GeminiRequest {
  return {
    apiKey: 'test-key',
    model: 'gemini-2.5-flash',
    prompt: 'Say hi as JSON',
    schema: { type: 'OBJECT' },
    temperature: 0.2,
    retryDelayMs: 0,
    fetchFn,
    ...extra,
  };
}

async function failure(promise: Promise<unknown>): Promise<AiError> {
  try {
    await promise;
  } catch (e) {
    if (e instanceof AiError) return e;
    throw e;
  }
  throw new Error('expected an AiError');
}

describe('callGemini', () => {
  it('sends the prompt, key, schema and temperature, and parses the JSON answer', async () => {
    const fetchFn = vi.fn(async () => answer('{"hi":"there"}'));
    await expect(callGemini(request(fetchFn as unknown as typeof fetch))).resolves.toEqual({ hi: 'there' });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=test-key',
    );
    const body = JSON.parse(init.body as string);
    expect(body.contents[0].parts[0].text).toBe('Say hi as JSON');
    expect(body.generationConfig).toEqual({
      temperature: 0.2,
      responseMimeType: 'application/json',
      responseSchema: { type: 'OBJECT' },
    });
  });

  it('retries once after a network error', async () => {
    const fetchFn = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('connection reset'))
      .mockResolvedValueOnce(answer('{"ok":true}'));
    await expect(callGemini(request(fetchFn))).resolves.toEqual({ ok: true });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('never puts the key in an error message', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new TypeError('error sending request for url (...?key=test-key)'));
    const err = await failure(callGemini(request(fetchFn)));
    expect(err.message).not.toContain('test-key');
    expect(err.message).toContain('[key]');
  });

  it('gives up after two network errors', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new TypeError('offline'));
    expect((await failure(callGemini(request(fetchFn)))).code).toBe('ai_network');
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('retries once on 503, not on 400', async () => {
    const busy = vi
      .fn()
      .mockResolvedValueOnce(new Response('overloaded', { status: 503 }))
      .mockResolvedValueOnce(answer('{"ok":1}'));
    await expect(callGemini(request(busy))).resolves.toEqual({ ok: 1 });

    const bad = vi.fn().mockResolvedValue(new Response('bad schema', { status: 400 }));
    const err = await failure(callGemini(request(bad)));
    expect(err.code).toBe('ai_http');
    expect(err.status).toBe(400);
    expect(bad).toHaveBeenCalledTimes(1);
  });

  it('times out each attempt and reports ai_timeout', async () => {
    const hang = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
    );
    const err = await failure(callGemini(request(hang as unknown as typeof fetch, { timeoutMs: 20 })));
    expect(err.code).toBe('ai_timeout');
    expect(hang).toHaveBeenCalledTimes(2);
  });

  it('does not retry an answer that is not JSON', async () => {
    const fetchFn = vi.fn(async () => answer('not json'));
    expect((await failure(callGemini(request(fetchFn as unknown as typeof fetch)))).code).toBe('ai_bad_json');
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('reports a refused prompt, a safety stop and an empty answer', async () => {
    const refused = vi.fn(async () => new Response(JSON.stringify({ promptFeedback: { blockReason: 'SAFETY' } })));
    expect((await failure(callGemini(request(refused as unknown as typeof fetch)))).code).toBe('ai_blocked');

    const stopped = vi.fn(async () => answer('{}', 'SAFETY'));
    expect((await failure(callGemini(request(stopped as unknown as typeof fetch)))).code).toBe('ai_blocked');

    const empty = vi.fn(async () => answer('  '));
    expect((await failure(callGemini(request(empty as unknown as typeof fetch)))).code).toBe('ai_empty');
  });
});
