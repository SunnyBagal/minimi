import { describe, expect, it } from 'vitest';
import type { AgentEvent, MemoryHit, MemoryStore } from '../contracts';
import { FakeSearch, fakeTime, passThroughGuard, FakeLlm, FakeClock, chatPlan } from '../testing/fakes';
import { InMemoryStore } from '../testing/inMemoryStore';
import { defaultConfig } from '../config';
import { runTurn } from './runTurn';
import { assistantTurn, claim, lastAssistant, plan, rig, source, textOf, types, userTurn, NOW, SESSION, TZ } from './testSupport';
import { recallHeadline } from '../recallHeadline';

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

  it('the recalled question is a structured field on the recall event, not repeated in the answer text', async () => {
    const store = new InMemoryStore();
    userTurn(store, { content: 'Tell me about Postgres hosting.', localDate: '2026-11-10', createdAtUtc: '2026-11-10T08:35:00.000Z', topic: 'Postgres' });
    assistantTurn(store, { localDate: '2026-11-10', topic: 'Postgres' });
    const { run } = rig({
      store,
      timeTable: [{ ref: { kind: 'weekday', weekday: 2, modifier: 'last' }, result: { dates: ['2026-11-10'], range: null, ambiguous: false, rule: 'last Tuesday' } }],
      llm: { route: plan({ intent: 'recall', timeRef: { kind: 'weekday', weekday: 2, modifier: 'last' }, topic: 'Postgres' }) },
    });
    const events = await run({ message: 'last Tuesday I asked about Postgres' });
    const asked = recallEvent(events).asked;
    expect(asked).toMatchObject({
      question: 'Tell me about Postgres hosting.',
      createdAtUtc: '2026-11-10T08:35:00.000Z',
      origin: 'live',
    });
    expect(textOf(events)).not.toContain('you asked');
  });

  it('the recalled question keeps its origin and zone, and the headline marks seeded history and a different zone', async () => {
    const store = new InMemoryStore();
    userTurn(store, { content: 'seeded question', localDate: '2026-11-10', origin: 'seed', tz: 'America/New_York', createdAtUtc: '2026-11-10T14:00:00.000Z' });
    assistantTurn(store, { localDate: '2026-11-10' });
    const { run } = rig({
      store,
      timeTable: [{ ref: { kind: 'named', name: 'today' }, result: { dates: ['2026-11-10'], range: null, ambiguous: false, rule: 'x' } }],
      llm: { route: plan({ intent: 'recall', timeRef: { kind: 'named', name: 'today' } }) },
    });
    const events = await run({ message: 'what did I ask today' });
    const asked = recallEvent(events).asked;
    expect(asked).toMatchObject({ question: 'seeded question', origin: 'seed', tz: 'America/New_York' });
    if (asked === undefined || asked === null) throw new Error('no asked');
    const line = recallHeadline(asked, (utc, tz) => `${utc} in ${tz}`, 'Asia/Kolkata');
    expect(line).toContain('(America/New_York)');
    expect(line).toContain('(seeded demo history)');
    expect(line).toContain('you asked: "seeded question".');
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
    expect(recalled.asked).toBeNull();
    expect(recalled.nearest).toEqual([]);
  });

  it('no record: the recall event carries the nearest turns handed to the writer', async () => {
    const store = new InMemoryStore();
    userTurn(store, { content: 'Postgres hosting prices?', localDate: '2026-11-05', createdAtUtc: '2026-11-05T09:00:00.000Z', topic: 'Postgres hosting' });
    assistantTurn(store, { localDate: '2026-11-05', topic: 'Postgres hosting' });
    const { run } = rig({
      store,
      llm: {
        route: plan({ intent: 'recall', timeRef: { kind: 'weekday', weekday: 2, modifier: 'last' }, topic: 'Postgres hosting' }),
        write: ['Nothing on that day.'],
      },
      timeTable: [{ ref: { kind: 'weekday', weekday: 2, modifier: 'last' }, result: { dates: ['2026-11-10'], range: null, ambiguous: false, rule: 'last Tuesday' } }],
    });
    const events = await run({ message: 'last Tuesday I asked about Postgres hosting' });
    const recalled = recallEvent(events);
    expect(recalled.hits).toEqual([]);
    expect(recalled.nearest?.map((hit) => hit.userTurn.localDate)).toContain('2026-11-05');
  });

  it('no record: code states the dates tried and the nearest match before the writer, in words', async () => {
    const store = new InMemoryStore();
    userTurn(store, { content: 'Postgres hosting prices?', localDate: '2026-11-05', createdAtUtc: '2026-11-05T09:00:00.000Z', topic: 'Postgres hosting' });
    assistantTurn(store, { localDate: '2026-11-05', topic: 'Postgres hosting' });
    const { run } = rig({
      store,
      llm: {
        route: plan({ intent: 'recall', timeRef: { kind: 'weekday', weekday: 2, modifier: 'last' }, topic: 'Postgres hosting' }),
        write: ['Nothing is saved for those dates. Was it that earlier conversation?'],
      },
      timeTable: [{ ref: { kind: 'weekday', weekday: 2, modifier: 'last' }, result: { dates: ['2026-11-10', '2026-11-03'], range: null, ambiguous: true, rule: 'last Tuesday' } }],
    });
    const text = textOf(await run({ message: 'last Tuesday I asked about Postgres hosting' }));
    expect(
      text.startsWith(
        "I have nothing saved about Postgres hosting from 10 Nov 2026 or 3 Nov 2026, so I can't look that conversation up.\nThe nearest saved conversation is from 5 Nov 2026: `Postgres hosting prices?`.",
      ),
    ).toBe(true);
    expect(text).toContain('Nothing is saved for those dates.');
  });

  it('no previous answer at all: no date is claimed as tried', async () => {
    const { run } = rig({
      llm: { route: plan({ intent: 'recheck', refersToPrevious: true }), write: ['I could not tell which earlier answer you meant.'] },
    });
    const events = await run({ message: 'Is that still right?' });
    expect(recallEvent(events).candidates.dates).toEqual([]);
    expect(textOf(events)).not.toContain('I have nothing saved');
  });

  it('the "I read" line is not added on the previous-answer path, even if the plan also carries a numeric date', async () => {
    const store = new InMemoryStore();
    userTurn(store, { content: 'Pipeloom Team price?', localDate: '2026-11-09', createdAtUtc: '2026-11-09T05:50:00.000Z', session: SESSION } as never);
    const { run } = rig({
      store,
      llm: { route: plan({ intent: 'recheck', refersToPrevious: true, timeRef: { kind: 'numeric', first: 3, second: 11 }, timeText: '3/11' }), write: ['Summary.'] },
    });
    const text = textOf(await run({ message: 'Is that still right for 3/11?' }));
    expect(text).not.toContain('I read');
  });

  it('a numeric date is stated in words: I read "3/11" as 3 November 2026', async () => {
    const store = new InMemoryStore();
    userTurn(store, { content: 'Pipeloom Team price?', localDate: '2026-11-03', createdAtUtc: '2026-11-03T05:50:00.000Z', topic: 'Pipeloom' });
    assistantTurn(store, { localDate: '2026-11-03', topic: 'Pipeloom' });
    const { run } = rig({
      store,
      timeTable: [{ ref: { kind: 'numeric', first: 3, second: 11 }, result: { dates: ['2026-11-03', '2026-03-11'], range: null, ambiguous: true, rule: 'numeric' } }],
      llm: { route: plan({ intent: 'recall', timeRef: { kind: 'numeric', first: 3, second: 11 }, timeText: '3/11' }) },
    });
    const text = textOf(await run({ message: 'What did we talk about on 3/11?' }));
    expect(text).toContain('I read "3/11" as 3 November 2026.');
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
    expect(recallEvent(events).asked?.question).toBe('What about Postgres hosting?');
    expect(textOf(events)).not.toContain('Totally unrelated');
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

  const LAST_TUESDAY = { kind: 'weekday', weekday: 2, modifier: 'last' } as const;
  const CASE19_PLAN = {
    intent: 'recheck' as const,
    timeRef: { ...LAST_TUESDAY },
    topic: 'Postgres hosting pricing',
    entities: ['Postgres', 'Northwind PG', 'Basalt DB'],
  };

  function seedCase19(store: InMemoryStore) {
    // The two stored conversations exactly as the real eval case wrote them.
    const pgUser = userTurn(store, {
      content: 'Compare Postgres hosting for a small SaaS: Northwind PG or Basalt DB?',
      localDate: '2026-11-10',
      topic: 'Postgres hosting',
    });
    const pgAnswer = assistantTurn(store, {
      localDate: '2026-11-10',
      topic: 'Postgres hosting',
      content:
        'Northwind PG Starter is 19 USD per month. Basalt DB Pro is 25 USD per month. Basalt DB free tier includes 1 project.',
    });
    const pgSource = source(store, {
      url: 'https://northwind.test/pricing',
      firstParty: true,
      text: 'Starter: 19 USD per month',
    });
    claim(store, pgAnswer.id, pgSource.id, {
      entity: 'Northwind PG',
      attribute: 'Starter price',
      value: '19 USD/month',
      quote: 'Starter: 19 USD per month',
    });
    const nov3User = userTurn(store, {
      content: "What does Pipeloom's Team plan cost per seat?",
      localDate: '2026-11-03',
      topic: 'Pipeloom pricing',
      entities: ['Pipeloom'],
    });
    assistantTurn(store, {
      localDate: '2026-11-03',
      content: 'Pipeloom Team is 30 USD per seat per month.',
    });
    return { pgUser, pgAnswer, nov3User };
  }

  function case19Rig(store: InMemoryStore) {
    return rig({
      store,
      timeTable: [
        {
          ref: { ...LAST_TUESDAY },
          result: { dates: ['2026-11-10', '2026-11-03'], range: null, ambiguous: true, rule: 'last Tuesday' },
        },
      ],
      llm: { route: plan(CASE19_PLAN), write: ['Summary.'] },
      search: {
        pages: {
          'https://northwind.test/pricing': { status: 'ok', live: true, text: 'Starter: 19 USD per month' },
        },
      },
    });
  }

  it('a date that shares only one word of the topic does not make the choice ambiguous', async () => {
    const store = new InMemoryStore();
    const { nov3User } = seedCase19(store);
    const { run } = case19Rig(store);
    const events = await run({
      message: 'Last Tuesday I asked you about Postgres hosting. Has any pricing changed since then?',
    });
    const recalled = recallEvent(events);
    // The reproduction: the 3 Nov Pipeloom pair still comes back 'date+topic'
    // (score 1 on the shared word "pricing"), it just cannot compete with 4.
    expect(recalled.hits.find((hit) => hit.userTurn.id === nov3User.id)?.matched).toBe('date+topic');
    expect(recalled.chosen).toBe('2026-11-10');
    const verdicts = events.filter((e) => e.type === 'verdict');
    expect(verdicts).toHaveLength(1);
    if (verdicts[0]?.type === 'verdict') {
      expect(verdicts[0].row.claim.entity).toBe('Northwind PG');
    }
  });

  it('two dates with comparable topic matches stay ambiguous', async () => {
    const store = new InMemoryStore();
    seedCase19(store);
    // A genuinely on-topic second conversation on 3 Nov: scores 3 vs 4.
    userTurn(store, {
      content: 'Is managed Postgres worth it over a VPS?',
      localDate: '2026-11-03',
      topic: 'Postgres hosting',
      entities: ['Northwind PG'],
    });
    assistantTurn(store, {
      localDate: '2026-11-03',
      content: 'Northwind PG Starter is 19 USD per month.',
    });
    const { run } = case19Rig(store);
    const events = await run({
      message: 'Last Tuesday I asked you about Postgres hosting. Has any pricing changed since then?',
    });
    const recalled = recallEvent(events);
    // The on-topic pairs score 4 and 3; the Pipeloom pair is still there at 1.
    expect(recalled.hits.map((hit) => hit.score).sort((a, b) => b - a)).toEqual([4, 3, 1]);
    expect(recalled.chosen).toBeNull();
    expect(textOf(events)).toContain('Which one do you mean?');
    expect(events.filter((e) => e.type === 'verdict')).toHaveLength(0);
  });
});
