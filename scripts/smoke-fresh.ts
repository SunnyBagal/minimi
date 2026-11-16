/**
 * Smoke: one fresh question against the real deps. Exits 0 only when the turn
 * cited at least one source, the answer text contains a [n] citation and at
 * least one source row was saved. Needs both API keys in .env.
 */
import { existsSync } from 'node:fs';
import { getDeps } from '../src/compose';
import { runTurn } from '../src/core/pipeline/runTurn';
import type { AgentEvent } from '../src/core/contracts';

if (existsSync('.env')) process.loadEnvFile('.env');

const QUESTION = "What does Neon's Launch plan cost per month right now?";

async function main(): Promise<number> {
  const deps = getDeps();
  const events: AgentEvent[] = [];
  for await (const event of runTurn(
    { sessionId: crypto.randomUUID(), message: QUESTION, tz: 'UTC' },
    deps,
  )) {
    events.push(event);
  }

  const citations = events.find((event) => event.type === 'citations');
  const items = citations !== undefined && citations.type === 'citations' ? citations.items : [];
  const text = events
    .filter((event) => event.type === 'text')
    .map((event) => event.delta)
    .join('');
  const sources = deps.store.getSources(items.map((item) => item.sourceId));

  const failures: string[] = [];
  if (items.length === 0) failures.push('no citations event items');
  if (!/\[\d+\]/.test(text)) failures.push('answer text has no [n] citation');
  if (sources.length === 0) failures.push('no source rows saved');

  if (failures.length > 0) {
    console.error(`smoke-fresh: FAIL — ${failures.join('; ')}`);
    return 1;
  }
  console.log(`smoke-fresh: PASS — ${items.length} citation(s), ${sources.length} source(s) saved`);
  return 0;
}

process.exitCode = await main().catch((error: unknown) => {
  console.error(`smoke-fresh: FAIL — ${error instanceof Error ? error.message : String(error)}`);
  return 1;
});
