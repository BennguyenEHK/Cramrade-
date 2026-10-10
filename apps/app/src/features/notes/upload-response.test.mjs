import assert from 'node:assert/strict';
import test from 'node:test';
import { readUploadResponse } from './upload-response.ts';

test('a note ID alone never confirms successful extraction', () => {
  assert.throws(() => readUploadResponse({ noteId: 'note' }, true), /did not confirm/);
  assert.throws(() => readUploadResponse(null, true), /did not confirm/);
});

test('ready, processing and failed responses stay distinct', () => {
  for (const status of ['ready', 'processing', 'failed']) {
    const result = readUploadResponse({ noteId: 'note', status, reason: 'No readable text' }, true);
    assert.equal(result.status, status);
    assert.equal(result.noteId, 'note');
    assert.equal(result.reason, 'No readable text');
  }
});

test('structured backend errors show their message rather than an object', () => {
  assert.throws(
    () =>
      readUploadResponse({ error: { code: 'not_signed_in', message: 'Sign in first.' } }, false),
    /Sign in first/,
  );
  assert.throws(() => readUploadResponse({ error: 'Legacy error' }, false), /Legacy error/);
  assert.throws(() => readUploadResponse({ error: {} }, false), /could not finish/);
});
