import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import type { AgentConfig, Clock, LocalDate, MemoryStore, NewClaim, NewSource, NewTurn, Turn } from '../contracts';
import { defaultConfig } from '../config';
import { chooseTextSearch, Fts5MissingError, SqliteStore } from './sqliteStore';
import { createStore } from './index';
import { InMemoryStore } from '../testing/inMemoryStore';

const tmpDirs: string[] = [];
const stores: SqliteStore[] = [];

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  stores.length = 0;
});

function tmpDb(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'minimi-store-'));
  tmpDirs.push(dir);
  return path.join(dir, 'minimi.db');
}

const clock: Clock = { now: () => new Date('2026-11-16T04:30:00.000Z') };
const config: AgentConfig = defaultConfig;

function makeStore(options?: { textSearch?: 'fts' | 'like' }): SqliteStore {
  const store = new SqliteStore(tmpDb(), clock, config, options);
  stores.push(store);
  return store;
}

function ftsAvailable(): boolean {
  const probe = new DatabaseSync(':memory:');
  const options = (probe.prepare('PRAGMA compile_options').all() as { compile_options?: string }[]).map(
    (row) => row.compile_options ?? '',
  );
  probe.close();
  return options.includes('ENABLE_FTS5');
}

function userTurn(store: MemoryStore, fields: Partial<NewTurn> & { content: string }): Turn {
  return store.saveTurn({
    sessionId: 's1',
    role: 'user',
    createdAtUtc: '2026-11-10T08:35:00.000Z',
    tz: 'Asia/Kolkata',
    localDate: '2026-11-10',
    origin: 'live',
    topic: null,
    entities: [],
    summary: null,
    extraction: 'skipped',
    intent: null,
    targetTurnIds: [],
    ...fields,
  });
}

function assistantTurn(store: MemoryStore, fields: Partial<NewTurn> = {}): Turn {
  return store.saveTurn({
    sessionId: 's1',
    role: 'assistant',
    content: 'A stored answer.',
    createdAtUtc: '2026-11-10T08:40:00.000Z',
    tz: 'Asia/Kolkata',
    localDate: '2026-11-10',
    origin: 'live',
    topic: null,
    entities: [],
    summary: null,
    extraction: 'done',
    intent: 'fresh',
    targetTurnIds: [],
    ...fields,
  });
}

function sourceFixture(store: MemoryStore, fields: Partial<NewSource> = {}) {
  return store.saveSource({
    url: 'https://example.test/p',
    finalUrl: 'https://example.test/p',
    title: null,
    publishedAt: null,
    fetchedAtUtc: '2026-11-10T08:40:00.000Z',
    live: true,
    firstParty: true,
    httpStatus: 200,
    text: 'page text',
    ...fields,
  });
}

function claimFixture(store: MemoryStore, turnId: string, sourceId: string, fields: Partial<NewClaim> = {}) {
  return store.saveClaims([
    {
      turnId,
      entity: 'Example Co',
      attribute: 'price',
      value: '10 USD',
      scope: {},
      sourceId,
      quote: 'Example Co costs 10 USD',
      asOfUtc: '2026-11-10T08:40:00.000Z',
      volatility: 'high',
      lastVerifiedAtUtc: '2026-11-10T08:40:00.000Z',
      supersedesId: null,
      ...fields,
    },
  ])[0];
}

