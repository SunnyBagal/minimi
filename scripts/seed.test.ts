import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import type { AgentDeps, Clock } from '../src/core/contracts';
import { defaultConfig } from '../src/core/config';
import { runTurn } from '../src/core/pipeline/runTurn';
import { containsQuote } from '../src/core/search/index';
import { SqliteStore } from '../src/core/store/sqliteStore';
import type { FakeLlmScript, FakeSearchScript, RouteInput } from '../src/core/testing/fakes';
import { FakeClock, FakeLlm, FakeSearch, chatPlan, passThroughGuard } from '../src/core/testing/fakes';
import { time } from '../src/core/time/index';
import { seed, seedDates } from './seed';

const tmpDirs: string[] = [];
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function tmpDb(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'minimi-seed-'));
  tmpDirs.push(dir);
  return path.join(dir, 'minimi.db');
}

/** The "real" instant the fetches stamp, deliberately not a seed date. */
const REAL_INSTANT = '2026-11-18T09:00:00.000Z';
const SOURCE_TEXT = 'Acme CRM costs 19 USD per seat per month for a 20-person sales team.';
const SOURCE_RESULT = {
  url: 'https://acme.test/pricing',
  title: 'Acme pricing',
  publishedAt: null,
  text: SOURCE_TEXT,
};

function route(input: RouteInput) {
  const message = input.message;
  if (message.includes('CRM')) {
    return chatPlan({
      intent: 'fresh',
      topic: 'CRM tools shortlist for a sales team',
      entities: ['Acme CRM'],
      queries: ['crm tools pricing for small sales teams'],
    });
  }
  if (message.includes('Postgres')) {
    return chatPlan({
      intent: 'fresh',
      topic: 'Managed Postgres hosting entry paid plan prices',
      entities: ['Neon', 'Supabase', 'Render'],
      queries: ['postgres hosting entry plan price neon supabase render'],
    });
  }
  return chatPlan({
    intent: 'fresh',
    topic: 'Notion Plus plan price',
    entities: ['Notion Plus'],
    queries: ['notion plus plan price per member month'],
  });
}

function makeLlm(overrides: FakeLlmScript = {}): FakeLlm {
  return new FakeLlm({
    route,
    write: ['The entry plan costs 19 USD per seat per month [1].'],
    extractClaims: () => [
      {
        entity: 'Acme',
        attribute: 'entry price',
        value: '19 USD per seat per month',
        scope: { currency: 'USD', period: 'month', unit: 'seat' },
        quote: 'costs 19 USD per seat per month',
        volatility: 'medium',
        sourceN: 1,
      },
    ],
    ...overrides,
  });
}

function makeDeps(options: { search?: FakeSearchScript; llm?: FakeLlmScript } = {}): {
  deps: AgentDeps;
  store: SqliteStore;
  realClock: FakeClock;
  dbPath: string;
} {
  const realClock = new FakeClock(REAL_INSTANT);
  const dbPath = tmpDb();
  const store = new SqliteStore(dbPath, realClock, defaultConfig);
  const deps: AgentDeps = {
    clock: realClock,
    store,
    search: new FakeSearch(new FakeClock(REAL_INSTANT), {
      results: { '*': [SOURCE_RESULT] },
      ...options.search,
    }),
    llm: makeLlm(options.llm),
    time,
    guardVerdict: passThroughGuard,
    config: defaultConfig,
  };
  return { deps, store, realClock, dbPath };
}

const at = (instant: string): FakeClock => new FakeClock(instant);

describe('seedDates', () => {
  it('seed dates are always strictly before today', () => {
    const zones = ['UTC', 'Asia/Kolkata', 'America/Los_Angeles'];
    const times = ['00:30', '11:00', '23:30'];
    for (
      let day = DateTime.fromISO('2026-10-20', { zone: 'UTC' });
      day <= DateTime.fromISO('2027-01-10', { zone: 'UTC' });
      day = day.plus({ days: 1 })
    ) {
      for (const zone of zones) {
        for (const hour of times) {
          const now = DateTime.fromISO(`${day.toISODate() ?? ''}T${hour}`, { zone }).toJSDate();
          const today = time.toLocalDate(now, zone);
          const dates = seedDates(now, zone, time);
          for (const date of [dates.monday, dates.tuesday, dates.nov3]) {
            expect(date < today, `${date} !< ${today} (${day.toISODate()} ${hour} ${zone})`).toBe(true);
          }
        }
      }
    }
    // The ambiguous day: on 3 Nov the 3-Nov seed must be last year's.
    expect(seedDates(new Date('2026-11-03T12:00:00Z'), 'UTC', time).nov3).toBe('2025-11-03');
    expect(seedDates(new Date('2026-11-04T12:00:00Z'), 'UTC', time).nov3).toBe('2026-11-03');
  });
});

