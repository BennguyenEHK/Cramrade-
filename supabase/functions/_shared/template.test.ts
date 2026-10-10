import { describe, expect, it } from 'vitest';
import { fillPrompt } from './template.ts';

describe('fillPrompt', () => {
  it('fills string placeholders, with or without inner spaces', () => {
    expect(fillPrompt('Today is {{today}}. {{ name }}!', { today: '2026-10-10', name: 'Hi' })).toBe(
      'Today is 2026-10-10. Hi!',
    );
  });
  it('writes non-strings as JSON', () => {
    expect(fillPrompt('{{n}} {{list}}', { n: 3, list: ['a'] })).toBe('3 [\n  "a"\n]');
  });
  it('throws on a placeholder with no value', () => {
    expect(() => fillPrompt('{{missing}}', {})).toThrow('{{missing}}');
  });
  it('does not re-read placeholders inside inserted text', () => {
    expect(fillPrompt('{{a}}', { a: '{{b}}' })).toBe('{{b}}');
  });
});
