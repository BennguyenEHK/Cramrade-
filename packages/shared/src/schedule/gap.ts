/**
 * Rule 2: days to wait before the same chunk comes back, given the days left
 * until the exam. About a fifth of the time left (Cepeda et al. 2008), daily in
 * the last week, never more than two weeks.
 */
export function gapDays(daysLeft: number): number {
  if (daysLeft <= 7) return 1;
  return Math.min(14, Math.max(1, Math.round(daysLeft * 0.2)));
}
