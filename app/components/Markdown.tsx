'use client';

/**
 * The writer's markdown, rendered as React elements. Nothing in the text
 * becomes HTML: every leaf is a React text node, links are http/https only,
 * and there is no dangerouslySetInnerHTML.
 *
 * Supported: paragraphs, **bold**, *italic*, `code`, fenced code blocks,
 * # to ### headings, -, * and 1. lists with one level of nesting, [text](url)
 * links and --- rules. Anything incomplete (an unclosed ** or ` mid-stream, a
 * half-typed link) renders as the literal text until it closes.
 *
 * Citations and uncited-number marks are computed on the raw text, exactly as
 * CitedText does (piecesOf). Every node keeps its offsets into that raw text,
 * so each text leaf picks up the pieces that fall inside it.
 */
import { Fragment, type ReactNode } from 'react';
import { CitationLink, piecesOf, UncitedMark, type Citation, type Piece } from './CitedText';

// ------------------------------------------------------------------ blocks

interface Line {
  start: number;
  end: number;
  text: string;
}

interface ListItem {
  start: number;
  end: number;
  sub: List | null;
}

interface List {
  ordered: boolean;
  first: number;
  items: ListItem[];
}

type Block =
  | { kind: 'paragraph'; start: number; end: number }
  | { kind: 'heading'; level: 1 | 2 | 3; start: number; end: number }
  | { kind: 'code'; start: number; lang: string; code: string }
  | { kind: 'rule'; start: number }
  | { kind: 'list'; start: number; list: List };

