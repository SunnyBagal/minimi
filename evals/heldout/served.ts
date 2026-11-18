/**
 * Text a held-out turn actually served. Search-hit text is included only when
 * the pipeline would keep the hit: undated hits are dropped from a dated news
 * search, and a hit whose local publish date is before `publishedOnOrAfter`
 * is dropped. Fetch text is included only for an inline `{ text }` page that
 * was fetched. A timeout or a missing page contributes nothing.
 */
import { formatLocalDate } from '../assert';
import type { FixtureCall, FixtureScenario } from '../fixtureSearch';
import type { SearchResult } from '../../src/core/contracts';

/** Same match as `FixtureSearch.search`: first substring hit, then `numResults`. */
function hitsFor(scenario: FixtureScenario, query: string, numResults: number): SearchResult[] {
  const wanted = query.toLowerCase();
  const found = scenario.searches.find((entry) => wanted.includes(entry.match.toLowerCase()));
  return (found?.results ?? []).slice(0, numResults);
}

function kept(result: SearchResult, publishedOnOrAfter: string | null, tz: string): boolean {
  if (publishedOnOrAfter === null) return true;
  if (result.publishedAt === null) return false;
  return formatLocalDate(result.publishedAt, tz) >= publishedOnOrAfter;
}

export function servedEvidence(scenario: FixtureScenario, calls: readonly FixtureCall[], tz: string): string[] {
  const texts: string[] = [];
  for (const call of calls) {
    if (call.kind === 'search') {
      for (const result of hitsFor(scenario, call.query, call.numResults)) {
        if (kept(result, call.publishedOnOrAfter, tz)) texts.push(result.text);
      }
      continue;
    }
    const spec = scenario.pages[call.url];
    if (spec !== undefined && 'text' in spec) texts.push(spec.text);
  }
  return texts;
}
