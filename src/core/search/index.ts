// Lane 3 replaces this file. Every export name stays.
import type {
  AgentConfig,
  Clock,
  ContainsQuote,
  IsFirstParty,
  NormalizeForQuote,
  SearchProvider,
  ValidateAnswer,
} from '../contracts';
import { FakeSearch } from '../testing/fakes';

/** Until Lane 3 merges: a provider that finds nothing. `apiKey` and `config` are not used yet. */
export function createSearch(apiKey: string, clock: Clock, config: AgentConfig): SearchProvider {
  void apiKey;
  void config;
  return new FakeSearch(clock);
}

/** Trivial version: NFKC, collapsed whitespace, lowercase. */
export const normalizeForQuote: NormalizeForQuote = (text) =>
  text.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();

/** Trivial version: a non-empty quote found after normalizing both sides. */
export const containsQuote: ContainsQuote = (haystack, quote) => {
  const wanted = normalizeForQuote(quote);
  return wanted.length > 0 && normalizeForQuote(haystack).includes(wanted);
};

/** Trivial version: nothing is first-party, so nothing can take the fast path yet. */
export const isFirstParty: IsFirstParty = () => false;

/** Trivial version: flags nothing. */
export const validateAnswer: ValidateAnswer = () => ({ strippedCitations: [], uncitedNumbers: [] });
