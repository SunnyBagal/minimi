// The store entry point: createStore(dbPath, clock, config) on node:sqlite.
import type { AgentConfig, Clock, MemoryStore } from '../contracts';
import { SqliteStore } from './sqliteStore';

export function createStore(dbPath: string, clock: Clock, config: AgentConfig): MemoryStore {
  return new SqliteStore(dbPath, clock, config);
}

export { Fts5MissingError, SqliteStore, chooseTextSearch, DATE_RANK_MAX_ROWS } from './sqliteStore';
