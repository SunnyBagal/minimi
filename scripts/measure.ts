/**
 * Measure: run a fixed list of turns (chat, fresh, re-check of the previous
 * answer) through runTurn with the real deps, collect every timing event and
 * write evals/results/latency.json. Prints only the path and the medians it
 * actually measured.
 */
import { existsSync } from 'node:fs';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { getDeps } from '../src/compose';
import { runTurn } from '../src/core/pipeline/runTurn';

if (existsSync('.env')) process.loadEnvFile('.env');

const TURNS = [
  'Explain what a connection pooler does in two sentences.',
  "What does Neon's Launch plan cost per month right now?",
  'Is that still right?',
];

const OUT = path.join('evals', 'results', 'latency.json');

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length === 0) return 0;
  return sorted.length % 2 === 1 ? (sorted[mid] as number) : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

async function main(): Promise<void> {
  const deps = getDeps();
  const sessionId = crypto.randomUUID();
  const stages = new Map<string, number[]>();
  let runs = 0;

  for (const message of TURNS) {
    for await (const event of runTurn({ sessionId, message, tz: 'UTC' }, deps)) {
      if (event.type !== 'timing') continue;
      const list = stages.get(event.stage) ?? [];
      list.push(event.ms);
      stages.set(event.stage, list);
    }
    runs += 1;
  }

  const report = {
    runs,
    generatedAtUtc: deps.clock.now().toISOString(),
    stages: Object.fromEntries(
      [...stages.entries()].map(([stage, ms]) => [stage, { ms, medianMs: median(ms) }]),
    ),
  };
  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
  console.log(OUT);
  for (const [stage, entry] of Object.entries(report.stages)) {
    console.log(`${stage}: ${entry.medianMs} ms`);
  }
}

await main();
