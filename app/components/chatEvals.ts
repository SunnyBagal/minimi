/**
 * "This chat" figures for the evals popover, computed only from the messages on screen:
 * the same data parts the page renders (data-citations, data-flags, data-verdict,
 * data-timing, data-error), the answer text, and the message metadata (intent, and the
 * turn id that marks a finished turn). Nothing is estimated: a figure with no data is
 * null, and the popover shows "—" with the reason.
 *
 * How the stream arrives matters here (src/core/pipeline/runTurn.ts, fresh.ts,
 * recheck.ts): persist and route timings come before any answer text; a fresh or
 * re-check answer gets its `data-citations` part (every source supplied to the writer,
 * cited or not) and then its `data-flags` part (the validator's result) after the text;
 * the metadata arrives last, when the turn is done.
 */
import type { Intent, Provenance, Verdict } from '../../src/core/contracts';
import type { ChatUIMessage } from '../api/chat/route';

export const INTENTS: readonly Intent[] = ['fresh', 'recheck', 'recall', 'chat'];
export const VERDICTS: readonly Verdict[] = ['unchanged', 'changed', 'unverifiable', 'source_unavailable'];
/** The pipeline's stage names in pipeline order; any other stage is listed after these. */
export const STAGE_ORDER = [
  'persist',
  'route',
  'search',
  'write',
  'validate',
  'extract',
  'resolve',
  'fetch',
  'judge',
  'summary',
];

/** The inline citation marker, as the validator reads it (src/core/search/validate.ts). */
const CITATION_MARKER = /\[(\d+)\]/g;

export interface StageLatency {
  stage: string;
  /** Mean over every timing part with this stage name, from any turn, finished or not. */
  avgMs: number;
  /** How many timing parts were averaged. */
  count: number;
}

export interface ChatEvals {
  /** Assistant messages with answer text on screen. A turn that has only sent timings is not one yet. */
  answers: number;
  /** Answers per intent, counted over answers whose metadata carries one; null when none does. */
  intents: Record<Intent, number> | null;
  /** Answers without an intent in their metadata (still streaming). */
  answersWithoutIntent: number;
  coverage: {
    /** Answers whose validator result (data-flags) has arrived. */
    validated: number;
    /** Answers with sources supplied but no validator result yet. */
    pending: number;
    /** Validated answers whose text cites at least one supplied source inline ([n]). */
    citing: number;
    /** Of those, answers with no uncited number flagged. */
    citingClean: number;
    /** citingClean / citing; null when no validated answer cites a source inline. */
    share: number | null;
    /** Uncited numbers flagged across all validated answers. */
    uncitedNumbers: number;
  };
  sources: {
    /** Sources supplied with the answers (the data-citations inventory), counted per answer. */
    supplied: number;
    live: number;
    firstParty: number;
    liveShare: number | null;
    firstPartyShare: number | null;
  };
  verdicts: {
    rows: number;
    counts: Record<Verdict, number>;
    /** Rows whose provenance is verified_now. */
    verifiedNow: number;
    verifiedShare: number | null;
  };
  latency: {
    /** Average ms per stage, pipeline order first. Empty when no timings arrived. */
    stages: StageLatency[];
    /** Total ms per finished answer (sum of its stages), in chat order. */
    perAnswer: number[];
    /** Mean of perAnswer; null when no answer has finished with timings. */
    avgAnswerMs: number | null;
    /** Turns with timings that have not finished; left out of perAnswer. */
    inProgress: number;
  };
  /** data-error parts across all assistant messages, answered or not. */
  errors: number;
}

const share = (part: number, whole: number): number | null => (whole === 0 ? null : part / whole);

function answerText(message: ChatUIMessage): string {
  return message.parts.map((part) => (part.type === 'text' ? part.text : '')).join('');
}

/** Inline [n] markers in the text that point at a source supplied with this answer. */
export function citesInline(text: string, supplied: ReadonlySet<number>): boolean {
  for (const match of text.matchAll(CITATION_MARKER)) {
    if (supplied.has(Number(match[1]))) return true;
  }
  return false;
}

function stageRank(stage: string): number {
  const index = STAGE_ORDER.indexOf(stage);
  return index === -1 ? STAGE_ORDER.length : index;
}

