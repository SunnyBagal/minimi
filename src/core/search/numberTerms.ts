// These phrases name a completion goal or play style. Keep the list explicit
// so unrelated percentages and measured rates still need support.
const FIXED_NUMBER_TERMS = [
  String.raw`[ \t]+completion`,
  String.raw`[ \t]+complete`,
  String.raw`[ \t]+completionist`,
  String.raw`-?ing`,
  String.raw`[ \t]+run`,
  String.raw`[ \t]+playthrough`,
];

const PERCENT = '100%';
const FIXED_TERM = new RegExp(
  String.raw`(?<![\p{L}\p{N}\p{Sc}_+\-]|\d[.,])${PERCENT}(?:${FIXED_NUMBER_TERMS.join('|')})(?![\p{L}\p{N}_]|\*{0,2}[ \t]+rate\b)`,
  'giu',
);

/** Offsets of the percentages that belong to fixed terms in the raw text. */
export function fixedNumberTermStarts(text: string): Set<number> {
  return new Set(Array.from(text.matchAll(FIXED_TERM), (match) => match.index));
}

/** Blank only the fixed-term percentages so number scans keep their token boundaries. */
export function withoutFixedNumberTerms(text: string): string {
  return text.replace(FIXED_TERM, (term) => ' '.repeat(PERCENT.length) + term.slice(PERCENT.length));
}
