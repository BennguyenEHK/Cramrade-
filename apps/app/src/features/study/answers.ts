/** Short answers are exact after case and whitespace normalization, never graded by AI. */
export function matchesAnswer(answer: string, expected: string): boolean {
  const normalize = (text: string) => text.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
  return normalize(answer) === normalize(expected);
}
