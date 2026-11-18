'use client';

/**
 * The verdict table inside an answer. A long re-check would bury the summary
 * under the table, so past VERDICT_PREVIEW_ROWS rows it shows the first few
 * and a toggle that says how many rows there are and how many of each verdict.
 * Every row it shows is rendered by VerdictTable, unchanged.
 */
import { useState } from 'react';
import type { Verdict, VerdictRow } from '../../src/core/contracts';
import { VerdictTable } from './VerdictTable';

export const VERDICT_PREVIEW_ROWS = 4;

/** How many rows have each verdict. */
export function verdictCounts(rows: VerdictRow[]): Record<Verdict, number> {
  const counts: Record<Verdict, number> = { changed: 0, unchanged: 0, unverifiable: 0, source_unavailable: 0 };
  for (const row of rows) counts[row.check.verdict] += 1;
  return counts;
}

/** "1 changed, 9 unchanged, 1 unverifiable", plus source unavailable when there is any. */
export function countsLabel(counts: Record<Verdict, number>): string {
  const parts = [`${counts.changed} changed`, `${counts.unchanged} unchanged`, `${counts.unverifiable} unverifiable`];
  if (counts.source_unavailable > 0) parts.push(`${counts.source_unavailable} source unavailable`);
  return parts.join(', ');
}

export function VerdictBlock({ rows }: { rows: VerdictRow[] }) {
  const [open, setOpen] = useState(false);
  const collapsible = rows.length > VERDICT_PREVIEW_ROWS;
  const shown = collapsible && !open ? rows.slice(0, VERDICT_PREVIEW_ROWS) : rows;
  return (
    <div className="verdict-block">
      <VerdictTable rows={shown} />
      {collapsible ? (
        <button type="button" className="verdict-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
          <span className="verdict-toggle-action">{open ? 'Show fewer' : `Show all ${rows.length}`}</span>
          <span className="verdict-toggle-counts">{countsLabel(verdictCounts(rows))}</span>
        </button>
      ) : null}
    </div>
  );
}
