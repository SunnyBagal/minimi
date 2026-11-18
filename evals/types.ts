import type { AgentEvent, MemoryStore } from '../src/core/contracts';
import type { FixtureCall, FixtureScenario } from './fixtureSearch';
import type { JudgeAnswer, JudgeId } from './judge';
import type { SeedId, SeedOptions } from './seeds';

export interface Assertion {
  name: string;
  pass: boolean;
  observed: unknown;
}

export interface TurnTrace {
  message: string;
  events: AgentEvent[];
  answerText: string;
  /**
   * Exactly what the model's writer produced on this turn. Answer text outside
   * it was injected by the app's code. Absent in hand-built test traces, where
   * the number checks treat all text as model-written.
   */
  modelText?: string;
  /** Provider calls made while this message was running. */
  log: FixtureCall[];
}

/** One clock, one provider, one or more messages in a single session. */
export interface CasePart {
  seeds: readonly SeedId[];
  seedOptions?: SeedOptions;
  /** ISO instant the fake clock starts at. */
  clock: string;
  tz: string;
  scenario: FixtureScenario;
  messages: readonly string[];
}

export interface PartTrace {
  traces: TurnTrace[];
  log: FixtureCall[];
  /** Zone of this part. Verdict timestamps are formatted in it. */
  tz: string;
}

export interface CaseRun {
  parts: PartTrace[];
  store: MemoryStore;
  /** Null during `--selftest`, which must not call a model. */
  judge: JudgeAnswer[] | null;
}

export interface EvalCase {
  id: number;
  /**
   * Case 18 runs two setups. Every other case is one part.
   * Messages inside a part share a session.
   */
  parts: CasePart[];
  judges?: readonly JudgeId[];
  check(run: CaseRun): Assertion[];
}

export const CLOCK = '2026-11-13T13:00:00.000Z';
export const TZ = 'Asia/Kolkata';
