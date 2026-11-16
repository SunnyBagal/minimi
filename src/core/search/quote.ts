import type { ContainsQuote, NormalizeForQuote } from '../contracts';

/** Default to tune: a quote below this length is too generic to count as evidence. */
export const MIN_QUOTE_CHARS = 12;

// Curly single quotes and primes.
const SINGLE_QUOTES = /[\u2018\u2019\u201A\u201B\u2032]/g;
// Curly double quotes and primes.
const DOUBLE_QUOTES = /[\u201C\u201D\u201E\u201F\u2033]/g;
// Unicode dashes U+2010–U+2015 and minus U+2212.
const DASHES = /[\u2010-\u2015\u2212]/g;
// Non-breaking/figure spaces and zero-width chars.
const SPECIAL_SPACES = /[\u00A0\u202F\u2007\u200B\u200C\u200D\u2060\uFEFF]/g;
// Leading markdown marks per line: "## ", "> ", and combinations.
const LINE_MARKS = /^[ \t]*(?:[#>][ \t]*)+/gm;
// Markdown emphasis and code marks anywhere in the text.
const EMPHASIS = /[*_`]/g;

export const normalizeForQuote: NormalizeForQuote = (text) =>
  text
    .normalize('NFKC')
    .replace(SINGLE_QUOTES, "'")
    .replace(DOUBLE_QUOTES, '"')
    .replace(DASHES, '-')
    .replace(SPECIAL_SPACES, ' ')
    .replace(LINE_MARKS, '')
    .replace(EMPHASIS, '')
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .trim();

export const containsQuote: ContainsQuote = (haystack, quote) => {
  const wanted = normalizeForQuote(quote);
  return wanted.length >= MIN_QUOTE_CHARS && normalizeForQuote(haystack).includes(wanted);
};