export function chatEvals(messages: readonly ChatUIMessage[]): ChatEvals {
  const intents: Record<Intent, number> = { fresh: 0, recheck: 0, recall: 0, chat: 0 };
  let answers = 0;
  let withIntent = 0;
  let validated = 0;
  let pending = 0;
  let citing = 0;
  let citingClean = 0;
  let uncitedNumbers = 0;
  let supplied = 0;
  let live = 0;
  let firstParty = 0;
  const counts: Record<Verdict, number> = { unchanged: 0, changed: 0, unverifiable: 0, source_unavailable: 0 };
  let rows = 0;
  let verifiedNow = 0;
  const stageSums = new Map<string, { sum: number; count: number; first: number }>();
  const perAnswer: number[] = [];
  let inProgress = 0;
  let errors = 0;
  let order = 0;

  for (const message of messages) {
    if (message.role !== 'assistant') continue;
    const text = answerText(message);
    const isAnswer = text.trim() !== '';
    const finished = message.metadata?.turnId !== undefined;

    const sourceNumbers = new Set<number>();
    let flagged: number | null = null;
    let totalMs = 0;
    let timed = false;
    for (const part of message.parts) {
      if (part.type === 'data-citations') {
        for (const item of part.data.items) {
          sourceNumbers.add(item.n);
          supplied += 1;
          if (item.live) live += 1;
          if (item.firstParty) firstParty += 1;
        }
      } else if (part.type === 'data-flags') {
        flagged = (flagged ?? 0) + part.data.uncitedNumbers.length;
      } else if (part.type === 'data-verdict') {
        rows += 1;
        counts[part.data.row.check.verdict] += 1;
        const provenance: Provenance = part.data.row.provenance;
        if (provenance === 'verified_now') verifiedNow += 1;
      } else if (part.type === 'data-timing') {
        timed = true;
        totalMs += part.data.ms;
        const entry = stageSums.get(part.data.stage) ?? { sum: 0, count: 0, first: order++ };
        entry.sum += part.data.ms;
        entry.count += 1;
        stageSums.set(part.data.stage, entry);
      } else if (part.type === 'data-error') {
        errors += 1;
      }
    }

    if (flagged !== null) {
      validated += 1;
      uncitedNumbers += flagged;
      if (citesInline(text, sourceNumbers)) {
        citing += 1;
        if (flagged === 0) citingClean += 1;
      }
    } else if (sourceNumbers.size > 0) {
      pending += 1;
    }

    if (isAnswer) {
      answers += 1;
      const intent = message.metadata?.intent;
      if (intent !== undefined && INTENTS.includes(intent)) {
        intents[intent] += 1;
        withIntent += 1;
      }
    }
    if (timed) {
      if (finished && isAnswer) perAnswer.push(totalMs);
      else if (!finished) inProgress += 1;
    }
  }

  const stages = [...stageSums.entries()]
    .sort(([a, x], [b, y]) => stageRank(a) - stageRank(b) || x.first - y.first)
    .map(([stage, { sum, count }]) => ({ stage, avgMs: sum / count, count }));

  return {
    answers,
    intents: withIntent === 0 ? null : intents,
    answersWithoutIntent: answers - withIntent,
    coverage: { validated, pending, citing, citingClean, share: share(citingClean, citing), uncitedNumbers },
    sources: {
      supplied,
      live,
      firstParty,
      liveShare: share(live, supplied),
      firstPartyShare: share(firstParty, supplied),
    },
    verdicts: { rows, counts, verifiedNow, verifiedShare: share(verifiedNow, rows) },
    latency: {
      stages,
      perAnswer,
      avgAnswerMs: perAnswer.length === 0 ? null : perAnswer.reduce((a, b) => a + b, 0) / perAnswer.length,
      inProgress,
    },
    errors,
  };
}

/** The coverage caption: what the share is of, or why there is none. */
export function coverageCaption(evals: ChatEvals): string {
  const { coverage } = evals;
  const pending =
    coverage.pending === 0
      ? ''
      : ` · ${coverage.pending} ${coverage.pending === 1 ? 'answer' : 'answers'} awaiting validation`;
  if (coverage.share === null) {
    if (coverage.pending > 0) {
      return `Validation pending for ${coverage.pending} ${coverage.pending === 1 ? 'answer' : 'answers'}.`;
    }
    if (coverage.validated > 0) return 'No validated answer cites a source inline yet.';
    return 'No answer in this chat has been checked for citations yet.';
  }
  const flagged = `${coverage.uncitedNumbers} uncited ${coverage.uncitedNumbers === 1 ? 'number' : 'numbers'} flagged`;
  return `${coverage.citingClean} of ${coverage.citing} ${coverage.citing === 1 ? 'answer' : 'answers'} citing sources had no uncited numbers flagged · ${flagged}${pending}`;
}

/** "4 answers · 1 re-check": the popover's subtitle. */
export function chatSubtitle(evals: ChatEvals): string {
  if (evals.answers === 0) return 'No answers yet';
  const parts = [`${evals.answers} ${evals.answers === 1 ? 'answer' : 'answers'}`];
  if (evals.intents !== null) {
    const labels: Record<Intent, [string, string]> = {
      fresh: ['fresh', 'fresh'],
      recheck: ['re-check', 're-checks'],
      recall: ['recall', 'recalls'],
      chat: ['chat reply', 'chat replies'],
    };
    for (const intent of INTENTS) {
      if (intent === 'fresh') continue;
      const n = evals.intents[intent];
      if (n > 0) parts.push(`${n} ${labels[intent][n === 1 ? 0 : 1]}`);
    }
  }
  return parts.join(' · ');
}

/** A share as a whole percent, e.g. 0.756 → "76%"; null → "—". */
export function percent(value: number | null): string {
  return value === null ? '—' : `${Math.round(value * 100)}%`;
}

/** Milliseconds for display: "640 ms" under a second, "2.4 s" from there. */
export function duration(ms: number | null): string {
  if (ms === null) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}