const FENCE = /^ {0,3}(`{3,}|~{3,})[ \t]*([\w+#.-]*)[ \t]*$/;
const HEADING = /^ {0,3}(#{1,3})[ \t]+/;
const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const MARKER = /^( *)([-*+]|\d{1,9}[.)])[ \t]+/;
const BLANK = /^[ \t]*$/;

function splitLines(text: string): Line[] {
  const lines: Line[] = [];
  let start = 0;
  for (;;) {
    const newline = text.indexOf('\n', start);
    let end = newline === -1 ? text.length : newline;
    if (end > start && text[end - 1] === '\r') end -= 1;
    lines.push({ start, end, text: text.slice(start, end) });
    if (newline === -1) return lines;
    start = newline + 1;
  }
}

function startsBlock(line: string): boolean {
  return FENCE.test(line) || HEADING.test(line) || RULE.test(line) || MARKER.test(line);
}

/** Offset of the first non-space character of the line (or its end). */
function contentStart(line: Line): number {
  const indent = /^[ \t]*/.exec(line.text)?.[0].length ?? 0;
  return line.start + indent;
}

function trimmedEnd(text: string, start: number, end: number): number {
  let at = end;
  while (at > start && (text[at - 1] === ' ' || text[at - 1] === '\t')) at -= 1;
  return at;
}

interface Marker {
  indent: number;
  ordered: boolean;
  number: number;
  contentStart: number;
}

function markerOf(line: Line): Marker | null {
  if (RULE.test(line.text)) return null;
  const match = MARKER.exec(line.text);
  if (match === null) return null;
  const token = match[2] ?? '-';
  const ordered = /\d/.test(token);
  return {
    indent: (match[1] ?? '').length,
    ordered,
    number: ordered ? Number.parseInt(token, 10) : 1,
    contentStart: line.start + match[0].length,
  };
}

/** A list starting at lines[from]. Returns the list and the index after it. */
function parseList(text: string, lines: Line[], from: number): { list: List; next: number } {
  const head = markerOf(lines[from] as Line) as Marker;
  const list: List = { ordered: head.ordered, first: head.number, items: [] };
  let i = from;
  let afterBlank = false;
  while (i < lines.length) {
    const line = lines[i] as Line;
    if (BLANK.test(line.text)) {
      afterBlank = true;
      i += 1;
      continue;
    }
    const marker = markerOf(line);
    const last = list.items[list.items.length - 1];
    if (marker !== null && marker.indent >= head.indent + 2 && last !== undefined) {
      // One level of nesting; anything deeper joins that level.
      if (last.sub === null) last.sub = { ordered: marker.ordered, first: marker.number, items: [] };
      last.sub.items.push({ start: marker.contentStart, end: trimmedEnd(text, marker.contentStart, line.end), sub: null });
    } else if (marker !== null && marker.indent < head.indent + 2 && marker.ordered === head.ordered) {
      list.items.push({ start: marker.contentStart, end: trimmedEnd(text, marker.contentStart, line.end), sub: null });
    } else if (marker === null && last !== undefined && !startsBlock(line.text) && (!afterBlank || /^ {2,}/.test(line.text))) {
      // A continuation line belongs to the newest item, nested or not.
      const target = last.sub?.items[last.sub.items.length - 1] ?? last;
      target.end = trimmedEnd(text, target.start, line.end);
    } else {
      break;
    }
    afterBlank = false;
    i += 1;
  }
  // Trailing blank lines are not part of the list.
  let next = i;
  while (next > from && BLANK.test((lines[next - 1] as Line).text)) next -= 1;
  return { list, next: Math.max(next, from + 1) };
}

function parseBlocks(text: string): Block[] {
  const lines = splitLines(text);
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] as Line;
    if (BLANK.test(line.text)) {
      i += 1;
      continue;
    }
    const fence = FENCE.exec(line.text);
    if (fence !== null) {
      const mark = fence[1] ?? '```';
      const body: string[] = [];
      i += 1;
      // An unclosed fence runs to the end of the text, so a code block streams in place.
      while (i < lines.length) {
        const inner = lines[i] as Line;
        const close = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(inner.text);
        i += 1;
        if (close !== null && (close[1] ?? '')[0] === mark[0] && (close[1] ?? '').length >= mark.length) break;
        body.push(inner.text);
      }
      blocks.push({ kind: 'code', start: line.start, lang: fence[2] ?? '', code: body.join('\n') });
      continue;
    }
    if (RULE.test(line.text)) {
      blocks.push({ kind: 'rule', start: line.start });
      i += 1;
      continue;
    }
    const heading = HEADING.exec(line.text);
    if (heading !== null) {
      const start = line.start + heading[0].length;
      const level = (heading[1] ?? '#').length as 1 | 2 | 3;
      blocks.push({ kind: 'heading', level, start, end: trimmedEnd(text, start, line.end) });
      i += 1;
      continue;
    }
    if (markerOf(line) !== null) {
      const { list, next } = parseList(text, lines, i);
      blocks.push({ kind: 'list', start: line.start, list });
      i = next;
      continue;
    }
    const start = contentStart(line);
    let end = line.end;
    i += 1;
    while (i < lines.length) {
      const more = lines[i] as Line;
      if (BLANK.test(more.text) || startsBlock(more.text)) break;
      end = more.end;
      i += 1;
    }
    blocks.push({ kind: 'paragraph', start, end: trimmedEnd(text, start, end) });
  }
  return blocks;
}

// ------------------------------------------------------------------ inline

type Inline =
  | { kind: 'text'; start: number; end: number }
  | { kind: 'code'; start: number; end: number }
  | { kind: 'strong'; start: number; children: Inline[] }
  | { kind: 'em'; start: number; children: Inline[] }
  | { kind: 'link'; start: number; href: string; children: Inline[] };

const isSpace = (char: string | undefined): boolean => char === undefined || /\s/.test(char);

