// Entry module for search + evidence checks. The export names are fixed:
// src/compose.ts imports createSearch; lanes import the pure functions here.
import type { AgentConfig, Clock, SearchProvider } from '../contracts';
import { createExaSearch } from './exa';

export function createSearch(apiKey: string, clock: Clock, config: AgentConfig): SearchProvider {
  return createExaSearch(apiKey, clock, config);
}

export { normalizeForQuote, containsQuote, MIN_QUOTE_CHARS } from './quote';
export { isFirstParty } from './firstParty';
export { validateAnswer } from './validate';
