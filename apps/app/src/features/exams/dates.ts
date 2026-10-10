/** Calendar dates must never be interpreted as UTC instants. */
export function dateOnly(date: Date): string {
  return `${date.getFullYear().toString().padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function parseDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1900 || year > 2100) return null;
  const date = new Date(year, month - 1, day, 12);
  return dateOnly(date) === value ? date : null;
}

export function formatDate(value: string): string {
  return parseDate(value)?.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) ?? value;
}
