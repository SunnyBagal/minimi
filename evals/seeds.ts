/**
 * Seed rows from the table in docs/02-evals.md. Both turns use origin `seed`.
 * The assistant turn is a fresh answer whose extraction is already done.
 * Every claim quote is a substring of its v1 source text.
 */
import type { ClaimScope, MemoryStore, NewClaim, Turn, Volatility } from '../src/core/contracts';
import { readFixture, URLS } from './pages';

export type SeedId = 'S-PG' | 'S-NOV3' | 'S-CRM' | 'S-PG-OLD' | 'S-LATE' | 'S-LA';

export interface SeedOptions {
  /** Case 6 moves S-PG onto Thu 5 Nov 2026. The instant is 14:05 IST that day. */
  pgOnThursday5Nov?: boolean;
  /** Case 15 stores the Northwind quote from the third-party blog, not the vendor page. */
  northwindFromBlog?: boolean;
}

const SEED_SESSION = 'seed';

interface When {
  createdAtUtc: string;
  localDate: string;
  tz: string;
}

interface ClaimSeed {
  entity: string;
  attribute: string;
  value: string;
  scope: ClaimScope;
  quote: string;
  volatility: Volatility;
  file: string;
  url: string;
}

function savePair(
  store: MemoryStore,
  when: When,
  user: string,
  assistant: string,
  topic: string,
  entities: string[],
): { assistant: Turn } {
  const base = {
    sessionId: SEED_SESSION,
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
  return { assistant: saved };
}

function saveClaims(store: MemoryStore, turnId: string, when: When, claims: ClaimSeed[]): void {
  const byUrl = new Map<string, { id: string; file: string }>();
  const rows: NewClaim[] = [];
  for (const claim of claims) {
    let source = byUrl.get(claim.url);
    if (source === undefined) {
      const saved = store.saveSource({
        url: claim.url,
        finalUrl: claim.url,
        title: new URL(claim.url).hostname,
        publishedAt: null,
        fetchedAtUtc: when.createdAtUtc,
        live: true,
        firstParty: !claim.url.includes('thirdparty.test'),
        httpStatus: 200,
        text: readFixture(claim.file),
      });
      source = { id: saved.id, file: claim.file };
      byUrl.set(claim.url, source);
    }
    rows.push({
      turnId,
      entity: claim.entity,
      attribute: claim.attribute,
      value: claim.value,
      scope: claim.scope,
      sourceId: source.id,
      quote: claim.quote,
      asOfUtc: when.createdAtUtc,
      volatility: claim.volatility,
      lastVerifiedAtUtc: when.createdAtUtc,
      supersedesId: null,
    });
  }
  store.saveClaims(rows);
}

const PG_WHEN: When = {
  createdAtUtc: '2026-11-10T08:35:00.000Z',
  localDate: '2026-11-10',
  tz: 'Asia/Kolkata',
};
const PG_THURSDAY: When = {
  createdAtUtc: '2026-11-05T08:35:00.000Z',
  localDate: '2026-11-05',
  tz: 'Asia/Kolkata',
};

const monthUsd = (plan: string, unit: ClaimScope['unit']): ClaimScope => ({
  plan,
  period: 'month',
  currency: 'USD',
  unit,
});

function pgClaims(fromBlog: boolean): ClaimSeed[] {
  return [
    {
      entity: 'Northwind PG',
      attribute: 'price',
      value: '19 USD/month',
      scope: monthUsd('Starter', 'flat'),
      quote: 'Northwind PG Starter is 19 USD per month.',
      volatility: 'high',
      file: fromBlog ? 'thirdparty-blog-v1.txt' : 'northwind-pricing-v1.txt',
      url: fromBlog ? URLS.thirdPartyBlog : URLS.northwindPricing,
    },
    {
      entity: 'Basalt DB',
      attribute: 'price',
      value: '25 USD/month',
      scope: monthUsd('Pro', 'flat'),
      quote: 'Basalt DB Pro is 25 USD per month.',
      volatility: 'high',
      file: 'basalt-pricing-v1.txt',
      url: URLS.basaltPricing,
    },
    {
      entity: 'Basalt DB',
      attribute: 'free tier',
      value: '1 project',
      scope: { plan: 'Free', period: 'month', unit: 'flat' },
      quote: 'Basalt DB free tier includes 1 project.',
      volatility: 'medium',
      file: 'basalt-pricing-v1.txt',
      url: URLS.basaltPricing,
    },
  ];
}

function loadPg(
  store: MemoryStore,
  when: When,
  user: string,
  topic: string,
  entities: string[],
  fromBlog: boolean,
): void {
  const { assistant } = savePair(
    store,
    when,
    user,
    'Northwind PG Starter is 19 USD per month. Basalt DB Pro is 25 USD per month. Basalt DB free tier includes 1 project.',
    topic,
    entities,
  );
  saveClaims(store, assistant.id, when, pgClaims(fromBlog));
}

function load(store: MemoryStore, id: SeedId, options: SeedOptions): void {
  if (id === 'S-PG') {
    loadPg(
      store,
      options.pgOnThursday5Nov ? PG_THURSDAY : PG_WHEN,
      'Compare Postgres hosting for a small SaaS: Northwind PG or Basalt DB?',
      'Postgres hosting',
      ['Northwind PG', 'Basalt DB'],
      options.northwindFromBlog === true,
    );
    return;
  }
  if (id === 'S-PG-OLD') {
    const when: When = {
      createdAtUtc: '2026-11-03T11:40:00.000Z',
      localDate: '2026-11-03',
      tz: 'Asia/Kolkata',
    };
    const { assistant } = savePair(
      store,
      when,
      'Is managed Postgres worth it over a VPS?',
      'Northwind PG Starter is 19 USD per month.',
      'Postgres hosting',
      ['Northwind PG'],
    );
    const claim = pgClaims(false)[0];
    if (claim !== undefined) saveClaims(store, assistant.id, when, [claim]);
    return;
  }
  if (id === 'S-NOV3') {
    const when: When = {
      createdAtUtc: '2026-11-03T05:50:00.000Z',
      localDate: '2026-11-03',
      tz: 'Asia/Kolkata',
    };
    const { assistant } = savePair(
      store,
      when,
      "What does Pipeloom's Team plan cost per seat?",
      'Pipeloom Team is 30 USD per seat per month.',
      'Pipeloom pricing',
      ['Pipeloom'],
    );
    saveClaims(store, assistant.id, when, [
      {
        entity: 'Pipeloom',
        attribute: 'price',
        value: '30 USD/seat/month',
        scope: monthUsd('Team', 'seat'),
        quote: 'Pipeloom Team is 30 USD per seat per month.',
        volatility: 'high',
        file: 'pipeloom-pricing-v1.txt',
        url: URLS.pipeloomPricing,
      },
    ]);
    return;
  }
  if (id === 'S-CRM') {
    const when: When = {
      createdAtUtc: '2026-11-09T11:10:00.000Z',
      localDate: '2026-11-09',
      tz: 'Asia/Kolkata',
    };
    const tools: Array<{ entity: string; value: string; quote: string; file: string; url: string }> = [
      {
        entity: 'Pipeloom',
        value: '18 USD/seat/month',
        quote: 'Pipeloom is 18 USD per seat per month.',
        file: 'pipeloom-pricing-v1.txt',
        url: URLS.pipeloomPricing,
      },
      {
        entity: 'Dealbase',
        value: '22 USD/seat/month',
        quote: 'Dealbase is 22 USD per seat per month.',
        file: 'dealbase-pricing-v1.txt',
        url: URLS.dealbasePricing,
      },
      {
        entity: 'Closewise',
        value: '15 USD/seat/month',
        quote: 'Closewise is 15 USD per seat per month.',
        file: 'closewise-pricing-v1.txt',
        url: URLS.closewisePricing,
      },
      {
        entity: 'Leadharbor',
        value: '27 USD/seat/month',
        quote: 'Leadharbor is 27 USD per seat per month.',
        file: 'leadharbor-pricing-v1.txt',
        url: URLS.leadharborPricing,
      },
      {
        entity: 'Salesyard',
        value: '21 USD/seat/month',
        quote: 'Salesyard is 21 USD per seat per month.',
        file: 'salesyard-pricing-v1.txt',
        url: URLS.salesyardPricing,
      },
    ];
    const { assistant } = savePair(
      store,
      when,
      'Shortlist 5 CRM tools for a 20-person sales team.',
      tools.map((tool) => tool.quote).join(' '),
      'CRM tools',
      tools.map((tool) => tool.entity),
    );
    saveClaims(
      store,
      assistant.id,
      when,
      tools.map((tool) => ({
        entity: tool.entity,
        attribute: 'price',
        value: tool.value,
        scope: monthUsd('Seat', 'seat'),
        quote: tool.quote,
        volatility: 'high' as const,
        file: tool.file,
        url: tool.url,
      })),
    );
    return;
  }
  if (id === 'S-LATE') {
    savePair(
      store,
      {
        createdAtUtc: '2026-11-10T18:20:00.000Z',
        localDate: '2026-11-10',
        tz: 'Asia/Kolkata',
      },
      'Remind me what a connection pooler does.',
      'A connection pooler reuses database connections.',
      'connection pooler',
      [],
    );
    return;
  }
  const when: When = {
    createdAtUtc: '2026-11-10T07:30:00.000Z',
    localDate: '2026-11-09',
    tz: 'America/Los_Angeles',
  };
  const { assistant } = savePair(
    store,
    when,
    'Which Postgres extensions does Basalt DB support?',
    'Basalt DB extensions include pgvector, PostGIS.',
    'Basalt DB extensions',
    ['Basalt DB'],
  );
  saveClaims(store, assistant.id, when, [
    {
      entity: 'Basalt DB',
      attribute: 'extensions',
      value: 'pgvector, PostGIS',
      scope: {},
      quote: 'Basalt DB extensions include pgvector, PostGIS.',
      volatility: 'low',
      file: 'basalt-extensions-v1.txt',
      url: URLS.basaltExtensions,
    },
  ]);
}

export function loadSeeds(store: MemoryStore, ids: readonly SeedId[], options: SeedOptions = {}): void {
  for (const id of ids) load(store, id, options);
}
