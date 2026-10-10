import assert from 'node:assert/strict';
import { test } from 'node:test';
// Node runs the date helpers directly with type stripping.
import { dateOnly, parseDate } from './dates.ts';

test('calendar dates reject rollover and invalid formats', () => {
  for (const date of ['2026-02-29', '2026-04-31', '2026-00-01', '2026-13-01', '2026-1-01', '', '2101-01-01']) {
    assert.equal(parseDate(date), null, date);
  }
  for (const date of ['2028-02-29', '2026-12-31', '2026-03-08', '2026-11-01']) {
    assert.equal(dateOnly(parseDate(date)), date);
  }
});

