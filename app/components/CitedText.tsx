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

// Same sentence rule as validateAnswer: a citation covers a number when it
// sits between the number and the end of its sentence, or right after the
// sentence's terminator.
const SENTENCE_END = /[.!?](?=\s|$)|\n/;
const TRAILING_CITATIONS = /^(?:[ \t]*\[\d+\])+/;

interface Piece {
  start: number;
  end: number;
  ref?: Citation;
}

function sentenceEnd(text: string, from: number): number {
  const terminator = SENTENCE_END.exec(text.slice(from));
  if (terminator === null) return text.length;
  const end = from + terminator.index + 1;
  return end + (TRAILING_CITATIONS.exec(text.slice(end))?.[0].length ?? 0);
}

/**
 * The linked citations, plus each occurrence of a flagged number that no
 * citation in its sentence covers, in text order. A number the flags list
 * can also appear elsewhere with a citation; that occurrence is not marked.
 */
function piecesOf(text: string, byN: Map<number, Citation>, uncited: string[]): Piece[] {
  const links: Piece[] = [];
  for (const match of text.matchAll(/\[(\d+)\]/g)) {
    const ref = byN.get(Number(match[1]));
    if (ref !== undefined) links.push({ start: match.index, end: match.index + match[0].length, ref });
  }
  if (uncited.length === 0) return links;
  // Whole tokens only, so "24" does not mark inside "240" or "1.24".
  const pattern = new RegExp(`(?<![\\d.,])(${uncited.map(escapeRegExp).join('|')})(?![\\d])`, 'g');
  const marks: Piece[] = [];
  for (const match of text.matchAll(pattern)) {
    const start = match.index;
    const end = start + match[0].length;
    if (links.some((link) => start >= link.start && start < link.end)) continue;
    const windowEnd = sentenceEnd(text, end);
    if (links.some((link) => link.start >= end && link.start < windowEnd)) continue;
    marks.push({ start, end });
  }
  return [...links, ...marks].sort((a, b) => a.start - b.start);
}

/**
 * Renders answer text with [n] citations as links and each uncited
 * occurrence of a number the flags listed wrapped in a "not verified" mark.
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
  let at = 0;
  for (const piece of piecesOf(text, byN, uncited)) {
    if (piece.start > at) parts.push(text.slice(at, piece.start));
    const key = piece.start;
    if (piece.ref !== undefined) {
      parts.push(
        <a key={key} href={piece.ref.url} title={checkedLabel(piece.ref)} style={{ margin: '0 1px' }}>
          [{piece.ref.n}]
          <sup style={{ color: '#777', fontSize: 10 }}> {piece.ref.live ? 'live' : 'cached'}</sup>
        </a>,
      );
    } else {
      parts.push(
        <mark key={key} title="not verified">
          {text.slice(piece.start, piece.end)}
          <small> (not verified)</small>
        </mark>,
      );
    }
    at = piece.end;
  }
  if (at < text.length) parts.push(text.slice(at));
  return <span style={{ whiteSpace: 'pre-wrap' }}>{parts}</span>;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
