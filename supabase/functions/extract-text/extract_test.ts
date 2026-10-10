import { strict as assert } from 'node:assert';
import { extractFile, chunkText, MAX_FILE_BYTES, UploadError } from './extract.ts';
import { pdfFixture, wordFixture } from './fixtures.ts';
import { handler } from './index.ts';

Deno.test('PDF extracts readable text', async () => {
  const text = (await extractFile('biology.pdf', pdfFixture())).join('');
  assert.match(text, /Mitochondria release energy/);
});
Deno.test('Word extracts paragraphs and decodes XML entities', async () => {
  assert.equal(
    (await extractFile('biology.docx', wordFixture())).join(''),
    'Cells & energy\nSecond paragraph.\n',
  );
});
Deno.test('Unicode text and Markdown retain exact source text across chunks', async () => {
  const text = 'x'.repeat(2999) + '🧬\n# Sinh học\nTế bào ' + 'é'.repeat(4000);
  const chunks = await extractFile('notes.md', new TextEncoder().encode(text));
  assert.equal(chunks.join(''), text);
  assert.ok(chunks.every((chunk) => chunk.length <= 3000 && !/[\uD800-\uDBFF]$/.test(chunk)));
  assert.deepEqual(chunkText(''), []);
});
Deno.test('empty, binary, unsupported and oversized inputs fail clearly', async () => {
  for (const [name, bytes] of [
    ['empty.txt', new Uint8Array()],
    ['binary.txt', new Uint8Array([0, 1, 2])],
    ['old.doc', new TextEncoder().encode('not a docx')],
    ['large.pdf', new Uint8Array(MAX_FILE_BYTES + 1)],
    ['fake.pdf', new TextEncoder().encode('not PDF')],
    ['bad.docx', new Uint8Array([1, 2, 3])],
    ['encoding.txt', new Uint8Array([255, 255])],
  ] as const)
    await assert.rejects(() => extractFile(name, bytes), UploadError);
});
Deno.test('PDF rejects blank pages and more than five pages', async () => {
  await assert.rejects(() => extractFile('scan.pdf', pdfFixture('')), /no selectable text/);
  await assert.rejects(() => extractFile('long.pdf', pdfFixture('Text', 6)), /at most 5/);
});
Deno.test('Word rejects oversized inflated XML and DTD declarations', async () => {
  await assert.rejects(
    () => extractFile('bomb.docx', wordFixture('a'.repeat(1024 * 1024 + 1))),
    /too large/,
  );
  await assert.rejects(
    () => extractFile('entity.docx', wordFixture('', '<!DOCTYPE document><document/>')),
    /unsupported XML/,
  );
});
Deno.test(
  'HTTP boundary handles CORS and rejects missing authentication before parsing',
  async () => {
    assert.equal(
      (await handler(new Request('http://localhost', { method: 'OPTIONS' }))).status,
      204,
    );
    assert.equal((await handler(new Request('http://localhost'))).status, 405);
    const response = await handler(
      new Request('http://localhost', { method: 'POST', body: 'invalid form' }),
    );
    assert.equal(response.status, 401);
  },
);

Deno.test('authenticated uploads save extracted chunks, with retry ID and owner JWT', async () => {
  const originalFetch = globalThis.fetch;
  const previousUrl = Deno.env.get('SUPABASE_URL');
  const previousKey = Deno.env.get('SUPABASE_ANON_KEY');
  Deno.env.set('SUPABASE_URL', 'http://test.invalid');
  Deno.env.set('SUPABASE_ANON_KEY', 'test-only-key');
  let guest = false;
  let unauthorized = false;
  let failSave = false;
  const saved: Record<string, unknown>[] = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith('/auth/v1/user')) {
      if (unauthorized) return Response.json({ message: 'Invalid JWT' }, { status: 401 });
      return Response.json({
        id: '11111111-1111-4111-8111-111111111111',
        is_anonymous: guest,
      });
    }
    if (url.endsWith('/rest/v1/rpc/save_uploaded_note')) {
      assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer test-token');
      saved.push(JSON.parse(String(init?.body)));
      if (failSave) return Response.json({ message: 'database unavailable' }, { status: 500 });
      return Response.json('33333333-3333-4333-8333-333333333333');
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  function request(name: string, bytes: Uint8Array) {
    const form = new FormData();
    form.append('file', new File([bytes as Uint8Array<ArrayBuffer>], name));
    form.append('uploadId', '33333333-3333-4333-8333-333333333333');
    return new Request('http://localhost/extract-text', {
      method: 'POST',
      headers: { Authorization: 'Bearer test-token' },
      body: form,
    });
  }
  try {
    assert.equal((await handler(request('biology.pdf', pdfFixture()))).status, 200);
    assert.match((saved[0].p_chunks as string[]).join(''), /Mitochondria/);
    assert.equal(saved[0].p_id, '33333333-3333-4333-8333-333333333333');
    assert.equal((await handler(request('biology.docx', wordFixture()))).status, 200);
    assert.match((saved[1].p_chunks as string[]).join(''), /Cells & energy/);
    assert.equal((await handler(request('broken.pdf', new Uint8Array([1])))).status, 422);
    assert.equal(saved.length, 2);
    guest = true;
    assert.equal((await handler(request('guest.pdf', pdfFixture()))).status, 403);
    guest = false;
    unauthorized = true;
    assert.equal((await handler(request('invalid.pdf', pdfFixture()))).status, 401);
    unauthorized = false;
    failSave = true;
    assert.equal((await handler(request('retry.pdf', pdfFixture()))).status, 503);
    assert.equal(saved.length, 3);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousUrl === undefined) Deno.env.delete('SUPABASE_URL');
    else Deno.env.set('SUPABASE_URL', previousUrl);
    if (previousKey === undefined) Deno.env.delete('SUPABASE_ANON_KEY');
    else Deno.env.set('SUPABASE_ANON_KEY', previousKey);
  }
});
