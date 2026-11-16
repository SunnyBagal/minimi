import { describe, expect, it } from 'vitest';
import type { AgentEvent, MemoryHit, MemoryStore } from '../contracts';
import { FakeSearch, fakeTime, passThroughGuard, FakeLlm, FakeClock, chatPlan } from '../testing/fakes';
import { InMemoryStore } from '../testing/inMemoryStore';
import { defaultConfig } from '../config';
import { runTurn } from './runTurn';
import { assistantTurn, claim, lastAssistant, plan, rig, source, textOf, types, userTurn, NOW, SESSION, TZ } from './testSupport';

const SELF_MSG = 'On Monday we shortlisted 5 CRM tools for a 20-person sales team. Has any of them changed pricing or shipped something big since?';
const WEEKDAY_1_BARE = { kind: 'weekday', weekday: 1, modifier: 'bare' } as const;

/** An InMemoryStore that records findTurns and nearestTurns arguments. */
class SpyStore extends InMemoryStore {
  findArgs: Parameters<MemoryStore['findTurns']>[0][] = [];
  nearestArgs: Parameters<MemoryStore['nearestTurns']>[0][] = [];
  override findTurns(query: Parameters<MemoryStore['findTurns']>[0]): MemoryHit[] {
    this.findArgs.push(structuredClone(query));
    return super.findTurns(query);
  }
  override nearestTurns(query: Parameters<MemoryStore['nearestTurns']>[0]): MemoryHit[] {
    this.nearestArgs.push(structuredClone(query));
    return super.nearestTurns(query);
  }
}

function recallEvent(events: AgentEvent[]) {
  const event = events.find((e) => e.type === 'recall');
  if (event === undefined || event.type !== 'recall') throw new Error('no recall event');
  return event;
}

