/**
 * Seed: three labelled conversations, each one real runTurn call at a
 * back-dated 11:00 local instant, so a fresh clone has history to recall on
 * whatever day it is reviewed. Re-running deletes the previous seed rows
 * (origin 'seed' and marked seed sources) first; live rows are never touched.
 *
 * The pipeline stamps each search-result source with deps.clock.now()
 * (fresh.ts), so a back-dated clock would lie about fetch times and claim
 * asOfUtc values. Instead this script passes runTurn a wrapping store whose
 * saveSource re-stamps fetchedAtUtc with the real deps.clock before
 * delegating; the pipeline builds its SourceRefs — and thus claim
 * asOfUtc/lastVerifiedAtUtc — from the returned Source.
 */
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { DateTime } from 'luxon';
import { getDeps } from '../src/compose';
import type {
  AgentConfig,
  AgentDeps,
  AgentEvent,
  Check,
  Claim,
  ClaimVersion,
  Clock,
  ExtractionState,
  IanaTz,
  Id,
  Llm,
  LocalDate,
  MemoryHit,
  MemoryStore,
  NewCheck,
  NewClaim,
  NewSource,
  NewTurn,
  Source,
  TimeFns,
  Turn,
} from '../src/core/contracts';
import { createLlm } from '../src/core/llm/index';
import { runTurn } from '../src/core/pipeline/runTurn';
import { SqliteStore } from '../src/core/store/sqliteStore';
import { systemClock } from '../src/core/systemClock';

interface SeedConversation {
  key: string;
  date: LocalDate;
  userTurnId: Id;
  assistantTurnId: Id;
  claims: number;
  sources: number;
}

interface SeedFailure {
  key: string;
  date: LocalDate;
  message: string;
  reason: string;
}

export interface SeedResult {
  dates: { monday: LocalDate; tuesday: LocalDate; nov3: LocalDate };
  conversations: SeedConversation[];
  failures: SeedFailure[];
}

/** The calendar dates the seed writes, all strictly before today. */
export function seedDates(
  now: Date,
  tz: IanaTz,
  time: TimeFns,
): { monday: LocalDate; tuesday: LocalDate; nov3: LocalDate } {
  const lastMonday = time.resolveTimeRef({ kind: 'weekday', weekday: 1, modifier: 'last' }, now, tz);
  const lastTuesday = time.resolveTimeRef({ kind: 'weekday', weekday: 2, modifier: 'last' }, now, tz);
  const monday = lastMonday.dates[0];
  const tuesday = lastTuesday.dates[0];
  if (monday === undefined || tuesday === undefined) {
    throw new Error('resolveTimeRef returned no date for last Monday/Tuesday');
  }
  const today = time.toLocalDate(now, tz);
  const year = Number(today.slice(0, 4));
  // The brief says "on or before today" but its acceptance requires strictly
  // before; on 3 Nov the previous year is used so the two never conflict.
  const nov3 = `${year}-11-03` < today ? `${year}-11-03` : `${year - 1}-11-03`;
  return { monday, tuesday, nov3 };
}

/**
 * Batch deadlines for seed runs: no user is waiting, and the interactive
 * budgets are too tight. Measured real run of the CRM seed message: write
 * 14426 ms, evidence 10 sources / 151682 chars, extractClaims 33554 ms —
 * past both the 30000 extract and 45000 turn defaults. 90000 is about 2.7×
 * the measured extraction; 180000 leaves room for that plus the write.
 */
export function seedConfig(config: AgentConfig): AgentConfig {
  return {
    ...config,
    deadlinesMs: { ...config.deadlinesMs, extract: 90000, turn: 180000 },
  };
}

/** A clock pinned at one instant — written here, not imported from testing. */
function fixedClock(instant: Date): Clock {
  return { now: () => new Date(instant.getTime()) };
}

/**
 * Delegates every MemoryStore method to the real store except saveSource,
 * which re-stamps fetchedAtUtc with the real clock (see the file comment),
 * records the source id for this conversation and marks it as a seed source.
 */
class SeedStore implements MemoryStore {
  readonly savedSourceIds: Id[] = [];

  constructor(
    private readonly inner: SqliteStore,
    private readonly realClock: Clock,
  ) {}

  saveTurn(turn: NewTurn): Turn {
    return this.inner.saveTurn(turn);
  }

  updateTurnMeta(id: Id, meta: Pick<Turn, 'topic' | 'entities' | 'summary'>): void {
    this.inner.updateTurnMeta(id, meta);
  }

  setExtraction(turnId: Id, state: ExtractionState): void {
    this.inner.setExtraction(turnId, state);
  }

  recentTurns(sessionId: Id, limit: number): Turn[] {
    return this.inner.recentTurns(sessionId, limit);
  }

  getTurns(ids: Id[]): Turn[] {
    return this.inner.getTurns(ids);
  }

  findTurns(query: {
    dates?: LocalDate[];
    range?: { from: LocalDate; to: LocalDate };
    topic?: string;
    entities?: string[];
    excludeTurnIds: Id[];
    limit: number;
  }): MemoryHit[] {
    return this.inner.findTurns(query);
  }

  nearestTurns(query: {
    around: LocalDate[];
    topic?: string;
    entities?: string[];
    excludeTurnIds: Id[];
    limit: number;
  }): MemoryHit[] {
    return this.inner.nearestTurns(query);
  }

  saveSource(source: NewSource): Source {
    const saved = this.inner.saveSource({
      ...source,
      fetchedAtUtc: this.realClock.now().toISOString(),
    });
    this.inner.markSeedSource(saved.id);
    this.savedSourceIds.push(saved.id);
    return saved;
  }

