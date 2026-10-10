import { describe, expect, it, vi } from 'vitest';
import { AiError } from './gemini.ts';
import { error, handle, HttpError, json, readJson, requireId } from './http.ts';

const post = (body: string) => new Request('http://x/fn', { method: 'POST', body });

describe('json and error', () => {
  it('answers JSON with CORS headers', async () => {
    const res = json({ chunks: 3 });
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.headers.get('Content-Type')).toBe('application/json');
    expect(await res.json()).toEqual({ chunks: 3 });
  });

  it('wraps errors as { error: { code, message } }', async () => {
    const res = error('not_found', 404, 'That note could not be found.');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: 'not_found', message: 'That note could not be found.' } });
  });
});

describe('readJson and requireId', () => {
  it('reads an object body', async () => {
    await expect(readJson(post('{"noteId":"x"}'))).resolves.toEqual({ noteId: 'x' });
  });

  it('refuses a body that is not a JSON object', async () => {
    await expect(readJson(post('nope'))).rejects.toMatchObject({ status: 400, code: 'bad_input' });
    await expect(readJson(post('[1]'))).rejects.toMatchObject({ status: 400 });
  });

  it('accepts a uuid and refuses anything else', () => {
    const id = '0b6f2a4e-6c1d-4a39-9d3e-1f2a3b4c5d6e';
    expect(requireId({ noteId: id }, 'noteId')).toBe(id);
    expect(() => requireId({ noteId: 'abc' }, 'noteId')).toThrow('noteId must be an id.');
    expect(() => requireId({}, 'noteId')).toThrow(HttpError);
  });
});

describe('handle', () => {
  it('answers OPTIONS without calling the handler', async () => {
    const fn = vi.fn();
    const res = await handle(fn)(new Request('http://x/fn', { method: 'OPTIONS' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Headers')).toContain('authorization');
    expect(fn).not.toHaveBeenCalled();
  });

  it('turns HttpError into its status, code and message', async () => {
    const res = await handle(async () => {
      throw new HttpError(403, 'not_yours', 'That note belongs to someone else.');
    })(post('{}'));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: { code: 'not_yours', message: 'That note belongs to someone else.' } });
  });

  it('turns AiError into 502 ai_failed and anything else into 500 internal', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const ai = await handle(async () => {
      throw new AiError('ai_bad_json', 'x');
    })(post('{}'));
    expect(ai.status).toBe(502);
    expect((await ai.json()).error.code).toBe('ai_failed');

    const boom = await handle(async () => {
      throw new Error('db down');
    })(post('{}'));
    expect(boom.status).toBe(500);
    expect((await boom.json()).error.code).toBe('internal');
  });
});