/** The http or https URL, or null for anything else (javascript:, data:, relative, malformed). */
export function safeHref(raw: string): string | null {
  const candidate = raw.trim();
  if (!/^https?:\/\//i.test(candidate) || /\s/.test(candidate)) return null;
  try {
    const url = new URL(candidate);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

/** Index of the closing `**` for an opening at `from`, or -1. */
function closeStrong(text: string, from: number, end: number): number {
  if (isSpace(text[from + 2])) return -1;
  let at = text.indexOf('**', from + 3);
  while (at !== -1 && at + 2 <= end) {
    if (!isSpace(text[at - 1])) return at;
    at = text.indexOf('**', at + 1);
  }
  return -1;
}

/** Index of the closing single `*` for an opening at `from`, or -1. Skips `**` pairs. */
function closeEm(text: string, from: number, end: number): number {
  if (isSpace(text[from + 1]) || text[from + 1] === '*') return -1;
  let at = from + 2;
  while (at < end) {
    if (text[at] === '\n' && text[at + 1] === '\n') return -1;
    if (text[at] === '*') {
      if (text[at + 1] === '*') {
        at += 2;
        continue;
      }
      if (!isSpace(text[at - 1])) return at;
    }
    at += 1;
  }
  return -1;
}

/** For `[` at `from`: the `]` index, the URL span and the index after `)`, or null. */
function linkAt(text: string, from: number, end: number): { close: number; urlStart: number; urlEnd: number; after: number } | null {
  let depth = 0;
  let close = -1;
  for (let at = from; at < end; at += 1) {
    const char = text[at];
    if (char === '\n' && text[at + 1] === '\n') return null;
    if (char === '[') depth += 1;
    else if (char === ']') {
      depth -= 1;
      if (depth === 0) {
        close = at;
        break;
      }
    }
  }
  if (close === -1 || text[close + 1] !== '(') return null;
  const urlEnd = text.indexOf(')', close + 2);
  if (urlEnd === -1 || urlEnd >= end) return null;
  return { close, urlStart: close + 2, urlEnd, after: urlEnd + 1 };
}

function parseInline(text: string, start: number, end: number): Inline[] {
  const nodes: Inline[] = [];
  let textStart = start;
  let at = start;
  const flush = (upTo: number) => {
    if (upTo > textStart) nodes.push({ kind: 'text', start: textStart, end: upTo });
  };
  while (at < end) {
    const char = text[at];
    if (char === '`') {
      let run = 1;
      while (text[at + run] === '`') run += 1;
      const fence = '`'.repeat(run);
      let close = text.indexOf(fence, at + run);
      while (close !== -1 && text[close + run] === '`') close = text.indexOf(fence, close + run + 1);
      if (close !== -1 && close + run <= end && close > at + run) {
        flush(at);
        nodes.push({ kind: 'code', start: at + run, end: close });
        at = close + run;
        textStart = at;
      } else {
        at += run;
      }
      continue;
    }
    if (char === '*' && text[at + 1] === '*') {
      const close = closeStrong(text, at, end);
      if (close !== -1) {
        flush(at);
        nodes.push({ kind: 'strong', start: at, children: parseInline(text, at + 2, close) });
        at = close + 2;
        textStart = at;
      } else {
        at += 2;
      }
      continue;
    }
    if (char === '*') {
      const close = closeEm(text, at, end);
      if (close !== -1) {
        flush(at);
        nodes.push({ kind: 'em', start: at, children: parseInline(text, at + 1, close) });
        at = close + 1;
        textStart = at;
      } else {
        at += 1;
      }
      continue;
    }
    if (char === '[') {
      const link = linkAt(text, at, end);
      if (link === null) {
        at += 1;
        continue;
      }
      const href = safeHref(text.slice(link.urlStart, link.urlEnd));
      if (href !== null) {
        flush(at);
        nodes.push({ kind: 'link', start: at, href, children: parseInline(text, at + 1, link.close) });
        textStart = link.after;
      }
      // A link to anything but http/https stays literal text, URL and all.
      at = link.after;
      continue;
    }
    at += 1;
  }
  flush(end);
  return nodes;
}

// ------------------------------------------------------------------ render

interface Context {
  text: string;
  pieces: Piece[];
}

function withBreaks(value: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  value.split('\n').forEach((part, index) => {
    if (index > 0) out.push(<br key={`${key}-br${index}`} />);
    if (part !== '') out.push(part);
  });
  return out;
}

/** A text leaf, with the citation links and uncited marks that fall inside it. */
function renderText(ctx: Context, start: number, end: number, inLink: boolean): ReactNode[] {
  const out: ReactNode[] = [];
  let at = start;
  for (const piece of ctx.pieces) {
    if (piece.end <= start || piece.start >= end) continue;
    const from = Math.max(piece.start, start);
    const to = Math.min(piece.end, end);
    if (from > at) out.push(...withBreaks(ctx.text.slice(at, from), `t${at}`));
    const slice = ctx.text.slice(from, to);
    if (piece.ref !== undefined && !inLink && from === piece.start && to === piece.end) {
      out.push(<CitationLink key={`c${from}`} citation={piece.ref} />);
    } else if (piece.ref === undefined) {
      out.push(<UncitedMark key={`m${from}`}>{slice}</UncitedMark>);
    } else {
      out.push(...withBreaks(slice, `t${from}`));
    }
    at = to;
  }
  if (end > at) out.push(...withBreaks(ctx.text.slice(at, end), `t${at}`));
  return out;
}

function renderInline(ctx: Context, nodes: Inline[], inLink = false): ReactNode[] {
  return nodes.map((node) => {
    switch (node.kind) {
      case 'text':
        return <Fragment key={`x${node.start}`}>{renderText(ctx, node.start, node.end, inLink)}</Fragment>;
      case 'code':
        return (
          <code key={`k${node.start}`} className="md-code">
            {ctx.text.slice(node.start, node.end)}
          </code>
        );
      case 'strong':
        return <strong key={`s${node.start}`}>{renderInline(ctx, node.children, inLink)}</strong>;
      case 'em':
        return <em key={`e${node.start}`}>{renderInline(ctx, node.children, inLink)}</em>;
      case 'link':
        return (
          <a key={`l${node.start}`} className="md-link" href={node.href} target="_blank" rel="noopener noreferrer">
            {renderInline(ctx, node.children, true)}
          </a>
        );
    }
  });
}

function renderList(ctx: Context, list: List, key: string): ReactNode {
  const items = list.items.map((item) => (
    <li key={`i${item.start}`}>
      {renderInline(ctx, parseInline(ctx.text, item.start, item.end))}
      {item.sub !== null ? renderList(ctx, item.sub, `sub${item.start}`) : null}
    </li>
  ));
  return list.ordered ? (
    <ol key={key} className="md-list" start={list.first === 1 ? undefined : list.first}>
      {items}
    </ol>
  ) : (
    <ul key={key} className="md-list">
      {items}
    </ul>
  );
}

function renderBlock(ctx: Context, block: Block): ReactNode {
  switch (block.kind) {
    case 'paragraph':
      return (
        <p key={`p${block.start}`} className="md-p">
          {renderInline(ctx, parseInline(ctx.text, block.start, block.end))}
        </p>
      );
    case 'heading': {
      const children = renderInline(ctx, parseInline(ctx.text, block.start, block.end));
      const className = `md-h md-h${block.level}`;
      if (block.level === 1) return <h3 key={`h${block.start}`} className={className}>{children}</h3>;
      if (block.level === 2) return <h4 key={`h${block.start}`} className={className}>{children}</h4>;
      return <h5 key={`h${block.start}`} className={className}>{children}</h5>;
    }
    case 'code':
      return (
        <pre key={`f${block.start}`} className="md-pre" data-lang={block.lang === '' ? undefined : block.lang}>
          <code>{block.code}</code>
        </pre>
      );
    case 'rule':
      return <hr key={`r${block.start}`} className="md-rule" />;
    case 'list':
      return renderList(ctx, block.list, `u${block.start}`);
  }
}

/** Renders one answer's markdown with its citations and uncited-number marks. */
export function Markdown({ text, citations, uncited }: { text: string; citations: Citation[]; uncited: string[] }) {
  const byN = new Map(citations.map((ref) => [ref.n, ref]));
  const ctx: Context = { text, pieces: piecesOf(text, byN, uncited) };
  return <div className="md">{parseBlocks(text).map((block) => renderBlock(ctx, block))}</div>;
}