describe('seed', () => {
  it('with the clock on Tue 17 Nov 2026 it writes Mon 16 Nov, Tue 10 Nov and 3 Nov 2026 at 11:00 local', async () => {
    const { deps, store } = makeDeps();
    const result = await seed(deps, at('2026-11-17T12:00:00Z'), 'UTC');
    expect(result.failures).toEqual([]);
    expect(result.dates).toEqual({ monday: '2026-11-16', tuesday: '2026-11-10', nov3: '2026-11-03' });
    const byDate = new Map(result.conversations.map((conversation) => [conversation.date, conversation]));
    for (const date of ['2026-11-16', '2026-11-10', '2026-11-03']) {
      const conversation = byDate.get(date);
      expect(conversation, `missing conversation for ${date}`).toBeDefined();
      const [user, assistant] = store.getTurns([conversation?.userTurnId ?? '', conversation?.assistantTurnId ?? '']);
      expect(user?.localDate).toBe(date);
      expect(user?.createdAtUtc).toBe(`${date}T11:00:00.000Z`);
      expect(user?.origin).toBe('seed');
      expect(assistant?.localDate).toBe(date);
      expect(assistant?.createdAtUtc).toBe(`${date}T11:00:00.000Z`);
      expect(assistant?.origin).toBe('seed');
      expect(assistant?.intent).toBe('fresh');
    }
  });

  it('with the clock on Mon 16 Nov 2026 it writes Mon 9 Nov, Tue 10 Nov and 3 Nov 2026', async () => {
    const { deps } = makeDeps();
    const result = await seed(deps, at('2026-11-16T12:00:00Z'), 'UTC');
    expect(result.failures).toEqual([]);
    expect(result.dates).toEqual({ monday: '2026-11-09', tuesday: '2026-11-10', nov3: '2026-11-03' });
  });

  it.each([
    { now: '2026-11-17T12:00:00Z' },
    { now: '2026-11-16T12:00:00Z' },
  ])(
    'at $now, "On Monday" and "last Tuesday" include a seeded date and findTurns returns that conversation',
    async ({ now }) => {
      const { deps, store } = makeDeps();
      const result = await seed(deps, at(now), 'UTC');
      expect(result.failures).toEqual([]);
      const pairs: [ReturnType<typeof time.resolveTimeRef>, string][] = [
        [time.resolveTimeRef({ kind: 'weekday', weekday: 1, modifier: 'bare' }, at(now).now(), 'UTC'), 'monday'],
        [time.resolveTimeRef({ kind: 'weekday', weekday: 2, modifier: 'last' }, at(now).now(), 'UTC'), 'tuesday'],
      ];
      for (const [candidates, key] of pairs) {
        const conversation = result.conversations.find((entry) => entry.key === key);
        expect(conversation).toBeDefined();
        expect(candidates.dates).toContain(conversation?.date);
        const [user] = store.getTurns([conversation?.userTurnId ?? '']);
        const hits = store.findTurns({
          dates: [conversation?.date ?? ''],
          topic: user?.topic ?? undefined,
          entities: user?.entities ?? [],
          excludeTurnIds: [],
          limit: 5,
        });
        const hit = hits.find((entry) => entry.userTurn.id === user?.id);
        expect(hit).toBeDefined();
        expect(hit?.assistantTurn?.id).toBe(conversation?.assistantTurnId);
      }
    },
  );

  it('running the seed twice leaves exactly three seeded conversations and a live turn saved between survives', async () => {
    const { deps, store, dbPath } = makeDeps();
    const first = await seed(deps, at('2026-11-17T12:00:00Z'), 'UTC');
    expect(first.failures).toEqual([]);
    const firstSourceIds = first.conversations.flatMap(
      (conversation) => store.claimsForTurns([conversation.assistantTurnId], 'as_stated').map((claim) => claim.sourceId),
    );
    expect(firstSourceIds.length).toBeGreaterThan(0);

    // A live turn between the two seed runs, through runTurn like the app does.
    const sessionId = crypto.randomUUID();
    for await (const event of runTurn(
      { sessionId, message: 'What does Acme CRM cost per seat?', tz: 'UTC' },
      deps,
    )) {
      void event;
    }
    const live = store.recentTurns(sessionId, 2);
    const liveAssistant = live.find((turn) => turn.role === 'assistant');
    const liveClaims = liveAssistant !== undefined ? store.claimsForTurns([liveAssistant.id], 'as_stated') : [];
    expect(live.length).toBe(2);
    expect(liveClaims.length).toBeGreaterThan(0);

    const second = await seed(deps, at('2026-11-18T12:00:00Z'), 'UTC');
    expect(second.failures).toEqual([]);

    const probe = new DatabaseSync(dbPath);
    const turnCount = probe.prepare("SELECT count(*) n FROM turns WHERE origin = 'seed'").get() as { n: number };
    const sessionCount = probe.prepare(
      "SELECT count(*) n FROM sessions s WHERE EXISTS (SELECT 1 FROM turns t WHERE t.session_id = s.id AND t.origin = 'seed')",
    ).get() as { n: number };
    const firstSourcesLeft = firstSourceIds
      .map((id) => probe.prepare('SELECT count(*) n FROM sources WHERE id = ?').get(id) as { n: number })
      .reduce((sum, row) => sum + row.n, 0);
    const marked = probe.prepare('SELECT source_id FROM seed_sources').all() as { source_id: string }[];
    probe.close();

    expect(turnCount.n).toBe(6);
    expect(sessionCount.n).toBe(3);
    expect(firstSourcesLeft).toBe(0);
    const secondSourceIds = second.conversations.flatMap(
      (conversation) => store.claimsForTurns([conversation.assistantTurnId], 'as_stated').map((claim) => claim.sourceId),
    );
    expect(marked.map((row) => row.source_id).sort()).toEqual([...secondSourceIds].sort());

    const liveAfter = store.recentTurns(sessionId, 2);
    expect(liveAfter.map((turn) => turn.id)).toEqual(live.map((turn) => turn.id));
    expect(liveAssistant !== undefined ? store.claimsForTurns([liveAssistant.id], 'as_stated').length : 0).toBe(
      liveClaims.length,
    );
  });

  it("every seeded claim's quote passes containsQuote and every seed source keeps the real fetch time", async () => {
    const { deps, store, realClock } = makeDeps();
    const result = await seed(deps, at('2026-11-17T12:00:00Z'), 'UTC');
    expect(result.failures).toEqual([]);
    const expected = realClock.now().toISOString();
    let claimCount = 0;
    for (const conversation of result.conversations) {
      for (const claim of store.claimsForTurns([conversation.assistantTurnId], 'as_stated')) {
        claimCount += 1;
        const [source] = store.getSources([claim.sourceId]);
        expect(source).toBeDefined();
        expect(containsQuote(source?.text ?? '', claim.quote)).toBe(true);
        expect(source?.fetchedAtUtc).toBe(expected);
        expect(claim.asOfUtc).toBe(expected);
        expect(claim.lastVerifiedAtUtc).toBe(expected);
      }
    }
    expect(claimCount).toBeGreaterThan(0);
  });

  it('a search that returns nothing fails that conversation with "search returned nothing" and removes its rows', async () => {
    const { deps, store } = makeDeps({
      search: { results: { postgres: [], '*': [SOURCE_RESULT] } },
    });
    const result = await seed(deps, at('2026-11-17T12:00:00Z'), 'UTC');
    expect(result.conversations.map((conversation) => conversation.key).sort()).toEqual(['monday', 'nov3']);
    expect(result.failures).toEqual([
      {
        key: 'tuesday',
        date: '2026-11-10',
        message:
          'Compare managed Postgres hosting: what do Neon, Supabase and Render charge for their entry paid plans right now?',
        reason: 'search returned nothing',
      },
    ]);
    const leftovers = store.findTurns({ dates: ['2026-11-10'], excludeTurnIds: [], limit: 10 });
    expect(leftovers).toEqual([]);
  });

  it('a failed claim extraction fails that conversation with "claim extraction failed" and removes its rows', async () => {
    const { deps, store } = makeDeps({
      llm: {
        extractClaims: (_input, call) => {
          if (call === 1) throw new Error('extractor exploded');
          return [
            {
              entity: 'Acme',
              attribute: 'entry price',
              value: '19 USD per seat per month',
              scope: { currency: 'USD', period: 'month', unit: 'seat' },
              quote: 'costs 19 USD per seat per month',
              volatility: 'medium',
              sourceN: 1,
            },
          ];
        },
      },
    });
    const result = await seed(deps, at('2026-11-17T12:00:00Z'), 'UTC');
    // Conversations run oldest first: nov3, tuesday, monday — call 1 is tuesday.
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.key).toBe('tuesday');
    expect(result.failures[0]?.reason).toBe('claim extraction failed');
    const leftovers = store.findTurns({ dates: ['2026-11-10'], excludeTurnIds: [], limit: 10 });
    expect(leftovers).toEqual([]);
  });
});
