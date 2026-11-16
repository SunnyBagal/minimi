/**
 * Evidence plumbing shared by fresh, recall and recheck: numbering sources as
 * SourceRefs, extracting claims into the store, and the in-process registry
 * that links a turn to the sources it cited.
 *
 * The registry is a WeakMap keyed on the MemoryStore because the contract has
 * no turn→sources link. It works within a process; after a restart a pending
 * turn has no known sources and counts as "nothing to check".
 */
import type {
  AgentEvent,
  ClaimDraft,
  Id,
  IsoUtc,
  MemoryStore,
  NewSource,
  Source,
  SourceRef,
} from '../contracts';
import { containsQuote } from '../search/index';
import type { TurnContext } from './context';

// ------------------------------------------------------------- numbers

/** Number tokens like `24`, `1,200` or `24.50` as written. */
export function numberTokens(text: string): string[] {
  return [...text.matchAll(/\d+(?:[.,]\d+)*/g)].map((match) => match[0]);
}

/** The tokens parsed: commas (thousands) removed, then Number. */
export function numbersIn(text: string): number[] {
  return numberTokens(text).map((token) => Number(token.replace(/,/g, '')));
}

/**
 * `allowedNumbers` for validateAnswer: each token AND its plain-number form,
 * because validateAnswer compares normalized strings — '24.00' also needs '24'.
 */
export function allowedNumbersOf(...texts: string[]): string[] {
  const allowed = new Set<string>();
  for (const text of texts) {
    for (const token of numberTokens(text)) {
      allowed.add(token);
      allowed.add(String(Number(token.replace(/,/g, ''))));
    }
  }
  return [...allowed];
}

// ------------------------------------------------------------- sources

/** Saves one fetched/searched item as a source row and returns the row. */
export function saveSource(ctx: TurnContext, source: NewSource): Source {
  return ctx.store.saveSource(source);
}

/** Turns a saved source into a numbered SourceRef for the evidence list. */
export function asRef(source: Source, n: number): SourceRef {
  return {
    n,
    sourceId: source.id,
    url: source.url,
    title: source.title,
    fetchedAtUtc: source.fetchedAtUtc,
    live: source.live,
    firstParty: source.firstParty,
    text: source.text,
  };
}

// ------------------------------------------------- the evidence registry

const REGISTRY = new WeakMap<MemoryStore, Map<Id, SourceRef[]>>();

/** Records the evidence a turn cited, keyed by the assistant turn id. */
export function rememberEvidence(store: MemoryStore, turnId: Id, refs: SourceRef[]): void {
  let byTurn = REGISTRY.get(store);
  if (byTurn === undefined) {
    byTurn = new Map();
    REGISTRY.set(store, byTurn);
  }
  byTurn.set(turnId, refs);
}

/** The evidence a turn cited, or null when this process never saw it. */
export function evidenceFor(store: MemoryStore, turnId: Id): SourceRef[] | null {
  return REGISTRY.get(store)?.get(turnId) ?? null;
}

// ------------------------------------------------------- claim extraction

/**
 * Runs extractClaims for `answer` against `evidence` and saves the claims
 * that pass the code checks: the draft's `sourceN` must point at a real
 * evidence item, its quote must sit in that source's text, and every number
 * in the value must be inside the quote. Claims get `asOfUtc` and
 * `lastVerifiedAtUtc` from the cited source's fetch time, not the clock.
 * Marks the turn's extraction `done`, or `failed` on any error or abort —
 * extraction never breaks the turn.
 */
export async function extractInto(
  ctx: TurnContext,
  turnId: Id,
  answer: string,
  evidence: SourceRef[],
): Promise<AgentEvent> {
  const done = ctx.timer('extract');
  const fail = (): AgentEvent => {
    ctx.store.setExtraction(turnId, 'failed');
    return done();
  };
  let drafts: ClaimDraft[];
  try {
    drafts = await Promise.race([
      ctx.deps.llm.extractClaims({ answer, evidence }),
      new Promise<never>((_, reject) => {
        if (ctx.signal.aborted) reject(new Error('turn deadline'));
        ctx.signal.addEventListener('abort', () => reject(new Error('turn deadline')), { once: true });
      }),
    ]);
  } catch {
    return fail();
  }

  const kept = drafts.filter((draft) => {
    const source = evidence.find((item) => item.n === draft.sourceN);
    if (source === undefined) return false;
    if (!containsQuote(source.text, draft.quote)) return false;
    const quoteNumbers = numbersIn(draft.quote);
    return numbersIn(draft.value).every((n) => quoteNumbers.includes(n));
  });
  try {
    ctx.store.saveClaims(
      kept.map((draft) => {
        const source = evidence.find((item) => item.n === draft.sourceN);
        const fetchedAtUtc: IsoUtc = source?.fetchedAtUtc ?? ctx.clock.now().toISOString();
        return {
          turnId,
          entity: draft.entity,
          attribute: draft.attribute,
          value: draft.value,
          scope: draft.scope,
          sourceId: source?.sourceId ?? '',
          quote: draft.quote,
          asOfUtc: fetchedAtUtc,
          volatility: draft.volatility,
          lastVerifiedAtUtc: fetchedAtUtc,
          supersedesId: null,
        };
      }),
    );
    ctx.store.setExtraction(turnId, 'done');
  } catch {
    return fail();
  }
  return done();
}
