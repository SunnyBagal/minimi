import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Claim, Verdict, VerdictRow } from '../../src/core/contracts';
import { countsLabel, VERDICT_PREVIEW_ROWS, VerdictBlock, verdictCounts } from './VerdictBlock';

function row(index: number, verdict: Verdict): VerdictRow {
  const claim: Claim = {
    id: `claim-${index}`,
    turnId: 'turn-1',
    entity: `Entity${index}`,
    attribute: 'price',
    value: `${index} USD`,
    scope: {},
    sourceId: 'source-1',
    quote: 'quote',
    asOfUtc: '2026-11-09T05:05:00.000Z',
    volatility: 'high',
    lastVerifiedAtUtc: '2026-11-09T05:05:00.000Z',
    supersedesId: null,
  };
  return {
    claim,
    check: {
      id: `check-${index}`,
      claimId: claim.id,
      checkedAtUtc: '2026-11-16T04:30:00.000Z',
      verdict,
      newValue: null,
      newSourceId: null,
      newQuote: null,
      reason: 'reason',
      decidedBy: 'fast_path',
    },
    provenance: verdict === 'unchanged' || verdict === 'changed' ? 'verified_now' : 'could_not_verify',
    nowSource: null,
  };
}

const ELEVEN: VerdictRow[] = [
  row(1, 'changed'),
  ...Array.from({ length: 8 }, (_, index) => row(index + 2, 'unchanged')),
  row(10, 'unverifiable'),
  row(11, 'unverifiable'),
];

const render = (rows: VerdictRow[]) => renderToStaticMarkup(createElement(VerdictBlock, { rows }));
const dataRows = (html: string) => (html.match(/<tr data-verdict=/g) ?? []).length;

describe('VerdictBlock', () => {
  it('counts rows per verdict from the rows themselves', () => {
    expect(verdictCounts(ELEVEN)).toEqual({ changed: 1, unchanged: 8, unverifiable: 2, source_unavailable: 0 });
    expect(verdictCounts([])).toEqual({ changed: 0, unchanged: 0, unverifiable: 0, source_unavailable: 0 });
  });

  it('labels changed, unchanged and unverifiable, and source unavailable only when present', () => {
    expect(countsLabel(verdictCounts(ELEVEN))).toBe('1 changed, 8 unchanged, 2 unverifiable');
    expect(countsLabel(verdictCounts([row(1, 'source_unavailable')]))).toBe(
      '0 changed, 0 unchanged, 0 unverifiable, 1 source unavailable',
    );
  });

  it('collapses a long table to the first rows, with "Show all N" and the counts', () => {
    const html = render(ELEVEN);
    expect(dataRows(html)).toBe(VERDICT_PREVIEW_ROWS);
    expect(html).toContain('Show all 11');
    expect(html).toContain('1 changed, 8 unchanged, 2 unverifiable');
    expect(html).toContain('aria-expanded="false"');
    // The first rows, in order.
    expect(html.indexOf('Entity1 price')).toBeLessThan(html.indexOf('Entity4 price'));
    expect(html).not.toContain('Entity5 price');
  });

  it('shows a short table whole, with no toggle', () => {
    const html = render(ELEVEN.slice(0, VERDICT_PREVIEW_ROWS));
    expect(dataRows(html)).toBe(VERDICT_PREVIEW_ROWS);
    expect(html).not.toContain('Show all');
  });
});
