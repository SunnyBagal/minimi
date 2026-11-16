import { describe, expect, it } from 'vitest';
import type { Id, IsoUtc, LocalDate, MemoryHit, NewClaim, NewTurn } from '../contracts';
import { InMemoryStore } from './inMemoryStore';

const DAY = 24 * 60 * 60 * 1000;

let counter = 0;
function utc(day: number, hour = 12): IsoUtc {
  return new Date(Date.UTC(2026, 10, day, hour)).toISOString();
}

function turn(overrides: Partial<NewTurn> = {}): NewTurn {
  counter += 1;
  return {
    sessionId: 's1',
    role: 'user',
    content: `message ${counter}`,
    createdAtUtc: utc(10),
    tz: 'UTC',
    localDate: '2026-11-10' as LocalDate,
    origin: 'live',
    topic: null,
    entities: [],
    summary: null,
    extraction: 'skipped',
    intent: null,
    targetTurnIds: [],
    ...overrides,
  };
}

function exchange(store: InMemoryStore, localDate: LocalDate, sessionId = 's1', question = 'asked'): { user: Id; assistant: Id } {
  const [year, month, day] = localDate.split('-').map(Number);
  const at = new Date(Date.UTC(year ?? 2026, (month ?? 1) - 1, day ?? 1, 12)).toISOString();
  const user = store.saveTurn(turn({ sessionId, content: `${question} ${localDate}`, createdAtUtc: at, localDate }));
  const assistant = store.saveTurn(
    turn({ sessionId, role: 'assistant', content: `answered ${localDate}`, createdAtUtc: at, localDate, intent: 'chat' }),
  );
  return { user: user.id, assistant: assistant.id };
}

function hitIds(hits: MemoryHit[]): Id[] {
  return hits.flatMap((hit) => [hit.userTurn.id, ...(hit.assistantTurn === null ? [] : [hit.assistantTurn.id])]);
}

function claim(turnId: Id, overrides: Partial<NewClaim> = {}): NewClaim {
  counter += 1;
  return {
    turnId,
    entity: 'Example Co',
    attribute: 'price',
    value: `${counter} USD`,
    scope: {},
    sourceId: 'source-1',
    quote: `quote ${counter}`,
    asOfUtc: utc(10),
    volatility: 'high',
    lastVerifiedAtUtc: utc(10),
    supersedesId: null,
    ...overrides,
  };
}

describe('InMemoryStore.findTurns / nearestTurns', () => {
  it('findTurns never returns an excluded id', () => {
    const store = new InMemoryStore();
    exchange(store, '2026-11-08', 's1', 'pricing');
    const b = exchange(store, '2026-11-10', 's1', 'pricing');
    exchange(store, '2026-11-09', 'other', 'pricing');

    for (const excluded of [b.user, b.assistant]) {
      const queries = [
        { dates: ['2026-11-10'], excludeTurnIds: [excluded], limit: 10 },
        { range: { from: '2026-11-07', to: '2026-11-11' }, excludeTurnIds: [excluded], limit: 10 },
        { topic: 'pricing', excludeTurnIds: [excluded], limit: 10 },
      ];
      for (const query of queries) {
        const hits = store.findTurns(query);
        expect(hitIds(hits)).not.toContain(excluded);
      }
      const near = store.nearestTurns({ around: ['2026-11-09'], excludeTurnIds: [excluded], limit: 10 });
      expect(hitIds(near)).not.toContain(excluded);
    }

    // Excluding the user turn drops the whole pair; excluding the assistant
    // turn keeps the pair with assistantTurn null.
    const noUser = store.findTurns({ dates: ['2026-11-10'], excludeTurnIds: [b.user], limit: 10 });
    expect(noUser.some((hit) => hit.userTurn.id === b.user || hit.assistantTurn?.id === b.assistant)).toBe(false);
    const noAssistant = store.findTurns({ dates: ['2026-11-10'], excludeTurnIds: [b.assistant], limit: 10 });
    const pair = noAssistant.find((hit) => hit.userTurn.id === b.user);
    expect(pair?.assistantTurn).toBeNull();
    expect(noAssistant.length).toBeGreaterThan(0);
  });
});

describe('InMemoryStore.claimsForTurns', () => {
  it('two-step supersedes chain', () => {
    const store = new InMemoryStore();
    const t1 = exchange(store, '2026-11-08').assistant;
    const t2 = exchange(store, '2026-11-09').assistant;
    const t3 = exchange(store, '2026-11-10').assistant;

    const [a] = store.saveClaims([claim(t1, { value: '10 USD' })]);
    if (a === undefined) throw new Error('claim A not saved');
    const [b] = store.saveClaims([claim(t2, { value: '12 USD', supersedesId: a.id })]);
    if (b === undefined) throw new Error('claim B not saved');
    const [c] = store.saveClaims([claim(t3, { value: '15 USD', supersedesId: b.id })]);
    if (c === undefined) throw new Error('claim C not saved');

    const ids = (claims: { id: Id; value: string }[]) => claims.map((x) => `${x.id}:${x.value}`);

    expect(ids(store.claimsForTurns([t1], 'as_stated'))).toEqual([`${a.id}:10 USD`]);
    expect(ids(store.claimsForTurns([t1], 'current'))).toEqual([`${c.id}:15 USD`]);
    expect(ids(store.claimsForTurns([t2], 'as_stated'))).toEqual([`${b.id}:12 USD`]);
    expect(ids(store.claimsForTurns([t2], 'current'))).toEqual([`${c.id}:15 USD`]);
    expect(ids(store.claimsForTurns([t1, t2], 'current'))).toEqual([`${c.id}:15 USD`]);
    expect(ids(store.claimsForTurns([t3], 'as_stated'))).toEqual([`${c.id}:15 USD`]);
  });
});

describe('InMemoryStore.staleClaims', () => {
  it('skips superseded claims and respects shelf life', () => {
    const store = new InMemoryStore();
    const t1 = exchange(store, '2026-11-01').assistant;
    const t2 = exchange(store, '2026-11-02').assistant;

    const verified = (daysAgo: number): IsoUtc => new Date(Date.UTC(2026, 10, 20) - daysAgo * DAY).toISOString();

    const [old] = store.saveClaims([claim(t1, { volatility: 'high', lastVerifiedAtUtc: verified(10) })]);
    if (old === undefined) throw new Error('old claim not saved');
    const [fresh] = store.saveClaims([claim(t2, { volatility: 'high', lastVerifiedAtUtc: verified(2) })]);
    if (fresh === undefined) throw new Error('fresh claim not saved');
    const [superseded] = store.saveClaims([claim(t1, { volatility: 'high', lastVerifiedAtUtc: verified(30) })]);
    if (superseded === undefined) throw new Error('superseded claim not saved');
    store.saveClaims([claim(t2, { supersedesId: superseded.id, lastVerifiedAtUtc: verified(2) })]);
    const [lowStale] = store.saveClaims([claim(t1, { volatility: 'low', lastVerifiedAtUtc: verified(100) })]);
    if (lowStale === undefined) throw new Error('low claim not saved');

    const now = new Date(Date.UTC(2026, 10, 20));
    const stale = store.staleClaims(now, 10).map((x) => x.id);
    expect(stale).toEqual([old.id]);
    expect(stale).not.toContain(fresh.id);
    expect(stale).not.toContain(superseded.id);
    expect(stale).not.toContain(lowStale.id);
  });
});
