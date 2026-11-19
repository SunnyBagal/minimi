'use client';

import type { SourceRef } from '../../src/core/contracts';
import { fixedNumberTermStarts } from '../../src/core/search/numberTerms';
import type { ReactNode } from 'react';

export type Citation = Omit<SourceRef, 'text'>;

export function checkedLabel(ref: Citation): string {
  const when = new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(new Date(ref.fetchedAtUtc));
  return `checked ${when}`;
}

// Same sentence rule as validateAnswer: a citation covers a number when it
// sits between the number and the end of its sentence, or right after the
// sentence's terminator. SENTENCE_END and TRAILING_CITATIONS are copied from
// src/core/search/validate.ts; keep them in step.
const SENTENCE_END = /[.!?](?=\s|$)|\n/;
const TRAILING_CITATIONS = /^(?:[ \t]*\[\d+\])+/;

/** A span of the raw answer text: a linked citation (with `ref`) or an uncited number mark. */
export interface Piece {
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
 * Offsets are into the raw text, so the markdown renderer can carry them.
 */
export function piecesOf(text: string, byN: Map<number, Citation>, uncited: string[]): Piece[] {
  const links: Piece[] = [];
  for (const match of text.matchAll(/\[(\d+)\]/g)) {
    const ref = byN.get(Number(match[1]));
    if (ref !== undefined) links.push({ start: match.index, end: match.index + match[0].length, ref });
  }
  if (uncited.length === 0) return links;
  // Whole tokens only, so "24" does not mark inside "240" or "1.24".
  const pattern = new RegExp(`(?<![\\d.,])(${uncited.map(escapeRegExp).join('|')})(?![\\d])`, 'g');
  const fixedTerms = fixedNumberTermStarts(text);
  const marks: Piece[] = [];
  for (const match of text.matchAll(pattern)) {
    const start = match.index;
    if (fixedTerms.has(start)) continue;
    const end = start + match[0].length;
    if (links.some((link) => start >= link.start && start < link.end)) continue;
    const windowEnd = sentenceEnd(text, end);
    if (links.some((link) => link.start >= end && link.start < windowEnd)) continue;
    marks.push({ start, end });
  }
  return [...links, ...marks].sort((a, b) => a.start - b.start);
}

/** How the source's text was obtained, in plain words, for the tooltip. */
export function stateLabel(ref: Citation): string {
  return ref.live ? 'fetched live' : 'cached copy from the search index';
}

/** "checked 20:26 GMT+5:30 · fetched live" */
export function citationTip(ref: Citation): string {
  return `${checkedLabel(ref)} · ${stateLabel(ref)}`;
}

/**
 * An inline [n] citation: a small chip that shows only [n] and links to the
 * source. When it was checked and whether it was live is in the tooltip (title,
 * and a CSS tooltip on hover and focus) and in the accessible name.
 */
export function CitationLink({ citation }: { citation: Citation }) {
  const tip = citationTip(citation);
  const title = citation.title !== null && citation.title !== '' ? `: ${citation.title}` : '';
  return (
    <a
      className="cite"
      href={citation.url}
      title={tip}
      data-tip={tip}
      aria-label={`Source ${citation.n}${title}, ${tip}`}
      target="_blank"
      rel="noopener noreferrer"
    >
      [{citation.n}]
    </a>
  );
}

/** A number the answer states without a citation that covers it. */
export function UncitedMark({ children }: { children: ReactNode }) {
  return (
    <mark className="uncited" title="not verified">
      {children}
      <small> (not verified)</small>
    </mark>
  );
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
      parts.push(<CitationLink key={key} citation={piece.ref} />);
    } else {
      parts.push(<UncitedMark key={key}>{text.slice(piece.start, piece.end)}</UncitedMark>);
    }
    at = piece.end;
  }
  if (at < text.length) parts.push(text.slice(at));
  return <span className="prewrap">{parts}</span>;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
