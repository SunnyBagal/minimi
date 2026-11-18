/**
 * Seed rows for the held-out cases. Same shape as the scripted seeds:
 * origin `seed`, user extraction skipped, assistant extraction done.
 * The quote is a substring of the source text stored with the claim.
 */
import type { ClaimScope, MemoryStore, Volatility } from '../../src/core/contracts';

const SESSION = 'heldout-seed';

export interface HeldoutWhen {
  createdAtUtc: string;
  localDate: string;
  tz: string;
}

export interface HeldoutClaim {
  entity: string;
  attribute: string;
  value: string;
  scope: ClaimScope;
  quote: string;
  url: string;
  text: string;
  firstParty?: boolean;
  volatility?: Volatility;
}

export function monthScope(plan: string, currency: string): ClaimScope {
  return { plan, period: 'month', currency, unit: 'flat' };
}

export function ist(localDate: string, createdAtUtc: string): HeldoutWhen {
  return { localDate, createdAtUtc, tz: 'Asia/Kolkata' };
}

/**
 * One user question, the assistant answer, and the claims that answer stored.
 * `lastVerifiedAtUtc` defaults to the exchange time. Pass another instant when
 * the last verification day must differ from the question's local date.
 */
export function seedExchange(
  store: MemoryStore,
  when: HeldoutWhen,
  user: string,
  assistant: string,
  topic: string,
  entities: string[],
  claims: readonly HeldoutClaim[],
  lastVerifiedAtUtc?: string,
): void {
  const base = {
    sessionId: SESSION,
    createdAtUtc: when.createdAtUtc,
    tz: when.tz,
    localDate: when.localDate,
    origin: 'seed' as const,
    topic,
    entities,
    summary: null,
    targetTurnIds: [] as string[],
  };
  store.saveTurn({
    ...base,
    role: 'user',
    content: user,
    extraction: 'skipped',
    intent: null,
  });
  const saved = store.saveTurn({
    ...base,
    role: 'assistant',
    content: assistant,
    extraction: 'done',
    intent: 'fresh',
  });
  const byUrl = new Map<string, string>();
  const rows = [];
  for (const claim of claims) {
    let sourceId = byUrl.get(claim.url);
    if (sourceId === undefined) {
      const source = store.saveSource({
        url: claim.url,
        finalUrl: claim.url,
        title: new URL(claim.url).hostname,
        publishedAt: null,
        fetchedAtUtc: when.createdAtUtc,
        live: true,
        firstParty: claim.firstParty ?? true,
        httpStatus: 200,
        text: claim.text,
      });
      sourceId = source.id;
      byUrl.set(claim.url, sourceId);
    }
    rows.push({
      turnId: saved.id,
      entity: claim.entity,
      attribute: claim.attribute,
      value: claim.value,
      scope: claim.scope,
      sourceId,
      quote: claim.quote,
      asOfUtc: when.createdAtUtc,
      volatility: claim.volatility ?? 'high',
      lastVerifiedAtUtc: lastVerifiedAtUtc ?? when.createdAtUtc,
      supersedesId: null,
    });
  }
  if (rows.length > 0) store.saveClaims(rows);
}
