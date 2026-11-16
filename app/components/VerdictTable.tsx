'use client';

import type { Provenance, VerdictRow } from '../../src/core/contracts';

const BADGE: Record<Provenance, string> = {
  verified_now: 'verified now',
  from_memory: 'from memory',
  could_not_verify: "couldn't verify",
};

function checkedAt(iso: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
}

/** Then-against-now table built from verdict rows only, never parsed text. */
export function VerdictTable({ rows }: { rows: VerdictRow[] }) {
  return (
    <table data-testid="verdicts" style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13, margin: '8px 0' }}>
      <thead>
        <tr>
          {['Claim', 'Then', 'Now', 'State', 'Why'].map((head) => (
            <th key={head} style={{ textAlign: 'left', borderBottom: '1px solid #ccc', padding: '4px 8px 4px 0' }}>
              {head}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          // A row that could not be verified shows no "now" value at all:
          // repeating the old value would read as verified.
          const nowValue =
            row.provenance === 'could_not_verify'
              ? '—'
              : row.check.verdict === 'changed'
                ? row.check.newValue
                : row.claim.value;
          return (
            <tr key={row.claim.id} data-verdict={row.check.verdict}>
              <td style={{ padding: '4px 8px 4px 0', verticalAlign: 'top' }}>
                {row.claim.entity} {row.claim.attribute}
              </td>
              <td style={{ padding: '4px 8px 4px 0', verticalAlign: 'top' }}>
                {row.claim.value}
                <div style={{ color: '#777' }}>as of {checkedAt(row.claim.asOfUtc)}</div>
              </td>
              <td style={{ padding: '4px 8px 4px 0', verticalAlign: 'top' }}>
                {nowValue}
                {row.provenance !== 'could_not_verify' && row.check.newQuote !== null ? (
                  <div style={{ color: '#777' }}>&ldquo;{row.check.newQuote}&rdquo;</div>
                ) : null}
                {row.nowSource !== null ? (
                  <div>
                    <a href={row.nowSource.url}>[{row.nowSource.n}]</a>{' '}
                    <span style={{ color: '#777' }}>{row.nowSource.live ? 'live' : 'cached'}</span>
                  </div>
                ) : null}
              </td>
              <td style={{ padding: '4px 8px 4px 0', verticalAlign: 'top' }}>{BADGE[row.provenance]}</td>
              <td style={{ padding: '4px 8px 4px 0', verticalAlign: 'top' }}>{row.check.reason}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
