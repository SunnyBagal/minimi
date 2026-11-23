/**
 * The words memory lookup compares, shared by the SQLite store and the in-memory
 * fake so both match the same way.
 *
 * Words of three letters or more, lowercased, plus the initials of every run of
 * three to five capitalised words. The initials let a full name and its acronym
 * meet in either direction: a question about "Grand Theft Auto VI" finds a turn
 * that said "GTA 6", and "GTA" finds a turn that spelled the name out.
 */

export const MIN_TERM_CHARS = 3;
const MIN_ACRONYM_WORDS = 3;
const MAX_ACRONYM_WORDS = 5;

/** Words of three letters or more, lowercased. */
export function terms(text: string): string[] {
  return text.toLowerCase().match(new RegExp(`[\\p{L}\\p{N}]{${MIN_TERM_CHARS},}`, 'gu')) ?? [];
}

/** Initials of each window of 3–5 consecutive capitalised words, lowercased: "Grand Theft Auto VI" → gta, gtav, tav. */
export function acronyms(text: string): string[] {
  const out = new Set<string>();
  // Runs of capitalised words separated only by spaces ("Grand Theft Auto VI").
  for (const run of text.match(/\p{Lu}[\p{L}\p{N}]*(?: +\p{Lu}[\p{L}\p{N}]*)*/gu) ?? []) {
    const initials = run
      .split(/ +/)
      .map((word) => word[0] ?? '')
      .join('')
      .toLowerCase();
    for (let size = MIN_ACRONYM_WORDS; size <= MAX_ACRONYM_WORDS; size += 1) {
      for (let start = 0; start + size <= initials.length; start += 1) out.add(initials.slice(start, start + size));
    }
  }
  return [...out];
}

/** The terms a text is matched on: its words and its capitalised-run initials. */
export function matchTerms(text: string): string[] {
  return [...new Set([...terms(text), ...acronyms(text)])];
}