  getSources(ids: Id[]): Source[] {
    return this.inner.getSources(ids);
  }

  saveClaims(claims: NewClaim[]): Claim[] {
    return this.inner.saveClaims(claims);
  }

  claimsForTurns(turnIds: Id[], version: ClaimVersion): Claim[] {
    return this.inner.claimsForTurns(turnIds, version);
  }

  saveCheck(check: NewCheck): Check {
    return this.inner.saveCheck(check);
  }

  touchVerified(claimId: Id, at: string): void {
    this.inner.touchVerified(claimId, at);
  }

  staleClaims(now: Date, limit: number): Claim[] {
    return this.inner.staleClaims(now, limit);
  }
}

const SEED_PROMPTS = [
  {
    key: 'monday',
    date: (d: ReturnType<typeof seedDates>) => d.monday,
    message: 'Shortlist 5 CRM tools for a 20-person sales team.',
  },
  {
    key: 'tuesday',
    date: (d: ReturnType<typeof seedDates>) => d.tuesday,
    message:
      'Compare managed Postgres hosting: what do Neon, Supabase and Render charge for their entry paid plans right now?',
  },
  {
    key: 'nov3',
    date: (d: ReturnType<typeof seedDates>) => d.nov3,
    message: "What does Notion's Plus plan cost per member per month right now?",
  },
];

/** Runs the three seed conversations against deps. See SeedResult. */
export async function seed(deps: AgentDeps, today: Clock, tz: IanaTz): Promise<SeedResult> {
  if (!(deps.store instanceof SqliteStore)) {
    throw new Error('seed: deps.store is not a SqliteStore — the seed needs deleteSeed/markSeedSource');
  }
  const store = deps.store;
  const removed = store.deleteSeed();
  console.log(
    `seed: cleared ${removed.turns} turn(s), ${removed.claims} claim(s), ${removed.checks} check(s), ${removed.sources} source(s) from the previous seed`,
  );

  const dates = seedDates(today.now(), tz, deps.time);
  const prompts = [...SEED_PROMPTS]
    .map((prompt) => ({ ...prompt, date: prompt.date(dates) }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const result: SeedResult = { dates, conversations: [], failures: [] };
  for (const { key, date, message } of prompts) {
    const sessionId = crypto.randomUUID();
    const instant = DateTime.fromISO(`${date}T11:00`, { zone: tz }).toUTC().toJSDate();
    const wrapper = new SeedStore(store, deps.clock);
    // extractInto swallows the extractor's error, so record it here to say why.
    let extractError: string | null = null;
    const llm: Llm = {
      route: (input) => deps.llm.route(input),
      extractClaims: async (input) => {
        try {
          return await deps.llm.extractClaims(input);
        } catch (error) {
          extractError = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
          throw error;
        }
      },
      judge: (input) => deps.llm.judge(input),
      write: (input, signal) => deps.llm.write(input, signal),
    };
    const events: AgentEvent[] = [];
    let runError: string | null = null;
    try {
      for await (const event of runTurn(
        { sessionId, message, tz, origin: 'seed' },
        { ...deps, clock: fixedClock(instant), store: wrapper, llm },
      )) {
        events.push(event);
      }
    } catch (error) {
      runError = error instanceof Error ? error.message : String(error);
    }

    const errorEvent = events.find((event) => event.type === 'error');
    const done = events.find((event) => event.type === 'done');
    const assistant = done !== undefined && done.type === 'done' ? store.getTurns([done.turnId])[0] : undefined;
    const citations = events.find((event) => event.type === 'citations');
    const cited = citations !== undefined && citations.type === 'citations' ? citations.items.length : 0;

    let reason: string | null = null;
    if (runError !== null) reason = runError;
    else if (errorEvent !== undefined && errorEvent.type === 'error')
      reason = `${errorEvent.stage}: ${errorEvent.message}`;
    else if (assistant === undefined) reason = 'turn did not finish';
    else if (assistant.intent !== 'fresh') reason = `routed to ${assistant.intent ?? 'none'}`;
    else if (cited === 0) reason = 'search returned nothing';
    else if (assistant.extraction !== 'done')
      reason =
        extractError !== null
          ? `claim extraction failed (${extractError})`
          : `claim extraction ${assistant.extraction}`;

    if (reason !== null || assistant === undefined) {
      store.deleteSeed({ sessionId, sourceIds: wrapper.savedSourceIds });
      const failure = { key, date, message, reason: reason ?? 'turn did not finish' };
      result.failures.push(failure);
      console.log(`seed: ${key} ${date} FAILED — ${failure.reason}`);
      continue;
    }

    const userTurn = store.recentTurns(sessionId, 2).find((turn) => turn.role === 'user');
    const claims = store.claimsForTurns([assistant.id], 'as_stated').length;
    result.conversations.push({
      key,
      date,
      userTurnId: userTurn?.id ?? '',
      assistantTurnId: assistant.id,
      claims,
      sources: wrapper.savedSourceIds.length,
    });
    console.log(`seed: ${key} ${date} — ${claims} claim(s), ${wrapper.savedSourceIds.length} source(s)`);
  }
  return result;
}

async function main(): Promise<void> {
  if (existsSync('.env')) process.loadEnvFile('.env');
  const base = getDeps();
  // The Llm closes over its config at creation, so it is rebuilt, not patched.
  const config = seedConfig(base.config);
  const deps: AgentDeps = {
    ...base,
    config,
    llm: createLlm(process.env.ANTHROPIC_API_KEY ?? '', config),
  };
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const result = await seed(deps, systemClock, tz);
  process.exitCode = result.failures.length > 0 ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await main().catch((error: unknown) => {
    console.error(`seed: FAILED — ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