describe('recall', () => {
  it('self-match: "On Monday we shortlisted 5 CRM tools…" picks 9 Nov, never the message itself', async () => {
    const store = new InMemoryStore();
    const user = userTurn(store, { content: 'Which CRM tools should we shortlist?', topic: 'CRM tools', localDate: '2026-11-09' });
    assistantTurn(store, { localDate: '2026-11-09', topic: 'CRM tools', content: 'Here is the shortlist.' });
    const { run, llm } = rig({
      store,
      timeTable: [{ ref: { ...WEEKDAY_1_BARE }, result: { dates: ['2026-11-16', '2026-11-09'], range: null, ambiguous: true, rule: 'bare Monday' } }],
      llm: {
        route: plan({ intent: 'recall', timeRef: { ...WEEKDAY_1_BARE }, topic: 'CRM tools', entities: ['CRM'] }),
        write: ['ok'],
      },
    });
    const events = await run({ message: SELF_MSG });
    const recalled = recallEvent(events);
    expect(recalled.chosen).toBe('2026-11-09');
    expect(recalled.hits.map((hit) => hit.userTurn.id)).toContain(user.id);
    // The just-saved user turn is never a hit.
    const currentUserId = store.allTurns().at(-1)?.id;
    expect(recalled.hits.map((hit) => hit.userTurn.id)).not.toContain(currentUserId);
    // route's recent excludes the current message.
    const routeRecent = llm.calls('route')[0]?.input.recent ?? [];
    expect(routeRecent.map((turn) => turn.content)).not.toContain(SELF_MSG);
  });

  it('ambiguous: hits on both candidate dates produce chosen null, a question, and no verdicts', async () => {
    const store = new InMemoryStore();
    userTurn(store, { content: 'Postgres hosting?', localDate: '2026-11-10', topic: 'Postgres' });
    assistantTurn(store, { localDate: '2026-11-10', topic: 'Postgres' });
    userTurn(store, { content: 'Redis hosting?', localDate: '2026-11-03', topic: 'Postgres' });
    assistantTurn(store, { localDate: '2026-11-03', topic: 'Postgres' });
    const { run } = rig({
      store,
      timeTable: [{ ref: { kind: 'weekday', weekday: 2, modifier: 'last' }, result: { dates: ['2026-11-10', '2026-11-03'], range: null, ambiguous: true, rule: 'last Tuesday' } }],
      llm: { route: plan({ intent: 'recheck', timeRef: { kind: 'weekday', weekday: 2, modifier: 'last' }, topic: 'Postgres' }) },
    });
    const events = await run({ message: 'last Tuesday I asked about Postgres' });
    expect(recallEvent(events).chosen).toBeNull();
    expect(textOf(events)).toContain('Which one do you mean?');
    expect(events.filter((e) => e.type === 'verdict')).toHaveLength(0);
  });

  it('the recall line is built by code from the stored user turn', async () => {
    const store = new InMemoryStore();
    userTurn(store, { content: 'Tell me about Postgres hosting.', localDate: '2026-11-10', createdAtUtc: '2026-11-10T08:35:00.000Z', topic: 'Postgres' });
    assistantTurn(store, { localDate: '2026-11-10', topic: 'Postgres' });
    const { run } = rig({
      store,
      timeTable: [{ ref: { kind: 'weekday', weekday: 2, modifier: 'last' }, result: { dates: ['2026-11-10'], range: null, ambiguous: false, rule: 'last Tuesday' } }],
      llm: { route: plan({ intent: 'recall', timeRef: { kind: 'weekday', weekday: 2, modifier: 'last' }, topic: 'Postgres' }) },
    });
    const events = await run({ message: 'last Tuesday I asked about Postgres' });
    const text = textOf(events);
    expect(text).toContain('you asked: "Tell me about Postgres hosting."');
    expect(text).toContain('On ');
  });

  it('the recall line marks seeded history and a different zone', async () => {
    const store = new InMemoryStore();
    userTurn(store, { content: 'seeded question', localDate: '2026-11-10', origin: 'seed', tz: 'America/New_York', createdAtUtc: '2026-11-10T14:00:00.000Z' });
    assistantTurn(store, { localDate: '2026-11-10' });
    const { run } = rig({
      store,
      timeTable: [{ ref: { kind: 'named', name: 'today' }, result: { dates: ['2026-11-10'], range: null, ambiguous: false, rule: 'x' } }],
      llm: { route: plan({ intent: 'recall', timeRef: { kind: 'named', name: 'today' } }) },
    });
    const events = await run({ message: 'what did I ask today' });
    const text = textOf(events);
    expect(text).toContain('(America/New_York)');
    expect(text).toContain('(seeded demo history)');
  });

  it('event order: no record', async () => {
    const { run } = rig({
      llm: {
        route: plan({ intent: 'recall', timeRef: { kind: 'weekday', weekday: 2, modifier: 'last' } }),
        write: ['I could not find anything on those dates.'],
      },
      timeTable: [{ ref: { kind: 'weekday', weekday: 2, modifier: 'last' }, result: { dates: ['2026-11-10'], range: null, ambiguous: false, rule: 'last Tuesday' } }],
    });
    const events = await run({ message: 'last Tuesday we talked about X' });
    const nonTiming = types(events, ['timing']);
    expect(nonTiming[0]).toBe('status');
    expect(nonTiming).toContain('recall');
    expect(nonTiming).toContain('text');
    expect(nonTiming.at(-1)).toBe('done');
    const recalled = recallEvent(events);
    expect(recalled.hits).toEqual([]);
    expect(recalled.chosen).toBeNull();
  });

  it('every findTurns and nearestTurns call passes currentId', async () => {
    const store = new SpyStore();
    const clock = new FakeClock(NOW);
    const deps = {
      clock,
      store,
      search: new FakeSearch(clock),
      llm: new FakeLlm({ route: plan({ intent: 'recall', timeRef: { kind: 'weekday', weekday: 2, modifier: 'last' } }), write: ['none'] }),
      time: fakeTime([{ ref: { kind: 'weekday', weekday: 2, modifier: 'last' }, result: { dates: ['2026-11-10'], range: null, ambiguous: false, rule: 'x' } }]),
      guardVerdict: passThroughGuard,
      config: defaultConfig,
    };
    const events: AgentEvent[] = [];
    for await (const event of runTurn({ sessionId: SESSION, message: 'q', tz: TZ }, deps)) events.push(event);
    const currentId = store.allTurns().find((turn) => turn.role === 'user')?.id;
    for (const args of [...store.findArgs, ...store.nearestArgs]) {
      expect(args.excludeTurnIds).toEqual([currentId]);
    }
    expect(store.nearestArgs.length).toBeGreaterThan(0);
  });

  it('recall intent lists claims "from memory, not re-checked"', async () => {
    const store = new InMemoryStore();
    userTurn(store, { content: 'Neon pricing?', localDate: '2026-11-10' });
    const answer = assistantTurn(store, { localDate: '2026-11-10' });
    const src = source(store);
    claim(store, answer.id, src.id, { entity: 'Neon', attribute: 'price', value: '19 USD/month' });
    const { run } = rig({
      store,
      timeTable: [{ ref: { kind: 'named', name: 'today' }, result: { dates: ['2026-11-10'], range: null, ambiguous: false, rule: 'x' } }],
      llm: { route: plan({ intent: 'recall', timeRef: { kind: 'named', name: 'today' } }) },
    });
    const events = await run({ message: 'what was that price' });
    const text = textOf(events);
    expect(text).toContain('Neon price: 19 USD/month');
    expect(text).toContain('from memory, not re-checked');
    expect(lastAssistant(store)?.intent).toBe('recall');
  });

  it('an answer with no claims says there is nothing to check', async () => {
    const store = new InMemoryStore();
    userTurn(store, { content: 'hi', localDate: '2026-11-10' });
    assistantTurn(store, { localDate: '2026-11-10' });
    const { run } = rig({
      store,
      timeTable: [{ ref: { kind: 'named', name: 'today' }, result: { dates: ['2026-11-10'], range: null, ambiguous: false, rule: 'x' } }],
      llm: { route: plan({ intent: 'recheck', timeRef: { kind: 'named', name: 'today' } }) },
    });
    const events = await run({ message: 'check that' });
    expect(textOf(events)).toContain('no stored facts to check');
    expect(events.filter((e) => e.type === 'verdict')).toHaveLength(0);
  });

  it('refersToPrevious in an empty session gives exactly one recall event (no record)', async () => {
    const { run } = rig({
      llm: { route: plan({ intent: 'recheck', refersToPrevious: true }), write: ['I found nothing.'] },
    });
    const events = await run({ message: 'is that still right?' });
    expect(events.filter((e) => e.type === 'recall')).toHaveLength(1);
    const recalled = recallEvent(events);
    expect(recalled.hits).toEqual([]);
    expect(recalled.chosen).toBeNull();
  });

  it('a chosen question with no stored answer has nothing to check and one recall event', async () => {
    const store = new InMemoryStore();
    userTurn(store, { content: 'Unanswered question?', localDate: '2026-11-10' });
    const { run } = rig({
      store,
      timeTable: [{ ref: { kind: 'named', name: 'today' }, result: { dates: ['2026-11-10'], range: null, ambiguous: false, rule: 'x' } }],
      llm: { route: plan({ intent: 'recheck', timeRef: { kind: 'named', name: 'today' } }) },
    });
    const events = await run({ message: 'check what I asked today' });
    expect(events.filter((e) => e.type === 'recall')).toHaveLength(1);
    expect(textOf(events)).toContain('no stored facts to check');
    expect(events.filter((e) => e.type === 'verdict')).toHaveLength(0);
  });

  it('the recall line quotes the date+topic hit on the chosen date', async () => {
    const store = new InMemoryStore();
    // Two questions on the same day; only the second overlaps the topic.
    userTurn(store, { content: 'Totally unrelated question.', localDate: '2026-11-10', createdAtUtc: '2026-11-10T06:00:00.000Z' });
    assistantTurn(store, { localDate: '2026-11-10' });
    userTurn(store, { content: 'What about Postgres hosting?', localDate: '2026-11-10', createdAtUtc: '2026-11-10T07:00:00.000Z', topic: 'Postgres' });
    const answer = assistantTurn(store, { localDate: '2026-11-10', topic: 'Postgres' });
    const src = source(store);
    claim(store, answer.id, src.id, { entity: 'Postgres', attribute: 'price' });
    const { run } = rig({
      store,
      timeTable: [{ ref: { kind: 'named', name: 'today' }, result: { dates: ['2026-11-10'], range: null, ambiguous: false, rule: 'x' } }],
      llm: { route: plan({ intent: 'recall', timeRef: { kind: 'named', name: 'today' }, topic: 'Postgres' }) },
    });
    const events = await run({ message: 'what did I ask today about Postgres' });
    const text = textOf(events);
    expect(text).toContain('you asked: "What about Postgres hosting?"');
    expect(text).not.toContain('Totally unrelated');
  });

  it('refersToPrevious finds the last assistant turn without a time ref', async () => {
    const store = new InMemoryStore();
    userTurn(store, { content: 'Neon pricing?', localDate: '2026-11-10' });
    const answer = assistantTurn(store, { localDate: '2026-11-10' });
    const src = source(store);
    claim(store, answer.id, src.id, { entity: 'Neon', attribute: 'price' });
    const { run } = rig({
      store,
      llm: { route: plan({ intent: 'recall', refersToPrevious: true }) },
    });
    const events = await run({ message: 'is that still right?' });
    const recalled = recallEvent(events);
    expect(recalled.chosen).toBe('2026-11-10');
    expect(recalled.hits[0]?.assistantTurn?.id).toBe(answer.id);
  });
});
