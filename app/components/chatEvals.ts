/**
 * "This chat" figures for the evals popover, computed only from the messages on screen:
 * the same data parts the page renders (data-citations, data-flags, data-verdict,
 * data-timing, data-error) and the message metadata's intent. Nothing is estimated:
 * a figure with no data is null, and the popover shows "—" with the reason.
 */
import type { Intent, Provenance, Verdict } from '../../src/core/contracts';
import type { ChatUIMessage } from '../api/chat/route';

export const INTENTS: readonly Intent[] = ['fresh', 'recheck', 'recall', 'chat'];
export const VERDICTS: readonly Verdict[] = ['unchanged', 'changed', 'unverifiable', 'source_unavailable'];
/** The pipeline's stage names in pipeline order; any other stage is listed after these. */
export const STAGE_ORDER = ['persist', 'route', 'search', 'write', 'validate', 'extract', 'resolve', 'fetch', 'judge', 'summary'];

export interface StageLatency {
  stage: string;
  /** Mean over every timing part with this stage name. */
  avgMs: number;
  /** How many timing parts were averaged. */
  count: number;
}

export interface ChatEvals {
  /** Assistant messages with at least one text or data part. */
  answers: number;
  /** Answers per intent, counted over answers whose metadata carries one; null when none does. */
  intents: Record<Intent, number> | null;
  /** Answers without an intent in their metadata (for example still streaming). */
  answersWithoutIntent: number;
  coverage: {
    /** Answers with at least one citation. */
    citedAnswers: number;
    /** Of those, answers with no uncited number flagged. */
    fullyCited: number;
    /** fullyCited / citedAnswers; null when no answer cited a source. */
    share: number | null;
    /** Uncited numbers flagged across all answers. */
    uncitedNumbers: number;
  };
  sources: {
    /** Citation entries across all answers (a page cited by two answers counts twice). */
    total: number;
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
    /** Total ms per answer (sum of its stages), in chat order, for answers that have timings. */
    perAnswer: number[];
    /** Mean of perAnswer; null when no answer has timings. */
    avgAnswerMs: number | null;
  };
  /** data-error parts across all answers. */
  errors: number;
}

const share = (part: number, whole: number): number | null => (whole === 0 ? null : part / whole);

function isAnswer(message: ChatUIMessage): boolean {
  return message.role === 'assistant' && message.parts.some((part) => part.type === 'text' || part.type.startsWith('data-'));
}

function stageRank(stage: string): number {
  const index = STAGE_ORDER.indexOf(stage);
  return index === -1 ? STAGE_ORDER.length : index;
}

export function chatEvals(messages: readonly ChatUIMessage[]): ChatEvals {
  const answers = messages.filter(isAnswer);
  const intents: Record<Intent, number> = { fresh: 0, recheck: 0, recall: 0, chat: 0 };
  let withIntent = 0;
  let citedAnswers = 0;
  let fullyCited = 0;
  let uncitedNumbers = 0;
  let total = 0;
  let live = 0;
  let firstParty = 0;
  const counts: Record<Verdict, number> = { unchanged: 0, changed: 0, unverifiable: 0, source_unavailable: 0 };
  let rows = 0;
  let verifiedNow = 0;
  const stageSums = new Map<string, { sum: number; count: number; first: number }>();
  const perAnswer: number[] = [];
  let errors = 0;
  let order = 0;

  for (const message of answers) {
    const intent = message.metadata?.intent;
    if (intent !== undefined && INTENTS.includes(intent)) {
      intents[intent] += 1;
      withIntent += 1;
    }
    let citations = 0;
    let uncited = 0;
    let answerMs = 0;
    let timed = false;
    for (const part of message.parts) {
      if (part.type === 'data-citations') {
        citations += part.data.items.length;
        for (const item of part.data.items) {
          total += 1;
          if (item.live) live += 1;
          if (item.firstParty) firstParty += 1;
        }
      } else if (part.type === 'data-flags') {
        uncited += part.data.uncitedNumbers.length;
      } else if (part.type === 'data-verdict') {
        rows += 1;
        counts[part.data.row.check.verdict] += 1;
        const provenance: Provenance = part.data.row.provenance;
        if (provenance === 'verified_now') verifiedNow += 1;
      } else if (part.type === 'data-timing') {
        timed = true;
        answerMs += part.data.ms;
        const entry = stageSums.get(part.data.stage) ?? { sum: 0, count: 0, first: order++ };
        entry.sum += part.data.ms;
        entry.count += 1;
        stageSums.set(part.data.stage, entry);
      } else if (part.type === 'data-error') {
        errors += 1;
      }
    }
    uncitedNumbers += uncited;
    if (citations > 0) {
      citedAnswers += 1;
      if (uncited === 0) fullyCited += 1;
    }
    if (timed) perAnswer.push(answerMs);
  }

  const stages = [...stageSums.entries()]
    .sort(([a, x], [b, y]) => stageRank(a) - stageRank(b) || x.first - y.first)
    .map(([stage, { sum, count }]) => ({ stage, avgMs: sum / count, count }));

  return {
    answers: answers.length,
    intents: withIntent === 0 ? null : intents,
    answersWithoutIntent: answers.length - withIntent,
    coverage: { citedAnswers, fullyCited, share: share(fullyCited, citedAnswers), uncitedNumbers },
    sources: { total, live, firstParty, liveShare: share(live, total), firstPartyShare: share(firstParty, total) },
    verdicts: { rows, counts, verifiedNow, verifiedShare: share(verifiedNow, rows) },
    latency: {
      stages,
      perAnswer,
      avgAnswerMs: perAnswer.length === 0 ? null : perAnswer.reduce((a, b) => a + b, 0) / perAnswer.length,
    },
    errors,
  };
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
