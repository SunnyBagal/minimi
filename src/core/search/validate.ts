import type { ValidateAnswer } from '../contracts';

const CITATION = /\[(\d+)\]/g;
// Digits with optional separators/percent, optionally led by a currency
// symbol; lookbehind keeps "H100" and "SKU2" out.
const NUMBER_TOKEN = /(?<![\p{L}\p{N}])\p{Sc}?\d[\d.,]*%?/gu;
// First sentence terminator after a token: punctuation followed by
// whitespace/end, or a newline.
const SENTENCE_END = /[.!?](?=\s|$)|\n/;
// Citations directly after a terminator still close the previous sentence.
const TRAILING_CITATIONS = /^(?:[ \t]*\[\d+\])+/;
// Strips the decoration allowed on number tokens; keeps '.' and '%'.
const NUMBER_DECORATION = /[\p{Sc},]/gu;

interface Span {
  start: number;
  end: number;
}

function citationSpans(text: string): { n: number; span: Span }[] {
  const spans: { n: number; span: Span }[] = [];
  for (const match of text.matchAll(CITATION)) {
    const n = Number(match[1]);
    const start = match.index ?? 0;
    spans.push({ n, span: { start, end: start + match[0].length } });
  }
  return spans;
}

/** Sentence region open to citations: token end -> terminator + adjacent [n] run. */
function citationWindowEnd(text: string, tokenEnd: number): number {
  const rest = text.slice(tokenEnd);
  const terminator = SENTENCE_END.exec(rest);
  if (terminator === null) return text.length;
  let end = tokenEnd + terminator.index + 1;
  const trailing = TRAILING_CITATIONS.exec(text.slice(end));
  if (trailing !== null) end += trailing[0].length;
  return end;
}

function isListMarker(text: string, span: Span): boolean {
  const lineStart = text.lastIndexOf('\n', span.start - 1) + 1;
  if (text.slice(lineStart, span.start).trim() !== '') return false;
  const next = text[span.end];
  return (next === '.' || next === ')') && /\s/.test(text[span.end + 1] ?? '');
}

export const validateAnswer: ValidateAnswer = (text, evidence, allowedNumbers) => {
  const valid = new Set(evidence.map((item) => item.n));
  const citations = citationSpans(text);
  const allowed = new Set(allowedNumbers.map((n) => n.replace(NUMBER_DECORATION, '')));

  const strippedCitations = [
    ...new Set(citations.filter((c) => !valid.has(c.n)).map((c) => c.n)),
  ].sort((a, b) => a - b);

  const uncitedNumbers: string[] = [];
  for (const match of text.matchAll(NUMBER_TOKEN)) {
    const start = match.index ?? 0;
    const raw = match[0];
    const trimmed = raw.replace(/[.,]+$/, '');
    const span: Span = { start, end: start + trimmed.length };

    if (citations.some((c) => span.start >= c.span.start && span.end <= c.span.end)) continue;
    if (isListMarker(text, span)) continue;
    if (allowed.has(trimmed.replace(NUMBER_DECORATION, ''))) continue;
    const windowEnd = citationWindowEnd(text, span.end);
    if (citations.some((c) => valid.has(c.n) && c.span.start >= span.end && c.span.start < windowEnd)) {
      continue;
    }
    uncitedNumbers.push(trimmed);
  }

  return { strippedCitations, uncitedNumbers };
};