describe('SqliteStore', () => {
  it('boot asserts FTS5 through PRAGMA compile_options, or takes the recorded LIKE path', () => {
    expect(chooseTextSearch(['ENABLE_FTS5'], false)).toBe('fts');
    expect(chooseTextSearch([], false)).toBe('like');
    const store = makeStore();
    expect(store.textSearch).toBe(ftsAvailable() ? 'fts' : 'like');
  });

  it('a missing FTS5 that was not recorded throws a named error', () => {
    expect(() => chooseTextSearch([], true)).toThrow(Fts5MissingError);
    try {
      chooseTextSearch([], true);
      throw new Error('did not throw');
    } catch (error) {
      expect((error as Error).name).toBe('Fts5MissingError');
    }
  });

  it('saveTurn round-trips every Turn field, including intent, targetTurnIds, entities and extraction', () => {
    const store = makeStore();
    const saved = store.saveTurn({
      sessionId: 's1',
      role: 'assistant',
      content: 'full answer',
      createdAtUtc: '2026-11-10T08:40:00.000Z',
      tz: 'Europe/London',
      localDate: '2026-11-10',
      origin: 'seed',
      topic: 'Postgres',
      entities: ['Neon', 'Northwind'],
      summary: 'A summary.',
      extraction: 'pending',
      intent: 'recheck',
      targetTurnIds: ['turn-a', 'turn-b'],
    });
    const back = store.getTurns([saved.id])[0];
    expect(back).toEqual(saved);
    expect(back?.entities).toEqual(['Neon', 'Northwind']);
    expect(back?.targetTurnIds).toEqual(['turn-a', 'turn-b']);
    expect(back?.extraction).toBe('pending');
    expect(back?.origin).toBe('seed');
  });

  it('getTurns returns turns by id', () => {
    const store = makeStore();
    const a = userTurn(store, { content: 'first' });
    const b = userTurn(store, { content: 'second' });
    expect(store.getTurns([b.id, 'missing', a.id]).map((turn) => turn.id)).toEqual([b.id, a.id]);
  });

  it('findTurns({dates}) returns only user turns with that localDate, each paired with the assistant turn that followed it in the same session', () => {
    const store = makeStore();
    const userA = userTurn(store, { content: 'session A question', localDate: '2026-11-10', sessionId: 'sA' });
    const otherSessionUser = userTurn(store, { content: 'session B question', localDate: '2026-11-10', sessionId: 'sB' });
    const assistantA = assistantTurn(store, { sessionId: 'sA', localDate: '2026-11-10' });
    userTurn(store, { content: 'session A later', localDate: '2026-11-11', sessionId: 'sA' });
    const hits = store.findTurns({ dates: ['2026-11-10'], excludeTurnIds: [], limit: 10 });
    const hitA = hits.find((hit) => hit.userTurn.id === userA.id);
    const hitB = hits.find((hit) => hit.userTurn.id === otherSessionUser.id);
    expect(hits.every((hit) => hit.userTurn.localDate === '2026-11-10')).toBe(true);
    expect(hits.every((hit) => hit.userTurn.role === 'user')).toBe(true);
    expect(hitA?.assistantTurn?.id).toBe(assistantA.id);
    expect(hitB?.assistantTurn).toBeNull();
  });

  it('findTurns and nearestTurns never return a turn whose id is in excludeTurnIds', () => {
    const store = makeStore();
    const user = userTurn(store, { content: 'today question', localDate: '2026-11-16' });
    const assistant = assistantTurn(store, { localDate: '2026-11-16' });
    const other = userTurn(store, { content: 'another today', localDate: '2026-11-16' });
    assistantTurn(store, { localDate: '2026-11-16' });

    // The user turn dated today, excluded, gives no hit for it.
    const excludedUser = store.findTurns({ dates: ['2026-11-16'], excludeTurnIds: [user.id], limit: 10 });
    expect(excludedUser.map((hit) => hit.userTurn.id)).not.toContain(user.id);
    // The excluded assistant turn pairs as null.
    const excludedAssistant = store.findTurns({ dates: ['2026-11-16'], excludeTurnIds: [assistant.id], limit: 10 });
    expect(excludedAssistant.find((hit) => hit.userTurn.id === user.id)?.assistantTurn).toBeNull();
    // nearestTurns honours the same rule.
    const near = store.nearestTurns({ around: ['2026-11-15'], excludeTurnIds: [user.id, other.id], limit: 10 });
    expect(near.map((hit) => hit.userTurn.id)).not.toContain(user.id);
    expect(near.map((hit) => hit.userTurn.id)).not.toContain(other.id);
  });

  it('with 20 or fewer date matches, ranking uses topic and entity overlap and never calls FTS', () => {
    const store = makeStore();
    userTurn(store, { content: 'plain question', localDate: '2026-11-10' });
    assistantTurn(store, { localDate: '2026-11-10' });
    const top = userTurn(store, { content: 'Postgres hosting?', localDate: '2026-11-10', topic: 'Postgres hosting', entities: ['Neon'] });
    assistantTurn(store, { localDate: '2026-11-10' });
    const hits = store.findTurns({ dates: ['2026-11-10'], topic: 'Postgres hosting', entities: ['Neon'], excludeTurnIds: [], limit: 10 });
    expect(store.stats.textQueries).toBe(0);
    expect(hits[0]?.userTurn.id).toBe(top.id);
    expect(hits[0]?.matched).toBe('date+topic');
    expect(hits[1]?.matched).toBe('date');
  });

  it('an undated query uses FTS with OR terms', () => {
    if (!ftsAvailable()) {
      // A Node without FTS5 (22.13 had none): forcing it must throw, the default is 'like'.
      expect(() => new SqliteStore(tmpDb(), clock, config, { textSearch: 'fts' })).toThrow(Fts5MissingError);
      const likeStore = makeStore();
      expect(likeStore.textSearch).toBe('like');
      userTurn(likeStore, { content: 'about Postgres only', localDate: '2026-11-10' });
      const hits = likeStore.findTurns({ topic: 'Postgres hosting', excludeTurnIds: [], limit: 10 });
      expect(likeStore.stats.textQueries).toBe(1);
      expect(hits.map((hit) => hit.userTurn.content)).toContain('about Postgres only');
      expect(hits[0]?.matched).toBe('topic');
      return;
    }
    for (const mode of ['fts', 'like'] as const) {
      const store = makeStore({ textSearch: mode });
      userTurn(store, { content: 'about Postgres only', localDate: '2026-11-10' });
      assistantTurn(store, { localDate: '2026-11-10' });
      const hits = store.findTurns({ topic: 'Postgres hosting', excludeTurnIds: [], limit: 10 });
      expect(store.textSearch).toBe(mode);
      expect(store.stats.textQueries).toBe(1);
      // OR semantics: matching only 'Postgres' still finds the turn.
      expect(hits.map((hit) => hit.userTurn.content)).toContain('about Postgres only');
      expect(hits[0]?.matched).toBe('topic');
    }
  });

  it('more than 20 date matches rank by text search within the dates', () => {
    const store = makeStore();
    for (let i = 0; i < 25; i += 1) {
      userTurn(store, { content: `daily question ${i}`, localDate: '2026-11-10' });
    }
    const topical = userTurn(store, { content: 'the Postgres deep dive', localDate: '2026-11-10' });
    const hits = store.findTurns({ dates: ['2026-11-10'], topic: 'Postgres', excludeTurnIds: [], limit: 30 });
    if (ftsAvailable()) {
      expect(store.stats.textQueries).toBe(1);
      const topicalHit = hits.find((hit) => hit.userTurn.id === topical.id);
      expect(topicalHit?.matched).toBe('date+topic');
      expect(hits.some((hit) => hit.matched === 'date')).toBe(true);
    } else {
      // LIKE mode takes the same text-search branch on this build.
      expect(store.stats.textQueries).toBe(1);
      expect(hits.find((hit) => hit.userTurn.id === topical.id)?.matched).toBe('date+topic');
    }
  });

  it('a turn written with zone America/Los_Angeles and localDate 2026-11-09 is found by dates [2026-11-09] and not by [2026-11-10]', () => {
    const store = makeStore();
    const la = userTurn(store, { content: 'LA question', tz: 'America/Los_Angeles', localDate: '2026-11-09' });
    const found = store.findTurns({ dates: ['2026-11-09'], excludeTurnIds: [], limit: 10 });
    expect(found.map((hit) => hit.userTurn.id)).toContain(la.id);
    const notFound = store.findTurns({ dates: ['2026-11-10'], excludeTurnIds: [], limit: 10 });
    expect(notFound.map((hit) => hit.userTurn.id)).not.toContain(la.id);
  });

  it('nearestTurns returns a turn on the day before around, and a same-topic turn a week away', () => {
    const store = makeStore();
    const dayBefore = userTurn(store, { content: 'yesterday thing', localDate: '2026-11-09' });
    const weekAway = userTurn(store, { content: 'old Postgres note', localDate: '2026-11-03', topic: 'Postgres' });
    userTurn(store, { content: 'on the day itself', localDate: '2026-11-10' });
    const hits = store.nearestTurns({ around: ['2026-11-10'], topic: 'Postgres', excludeTurnIds: [], limit: 10 });
    expect(hits.find((hit) => hit.userTurn.id === dayBefore.id)?.matched).toBe('date');
    expect(hits.find((hit) => hit.userTurn.id === weekAway.id)?.matched).toBe('topic');
    expect(hits.map((hit) => hit.userTurn.content)).not.toContain('on the day itself');
  });

  it('claimsForTurns as_stated returns the original claim after it was superseded; current returns the newest claim in a two-step chain, written by a different turn, and returns it once', () => {
    const store = makeStore();
    userTurn(store, { content: 'q' });
    const turn1 = assistantTurn(store, {});
    const turn2 = assistantTurn(store, {});
    const turn3 = assistantTurn(store, {});
    const src = sourceFixture(store);
    const original = claimFixture(store, turn1.id, src.id, { value: 'v1' });
    const second = claimFixture(store, turn2.id, src.id, { value: 'v2', supersedesId: original.id });
    const third = claimFixture(store, turn3.id, src.id, { value: 'v3', supersedesId: second.id });

    const stated = store.claimsForTurns([turn1.id], 'as_stated');
    expect(stated.map((claim) => claim.id)).toEqual([original.id]);

    const current = store.claimsForTurns([turn1.id], 'current');
    expect(current.map((claim) => claim.id)).toEqual([third.id]);
    expect(current[0]?.turnId).toBe(turn3.id);
    expect(current[0]?.value).toBe('v3');
  });

  it('staleClaims respects shelfLifeDays per volatility and ignores superseded claims', () => {
    const store = makeStore();
    userTurn(store, { content: 'q' });
    const turn = assistantTurn(store, {});
    const src = sourceFixture(store);
    const now = new Date('2026-11-16T00:00:00.000Z');
    const fresh = claimFixture(store, turn.id, src.id, {
      volatility: 'high',
      lastVerifiedAtUtc: '2026-11-15T00:00:00.000Z',
    });
    const staleHigh = claimFixture(store, turn.id, src.id, {
      attribute: 'stale-high',
      volatility: 'high',
      lastVerifiedAtUtc: '2026-10-01T00:00:00.000Z',
    });
    const oldLow = claimFixture(store, turn.id, src.id, {
      attribute: 'old-low',
      volatility: 'low',
      lastVerifiedAtUtc: '2025-01-01T00:00:00.000Z',
    });
    const superseded = claimFixture(store, turn.id, src.id, {
      attribute: 'superseded',
      volatility: 'high',
      lastVerifiedAtUtc: '2026-01-01T00:00:00.000Z',
    });
    claimFixture(store, turn.id, src.id, { attribute: 'replacement', supersedesId: superseded.id, lastVerifiedAtUtc: '2026-11-15T00:00:00.000Z' });

    const stale = store.staleClaims(now, 10);
    const ids = stale.map((claim) => claim.id);
    expect(ids).toContain(staleHigh.id);
    expect(ids).toContain(oldLow.id);
    expect(ids).not.toContain(fresh.id);
    expect(ids).not.toContain(superseded.id);
    // Oldest verification first.
    expect(ids.indexOf(oldLow.id)).toBeLessThan(ids.indexOf(staleHigh.id));
  });

  it('saveSource and getSources round-trip', () => {
    const store = makeStore();
    const saved = sourceFixture(store, { live: false, firstParty: false, httpStatus: null, title: 'A title', publishedAt: '2026-11-01T00:00:00.000Z' });
    const back = store.getSources([saved.id])[0];
    expect(back).toEqual(saved);
    expect(back?.live).toBe(false);
    expect(back?.publishedAt).toBe('2026-11-01T00:00:00.000Z');
  });

  it('saveCheck round-trips', () => {
    const store = makeStore();
    userTurn(store, { content: 'q' });
    const turn = assistantTurn(store, {});
    const src = sourceFixture(store);
    const claim = claimFixture(store, turn.id, src.id);
    const check = store.saveCheck({
      claimId: claim.id,
      checkedAtUtc: '2026-11-16T04:30:00.000Z',
      verdict: 'changed',
      newValue: '12 USD',
      newSourceId: src.id,
      newQuote: 'now costs 12 USD',
      reason: 'The price rose.',
      decidedBy: 'judge',
    });
    expect(check.verdict).toBe('changed');
    expect(check.newSourceId).toBe(src.id);
    expect(check.decidedBy).toBe('judge');
  });

  it('updateTurnMeta stores topic and entities, and the new topic becomes searchable', () => {
    const store = makeStore({ textSearch: ftsAvailable() ? 'fts' : 'like' });
    const turn = userTurn(store, { content: 'vague question' });
    store.updateTurnMeta(turn.id, { topic: 'Postgres hosting', entities: ['Neon'], summary: null });
    expect(store.getTurns([turn.id])[0]?.topic).toBe('Postgres hosting');
    const hits = store.findTurns({ topic: 'Postgres hosting', excludeTurnIds: [], limit: 10 });
    expect(hits.map((hit) => hit.userTurn.id)).toContain(turn.id);
  });

  it('setExtraction marks the turn', () => {
    const store = makeStore();
    const turn = assistantTurn(store, { extraction: 'pending' });
    store.setExtraction(turn.id, 'done');
    expect(store.getTurns([turn.id])[0]?.extraction).toBe('done');
  });

  it('recentTurns returns oldest first', () => {
    const store = makeStore();
    const a = userTurn(store, { content: 'one' });
    const b = assistantTurn(store, {});
    const c = userTurn(store, { content: 'three' });
    const recent = store.recentTurns('s1', 3);
    expect(recent.map((turn) => turn.id)).toEqual([a.id, b.id, c.id]);
    expect(store.recentTurns('s1', 2).map((turn) => turn.id)).toEqual([b.id, c.id]);
  });

  it("two createStore calls on the same path do not corrupt each other's writes", () => {
    const dbPath = tmpDb();
    const a = createStore(dbPath, clock, config);
    const b = createStore(dbPath, clock, config);
    const turnA = userTurn(a, { content: 'from store a' });
    const srcA = sourceFixture(a);
    const turnB = userTurn(b, { content: 'from store b' });
    const claimB = claimFixture(b, turnA.id, srcA.id);
    assistantTurn(a, {});
    expect(a.getTurns([turnA.id, turnB.id]).map((turn) => turn.id)).toEqual([turnA.id, turnB.id]);
    expect(b.claimsForTurns([turnA.id], 'as_stated').map((claim) => claim.id)).toEqual([claimB.id]);
    const reopened = createStore(dbPath, clock, config);
    expect(reopened.getTurns([turnB.id])[0]?.content).toBe('from store b');
    expect(reopened.recentTurns('s1', 10).map((turn) => turn.id)).toContain(turnA.id);
  });

  // ------------------------------------------------------------------ parity

  it('parity with InMemoryStore: findTurns never returns an excluded id', () => {
    const sqlite = makeStore();
    const memory = new InMemoryStore();
    for (const store of [sqlite, memory]) {
      const user = userTurn(store, { content: 'excluded me', localDate: '2026-11-10' });
      assistantTurn(store, {});
      const hits = store.findTurns({ dates: ['2026-11-10'], excludeTurnIds: [user.id], limit: 10 });
      expect(hits.map((hit) => hit.userTurn.id)).not.toContain(user.id);
    }
  });

  it('parity with InMemoryStore: the two-step supersedes chain', () => {
    const sqlite = makeStore();
    const memory = new InMemoryStore();
    for (const store of [sqlite, memory]) {
      userTurn(store, { content: 'q' });
      const t1 = assistantTurn(store, {});
      const t2 = assistantTurn(store, {});
      const t3 = assistantTurn(store, {});
      const src = sourceFixture(store);
      const c1 = claimFixture(store, t1.id, src.id, { value: 'v1' });
      const c2 = claimFixture(store, t2.id, src.id, { value: 'v2', supersedesId: c1.id });
      const c3 = claimFixture(store, t3.id, src.id, { value: 'v3', supersedesId: c2.id });
      expect(store.claimsForTurns([t1.id], 'as_stated').map((c) => c.id)).toEqual([c1.id]);
      expect(store.claimsForTurns([t1.id], 'current').map((c) => c.id)).toEqual([c3.id]);
      void c3;
    }
  });

  it('deleteSeed removes seed turns, claims, checks, sources and their sessions', () => {
    const db = tmpDb();
    const store = new SqliteStore(db, clock, config);
    stores.push(store);
    const user = userTurn(store, { content: 'seed q', sessionId: 'seed-session', origin: 'seed' });
    const assistant = assistantTurn(store, { sessionId: 'seed-session', origin: 'seed' });
    const src = sourceFixture(store);
    store.markSeedSource(src.id);
    const claim = claimFixture(store, assistant.id, src.id);
    store.saveCheck({
      claimId: claim.id,
      checkedAtUtc: '2026-11-10T09:00:00.000Z',
      verdict: 'unchanged',
      newValue: null,
      newSourceId: null,
      newQuote: null,
      reason: 'ok',
      decidedBy: 'judge',
    });

    const counts = store.deleteSeed();
    expect(counts).toEqual({ turns: 2, claims: 1, checks: 1, sources: 1 });
    expect(store.getTurns([user.id, assistant.id])).toEqual([]);
    expect(store.getSources([src.id])).toEqual([]);
    expect(store.claimsForTurns([assistant.id], 'as_stated')).toEqual([]);

    const probe = new DatabaseSync(db);
    const sessions = probe.prepare('SELECT count(*) n FROM sessions').get() as { n: number };
    const marked = probe.prepare('SELECT count(*) n FROM seed_sources').get() as { n: number };
    probe.close();
    expect(sessions.n).toBe(0);
    expect(marked.n).toBe(0);
  });

  it('deleteSeed keeps live rows: a live turn survives, and a live claim superseding a seed claim keeps its row with supersedes_id null', () => {
    const store = makeStore();
    const seedUser = userTurn(store, { content: 'seed q', sessionId: 'seed-s', origin: 'seed' });
    const seedAssistant = assistantTurn(store, { sessionId: 'seed-s', origin: 'seed' });
    const seedSource = sourceFixture(store);
    store.markSeedSource(seedSource.id);
    const seedClaim = claimFixture(store, seedAssistant.id, seedSource.id);

    const liveUser = userTurn(store, { content: 'live q', sessionId: 'live-s' });
    const liveAssistant = assistantTurn(store, { sessionId: 'live-s' });
    const liveSource = sourceFixture(store, { url: 'https://live.test/p', finalUrl: 'https://live.test/p' });
    const liveClaim = claimFixture(store, liveAssistant.id, liveSource.id, { supersedesId: seedClaim.id });

    store.deleteSeed();
    expect(store.getTurns([liveUser.id, liveAssistant.id])).toHaveLength(2);
    expect(store.getTurns([seedUser.id, seedAssistant.id])).toEqual([]);
    const [kept] = store.claimsForTurns([liveAssistant.id], 'as_stated');
    expect(kept?.id).toBe(liveClaim.id);
    expect(kept?.supersedesId).toBeNull();
    expect(store.getSources([liveSource.id])).toHaveLength(1);
  });

  for (const mode of ['fts', 'like'] as const) {
    it(`deleteSeed removes a seed turn from undated findTurns (${mode} mode)`, () => {
      if (mode === 'fts' && !ftsAvailable()) {
        expect(() => makeStore({ textSearch: 'fts' })).toThrow(Fts5MissingError);
        return;
      }
      const store = makeStore({ textSearch: mode });
      userTurn(store, {
        content: 'seed question about postgres hosting',
        sessionId: 'seed-s',
        origin: 'seed',
        topic: 'postgres hosting',
      });
      assistantTurn(store, { sessionId: 'seed-s', origin: 'seed' });
      const hitsBefore = store.findTurns({ topic: 'postgres hosting', excludeTurnIds: [], limit: 5 });
      expect(hitsBefore).toHaveLength(1);
      store.deleteSeed();
      const hitsAfter = store.findTurns({ topic: 'postgres hosting', excludeTurnIds: [], limit: 5 });
      expect(hitsAfter).toEqual([]);
    });
  }

  it('deleteSeed with an only scope removes just that session and those sources', () => {
    const store = makeStore();
    const aUser = userTurn(store, { content: 'a', sessionId: 'seed-a', origin: 'seed' });
    const aAssistant = assistantTurn(store, { sessionId: 'seed-a', origin: 'seed' });
    const aSource = sourceFixture(store, { url: 'https://a.test', finalUrl: 'https://a.test' });
    claimFixture(store, aAssistant.id, aSource.id);
    const bUser = userTurn(store, { content: 'b', sessionId: 'seed-b', origin: 'seed' });
    const bAssistant = assistantTurn(store, { sessionId: 'seed-b', origin: 'seed' });
    const bSource = sourceFixture(store, { url: 'https://b.test', finalUrl: 'https://b.test' });
    claimFixture(store, bAssistant.id, bSource.id);
    store.markSeedSource(aSource.id);
    store.markSeedSource(bSource.id);

    const counts = store.deleteSeed({ sessionId: 'seed-a', sourceIds: [aSource.id] });
    expect(counts).toEqual({ turns: 2, claims: 1, checks: 0, sources: 1 });
    expect(store.getTurns([aUser.id, aAssistant.id])).toEqual([]);
    expect(store.getSources([aSource.id])).toEqual([]);
    expect(store.getTurns([bUser.id, bAssistant.id])).toHaveLength(2);
    expect(store.getSources([bSource.id])).toHaveLength(1);
  });

  it('deleteSeed keeps a seed source still referenced by a remaining claim', () => {
    const store = makeStore();
    const liveUser = userTurn(store, { content: 'live', sessionId: 'live-s' });
    const liveAssistant = assistantTurn(store, { sessionId: 'live-s' });
    const sharedSource = sourceFixture(store);
    store.markSeedSource(sharedSource.id);
    claimFixture(store, liveAssistant.id, sharedSource.id);
    void liveUser;

    const counts = store.deleteSeed();
    expect(counts.sources).toBe(0);
    expect(store.getSources([sharedSource.id])).toHaveLength(1);
  });

  it('parity with InMemoryStore: staleClaims', () => {
    const sqlite = makeStore();
    const memory = new InMemoryStore();
    for (const store of [sqlite, memory]) {
      userTurn(store, { content: 'q' });
      const turn = assistantTurn(store, {});
      const src = sourceFixture(store);
      const stale = claimFixture(store, turn.id, src.id, { volatility: 'high', lastVerifiedAtUtc: '2026-01-01T00:00:00.000Z' });
      const fresh = claimFixture(store, turn.id, src.id, { volatility: 'high', lastVerifiedAtUtc: '2026-11-15T00:00:00.000Z' });
      const ids = store.staleClaims(new Date('2026-11-16T00:00:00.000Z'), 10).map((claim) => claim.id);
      expect(ids).toEqual([stale.id]);
      void fresh;
    }
  });
});

describe('writablePath', () => {
  it('keeps the requested path when its directory can be created', async () => {
    const { writablePath } = await import('./sqliteStore');
    expect(writablePath('/data/minimi.db', () => {})).toBe('/data/minimi.db');
  });

  it('falls back to the temp directory when the directory is read-only (as on Vercel)', async () => {
    const { writablePath } = await import('./sqliteStore');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const readOnly = (dir: string): void => {
      if (dir === '/var/task/data') throw Object.assign(new Error('read-only file system'), { code: 'EROFS' });
    };
    expect(writablePath('/var/task/data/minimi.db', readOnly)).toBe(join(tmpdir(), 'minimi.db'));
  });
});
