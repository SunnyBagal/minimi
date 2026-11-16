// Lane 2 replaces this file. The export stays: createStore(dbPath, clock, config).
import type { AgentConfig, Clock, MemoryStore } from '../contracts';
import { InMemoryStore } from '../testing/inMemoryStore';

/** Until Lane 2 merges: an in-memory store. `dbPath` and `clock` are not used yet. */
export function createStore(dbPath: string, clock: Clock, config: AgentConfig): MemoryStore {
  void dbPath;
  void clock;
  return new InMemoryStore(config);
}
