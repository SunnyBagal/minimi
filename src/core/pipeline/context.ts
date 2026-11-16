/**
 * The per-turn context every branch (chat, fresh, recall, recheck, no record)
 * receives: the deps, the routed plan, the ids and helpers they share.
 *
 * `saveAssistant` writes the assistant turn exactly once and then runs the
 * `afterSave` queue — used by the re-check, which must write superseding
 * claims against this turn's id, and by the error path in runTurn.
 */
import type {
  AgentConfig,
  AgentDeps,
  AgentEvent,
  Clock,
  ExtractionState,
  Id,
  IanaTz,
  Intent,
  MemoryStore,
  RouterPlan,
  TimeFns,
  GuardVerdict,
  Turn,
  TurnInput,
} from '../contracts';

export interface AssistantFields {
  intent: Intent;
  extraction: ExtractionState;
  targetTurnIds: Id[];
}

export class TurnContext {
  readonly deps: AgentDeps;
  readonly input: TurnInput;
  readonly tz: IanaTz;
  plan: RouterPlan;
  readonly recent: Turn[];
  readonly currentId: Id;
  readonly now: Date;
  readonly signal: AbortSignal;
  /** Which stage an error event should name. Mutated by each branch. */
  stage = 'route';
  /** Text deltas emitted so far — becomes the saved assistant content. */
  answer = '';
  private assistantId: Id | null = null;
  private readonly afterSaveQueue: (() => void)[] = [];

  constructor(fields: {
    deps: AgentDeps;
    input: TurnInput;
    tz: IanaTz;
    plan: RouterPlan;
    recent: Turn[];
    currentId: Id;
    now: Date;
    signal: AbortSignal;
  }) {
    this.deps = fields.deps;
    this.input = fields.input;
    this.tz = fields.tz;
    this.plan = fields.plan;
    this.recent = fields.recent;
    this.currentId = fields.currentId;
    this.now = fields.now;
    this.signal = fields.signal;
  }

  get clock(): Clock {
    return this.deps.clock;
  }
  get store(): MemoryStore {
    return this.deps.store;
  }
  get config(): AgentConfig {
    return this.deps.config;
  }
  get time(): TimeFns {
    return this.deps.time;
  }
  get guardVerdict(): GuardVerdict {
    return this.deps.guardVerdict;
  }

  /** An event whose text also counts toward the saved assistant content. */
  textEvent(delta: string): AgentEvent {
    this.answer += delta;
    return { type: 'text', delta };
  }

  /** A timing event measured with the injected clock (FakeClock yields 0 ms). */
  timer(stage: string): () => AgentEvent {
    const started = this.clock.now().getTime();
    return () => ({ type: 'timing', stage, ms: this.clock.now().getTime() - started });
  }

  /** Queue a callback to run right after the assistant turn is saved. */
  afterSave(callback: () => void): void {
    this.afterSaveQueue.push(callback);
  }

  /** The saved assistant turn id, when it exists. */
  get savedTurnId(): Id | null {
    return this.assistantId;
  }

  /**
   * Saves the assistant turn once (later calls are ignored) and runs the
   * afterSave queue. Returns the saved turn.
   */
  saveAssistant(fields: AssistantFields): Turn {
    if (this.assistantId !== null) {
      const found = this.store.getTurns([this.assistantId])[0];
      if (found !== undefined) return found;
    }
    const saved = this.store.saveTurn({
      sessionId: this.input.sessionId,
      role: 'assistant',
      content: this.answer,
      createdAtUtc: this.clock.now().toISOString(),
      tz: this.tz,
      localDate: this.time.toLocalDate(this.clock.now(), this.tz),
      origin: this.input.origin ?? 'live',
      topic: this.plan.topic,
      entities: this.plan.entities,
      summary: null,
      extraction: fields.extraction,
      intent: fields.intent,
      targetTurnIds: fields.targetTurnIds,
    });
    this.assistantId = saved.id;
    for (const callback of this.afterSaveQueue.splice(0)) callback();
    return saved;
  }
}
