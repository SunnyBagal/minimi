import { describe, expect, it } from 'vitest';
import type { Id, IsoUtc, LocalDate, MemoryHit, NewClaim, NewTurn } from '../contracts';
import { withAssistantOrigin } from '../store/assistantVisibility';
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

describe('InMemoryStore.hideFrom', () => {
  it('hides that user turn and every later turn from recentTurns, findTurns, nearestTurns, getTurns and claimsForTurns', () => {
    const store = new InMemoryStore();
    const firstUser = store.saveTurn(
      turn({ content: 'first zephyr question', topic: 'zephyr', localDate: '2026-11-10', createdAtUtc: utc(10) }),
    );
    const firstAssistant = store.saveTurn(
      turn({
        role: 'assistant',
        content: 'first zephyr answer',
        topic: 'zephyr',
        localDate: '2026-11-10',
        createdAtUtc: utc(10),
        intent: 'chat',
      }),
    );
    const [claimA] = store.saveClaims([claim(firstAssistant.id, { value: '10 USD' })]);
    if (claimA === undefined) throw new Error('claim A not saved');
    const secondUser = store.saveTurn(
      turn({ content: 'second zephyr question', topic: 'zephyr', localDate: '2026-11-11', createdAtUtc: utc(11) }),
    );
    const secondAssistant = store.saveTurn(
      turn({
        role: 'assistant',
        content: 'second zephyr answer',
        topic: 'zephyr',
        localDate: '2026-11-11',
        createdAtUtc: utc(11),
        intent: 'chat',
      }),
    );
    store.saveClaims([claim(secondAssistant.id, { value: '12 USD', supersedesId: claimA.id })]);
    const other = store.saveTurn(
      turn({
        sessionId: 's2',
        content: 'other session zephyr',
        topic: 'zephyr',
        localDate: '2026-11-11',
        createdAtUtc: utc(11),
      }),
    );

    expect(store.hideFrom('s1', firstAssistant.id)).toBe(0);
    expect(store.hideFrom('s2', secondUser.id)).toBe(0);
    expect(store.hideFrom('s1', 'missing-turn')).toBe(0);
    expect(store.recentTurns('s1', 10)).toHaveLength(4);

    expect(store.hideFrom('s1', secondUser.id)).toBe(2);
    expect(store.hideFrom('s1', secondUser.id)).toBe(0);

    expect(store.recentTurns('s1', 20).map((row) => row.id)).toEqual([firstUser.id, firstAssistant.id]);
    expect(store.recentTurns('s1', 2).map((row) => row.id)).toEqual([firstUser.id, firstAssistant.id]);
    expect(store.getTurns([secondUser.id, secondAssistant.id, firstUser.id]).map((row) => row.id)).toEqual([firstUser.id]);
    expect(store.recentTurns('s2', 10).map((row) => row.id)).toEqual([other.id]);

    const onLaterDay = store.findTurns({ dates: ['2026-11-11'], excludeTurnIds: [], limit: 10 });
    expect(hitIds(onLaterDay)).toContain(other.id);
    expect(hitIds(onLaterDay)).not.toContain(secondUser.id);

    const byTopic = store.findTurns({ topic: 'zephyr', excludeTurnIds: [], limit: 10 });
    expect(hitIds(byTopic)).toContain(firstUser.id);
    expect(hitIds(byTopic)).not.toContain(secondUser.id);

    const near = store.nearestTurns({ around: ['2026-11-10'], topic: 'zephyr', excludeTurnIds: [], limit: 10 });
    expect(hitIds(near)).toContain(other.id);
    expect(hitIds(near)).not.toContain(secondUser.id);

    expect(store.claimsForTurns([secondAssistant.id], 'as_stated')).toEqual([]);
    expect(store.claimsForTurns([secondAssistant.id], 'current')).toEqual([]);
    expect(store.claimsForTurns([firstAssistant.id], 'as_stated').map((row) => row.value)).toEqual(['10 USD']);
    expect(store.claimsForTurns([firstAssistant.id], 'current').map((row) => row.id)).toEqual([claimA.id]);
  });

  it('leaves a replacement visible when the anchor is replayed and hides a late answer for the hidden prompt', () => {
    const store = new InMemoryStore();
    const firstUser = store.saveTurn(turn({ content: 'first question' }));
    store.saveTurn(turn({ role: 'assistant', content: 'first answer', intent: 'chat' }));
    const followUser = store.saveTurn(turn({ content: 'follow-up question' }));
    expect(store.hideFrom('s1', firstUser.id)).toBe(3);

    const replacementUser = store.saveTurn(turn({ content: 'replacement question' }));
    const replacementAssistant = store.saveTurn(turn({ role: 'assistant', content: 'replacement answer', intent: 'chat' }));
    expect(store.hideFrom('s1', firstUser.id)).toBe(0);
    expect(store.hideFrom('s1', followUser.id)).toBe(0);

    const late = withAssistantOrigin(firstUser.id, () =>
      store.saveTurn(turn({ role: 'assistant', content: 'orphan answer', intent: 'chat' })),
    );
    expect(store.getTurns([late.id])).toEqual([]);
    expect(store.recentTurns('s1', 10).map((row) => row.id)).toEqual([replacementUser.id, replacementAssistant.id]);
    expect(store.recentTurns('s1', 10).map((row) => row.content).join('\n')).not.toContain('orphan');
    expect(store.recentTurns('s1', 10).map((row) => row.content).join('\n')).not.toContain('follow-up');
  });

  it('walks a hidden claim through to a later visible claim in another session', () => {
    const store = new InMemoryStore();
    const a = exchange(store, '2026-11-08', 'chain-a', 'price');
    const b = exchange(store, '2026-11-09', 'chain-b', 'price');
    const c = exchange(store, '2026-11-10', 'chain-c', 'price');
    const [claimA] = store.saveClaims([claim(a.assistant, { value: '10 USD' })]);
    if (claimA === undefined) throw new Error('claim A not saved');
    const [claimB] = store.saveClaims([claim(b.assistant, { value: '12 USD', supersedesId: claimA.id })]);
    if (claimB === undefined) throw new Error('claim B not saved');
    const [claimC] = store.saveClaims([claim(c.assistant, { value: '14 USD', supersedesId: claimB.id })]);
    if (claimC === undefined) throw new Error('claim C not saved');

    expect(store.hideFrom('chain-b', b.user)).toBe(2);
    expect(store.claimsForTurns([b.assistant], 'as_stated')).toEqual([]);
    expect(store.claimsForTurns([b.assistant], 'current')).toEqual([]);
    expect(store.claimsForTurns([a.assistant], 'as_stated').map((row) => row.value)).toEqual(['10 USD']);
    expect(store.claimsForTurns([a.assistant], 'current').map((row) => row.id)).toEqual([claimC.id]);
    expect(store.claimsForTurns([c.assistant], 'current').map((row) => row.value)).toEqual(['14 USD']);
  });

  it('does not let a newer hidden branch mask a visible claim', () => {
    const store = new InMemoryStore();
    const a = exchange(store, '2026-11-08', 'branch-a', 'price');
    const b = exchange(store, '2026-11-09', 'branch-b', 'price');
    const c = exchange(store, '2026-11-10', 'branch-c', 'price');
    const d = exchange(store, '2026-11-11', 'branch-d', 'price');
    const [claimA] = store.saveClaims([claim(a.assistant, { value: '10 USD' })]);
    if (claimA === undefined) throw new Error('claim A not saved');
    const [claimB] = store.saveClaims([claim(b.assistant, { value: '12 USD', supersedesId: claimA.id })]);
    if (claimB === undefined) throw new Error('claim B not saved');
    const [claimC] = store.saveClaims([claim(c.assistant, { value: '14 USD', supersedesId: claimB.id })]);
    if (claimC === undefined) throw new Error('claim C not saved');
    store.saveClaims([claim(d.assistant, { value: '16 USD', supersedesId: claimA.id })]);

    expect(store.hideFrom('branch-b', b.user)).toBe(2);
    expect(store.hideFrom('branch-d', d.user)).toBe(2);
    expect(store.claimsForTurns([b.assistant], 'current')).toEqual([]);
    expect(store.claimsForTurns([d.assistant], 'current')).toEqual([]);
    expect(store.claimsForTurns([a.assistant], 'current').map((row) => row.id)).toEqual([claimC.id]);
    expect(store.claimsForTurns([a.assistant], 'current').map((row) => row.value)).toEqual(['14 USD']);
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
