// Pure helper for calendar-feed: turns the embedded session rows into topic
// titles. supabase-js types an embedded relation as an array, but a
// many-to-one embed arrives as one object at runtime, so both are accepted.

type OneOrMany<T> = T | T[] | null | undefined;

export interface SessionQuestionRow {
  position: number;
  questions: OneOrMany<{ topics: OneOrMany<{ title: string }> }>;
}

function asList<T>(value: OneOrMany<T>): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

/** Topic titles in question order, each title once. */
export function topicTitlesInOrder(rows: SessionQuestionRow[]): string[] {
  const titles = [...rows]
    .sort((a, b) => a.position - b.position)
    .flatMap((row) => asList(row.questions))
    .flatMap((question) => asList(question.topics))
    .map((topic) => topic.title)
    .filter((title) => Boolean(title));
  return [...new Set(titles)];
}
