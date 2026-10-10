// Which questions a quiz asks. Pure code, tested with vitest.

export interface PickableQuestion {
  id: string;
  chunkId: string;
}

/**
 * Spread the quiz across the notes: one question from each chunk in turn,
 * then a second from each, and so on, until count is reached. Chunks and
 * the questions inside a chunk are sorted by id, so the same pool always
 * gives the same quiz (no randomness on the server, easy to test).
 */
export function pickQuestions(questions: readonly PickableQuestion[], count: number): string[] {
  const byChunk = new Map<string, Set<string>>();
  for (const { id, chunkId } of questions) {
    const ids = byChunk.get(chunkId) ?? new Set<string>();
    ids.add(id);
    byChunk.set(chunkId, ids);
  }
  const queues = [...byChunk.keys()]
    .sort()
    .map((chunkId) => [...byChunk.get(chunkId)!].sort());

  const picked: string[] = [];
  for (let round = 0; picked.length < count; round++) {
    let tookAny = false;
    for (const queue of queues) {
      if (picked.length >= count) break;
      if (round < queue.length) {
        picked.push(queue[round]);
        tookAny = true;
      }
    }
    if (!tookAny) break;
  }
  return picked;
}

/**
 * The server reads questions with the service role, which skips Row Level
 * Security. An exam shared with a group can have questions made from a
 * classmate's private note; this keeps only questions whose note the
 * caller could read themselves (own note, or note shared with one of
 * their groups), the same rule as the "questions: read with note" policy.
 */
export function visibleQuestions<Q extends { noteOwnerId: string; noteGroupId: string | null }>(
  questions: readonly Q[],
  userId: string,
  groupIds: ReadonlySet<string>,
): Q[] {
  return questions.filter(
    (row) => row.noteOwnerId === userId || (row.noteGroupId !== null && groupIds.has(row.noteGroupId)),
  );
}

/**
 * PostgREST "or" filter for the questions an exam quiz may use: questions
 * tagged with the exam, or made from a note linked to the exam. The second
 * part matters when a note is linked to an exam after its questions were
 * made, so questions.exam_id is still empty. Ids are checked UUIDs, so
 * they need no quoting.
 */
export function examQuestionFilter(examId: string, noteIds: readonly string[]): string {
  const byExam = `exam_id.eq.${examId}`;
  const unique = [...new Set(noteIds)].sort();
  return unique.length === 0 ? byExam : `${byExam},note_id.in.(${unique.join(',')})`;
}
