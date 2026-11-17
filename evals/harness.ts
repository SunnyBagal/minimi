/**
 * One case: a temp store, fixture search, a clock, and runTurn.
 * The real path uses createLlm, time and guardVerdict. Selftest swaps in
 * FakeLlm, fakeTime and passThroughGuard and does not construct an Llm client.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultConfig } from '../src/core/config';
import type { AgentDeps, AgentEvent, Llm } from '../src/core/contracts';
import { createLlm } from '../src/core/llm/index';
import { runTurn } from '../src/core/pipeline/runTurn';
import { guardVerdict } from '../src/core/pipeline/guards';
import { createStore } from '../src/core/store/index';
import { FakeClock, FakeLlm, fakeTime, passThroughGuard } from '../src/core/testing/fakes';
import { time } from '../src/core/time/index';
import { answerOf, literalAssertions } from './assert';
import { scoredPass } from './score';
import { FixtureSearch } from './fixtureSearch';
import { askJudge, type JudgeAnswer } from './judge';
import { loadSeeds } from './seeds';
import { selftestScript, selftestTime } from './selftest';
import type { Assertion, CaseRun, EvalCase, PartTrace, TurnTrace } from './types';

export interface HarnessOptions {
  selftest: boolean;
  /** Real-model path. Ignored during selftest. */
  apiKey?: string;
}

export interface HarnessResult {
  assertions: Assertion[];
  judge: JudgeAnswer[] | null;
  passed: boolean;
}

async function collect(events: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const event of events) out.push(event);
  return out;
}

function answerText(events: AgentEvent[]): string {
  return answerOf(events);
}

export async function runHarness(evalCase: EvalCase, options: HarnessOptions): Promise<HarnessResult> {
  const clock = new FakeClock(evalCase.parts[0]?.clock ?? '2026-11-13T13:00:00.000Z');
  const dir = mkdtempSync(join(tmpdir(), 'minimi-eval-'));
  const store = createStore(join(dir, 'store.db'), clock, defaultConfig);
  const llm: Llm = options.selftest
    ? new FakeLlm(selftestScript(evalCase.id))
    : createLlm(options.apiKey ?? '', defaultConfig);
  const depsTime = options.selftest ? fakeTime(selftestTime(evalCase.id)) : time;
  const depsGuard = options.selftest ? passThroughGuard : guardVerdict;

  const parts: PartTrace[] = [];
  for (let index = 0; index < evalCase.parts.length; index += 1) {
    const part = evalCase.parts[index];
    if (part === undefined) continue;
    clock.set(part.clock);
    loadSeeds(store, part.seeds, part.seedOptions);
    const search = new FixtureSearch(clock, part.scenario);
    const deps: AgentDeps = {
      clock,
      store,
      search,
      llm,
      time: depsTime,
      guardVerdict: depsGuard,
      config: defaultConfig,
    };
    const sessionId = `case-${evalCase.id}-part-${index}`;
    const traces: TurnTrace[] = [];
    for (const message of part.messages) {
      const mark = search.log.length;
      const events = await collect(runTurn({ sessionId, message, tz: part.tz }, deps));
      traces.push({
        message,
        events,
        answerText: answerText(events),
        log: search.log.slice(mark),
      });
    }
    parts.push({ traces, log: search.log, tz: part.tz });
  }

  let judge: JudgeAnswer[] | null = null;
  if (!options.selftest && evalCase.judges !== undefined && evalCase.judges.length > 0) {
    const answer = parts.flatMap((part) => part.traces.map((trace) => trace.answerText)).join('\n');
    judge = [];
    for (const id of evalCase.judges) {
      judge.push(await askJudge(llm, id, answer, options.apiKey ?? null));
    }
  }

  const run: CaseRun = { parts, store, judge };
  const assertions = [...evalCase.check(run), ...literalAssertions(run)];
  return { assertions, judge, passed: scoredPass(assertions) };
}
