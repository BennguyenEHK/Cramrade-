import { describe, expect, it } from 'vitest';
import { topicTitlesInOrder } from './calendar-rows.ts';

describe('topicTitlesInOrder', () => {
  it('orders by position and drops repeats', () => {
    const rows = [
      { position: 2, questions: { topics: { title: 'Genes' } } },
      { position: 1, questions: { topics: { title: 'Cells' } } },
      { position: 3, questions: { topics: { title: 'Cells' } } },
    ];
    expect(topicTitlesInOrder(rows)).toEqual(['Cells', 'Genes']);
  });

  it('accepts embeds as arrays', () => {
    const rows = [{ position: 1, questions: [{ topics: [{ title: 'Cells' }] }] }];
    expect(topicTitlesInOrder(rows)).toEqual(['Cells']);
  });

  it('skips missing questions and topics', () => {
    const rows = [
      { position: 1, questions: null },
      { position: 2, questions: { topics: null } },
      { position: 3, questions: [] },
    ];
    expect(topicTitlesInOrder(rows)).toEqual([]);
  });
});
