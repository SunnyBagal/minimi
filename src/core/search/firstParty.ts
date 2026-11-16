import type { IsFirstParty } from '../contracts';

// Common second-level public suffixes: when labels[n-2] is one of these and
// the last label is a two-letter ccTLD, the registered name sits one level up.
const SECOND_LEVEL_SUFFIXES = new Set(['co', 'com', 'org', 'net', 'ac', 'gov']);

/** Letters and digits only, lowercased — "Basalt DB" -> "basaltdb". */
function slug(text: string): string {
  return text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

/**
 * True when the registered name of the host (the label directly left of the
 * public suffix) equals the entity slug, or the slug of its first word when
 * that word has four or more letters. Errs towards false on purpose: a wrong
 * "not first-party" costs one judge call; a wrong "first-party" can produce a
 * false `unchanged` verdict.
 */
export const isFirstParty: IsFirstParty = (url, entity) => {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (host.startsWith('www.')) host = host.slice(4);

  const labels = host.split('.');
  const n = labels.length;
  if (n < 2) return false;

  let label = labels[n - 2] ?? '';
  if (SECOND_LEVEL_SUFFIXES.has(label) && (labels[n - 1]?.length === 2) && n >= 3) {
    label = labels[n - 3] ?? '';
  }
  if (label === '') return false;

  const entitySlug = slug(entity);
  const firstWord = slug(entity.trim().split(/\s+/)[0] ?? '');
  if (entitySlug !== '' && label === entitySlug) return true;
  return firstWord.length >= 4 && label === firstWord;
};
