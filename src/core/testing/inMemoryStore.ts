/**
 * The whole MemoryStore, in memory. Used by tests, by the evals' self-test and,
 * until Lane 2 merges, by the live app (so history is lost on restart).
 * Rows are copied on the way in and on the way out, so a caller cannot change
 * stored state by mutating what it passed or received.
 */
import type {
  AgentConfig,
  Check,
  Claim,
  ClaimVersion,
  ExtractionState,
  Id,
  IsoUtc,
  LocalDate,
  MemoryHit,
  MemoryStore,
  NewCheck,
  NewClaim,
  NewSource,
  NewTurn,
  Source,
  Turn,
  Volatility,
} from '../contracts';
import { defaultConfig } from '../config';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Words of three letters or more, lowercased. Enough for topic and entity overlap. */
function terms(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [];
}

/** The calendar date `days` after `date`. Pure date arithmetic, no zone involved. */
function shiftDate(date: LocalDate, days: number): LocalDate {
  const [year = 0, month = 1, day = 1] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

interface Pair {
  userTurn: Turn;
  assistantTurn: Turn | null;
}

export class InMemoryStore implements MemoryStore {
  private readonly turnRows: Turn[] = [];
  private readonly sourceRows: Source[] = [];
  private readonly claimRows: Claim[] = [];
  private readonly checkRows: Check[] = [];
  private readonly shelfLifeDays: Record<Volatility, number>;
  private nextId = 1;

  constructor(config: Pick<AgentConfig, 'shelfLifeDays'> = defaultConfig) {
    this.shelfLifeDays = { ...config.shelfLifeDays };
  }

  private newId(prefix: string): Id {
    return `${prefix}-${this.nextId++}`;
  }

  // ------------------------------------------------- rows, for test assertions

  allTurns(): Turn[] {
    return structuredClone(this.turnRows);
  }

  allSources(): Source[] {
    return structuredClone(this.sourceRows);
  }

  allClaims(): Claim[] {
    return structuredClone(this.claimRows);
  }

  allChecks(): Check[] {
    return structuredClone(this.checkRows);
  }

  // --------------------------------------------------------------------- turns

  saveTurn(turn: NewTurn): Turn {
    const row: Turn = { ...structuredClone(turn), id: this.newId('turn') };
    this.turnRows.push(row);
    return structuredClone(row);
  }

  updateTurnMeta(id: Id, meta: Pick<Turn, 'topic' | 'entities' | 'summary'>): void {
    const row = this.turnRows.find((turn) => turn.id === id);
    if (row === undefined) return;
    row.topic = meta.topic;
    row.entities = [...meta.entities];
    row.summary = meta.summary;
  }

  setExtraction(turnId: Id, state: ExtractionState): void {
    const row = this.turnRows.find((turn) => turn.id === turnId);
    if (row !== undefined) row.extraction = state;
  }

  /** The last `limit` turns of the session, oldest first. */
  recentTurns(sessionId: Id, limit: number): Turn[] {
    if (limit <= 0) return [];
    const inSession = this.turnRows.filter((turn) => turn.sessionId === sessionId);
    return structuredClone(inSession.slice(-limit));
  }

  /** In the order of `ids`. Unknown ids are left out. */
  getTurns(ids: Id[]): Turn[] {
    const found: Turn[] = [];
    for (const id of ids) {
      const row = this.turnRows.find((turn) => turn.id === id);
      if (row !== undefined) found.push(structuredClone(row));
    }
    return found;
  }

  /**
   * Every user turn paired with the assistant turn that answered it: the next
   * turn of the same session, when that turn is an assistant turn.
   * An excluded user turn drops the pair. An excluded assistant turn is
   * replaced by null, so an excluded id is never returned in either position.
   */
  private pairs(excludeTurnIds: Id[]): Pair[] {
    const excluded = new Set(excludeTurnIds);
    const result: Pair[] = [];
    for (const userTurn of this.turnRows) {
      if (userTurn.role !== 'user' || excluded.has(userTurn.id)) continue;
      const session = this.turnRows.filter((turn) => turn.sessionId === userTurn.sessionId);
      const next = session[session.indexOf(userTurn) + 1];
      const answered = next !== undefined && next.role === 'assistant' && !excluded.has(next.id);
      result.push({ userTurn, assistantTurn: answered ? next : null });
    }
    return result;
  }

  /** How many distinct query terms appear in the pair's content, topic, entities or summary. */
  private overlap(pair: Pair, topic: string | undefined, entities: string[] | undefined): number {
    const wanted = new Set(terms([topic ?? '', ...(entities ?? [])].join(' ')));
    if (wanted.size === 0) return 0;
    const haystack = new Set<string>();
    for (const turn of [pair.userTurn, pair.assistantTurn]) {
      if (turn === null) continue;
      for (const term of terms([turn.content, turn.topic ?? '', turn.summary ?? '', ...turn.entities].join(' '))) {
        haystack.add(term);
      }
    }
    let count = 0;
    for (const term of wanted) if (haystack.has(term)) count += 1;
    return count;
  }

  private toHits(scored: { pair: Pair; matched: MemoryHit['matched']; score: number }[], limit: number): MemoryHit[] {
    scored.sort(
      (a, b) => b.score - a.score || (a.pair.userTurn.createdAtUtc < b.pair.userTurn.createdAtUtc ? 1 : -1),
    );
    return scored.slice(0, Math.max(0, limit)).map(({ pair, matched, score }) => ({
      userTurn: structuredClone(pair.userTurn),
      assistantTurn: structuredClone(pair.assistantTurn),
      matched,
      score,
    }));
  }

  /**
   * With `dates` or `range`: only turns on those dates, ranked by topic and
   * entity overlap; a turn with no overlap still matches, as `date`.
   * With neither: only turns with some overlap, as `topic`.
   */
  findTurns(query: {
    dates?: LocalDate[];
    range?: { from: LocalDate; to: LocalDate };
    topic?: string;
    entities?: string[];
    excludeTurnIds: Id[];
    limit: number;
  }): MemoryHit[] {
    const dated = query.dates !== undefined || query.range !== undefined;
    const scored: { pair: Pair; matched: MemoryHit['matched']; score: number }[] = [];
    for (const pair of this.pairs(query.excludeTurnIds)) {
      const date = pair.userTurn.localDate;
      const onDate =
        (query.dates?.includes(date) ?? false) ||
        (query.range !== undefined && date >= query.range.from && date <= query.range.to);
      if (dated && !onDate) continue;
      const score = this.overlap(pair, query.topic, query.entities);
      if (!dated && score === 0) continue;
      scored.push({ pair, matched: dated ? (score > 0 ? 'date+topic' : 'date') : 'topic', score });
    }
    return this.toHits(scored, query.limit);
  }

  /**
   * Turns on the day before or after any `around` date (`date`, or `date+topic`
   * with overlap), and turns on other dates that overlap the topic (`topic`).
   * Turns on the `around` dates themselves are left out: findTurns covers those.
   */
  nearestTurns(query: {
    around: LocalDate[];
    topic?: string;
    entities?: string[];
    excludeTurnIds: Id[];
    limit: number;
  }): MemoryHit[] {
    const around = new Set(query.around);
    const adjacent = new Set<LocalDate>();
    for (const date of query.around) {
      for (const days of [-1, 1]) {
        const near = shiftDate(date, days);
        if (!around.has(near)) adjacent.add(near);
      }
    }
    const scored: { pair: Pair; matched: MemoryHit['matched']; score: number }[] = [];
    for (const pair of this.pairs(query.excludeTurnIds)) {
      const date = pair.userTurn.localDate;
      if (around.has(date)) continue;
      const score = this.overlap(pair, query.topic, query.entities);
      if (adjacent.has(date)) {
        scored.push({ pair, matched: score > 0 ? 'date+topic' : 'date', score });
      } else if (score > 0) {
        scored.push({ pair, matched: 'topic', score });
      }
    }
    return this.toHits(scored, query.limit);
  }

  // ------------------------------------------------------- sources and claims

  saveSource(source: NewSource): Source {
    const row: Source = { ...structuredClone(source), id: this.newId('source') };
    this.sourceRows.push(row);
    return structuredClone(row);
  }

  /** In the order of `ids`. Unknown ids are left out. */
  getSources(ids: Id[]): Source[] {
    const found: Source[] = [];
    for (const id of ids) {
      const row = this.sourceRows.find((source) => source.id === id);
      if (row !== undefined) found.push(structuredClone(row));
    }
    return found;
  }

  saveClaims(claims: NewClaim[]): Claim[] {
    const rows = claims.map((claim): Claim => ({ ...structuredClone(claim), id: this.newId('claim') }));
    this.claimRows.push(...rows);
    return structuredClone(rows);
  }

  /** The newest claim in the supersedes chain that `claim` belongs to. */
  private newestInChain(claim: Claim): Claim {
    let current = claim;
    const seen = new Set<Id>([current.id]);
    for (;;) {
      const currentId = current.id;
      const next = this.claimRows.find((row) => row.supersedesId === currentId && !seen.has(row.id));
      if (next === undefined) return current;
      seen.add(next.id);
      current = next;
    }
  }

  /**
   * as_stated: the claims those turns wrote, superseded ones included.
   * current:   the newest claim in each of those claims' chains, whichever turn
   *            wrote it, each chain once.
   */
  claimsForTurns(turnIds: Id[], version: ClaimVersion): Claim[] {
    const wanted = new Set(turnIds);
    const stated = this.claimRows.filter((claim) => wanted.has(claim.turnId));
    if (version === 'as_stated') return structuredClone(stated);
    const current: Claim[] = [];
    for (const claim of stated) {
      const newest = this.newestInChain(claim);
      if (!current.includes(newest)) current.push(newest);
    }
    return structuredClone(current);
  }

  saveCheck(check: NewCheck): Check {
    const row: Check = { ...structuredClone(check), id: this.newId('check') };
    this.checkRows.push(row);
    return structuredClone(row);
  }

  touchVerified(claimId: Id, at: IsoUtc): void {
    const row = this.claimRows.find((claim) => claim.id === claimId);
    if (row !== undefined) row.lastVerifiedAtUtc = at;
  }

  /**
   * Claims that nothing supersedes and whose last verification is older than
   * the shelf life for their volatility. Longest unverified first.
   */
  staleClaims(now: Date, limit: number): Claim[] {
    const superseded = new Set(this.claimRows.map((claim) => claim.supersedesId));
    const stale = this.claimRows.filter((claim) => {
      if (superseded.has(claim.id)) return false;
      const ageMs = now.getTime() - new Date(claim.lastVerifiedAtUtc).getTime();
      return ageMs > this.shelfLifeDays[claim.volatility] * MS_PER_DAY;
    });
    stale.sort((a, b) => (a.lastVerifiedAtUtc < b.lastVerifiedAtUtc ? -1 : a.lastVerifiedAtUtc > b.lastVerifiedAtUtc ? 1 : 0));
    return structuredClone(stale.slice(0, Math.max(0, limit)));
  }
}
