'use client';

import type { SourceRef } from '../../src/core/contracts';
import type { ReactNode } from 'react';

type Citation = Omit<SourceRef, 'text'>;

function checkedLabel(ref: Citation): string {
  const when = new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(new Date(ref.fetchedAtUtc));
  return `checked ${when}`;
}

/**
 * Renders answer text with [n] citations as links and every number the flags
 * listed as uncited wrapped in a "not verified" mark.
 */
export function CitedText({
  text,
  citations,
  uncited,
}: {
  text: string;
  citations: Citation[];
  uncited: string[];
}) {
  const byN = new Map(citations.map((ref) => [ref.n, ref]));
  const parts: ReactNode[] = [];
  // Split on citations first, then mark uncited numbers inside each span.
  const chunks = text.split(/(\[\d+\])/g);
  chunks.forEach((chunk, index) => {
    const match = /^\[(\d+)\]$/.exec(chunk);
    const ref = match !== null ? byN.get(Number(match[1])) : undefined;
    if (ref !== undefined) {
      parts.push(
        <a key={index} href={ref.url} title={checkedLabel(ref)} style={{ margin: '0 1px' }}>
          [{ref.n}]
          <sup style={{ color: '#777', fontSize: 10 }}> {ref.live ? 'live' : 'cached'}</sup>
        </a>,
      );
      return;
    }
    parts.push(<MarkedNumbers key={index} text={chunk} uncited={uncited} offset={index} />);
  });
  return <span style={{ whiteSpace: 'pre-wrap' }}>{parts}</span>;
}

/** Marks each occurrence of an uncited number with a "not verified" note. */
function MarkedNumbers({ text, uncited, offset }: { text: string; uncited: string[]; offset: number }) {
  if (uncited.length === 0) return <>{text}</>;
  // Whole tokens only, so "24" does not mark inside "240" or "1.24".
  const pattern = new RegExp(`(?<![\\d.,])(${uncited.map(escapeRegExp).join('|')})(?![\\d])`, 'g');
  const parts: ReactNode[] = [];
  text.split(pattern).forEach((piece, index) => {
    if (uncited.includes(piece)) {
      parts.push(
        <mark key={`${offset}-${index}`} title="not verified">
          {piece}
          <small> (not verified)</small>
        </mark>,
      );
    } else if (piece !== '') {
      parts.push(piece);
    }
  });
  return <>{parts}</>;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
