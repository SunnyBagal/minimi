import { describe, expect, expectTypeOf, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Claim, Check, SourceRef, VerdictRow } from '../../src/core/contracts';
import { VerdictTable } from './VerdictTable';

const claimBase: Claim = {
  id: 'claim-1',
  turnId: 'turn-1',
  entity: 'Neon',
  attribute: 'price',
  value: '19 USD/month',
  scope: {},
  sourceId: 'source-1',
  quote: 'costs 19 USD per month',
  asOfUtc: '2026-11-09T05:05:00.000Z',
  volatility: 'high',
  lastVerifiedAtUtc: '2026-11-09T05:05:00.000Z',
  supersedesId: null,
};

const nowSource: SourceRef = {
  n: 1,
  sourceId: 'source-2',
  url: 'https://neon.test/pricing',
  title: null,
  fetchedAtUtc: '2026-11-16T04:30:00.000Z',
  live: true,
  firstParty: true,
  text: 'page text',
};

function row(check: Partial<Check>, provenance: VerdictRow['provenance'], source: SourceRef | null = nowSource): VerdictRow {
  return {
    claim: claimBase,
    check: {
      id: 'check-1',
      claimId: 'claim-1',
      checkedAtUtc: '2026-11-16T04:30:00.000Z',
      verdict: 'unchanged',
      newValue: null,
      newSourceId: null,
      newQuote: null,
      reason: 'Looks the same.',
      decidedBy: 'fast_path',
      ...check,
    },
    provenance,
    nowSource: source,
  };
}

describe('VerdictTable', () => {
  it('takes exactly { rows: VerdictRow[] }', () => {
    expectTypeOf<Parameters<typeof VerdictTable>[0]>().toEqualTypeOf<{ rows: VerdictRow[] }>();
  });

  it('renders a changed row with then/now values, badge and link', () => {
    const html = renderToStaticMarkup(
      VerdictTable({
        rows: [
          row(
            { verdict: 'changed', newValue: '24 USD/month', newQuote: 'costs 24 USD per month', reason: 'The price rose.' },
            'verified_now',
          ),
        ],
      }),
    );
    expect(html).toContain('Neon');
    expect(html).toContain('19 USD/month');
    expect(html).toContain('24 USD/month');
    expect(html).toContain('verified now');
    expect(html).toContain('https://neon.test/pricing');
    expect(html).toContain('The price rose.');
  });

  it('renders an unchanged row keeping the old value', () => {
    const html = renderToStaticMarkup(VerdictTable({ rows: [row({ verdict: 'unchanged' }, 'verified_now')] }));
    expect(html).toContain('19 USD/month');
    expect(html).not.toContain('24 USD/month');
  });

  it('renders a could_not_verify row without a source link', () => {
    const html = renderToStaticMarkup(
      VerdictTable({ rows: [row({ verdict: 'unverifiable', reason: 'No quote on the page.' }, 'could_not_verify', null)] }),
    );
    expect(html).toContain("couldn&#x27;t verify");
    expect(html).toContain('No quote on the page.');
  });

  it('a could_not_verify row shows a dash in the Now column, not the old value', () => {
    const html = renderToStaticMarkup(
      VerdictTable({ rows: [row({ verdict: 'unverifiable', reason: 'No quote.' }, 'could_not_verify', null)] }),
    );
    // The old value appears once (in Then) and never again as "now".
    expect(html.match(/19 USD\/month/g)).toHaveLength(1);
    expect(html).toContain('—');
    expect(html).not.toContain('href="https://neon.test/pricing"');
  });
});
