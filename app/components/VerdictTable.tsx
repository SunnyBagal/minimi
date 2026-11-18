'use client';

import { claimLabel } from '../../src/core/claimLabel';
import type { Provenance, Verdict, VerdictRow } from '../../src/core/contracts';

const BADGE: Record<Provenance, string> = {
  verified_now: 'verified now',
  from_memory: 'from memory',
  could_not_verify: "couldn't verify",
};

const VERDICT: Record<Verdict, string> = {
  changed: 'changed',
  unchanged: 'unchanged',
  unverifiable: 'unverifiable',
  source_unavailable: 'source unavailable',
};

function checkedAt(iso: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
}

/** Then-against-now table built from verdict rows only, never parsed text. */
export function VerdictTable({ rows }: { rows: VerdictRow[] }) {
  return (
    <div className="table-wrap">
      <table data-testid="verdicts" className="verdicts">
        <thead>
          <tr>
            {['Claim', 'Then', 'Now', 'State', 'Why'].map((head) => (
              <th key={head} scope="col">
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
                <td className="verdict-claim">{claimLabel(row.claim)}</td>
                {/* data-label and the inner div let a phone show each row as a stacked, labelled block. */}
                <td data-label="Then">
                  <div className="cell">
                    {row.claim.value}
                    <div className="cell-note">as of {checkedAt(row.claim.asOfUtc)}</div>
                  </div>
                </td>
                <td data-label="Now">
                  <div className="cell">
                    <span className="verdict-now">{nowValue}</span>
                    {row.provenance !== 'could_not_verify' && row.check.newQuote !== null ? (
                      <div className="cell-note cell-quote">&ldquo;{row.check.newQuote}&rdquo;</div>
                    ) : null}
                    {row.nowSource !== null ? (
                      <div className="cell-source">
                        <a className="cite" href={row.nowSource.url} target="_blank" rel="noopener noreferrer">
                          [{row.nowSource.n}]
                        </a>{' '}
                        <span className="cell-note">{row.nowSource.live ? 'live' : 'search-index copy'}</span>
                      </div>
                    ) : null}
                  </div>
                </td>
                <td data-label="State">
                  <div className="cell">
                    <span className={`pill pill-${row.check.verdict}`} title={VERDICT[row.check.verdict]}>
                      {BADGE[row.provenance]}
                    </span>
                  </div>
                </td>
                <td data-label="Why" className="verdict-why">
                  <div className="cell">{row.check.reason}</div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
