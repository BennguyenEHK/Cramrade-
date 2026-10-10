import assert from 'node:assert/strict';
import { test } from 'node:test';
import { quizPhase } from './clock.ts';

test('quiz phases change at the server deadlines, including a suspended tab', () => {
  const start = '2026-10-10T18:00:00Z';
  const time = Date.parse(start);
  assert.deepEqual(quizPhase(null, 20, 5, time), { phase: 'lobby', secondsLeft: 0 });
  assert.deepEqual(quizPhase(start, 20, 5, time), { phase: 'answering', secondsLeft: 20 });
  assert.deepEqual(quizPhase(start, 20, 5, time + 19999), { phase: 'answering', secondsLeft: 1 });
  assert.deepEqual(quizPhase(start, 20, 5, time + 20000), { phase: 'results', secondsLeft: 5 });
  assert.deepEqual(quizPhase(start, 20, 5, time + 24999), { phase: 'results', secondsLeft: 1 });
  assert.deepEqual(quizPhase(start, 20, 5, time + 25000), { phase: 'advance', secondsLeft: 0 });
  assert.deepEqual(quizPhase(start, 20, 5, time + 60000), { phase: 'advance', secondsLeft: 0 });
});
