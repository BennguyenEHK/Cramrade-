export function quizPhase(
  startedAt: string | null,
  seconds: number,
  resultsSeconds: number,
  now: number,
) {
  if (!startedAt) return { phase: 'lobby' as const, secondsLeft: 0 };
  const answerEnd = Date.parse(startedAt) + seconds * 1000;
  const resultsEnd = answerEnd + resultsSeconds * 1000;
  if (now < answerEnd)
    return {
      phase: 'answering' as const,
      secondsLeft: Math.max(0, Math.ceil((answerEnd - now) / 1000)),
    };
  if (now < resultsEnd)
    return {
      phase: 'results' as const,
      secondsLeft: Math.max(0, Math.ceil((resultsEnd - now) / 1000)),
    };
  return { phase: 'advance' as const, secondsLeft: 0 };
}
