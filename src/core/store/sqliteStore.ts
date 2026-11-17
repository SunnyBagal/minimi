/**
 * The MemoryStore on node:sqlite. One DatabaseSync handle per store, WAL mode,
 * foreign keys on, schema applied at boot.
 *
 * Text search has two modes chosen from PRAGMA compile_options at boot:
 * 'fts' keeps an FTS5 virtual table over user turns (findTurns hits are user
 * turns and the router sets topic/entities on the user turn, so the index
 * holds USER turns only); 'like' falls back to bound-parameter LIKE scans —
 * DECISIONS V5 recorded fts5: false on the Node 22.13 engines floor.
 *
 * Every ordering in this file means turns.seq / row seq, never timestamps:
 * test clocks do not advance.
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type {
  AgentConfig,
  Check,
  Claim,
  ClaimVersion,
  Clock,
  Id,
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

/** Date-filtered hits above this many rows get ranked by the text search. */
export const DATE_RANK_MAX_ROWS = 20;

/** Mirrors InMemoryStore.terms(): words of 3+ letters or digits, lowercased. */
const MIN_TERM_CHARS = 3;

/**
 * DECISIONS V5 recorded fts5: false on the Node 22.13 floor, so a missing
 * FTS5 takes the recorded LIKE path rather than throwing.
 */
const FTS5_EXPECTED = false;

/** Thrown when FTS5 is required but the SQLite build lacks it. */
export class Fts5MissingError extends Error {
  constructor() {
    super('This SQLite build has no FTS5 (ENABLE_FTS5 absent), which this deployment requires.');
    this.name = 'Fts5MissingError';
  }
}

/** Picks the text-search mode from the SQLite build's compile options. */
export function chooseTextSearch(compileOptions: string[], fts5Expected: boolean): 'fts' | 'like' {
  const hasFts5 = compileOptions.includes('ENABLE_FTS5');
  if (hasFts5) return 'fts';
  if (fts5Expected) throw new Fts5MissingError();
  return 'like';
}

/** Words of three letters or more, lowercased — the same rule as the fake. */
function terms(text: string): string[] {
  return text.toLowerCase().match(new RegExp(`[\\p{L}\\p{N}]{${MIN_TERM_CHARS},}`, 'gu')) ?? [];
}

