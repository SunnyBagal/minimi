/**
 * Measure: run a fixed list of turns (chat, fresh, re-check of the previous
 * answer) through runTurn with the real deps, PASSES times, each pass in a new
 * session, and write evals/results/latency.json. Per stage it records every
 * timing event; per turn it records, with the script's own clock
 * (performance.now(), not deps.clock), the time to the first text event and
 * to done. Prints only the path and the medians it actually measured.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { getDeps } from '../src/compose';
import type { AgentDeps, Intent } from '../src/core/contracts';
import { runTurn } from '../src/core/pipeline/runTurn';

export const TURNS = [
  'Explain what a connection pooler does in two sentences.',
  "What does Neon's Launch plan cost per month right now?",
  'Is that still right?',
];

/** How many times the fixed list runs, each pass in a new session. */
export const PASSES = 3;

const OUT = path.join('evals', 'results', 'latency.json');

export interface TurnRecord {
  pass: number;
  message: string;
  intent: Intent | null;
  /** Turn start to the first `text` event; null when the turn sent no text. */
  firstTextMs: number | null;
  /** Turn start to `done`. */
  totalMs: number;
  verdicts: number;
}

export interface MessageMedians {
  message: string;
  /** Median over the passes that sent text; null when none did. */
  medianFirstTextMs: number | null;
  medianTotalMs: number;
}

export interface Measurement {
  runs: number;
  stages: Record<string, { ms: number[]; medianMs: number }>;
  turns: TurnRecord[];
  messages: MessageMedians[];
}

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length === 0) return 0;
  return sorted.length % 2 === 1 ? (sorted[mid] as number) : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

/**
 * Runs `messages` through runTurn `passes` times. `now` is the script's clock
 * in milliseconds; it is read at turn start, at the first text event and at
 * done.
 */
export async function measure(
  deps: AgentDeps,
  options: { passes: number; messages: string[]; now?: () => number },
): Promise<Measurement> {
  const now = options.now ?? (() => performance.now());
  const stages = new Map<string, number[]>();
  const turns: TurnRecord[] = [];

  for (let pass = 1; pass <= options.passes; pass += 1) {
    const sessionId = crypto.randomUUID();
    for (const message of options.messages) {
      const started = now();
      let firstTextMs: number | null = null;
      let totalMs: number | null = null;
      let intent: Intent | null = null;
      let verdicts = 0;
      for await (const event of runTurn({ sessionId, message, tz: 'UTC' }, deps)) {
        if (event.type === 'text' && firstTextMs === null) firstTextMs = now() - started;
        if (event.type === 'verdict') verdicts += 1;
        if (event.type === 'done') {
          totalMs = now() - started;
          intent = event.intent;
        }
        if (event.type === 'timing') {
          const list = stages.get(event.stage) ?? [];
          list.push(event.ms);
          stages.set(event.stage, list);
        }
      }
      turns.push({ pass, message, intent, firstTextMs, totalMs: totalMs ?? now() - started, verdicts });
    }
  }

  const messages = options.messages.map((message) => {
    const mine = turns.filter((turn) => turn.message === message);
    const firstTexts = mine.flatMap((turn) => (turn.firstTextMs === null ? [] : [turn.firstTextMs]));
    return {
      message,
      medianFirstTextMs: firstTexts.length === 0 ? null : median(firstTexts),
      medianTotalMs: median(mine.map((turn) => turn.totalMs)),
    };
  });

  return {
    runs: turns.length,
    stages: Object.fromEntries([...stages.entries()].map(([stage, ms]) => [stage, { ms, medianMs: median(ms) }])),
    turns,
    messages,
  };
}

async function main(): Promise<void> {
  if (existsSync('.env')) process.loadEnvFile('.env');
  const deps = getDeps();
  const result = await measure(deps, { passes: PASSES, messages: TURNS });
  const report = {
    runs: result.runs,
    generatedAtUtc: deps.clock.now().toISOString(),
    passes: PASSES,
    stages: result.stages,
    turns: result.turns,
    messages: result.messages,
  };
  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
  console.log(OUT);
  for (const [stage, entry] of Object.entries(report.stages)) {
    console.log(`${stage}: ${entry.medianMs} ms`);
  }
  for (const entry of report.messages) {
    const first = entry.medianFirstTextMs === null ? 'no text' : `${Math.round(entry.medianFirstTextMs)} ms`;
    console.log(`"${entry.message}": first text ${first}, total ${Math.round(entry.medianTotalMs)} ms`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await main();
}
