import assert from 'node:assert/strict';
import { test } from 'node:test';
import { matchesAnswer } from './answers.ts';

test('short answers normalize whitespace and case without guessing new content', () => {
  assert.equal(matchesAnswer('  Solar\n ENERGY ', 'solar energy'), true);
  assert.equal(matchesAnswer('energy', 'solar energy'), false);
  assert.equal(matchesAnswer('42', '43'), false);
  assert.equal(matchesAnswer('carbon dioxide', 'carbon-dioxide'), false);
});