/** The calendar date `days` after `date`, pure UTC arithmetic like the fake. */
function shiftDate(date: LocalDate, days: number): LocalDate {
  const [year = 0, month = 1, day = 1] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

interface TurnRow {
  seq: number;
  id: string;
  session_id: string;
  role: string;
  content: string;
  created_at_utc: string;
  tz: string;
  local_date: string;
  origin: string;
  topic: string | null;
  entities_json: string;
  summary: string | null;
  extraction: string;
  intent: string | null;
  target_turn_ids_json: string;
}

function rowToTurn(row: TurnRow): Turn {
  return {
    id: row.id,
    sessionId: row.session_id,
    role: row.role as Turn['role'],
    content: row.content,
    createdAtUtc: row.created_at_utc,
    tz: row.tz,
    localDate: row.local_date,
    origin: row.origin as Turn['origin'],
    topic: row.topic,
    entities: JSON.parse(row.entities_json) as string[],
    summary: row.summary,
    extraction: row.extraction as Turn['extraction'],
    intent: row.intent as Turn['intent'],
    targetTurnIds: JSON.parse(row.target_turn_ids_json) as Id[],
  };
}

interface SourceRow {
  seq: number;
  id: string;
  url: string;
  final_url: string;
  title: string | null;
  published_at: string | null;
  fetched_at_utc: string;
  live: number;
  first_party: number;
  http_status: number | null;
  text: string;
}

function rowToSource(row: SourceRow): Source {
  return {
    id: row.id,
    url: row.url,
    finalUrl: row.final_url,
    title: row.title,
    publishedAt: row.published_at,
    fetchedAtUtc: row.fetched_at_utc,
    live: row.live === 1,
    firstParty: row.first_party === 1,
    httpStatus: row.http_status,
    text: row.text,
  };
}

interface ClaimRow {
  seq: number;
  id: string;
  turn_id: string;
  entity: string;
  attribute: string;
  value: string;
  scope_json: string;
  source_id: string;
  quote: string;
  as_of_utc: string;
  volatility: string;
  last_verified_at_utc: string;
  supersedes_id: string | null;
}

function rowToClaim(row: ClaimRow): Claim {
  return {
    id: row.id,
    turnId: row.turn_id,
    entity: row.entity,
    attribute: row.attribute,
    value: row.value,
    scope: JSON.parse(row.scope_json) as Claim['scope'],
    sourceId: row.source_id,
    quote: row.quote,
    asOfUtc: row.as_of_utc,
    volatility: row.volatility as Volatility,
    lastVerifiedAtUtc: row.last_verified_at_utc,
    supersedesId: row.supersedes_id,
  };
}

interface CheckRow {
  seq: number;
  id: string;
  claim_id: string;
  checked_at_utc: string;
  verdict: string;
  new_value: string | null;
  new_source_id: string | null;
  new_quote: string | null;
  reason: string;
  decided_by: string;
}

function rowToCheck(row: CheckRow): Check {
  return {
    id: row.id,
    claimId: row.claim_id,
    checkedAtUtc: row.checked_at_utc,
    verdict: row.verdict as Check['verdict'],
    newValue: row.new_value,
    newSourceId: row.new_source_id,
    newQuote: row.new_quote,
    reason: row.reason,
    decidedBy: row.decided_by as Check['decidedBy'],
  };
}

type TextSearch = 'fts' | 'like';

export class SqliteStore implements MemoryStore {
  readonly textSearch: TextSearch;
  /** Counts every FTS MATCH or LIKE text query, so tests can prove none ran. */
  readonly stats = { textQueries: 0 };
  private readonly db: DatabaseSync;
  private readonly clock: Clock;
  private readonly shelfLifeDays: Record<Volatility, number>;

  constructor(
    dbPath: string,
    clock: Clock,
    config: AgentConfig,
    options?: { textSearch?: TextSearch },
  ) {
    this.clock = clock;
    this.shelfLifeDays = { ...config.shelfLifeDays };
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA foreign_keys = ON');
    this.db.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));

    const compileOptions = (
      this.db.prepare('PRAGMA compile_options').all() as { compile_options?: string }[]
    )
      .map((row) => row.compile_options ?? '')
      .filter((option) => option !== '');
    this.textSearch =
      options?.textSearch !== undefined
        ? options.textSearch === 'like'
          ? 'like'
          : chooseTextSearch(compileOptions, true)
        : chooseTextSearch(compileOptions, FTS5_EXPECTED);
    if (this.textSearch === 'fts') {
      this.db.exec(
        "CREATE VIRTUAL TABLE IF NOT EXISTS turns_fts USING fts5(content, topic, entities)",
      );
    }
  }

  // --------------------------------------------------------------- queries

  private all<T>(sql: string, params: (string | number | null)[] = []): T[] {
    return this.db.prepare(sql).all(...params) as T[];
  }

  private run(sql: string, params: (string | number | null)[] = []): void {
    this.db.prepare(sql).run(...params);
  }

  /** A NOT IN (...) clause over excludeTurnIds, with bound parameters. */
  private exclusion(excludeTurnIds: Id[]): { clause: string; params: string[] } {
    if (excludeTurnIds.length === 0) return { clause: '', params: [] };
    const marks = excludeTurnIds.map(() => '?').join(', ');
    return { clause: ` AND id NOT IN (${marks})`, params: [...excludeTurnIds] };
  }

  /** The FTS5 MATCH expression: every term double-quoted, OR-ed. */
  private ftsExpression(queryTerms: string[]): string {
    const unique = [...new Set(queryTerms)];
    return unique.map((term) => `"${term.replace(/"/g, '""')}"`).join(' OR ');
  }

  /** seqs of indexed user turns matching the terms, honouring exclusions. */
  private ftsSeqs(queryTerms: string[], excludeTurnIds: Id[]): Set<number> {
    this.stats.textQueries += 1;
    const expression = this.ftsExpression(queryTerms);
    const excluded =
      excludeTurnIds.length === 0
        ? { clause: '', params: [] as string[] }
        : {
            clause: ` AND rowid NOT IN (SELECT seq FROM turns WHERE id IN (${excludeTurnIds.map(() => '?').join(', ')}))`,
            params: [...excludeTurnIds],
          };
    const rows = this.all<{ rowid: number }>(
      `SELECT rowid FROM turns_fts WHERE turns_fts MATCH ?${excluded.clause}`,
      [expression, ...excluded.params],
    );
    return new Set(rows.map((row) => row.rowid));
  }

  /** LIKE condition over (content, topic, entities_json) for ANY term, bound. */
  private likeClause(queryTerms: string[]): { clause: string; params: string[] } {
    const unique = [...new Set(queryTerms)];
    const params: string[] = [];
    const pieces = unique.map((term) => {
      const escaped = `%${term.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
      params.push(escaped, escaped, escaped);
      return "(lower(content) LIKE ? ESCAPE '\\' OR lower(topic) LIKE ? ESCAPE '\\' OR lower(entities_json) LIKE ? ESCAPE '\\')";
    });
    return { clause: `(${pieces.join(' OR ')})`, params };
  }

  /** seqs of user turns matching the terms via LIKE, honouring exclusions. */
  private likeSeqs(queryTerms: string[], excludeTurnIds: Id[], dateClause: string, dateParams: string[]): Set<number> {
    this.stats.textQueries += 1;
    const like = this.likeClause(queryTerms);
    const excluded = this.exclusion(excludeTurnIds);
    const rows = this.all<{ seq: number }>(
      `SELECT seq FROM turns WHERE role = 'user'${excluded.clause}${dateClause} AND ${like.clause}`,
      [...excluded.params, ...dateParams, ...like.params],
    );
    return new Set(rows.map((row) => row.seq));
  }

  /** seqs of user turns matching the terms, by whichever mode is active. */
  private searchSeqs(
    queryTerms: string[],
    excludeTurnIds: Id[],
    dateClause = '',
    dateParams: string[] = [],
  ): Set<number> {
    if (queryTerms.length === 0) return new Set();
    if (this.textSearch === 'fts') {
      // The FTS table is fetched unfiltered; the date restriction is applied
      // by intersecting with the dated rows (same set, one less join).
      return this.ftsSeqs(queryTerms, excludeTurnIds);
    }
    return this.likeSeqs(queryTerms, excludeTurnIds, dateClause, dateParams);
  }

  /**
   * The assistant turn immediately after `seq` in the session, if any. The
   * next turn is looked up first and excluded afterwards, so an excluded
   * answer gives null instead of skipping ahead to a later turn.
   */
  private assistantAfter(sessionId: string, seq: number, excludeTurnIds: Id[]): Turn | null {
    const rows = this.all<TurnRow>(
      'SELECT * FROM turns WHERE session_id = ? AND seq > ? ORDER BY seq LIMIT 1',
      [sessionId, seq],
    );
    const next = rows[0];
    if (next === undefined || next.role !== 'assistant' || excludeTurnIds.includes(next.id)) return null;
    return rowToTurn(next);
  }

  /** Distinct query terms found in the pair's words — the fake's overlap(). */
  private overlap(userTurn: Turn, assistantTurn: Turn | null, topic?: string, entities?: string[]): number {
    const wanted = new Set(terms([topic ?? '', ...(entities ?? [])].join(' ')));
    if (wanted.size === 0) return 0;
    const haystack = new Set<string>();
    for (const turn of [userTurn, assistantTurn]) {
      if (turn === null) continue;
      for (const term of terms([turn.content, turn.topic ?? '', turn.summary ?? '', ...turn.entities].join(' '))) {
        haystack.add(term);
      }
    }
    let count = 0;
    for (const term of wanted) if (haystack.has(term)) count += 1;
    return count;
  }

  private toHits(
    scored: { userTurn: Turn; assistantTurn: Turn | null; matched: MemoryHit['matched']; score: number; seq: number }[],
    limit: number,
  ): MemoryHit[] {
    scored.sort((a, b) => b.score - a.score || b.seq - a.seq);
    return scored.slice(0, Math.max(0, limit)).map(({ userTurn, assistantTurn, matched, score }) => ({
      userTurn,
      assistantTurn,
      matched,
      score,
    }));
  }

  // ----------------------------------------------------------------- turns

  saveTurn(turn: NewTurn): Turn {
    this.run('INSERT INTO sessions (id, created_at_utc) VALUES (?, ?) ON CONFLICT(id) DO NOTHING', [
      turn.sessionId,
      this.clock.now().toISOString(),
    ]);
    const id = crypto.randomUUID();
    this.run(
      `INSERT INTO turns (id, session_id, role, content, created_at_utc, tz, local_date, origin, topic, entities_json, summary, extraction, intent, target_turn_ids_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        turn.sessionId,
        turn.role,
        turn.content,
        turn.createdAtUtc,
        turn.tz,
        turn.localDate,
        turn.origin,
        turn.topic,
        JSON.stringify(turn.entities),
        turn.summary,
        turn.extraction,
        turn.intent,
        JSON.stringify(turn.targetTurnIds),
      ],
    );
    const seq = (this.all<{ seq: number }>('SELECT seq FROM turns WHERE id = ?', [id])[0] as { seq: number }).seq;
    if (this.textSearch === 'fts' && turn.role === 'user') {
      this.run('INSERT INTO turns_fts (rowid, content, topic, entities) VALUES (?, ?, ?, ?)', [
        seq,
        turn.content,
        turn.topic ?? '',
        turn.entities.join(' '),
      ]);
    }
    const saved = this.all<TurnRow>('SELECT * FROM turns WHERE id = ?', [id])[0];
    return rowToTurn(saved as TurnRow);
  }

  updateTurnMeta(id: Id, meta: Pick<Turn, 'topic' | 'entities' | 'summary'>): void {
    this.run('UPDATE turns SET topic = ?, entities_json = ?, summary = ? WHERE id = ?', [
      meta.topic,
      JSON.stringify(meta.entities),
      meta.summary,
      id,
    ]);
    if (this.textSearch === 'fts') {
      const row = this.all<TurnRow>('SELECT * FROM turns WHERE id = ?', [id])[0];
      if (row !== undefined && row.role === 'user') {
        this.run('DELETE FROM turns_fts WHERE rowid = ?', [row.seq]);
        this.run('INSERT INTO turns_fts (rowid, content, topic, entities) VALUES (?, ?, ?, ?)', [
          row.seq,
          row.content,
          meta.topic ?? '',
          meta.entities.join(' '),
        ]);
      }
    }
  }

  setExtraction(turnId: Id, state: Turn['extraction']): void {
    this.run('UPDATE turns SET extraction = ? WHERE id = ?', [state, turnId]);
  }

  recentTurns(sessionId: Id, limit: number): Turn[] {
    if (limit <= 0) return [];
    const rows = this.all<TurnRow>(
      'SELECT * FROM (SELECT * FROM turns WHERE session_id = ? ORDER BY seq DESC LIMIT ?) ORDER BY seq',
      [sessionId, limit],
    );
    return rows.map(rowToTurn);
  }

  getTurns(ids: Id[]): Turn[] {
    const found: Turn[] = [];
    for (const id of ids) {
      const row = this.all<TurnRow>('SELECT * FROM turns WHERE id = ?', [id])[0];
      if (row !== undefined) found.push(rowToTurn(row));
    }
    return found;
  }

  findTurns(query: {
    dates?: LocalDate[];
    range?: { from: LocalDate; to: LocalDate };
    topic?: string;
    entities?: string[];
    excludeTurnIds: Id[];
    limit: number;
  }): MemoryHit[] {
    const excluded = this.exclusion(query.excludeTurnIds);
    const dated = query.dates !== undefined || query.range !== undefined;
    const queryTerms = terms([query.topic ?? '', ...(query.entities ?? [])].join(' '));

    if (!dated) {
      if (queryTerms.length === 0) return [];
      const seqs = this.searchSeqs(queryTerms, query.excludeTurnIds);
      const marks = [...seqs].map(() => '?').join(', ');
      const rows =
        seqs.size === 0
          ? []
          : this.all<TurnRow>(
              `SELECT * FROM turns WHERE role = 'user' AND seq IN (${marks})${excluded.clause}`,
              [...seqs, ...excluded.params],
            );
      const scored = rows.map((row) => {
        const userTurn = rowToTurn(row);
        const assistantTurn = this.assistantAfter(row.session_id, row.seq, query.excludeTurnIds);
        return { userTurn, assistantTurn, matched: 'topic' as const, score: this.overlap(userTurn, assistantTurn, query.topic, query.entities), seq: row.seq };
      });
      return this.toHits(scored, query.limit);
    }

    const dateParts: string[] = [];
    const dateParams: string[] = [];
    if (query.dates !== undefined && query.dates.length > 0) {
      dateParts.push(`local_date IN (${query.dates.map(() => '?').join(', ')})`);
      dateParams.push(...query.dates);
    }
    if (query.range !== undefined) {
      dateParts.push('local_date BETWEEN ? AND ?');
      dateParams.push(query.range.from, query.range.to);
    }
    const dateClause = dateParts.length > 0 ? ` AND (${dateParts.join(' OR ')})` : '';
    const rows = this.all<TurnRow>(
      `SELECT * FROM turns WHERE role = 'user'${excluded.clause}${dateClause} ORDER BY seq`,
      [...excluded.params, ...dateParams],
    );

    // Few enough rows: rank by overlap and never touch the text search.
    // Above the threshold the text search decides 'date+topic' vs 'date';
    // in FTS mode its unfiltered seqs are intersected with the dated rows.
    const rowSeqs = new Set(rows.map((row) => row.seq));
    const matchedSeqs =
      rows.length > DATE_RANK_MAX_ROWS && queryTerms.length > 0
        ? new Set([...this.searchSeqs(queryTerms, query.excludeTurnIds, dateClause, dateParams)].filter((seq) => rowSeqs.has(seq)))
        : null;

    const scored = rows.map((row) => {
      const userTurn = rowToTurn(row);
      const assistantTurn = this.assistantAfter(row.session_id, row.seq, query.excludeTurnIds);
      const score = this.overlap(userTurn, assistantTurn, query.topic, query.entities);
      const matched =
        matchedSeqs !== null
          ? matchedSeqs.has(row.seq)
            ? 'date+topic'
            : 'date'
          : score > 0
            ? 'date+topic'
            : 'date';
      return { userTurn, assistantTurn, matched: matched as MemoryHit['matched'], score, seq: row.seq };
    });
    return this.toHits(scored, query.limit);
  }

  nearestTurns(query: {
    around: LocalDate[];
    topic?: string;
    entities?: string[];
    excludeTurnIds: Id[];
    limit: number;
  }): MemoryHit[] {
    const excluded = this.exclusion(query.excludeTurnIds);
    const around = new Set(query.around);
    const adjacent = new Set<LocalDate>();
    for (const date of query.around) {
      for (const days of [-1, 1]) {
        const near = shiftDate(date, days);
        if (!around.has(near)) adjacent.add(near);
      }
    }

    const scored: { userTurn: Turn; assistantTurn: Turn | null; matched: MemoryHit['matched']; score: number; seq: number }[] = [];
    if (adjacent.size > 0) {
      const marks = [...adjacent].map(() => '?').join(', ');
      const rows = this.all<TurnRow>(
        `SELECT * FROM turns WHERE role = 'user' AND local_date IN (${marks})${excluded.clause}`,
        [...adjacent, ...excluded.params],
      );
      for (const row of rows) {
        const userTurn = rowToTurn(row);
        const assistantTurn = this.assistantAfter(row.session_id, row.seq, query.excludeTurnIds);
        scored.push({
          userTurn,
          assistantTurn,
          matched: 'date',
          score: this.overlap(userTurn, assistantTurn, query.topic, query.entities),
          seq: row.seq,
        });
      }
    }

    // Topic matches on dates that are neither around nor adjacent.
    const queryTerms = terms([query.topic ?? '', ...(query.entities ?? [])].join(' '));
    const seenSeqs = new Set(scored.map((entry) => entry.seq));
    const skipDates = new Set([...around, ...adjacent]);
    if (queryTerms.length > 0) {
      const seqs = this.searchSeqs(queryTerms, query.excludeTurnIds);
      if (seqs.size > 0) {
        const marks = [...seqs].map(() => '?').join(', ');
        const rows = this.all<TurnRow>(
          `SELECT * FROM turns WHERE role = 'user' AND seq IN (${marks})${excluded.clause}`,
          [...seqs, ...excluded.params],
        );
        for (const row of rows) {
          if (skipDates.has(row.local_date) || seenSeqs.has(row.seq)) continue;
          const userTurn = rowToTurn(row);
          const assistantTurn = this.assistantAfter(row.session_id, row.seq, query.excludeTurnIds);
          scored.push({
            userTurn,
            assistantTurn,
            matched: 'topic',
            score: this.overlap(userTurn, assistantTurn, query.topic, query.entities),
            seq: row.seq,
          });
        }
      }
    }
    return this.toHits(scored, query.limit);
  }

  // -------------------------------------------------------------- sources

  saveSource(source: NewSource): Source {
    const id = crypto.randomUUID();
    this.run(
      `INSERT INTO sources (id, url, final_url, title, published_at, fetched_at_utc, live, first_party, http_status, text)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        source.url,
        source.finalUrl,
        source.title,
        source.publishedAt,
        source.fetchedAtUtc,
        source.live ? 1 : 0,
        source.firstParty ? 1 : 0,
        source.httpStatus,
        source.text,
      ],
    );
    const row = this.all<SourceRow>('SELECT * FROM sources WHERE id = ?', [id])[0];
    return rowToSource(row as SourceRow);
  }

  getSources(ids: Id[]): Source[] {
    const found: Source[] = [];
    for (const id of ids) {
      const row = this.all<SourceRow>('SELECT * FROM sources WHERE id = ?', [id])[0];
      if (row !== undefined) found.push(rowToSource(row));
    }
    return found;
  }

  /**
   * Records that the seed script wrote this source. Not on MemoryStore:
   * scripts/seed.ts is the only caller, and it requires a SqliteStore.
   */
  markSeedSource(id: Id): void {
    this.run('INSERT INTO seed_sources (source_id) VALUES (?) ON CONFLICT(source_id) DO NOTHING', [
      id,
    ]);
  }

  /**
   * Removes every row the seed wrote — seed turns with their claims, checks,
   * FTS rows, orphaned sessions and marked seed sources — inside one
   * transaction. Turns with origin 'live' are never touched, so a live claim
   * that supersedes a deleted seed claim survives with supersedes_id nulled.
   * When `only` is given, just that session's seed turns and just those
   * marked sources are removed. A marked source still referenced by a
   * remaining claim is kept. Not on MemoryStore; see markSeedSource.
   */
  deleteSeed(only?: { sessionId: Id; sourceIds: Id[] }): {
    turns: number;
    claims: number;
    checks: number;
    sources: number;
  } {
    const counts = { turns: 0, claims: 0, checks: 0, sources: 0 };
    this.db.exec('BEGIN');
    try {
      const seedTurns = this.all<Pick<TurnRow, 'seq' | 'id' | 'session_id'>>(
        `SELECT seq, id, session_id FROM turns WHERE origin = 'seed'${only !== undefined ? ' AND session_id = ?' : ''}`,
        only !== undefined ? [only.sessionId] : [],
      );
      const inList = (ids: (string | number)[]): string => `IN (${ids.map(() => '?').join(', ')})`;

      if (seedTurns.length > 0) {
        const turnIds = seedTurns.map((row) => row.id);
        const claims = this.all<Pick<ClaimRow, 'id'>>(
          `SELECT id FROM claims WHERE turn_id ${inList(turnIds)}`,
          turnIds,
        );
        const claimIds = claims.map((row) => row.id);
        if (claimIds.length > 0) {
          counts.checks = this.all<{ n: number }>(
            `SELECT count(*) n FROM checks WHERE claim_id ${inList(claimIds)}`,
            claimIds,
          )[0]?.n ?? 0;
          this.run(`DELETE FROM checks WHERE claim_id ${inList(claimIds)}`, claimIds);
          // A live claim (e.g. a re-check's superseding claim) that pointed at a
          // deleted seed claim keeps its own row; only the dead link is cut.
          // This must run before the claims delete or the FK refuses it.
          this.run(
            `UPDATE claims SET supersedes_id = NULL WHERE supersedes_id ${inList(claimIds)}`,
            claimIds,
          );
          this.run(`DELETE FROM claims WHERE id ${inList(claimIds)}`, claimIds);
          counts.claims = claimIds.length;
        }
        if (this.textSearch === 'fts') {
          const seqs = seedTurns.map((row) => row.seq);
          this.run(`DELETE FROM turns_fts WHERE rowid ${inList(seqs)}`, seqs);
        }
        this.run(`DELETE FROM turns WHERE id ${inList(turnIds)}`, turnIds);
        counts.turns = turnIds.length;
        const sessionIds = [...new Set(seedTurns.map((row) => row.session_id))];
        this.run(
          `DELETE FROM sessions WHERE id ${inList(sessionIds)} AND id NOT IN (SELECT session_id FROM turns)`,
          sessionIds,
        );
      }

      const marked =
        only !== undefined
          ? this.all<{ source_id: string }>(
              `SELECT source_id FROM seed_sources WHERE source_id ${inList(only.sourceIds)}`,
              only.sourceIds,
            )
          : this.all<{ source_id: string }>('SELECT source_id FROM seed_sources');
      const removable = marked
        .map((row) => row.source_id)
        .filter(
          (id) =>
            this.all<{ n: number }>('SELECT count(*) n FROM claims WHERE source_id = ?', [id])[0]
              ?.n === 0,
        );
      if (removable.length > 0) {
        this.run(`DELETE FROM seed_sources WHERE source_id ${inList(removable)}`, removable);
        this.run(`DELETE FROM sources WHERE id ${inList(removable)}`, removable);
        counts.sources = removable.length;
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return counts;
  }

  // --------------------------------------------------------------- claims

  saveClaims(claims: NewClaim[]): Claim[] {
    const saved: Claim[] = [];
    for (const claim of claims) {
      const id = crypto.randomUUID();
      this.run(
        `INSERT INTO claims (id, turn_id, entity, attribute, value, scope_json, source_id, quote, as_of_utc, volatility, last_verified_at_utc, supersedes_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          claim.turnId,
          claim.entity,
          claim.attribute,
          claim.value,
          JSON.stringify(claim.scope),
          claim.sourceId,
          claim.quote,
          claim.asOfUtc,
          claim.volatility,
          claim.lastVerifiedAtUtc,
          claim.supersedesId,
        ],
      );
      const row = this.all<ClaimRow>('SELECT * FROM claims WHERE id = ?', [id])[0];
      saved.push(rowToClaim(row as ClaimRow));
    }
    return saved;
  }

  /** The newest claim in the chain, following supersedes links, never timestamps. */
  private newestInChain(claim: ClaimRow): ClaimRow {
    let current = claim;
    const seen = new Set<Id>([current.id]);
    for (;;) {
      const next = this.all<ClaimRow>(
        'SELECT * FROM claims WHERE supersedes_id = ? ORDER BY seq DESC LIMIT 1',
        [current.id],
      )[0];
      if (next === undefined || seen.has(next.id)) return current;
      seen.add(next.id);
      current = next;
    }
  }

  claimsForTurns(turnIds: Id[], version: ClaimVersion): Claim[] {
    if (turnIds.length === 0) return [];
    const marks = turnIds.map(() => '?').join(', ');
    const stated = this.all<ClaimRow>(`SELECT * FROM claims WHERE turn_id IN (${marks}) ORDER BY seq`, turnIds);
    if (version === 'as_stated') return stated.map(rowToClaim);
    const current: Claim[] = [];
    const seen = new Set<Id>();
    for (const row of stated) {
      const newest = this.newestInChain(row);
      if (!seen.has(newest.id)) {
        seen.add(newest.id);
        current.push(rowToClaim(newest));
      }
    }
    return current;
  }

  saveCheck(check: NewCheck): Check {
    const id = crypto.randomUUID();
    this.run(
      `INSERT INTO checks (id, claim_id, checked_at_utc, verdict, new_value, new_source_id, new_quote, reason, decided_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        check.claimId,
        check.checkedAtUtc,
        check.verdict,
        check.newValue,
        check.newSourceId,
        check.newQuote,
        check.reason,
        check.decidedBy,
      ],
    );
    const row = this.all<CheckRow>('SELECT * FROM checks WHERE id = ?', [id])[0];
    return rowToCheck(row as CheckRow);
  }

  touchVerified(claimId: Id, at: string): void {
    this.run('UPDATE claims SET last_verified_at_utc = ? WHERE id = ?', [at, claimId]);
  }

  staleClaims(now: Date, limit: number): Claim[] {
    const rows = this.all<ClaimRow>(
      'SELECT * FROM claims WHERE id NOT IN (SELECT supersedes_id FROM claims WHERE supersedes_id IS NOT NULL) ORDER BY seq',
    );
    const stale = rows.filter((row) => {
      // last_verified_at_utc plus the shelf life in days, converted to ms.
      const expires = Date.parse(row.last_verified_at_utc) + this.shelfLifeDays[row.volatility as Volatility] * 86_400_000;
      return expires < now.getTime();
    });
    stale.sort((a, b) => (a.last_verified_at_utc < b.last_verified_at_utc ? -1 : a.last_verified_at_utc > b.last_verified_at_utc ? 1 : a.seq - b.seq));
    return stale.slice(0, Math.max(0, limit)).map(rowToClaim);
  }
}
