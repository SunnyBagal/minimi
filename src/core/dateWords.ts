/**
 * A resolved calendar date (YYYY-MM-DD) in words, for lines the pipeline
 * builds in code. String formatting only: the date was already resolved by
 * the time functions, so no calendar arithmetic happens here.
 */
import type { LocalDate } from './contracts';

const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** "2026-11-03" → "3 Nov 2026", or "3 November 2026" with `long`. */
export function dateWords(date: LocalDate, style: 'short' | 'long' = 'short'): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (match === null) return date;
  const [, year, month, day] = match;
  const names = style === 'long' ? LONG : SHORT;
  const name = names[Number(month) - 1];
  if (name === undefined) return date;
  return `${Number(day)} ${name} ${year}`;
}

/** "a", "a or b", "a, b or c". */
export function orList(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} or ${items.at(-1) ?? ''}`;
}
