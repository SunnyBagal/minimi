/**
 * Held-out cases 101–119. Written from docs/02-evals.md and the product brief.
 * Each comment names the spec rule the case tests.
 */
import type { AgentEvent, MemoryStore } from '../../src/core/contracts';
import {
  asksToConfirm,
  candidateDates,
  chosenIs,
  claimsNoChangeAbout,
  intentIs,
  judgeSaysNo,
  noVerdicts,
  numbersAllowed,
  offersIn,
  ofType,
  ok,
  quoteInPage,
  recallOf,
  sentencesOf,
  turnOf,
  verdictFor,
  verdictIs,
  verdictsOf,
} from '../assert';
import type { FixtureScenario } from '../fixtureSearch';
import { CLOCK, TZ, type Assertion, type CasePart, type CaseRun, type EvalCase } from '../types';
import { ist, monthScope, seedExchange } from './memory';
import {
  BRASSLINE_PRICING,
  BRASSLINE_V1,
  BRASSLINE_V1_QUOTE,
  BRASSLINE_V2,
  CINDERWELL_PAGE,
  CINDERWELL_PRICING,
  FERNLEDGER_PAGE,
  FERNLEDGER_PRICING,
  HARBORLANE_PAGE,
  HARBORLANE_PRICING,
  HEARTHMAIL_BLOG,
  HEARTHMAIL_PRICING,
  HEARTHMAIL_V2,
  IVYLEDGER_PAGE,
  IVYLEDGER_PRICING,
  IVYLEDGER_QUOTE,
  KILNNOTE_PAGE,
  LOOMERY_NEWS,
  LOOMERY_PAGE,
  LOOMERY_PRICING,
  LOOMERY_QUOTE,
  LUMENBOARD_PAGE,
  LUMENBOARD_PRICING,
  MOTHLIGHT_PAGE,
  MOTHLIGHT_PRICING,
  NIMBUSMAIL_PLUS_14,
  NIMBUSMAIL_PLUS_18,
  NIMBUSMAIL_PRICING,
  NIMBUSMAIL_V1_OLDER,
  NIMBUSMAIL_V2,
  ORCHARDPAY_PAGE,
  ORCHARDPAY_PRICING,
  PALLETORY_PAGE,
  PALLETORY_PRICING,
  PALLETORY_QUOTE,
  PEBBLECART_PAGE,
  PEBBLECART_PRICING,
  QUILLHARBOR_PAGE,
  QUILLHARBOR_PRICING,
  REVIEWDESK_NOTE,
  ROWANHOST_PAGE,
  ROWANHOST_PRICING,
  VELLUMSTACK_PRICING,
  VELLUMSTACK_V1,
  VELLUMSTACK_V1_QUOTE,
  VELLUMSTACK_V2,
} from './pages';
import {
  brasslineScenario,
  cinderwellScenario,
  emptyScenario,
  fernledgerScenario,
  hearthmailScenario,
  ivyledgerScenario,
  kilnnoteScenario,
  lumenboardScenario,
  newsScenario,
  nimbusmailScenario,
  orchardpayScenario,
  rowanhostScenario,
  vellumstackScenario,
} from './scenarios';

function namesDate(text: string, day: number, month: string): boolean {
  const m = month.slice(0, 3);
  return new RegExp(`\\b${day}\\s+${m}`, 'i').test(text) || new RegExp(`\\b${m}[a-z]*\\s+${day}\\b`, 'i').test(text);
}

/** "8 November 2026" or "November 8, 2026": the date in words, with the year. */
function saysDay(text: string, day: number, month: string, year = 2026): boolean {
  const m = month.slice(0, 3);
  return (
    new RegExp(`\\b${day}\\s+${m}[a-z]*\\s+${year}\\b`, 'i').test(text) ||
    new RegExp(`\\b${m}[a-z]*\\s+${day},?\\s+${year}\\b`, 'i').test(text)
  );
}

function part(
  messages: readonly string[],
  scenario: FixtureScenario,
  prepare?: (store: MemoryStore) => void,
  clock = CLOCK,
  tz = TZ,
): CasePart {
  return { seeds: [], prepare, clock, tz, scenario, messages };
}

function shown(run: CaseRun, index = 0): string {
  return turnOf(run, 0, index).answerText;
}

function eventsAt(run: CaseRun, index = 0): AgentEvent[] {
  return turnOf(run, 0, index).events;
}

function cites(events: AgentEvent[], url: string): boolean {
  return ofType(events, 'citations').some((event) => event.items.some((item) => item.url === url));
}

function uncitedEmpty(events: AgentEvent[]): boolean {
  return ofType(events, 'flags').every((event) => event.uncitedNumbers.length === 0);
}

// Spec: a fresh answer cites the page it got the figures from, and every number is on that page.
const case101: EvalCase = {
  id: 101,
  parts: [part(['What do Lumenboard\'s Studio and Field plans cost per month?'], lumenboardScenario)],
  check(run) {
    const events = eventsAt(run);
    const answer = shown(run);
    return [
      intentIs(events, 'fresh'),
      ok('searched', turnOf(run, 0, 0).log.some((call) => call.kind === 'search'), turnOf(run, 0, 0).log),
      ok('cites the Lumenboard pricing page', cites(events, LUMENBOARD_PRICING), ofType(events, 'citations')),
      ok('states both plan prices', /\b36\b/.test(answer) && /\b64\b/.test(answer), answer),
      ok('uncitedNumbers is empty', uncitedEmpty(events), ofType(events, 'flags')),
      numbersAllowed(run, events, [LUMENBOARD_PAGE]),
    ];
  },
};

// Brief: a fresh price stated in a currency other than US dollars, still cited.
const case102: EvalCase = {
  id: 102,
  parts: [part(['What does Orchardpay\'s Grove plan cost per month?'], orchardpayScenario)],
  check(run) {
    const events = eventsAt(run);
    const answer = shown(run);
    return [
      intentIs(events, 'fresh'),
      ok('cites the Orchardpay pricing page', cites(events, ORCHARDPAY_PRICING), ofType(events, 'citations')),
      ok('states the price in euros', /\b29\b/.test(answer) && /EUR|euros?/i.test(answer), answer),
      ok('uncitedNumbers is empty', uncitedEmpty(events), ofType(events, 'flags')),
      numbersAllowed(run, events, [ORCHARDPAY_PAGE]),
    ];
  },
};

// Brief: an explicit "search for this" on a stable topic still searches and uses the page.
const case103: EvalCase = {
  id: 103,
  parts: [part(['Search the web for the name of Kilnnote\'s notebook file format.'], kilnnoteScenario)],
  check(run) {
    const events = eventsAt(run);
    const answer = shown(run);
    return [
      intentIs(events, 'fresh'),
      ok('at least one search', turnOf(run, 0, 0).log.some((call) => call.kind === 'search'), turnOf(run, 0, 0).log),
      ok('answer names the Cinder file', /Cinder file/.test(answer), answer),
      ok('uncitedNumbers is empty', uncitedEmpty(events), ofType(events, 'flags')),
      numbersAllowed(run, events, [KILNNOTE_PAGE]),
    ];
  },
};

// Spec case 17: plain chat does not search, recall, or cite, even when a price is stored.
const case104: EvalCase = {
  id: 104,
  parts: [
    part(
      [
        "Make this shorter: 'Please let the client know the workshop has been moved to the east studio.'",
        'How does a compass find north?',
      ],
      emptyScenario,
      (store) => {
        seedExchange(
          store,
          ist('2026-11-10', '2026-11-10T08:00:00.000Z'),
          'What does Harborlane\'s Invoice plan cost?',
          'Harborlane Invoice is 12 USD per month.',
          'Harborlane',
          ['Harborlane'],
          [
            {
              entity: 'Harborlane',
              attribute: 'price',
              value: '12 USD/month',
              scope: monthScope('Invoice', 'USD'),
              quote: 'Harborlane Invoice is 12 USD per month.',
              url: HARBORLANE_PRICING,
              text: HARBORLANE_PAGE,
            },
          ],
        );
      },
    ),
  ],
  check(run) {
    const traces = run.parts[0]?.traces ?? [];
    const answer = traces.map((trace) => trace.answerText).join('\n');
    return [
      ...traces.flatMap((trace) => [
        intentIs(trace.events, 'chat'),
        ok('provider log is empty', trace.log.length === 0, trace.log),
        ok('no recall event', recallOf(trace.events) === undefined, recallOf(trace.events)?.chosen ?? null),
        noVerdicts(trace.events),
        ok('no citations', ofType(trace.events, 'citations').length === 0, ofType(trace.events, 'citations').length),
        numbersAllowed(run, trace.events, []),
      ]),
      ok('the stored Harborlane claim is not mentioned', !/Harborlane/.test(answer), answer),
    ];
  },
};

// Spec case 3's date rule: "last Thursday" has two candidate dates; only one is about this product.
const case105: EvalCase = {
  id: 105,
  parts: [
    part(['What did I ask you last Thursday about Pebblecart?'], emptyScenario, (store) => {
      seedExchange(
        store,
        ist('2026-11-12', '2026-11-12T04:30:00.000Z'),
        'What does Pebblecart\'s Harbor plan cost?',
        'Pebblecart Harbor is 33 USD per month.',
        'Pebblecart',
        ['Pebblecart'],
        [
          {
            entity: 'Pebblecart',
            attribute: 'price',
            value: '33 USD/month',
            scope: monthScope('Harbor', 'USD'),
            quote: 'Pebblecart Harbor is 33 USD per month.',
            url: PEBBLECART_PRICING,
            text: PEBBLECART_PAGE,
          },
        ],
      );
    }),
  ],
  check(run) {
    const events = eventsAt(run);
    const answer = shown(run);
    return [
      intentIs(events, 'recall'),
      candidateDates(events, ['2026-11-12', '2026-11-05']),
      chosenIs(events, '2026-11-12'),
      ok('answer names 12 Nov', namesDate(answer, 12, 'Nov'), answer),
      ok('answer restates Pebblecart', /Pebblecart/.test(answer), answer),
      noVerdicts(events),
      numbersAllowed(run, events, [PEBBLECART_PAGE]),
    ];
  },
};

// Spec: "yesterday" is the previous local calendar day.
const case106: EvalCase = {
  id: 106,
  parts: [
    part(['What did I ask you yesterday?'], emptyScenario, (store) => {
      seedExchange(
        store,
        ist('2026-11-12', '2026-11-12T12:30:00.000Z'),
        'What does Mothlight\'s Lantern plan cost?',
        'Mothlight Lantern is 28 USD per month.',
        'Mothlight',
        ['Mothlight'],
        [
          {
            entity: 'Mothlight',
            attribute: 'price',
            value: '28 USD/month',
            scope: monthScope('Lantern', 'USD'),
            quote: 'Mothlight Lantern is 28 USD per month.',
            url: MOTHLIGHT_PRICING,
            text: MOTHLIGHT_PAGE,
          },
        ],
      );
    }),
  ],
  check(run) {
    const events = eventsAt(run);
    const answer = shown(run);
    return [
      intentIs(events, 'recall'),
      chosenIs(events, '2026-11-12'),
      ok('answer restates Mothlight', /Mothlight/.test(answer), answer),
      noVerdicts(events),
      numbersAllowed(run, events, [MOTHLIGHT_PAGE]),
    ];
  },
};

// Spec case 8: a numeric date with no year has both readings; the one with a turn is chosen and said in words.
const case107: EvalCase = {
  id: 107,
  parts: [
    part(['What did we talk about on 8/11?'], emptyScenario, (store) => {
      seedExchange(
        store,
        ist('2026-11-08', '2026-11-08T05:45:00.000Z'),
        'What does Quillharbor\'s Ink plan cost?',
        'Quillharbor Ink is 41 USD per month.',
        'Quillharbor',
        ['Quillharbor'],
        [
          {
            entity: 'Quillharbor',
            attribute: 'price',
            value: '41 USD/month',
            scope: monthScope('Ink', 'USD'),
            quote: 'Quillharbor Ink is 41 USD per month.',
            url: QUILLHARBOR_PRICING,
            text: QUILLHARBOR_PAGE,
          },
        ],
      );
    }),
  ],
  check(run) {
    const events = eventsAt(run);
    const answer = shown(run);
    return [
      intentIs(events, 'recall'),
      candidateDates(events, ['2026-11-08', '2026-08-11']),
      chosenIs(events, '2026-11-08'),
      ok('answer says 8 November 2026 in words', saysDay(answer, 8, 'November'), answer),
      ok('answer restates Quillharbor', /Quillharbor/.test(answer), answer),
      noVerdicts(events),
      numbersAllowed(run, events, [QUILLHARBOR_PAGE]),
    ];
  },
};

// Spec case 11: after an ambiguous date, "the 12th" chooses that day and does not ask again.
const NIMBUS_QUESTION = 'What does the Nimbusmail Plus plan cost?';

const case108: EvalCase = {
  id: 108,
  parts: [
    part(
      ['Last Thursday I asked what the Nimbusmail Plus plan costs. Has the price changed?', 'The 12th.'],
      nimbusmailScenario,
      (store) => {
        seedExchange(
          store,
          ist('2026-11-12', '2026-11-12T09:40:00.000Z'),
          NIMBUS_QUESTION,
          NIMBUSMAIL_PLUS_18,
          'Nimbusmail',
          ['Nimbusmail'],
          [
            {
              entity: 'Nimbusmail',
              attribute: 'price',
              value: '18 USD/month',
              scope: monthScope('Plus', 'USD'),
              quote: NIMBUSMAIL_PLUS_18,
              url: NIMBUSMAIL_PRICING,
              text: NIMBUSMAIL_V2,
            },
          ],
        );
        seedExchange(
          store,
          ist('2026-11-05', '2026-11-05T09:40:00.000Z'),
          NIMBUS_QUESTION,
          NIMBUSMAIL_PLUS_14,
          'Nimbusmail',
          ['Nimbusmail'],
          [
            {
              entity: 'Nimbusmail',
              attribute: 'price',
              value: '14 USD/month',
              scope: monthScope('Plus', 'USD'),
              quote: NIMBUSMAIL_PLUS_14,
              url: NIMBUSMAIL_PRICING,
              text: NIMBUSMAIL_V1_OLDER,
            },
          ],
        );
      },
    ),
  ],
  check(run) {
    const first = eventsAt(run, 0);
    const second = eventsAt(run, 1);
    const follow = shown(run, 1);
    const rows = verdictsOf(second);
    return [
      candidateDates(first, ['2026-11-12', '2026-11-05']),
      chosenIs(first, null),
      ok('candidates are ambiguous', recallOf(first)?.candidates.ambiguous === true, recallOf(first)?.candidates.ambiguous ?? null),
      ok('turn 1 asks which conversation', asksToConfirm(shown(run, 0)), shown(run, 0)),
      noVerdicts(first),
      chosenIs(second, '2026-11-12'),
      ok('turn 2 does not ask the date again', !asksToConfirm(follow), follow),
      ok(
        'verdicts cover only the 12 Nov claim',
        rows.length >= 1 && rows.every((row) => row.claim.value.includes('18') && !row.claim.value.includes('14')),
        rows.map((row) => row.claim.value),
      ),
      verdictIs(second, 'Nimbusmail', 'price', 'unchanged'),
      numbersAllowed(run, first, [NIMBUSMAIL_V2]),
      numbersAllowed(run, second, [NIMBUSMAIL_V2]),
    ];
  },
};

// Spec case 18a: 23:40 local is still "yesterday" at 00:25 the next calendar morning.
const case109: EvalCase = {
  id: 109,
  parts: [
    part(
      ['What did I ask you yesterday?'],
      emptyScenario,
      (store) => {
        seedExchange(
          store,
          ist('2026-11-10', '2026-11-10T18:10:00.000Z'),
          'What does a tide table measure at Sablepath harbor?',
          'A tide table lists the times of high and low water.',
          'Sablepath',
          ['Sablepath'],
          [],
        );
      },
      '2026-11-10T18:55:00.000Z',
    ),
  ],
  check(run) {
    const events = eventsAt(run);
    const answer = shown(run);
    const hits = recallOf(events)?.hits ?? [];
    return [
      intentIs(events, 'recall'),
      chosenIs(events, '2026-11-10'),
      ok(
        'the hit is the late-night Sablepath turn',
        hits.some((hit) => hit.userTurn.localDate === '2026-11-10' && /tide table/.test(hit.userTurn.content)),
        hits.map((hit) => hit.userTurn.localDate),
      ),
      ok('answer restates the tide-table question', /tide table/.test(answer), answer),
      noVerdicts(events),
      numbersAllowed(run, events, []),
    ];
  },
};

// Spec case 7: both candidate dates match the topic, so the answer asks and does not pick one.
const ROWAN_QUESTION = 'What does the Rowanhost Cabin plan cost?';

const case110: EvalCase = {
  id: 110,
  parts: [
    part(
      ['Last Monday I asked about the Rowanhost Cabin plan. Has the price changed since then?'],
      rowanhostScenario,
      (store) => {
        for (const when of [
          ist('2026-11-09', '2026-11-09T10:30:00.000Z'),
          ist('2026-11-02', '2026-11-02T10:30:00.000Z'),
        ]) {
          seedExchange(store, when, ROWAN_QUESTION, 'Rowanhost Cabin is 52 USD per month.', 'Rowanhost Cabin', ['Rowanhost'], [
            {
              entity: 'Rowanhost',
              attribute: 'price',
              value: '52 USD/month',
              scope: monthScope('Cabin', 'USD'),
              quote: 'Rowanhost Cabin is 52 USD per month.',
              url: ROWANHOST_PRICING,
              text: ROWANHOST_PAGE,
            },
          ]);
        }
      },
    ),
  ],
  check(run) {
    const events = eventsAt(run);
    const answer = shown(run);
    const hits = recallOf(events)?.hits ?? [];
    return [
      candidateDates(events, ['2026-11-09', '2026-11-02']),
      ok('candidates are ambiguous', recallOf(events)?.candidates.ambiguous === true, recallOf(events)?.candidates.ambiguous ?? null),
      chosenIs(events, null),
      ok(
        'both Mondays matched',
        ['2026-11-09', '2026-11-02'].every((date) => hits.some((hit) => hit.userTurn.localDate === date)),
        hits.map((hit) => hit.userTurn.localDate),
      ),
      ok('asks which conversation', asksToConfirm(answer), answer),
      noVerdicts(events),
      numbersAllowed(run, events, [ROWANHOST_PAGE]),
    ];
  },
};

// Spec case 4: nothing stored on the dates named, and nothing near them. Judge J1.
const case111: EvalCase = {
  id: 111,
  parts: [
    part(
      ['Last Thursday I asked what Copperlane\'s Relay plan costs. Has that price changed?'],
      emptyScenario,
    ),
  ],
  judges: ['J1'],
  check(run) {
    const events = eventsAt(run);
    const answer = shown(run);
    const recall = recallOf(events);
    return [
      ok('recall.hits is empty', (recall?.hits.length ?? -1) === 0, recall?.hits.length ?? null),
      ok('nothing near', (recall?.nearest?.length ?? 0) === 0, recall?.nearest?.length ?? null),
      ok('answer names 12 Nov', namesDate(answer, 12, 'Nov'), answer),
      ok('answer names 5 Nov', namesDate(answer, 5, 'Nov'), answer),
      noVerdicts(events),
      ok('offers a fresh lookup', offersIn(answer, /Copperlane|Relay|pric/i), answer),
      ...judgeSaysNo(run, 'J1'),
      numbersAllowed(run, events, []),
    ];
  },
};

// Spec case 6: the asked dates have nothing; a same-topic turn on another day is offered, with no verdict yet.
const case112: EvalCase = {
  id: 112,
  parts: [
    part(
      ['Last Wednesday I asked you about Fernledger pricing. Has the price changed?'],
      fernledgerScenario,
      (store) => {
        seedExchange(
          store,
          ist('2026-11-07', '2026-11-07T06:30:00.000Z'),
          'What does Fernledger pricing look like for the Growth plan?',
          'Fernledger Growth is 17 USD per month.',
          'Fernledger pricing',
          ['Fernledger'],
          [
            {
              entity: 'Fernledger',
              attribute: 'price',
              value: '17 USD/month',
              scope: monthScope('Growth', 'USD'),
              quote: 'Fernledger Growth is 17 USD per month.',
              url: FERNLEDGER_PRICING,
              text: FERNLEDGER_PAGE,
            },
          ],
        );
      },
    ),
  ],
  check(run) {
    const events = eventsAt(run);
    const answer = shown(run);
    const nearest = recallOf(events)?.nearest ?? [];
    return [
      chosenIs(events, null),
      ok('answer names 11 Nov', namesDate(answer, 11, 'Nov'), answer),
      ok('answer names 4 Nov', namesDate(answer, 4, 'Nov'), answer),
      ok(
        'nearest is the Fernledger conversation on 7 Nov',
        nearest.some((hit) => hit.userTurn.localDate === '2026-11-07' && hit.matched === 'topic'),
        nearest.map((hit) => [hit.userTurn.localDate, hit.matched]),
      ),
      ok('answer names 7 Nov', namesDate(answer, 7, 'Nov'), answer),
      ok('offers that conversation', offersIn(answer, /Fernledger|Growth|pric/i), answer),
      noVerdicts(events),
      numbersAllowed(run, events, [FERNLEDGER_PAGE]),
    ];
  },
};

// Spec case 2: the stored quote is still on the live first-party page, so the verdict is unchanged by the fast path.
const case113: EvalCase = {
  id: 113,
  parts: [
    part(
      ['On 9 November I asked what Ivyledger\'s Desk plan costs. Is that price still correct?'],
      ivyledgerScenario,
      (store) => {
        seedExchange(
          store,
          ist('2026-11-09', '2026-11-09T10:30:00.000Z'),
          'What does Ivyledger\'s Desk plan cost?',
          IVYLEDGER_QUOTE,
          'Ivyledger',
          ['Ivyledger'],
          [
            {
              entity: 'Ivyledger',
              attribute: 'price',
              value: '27 USD/month',
              scope: monthScope('Desk', 'USD'),
              quote: IVYLEDGER_QUOTE,
              url: IVYLEDGER_PRICING,
              text: IVYLEDGER_PAGE,
            },
          ],
        );
      },
    ),
  ],
  check(run) {
    const events = eventsAt(run);
    const fetches = turnOf(run, 0, 0).log.filter((call) => call.kind === 'fetchPage');
    const row = verdictFor(events, 'Ivyledger', 'price');
    return [
      intentIs(events, 'recheck'),
      chosenIs(events, '2026-11-09'),
      verdictIs(events, 'Ivyledger', 'price', 'unchanged'),
      ok('decidedBy is fast_path', row?.check.decidedBy === 'fast_path', row?.check.decidedBy ?? null),
      ok('exactly one fetch, of the vendor page', fetches.length === 1 && fetches[0]?.url === IVYLEDGER_PRICING, fetches),
      ok('the source is live', row?.nowSource?.live === true, row?.nowSource?.live ?? null),
      numbersAllowed(run, events, [IVYLEDGER_PAGE]),
    ];
  },
};

// Spec case 3's changed row: the new value is on the live v2 page.
const case114: EvalCase = {
  id: 114,
  parts: [
    part(
      ['On 5 November I asked what Brassline\'s Meter plan costs. Has that price changed?'],
      brasslineScenario,
      (store) => {
        seedExchange(
          store,
          ist('2026-11-05', '2026-11-05T05:30:00.000Z'),
          'What does Brassline\'s Meter plan cost?',
          BRASSLINE_V1_QUOTE,
          'Brassline',
          ['Brassline'],
          [
            {
              entity: 'Brassline',
              attribute: 'price',
              value: '22 USD/month',
              scope: monthScope('Meter', 'USD'),
              quote: BRASSLINE_V1_QUOTE,
              url: BRASSLINE_PRICING,
              text: BRASSLINE_V1,
            },
          ],
        );
      },
    ),
  ],
  check(run) {
    const events = eventsAt(run);
    const row = verdictFor(events, 'Brassline', 'price');
    return [
      intentIs(events, 'recheck'),
      chosenIs(events, '2026-11-05'),
      verdictIs(events, 'Brassline', 'price', 'changed'),
      ok('newValue contains 31', (row?.check.newValue ?? '').includes('31'), row?.check.newValue ?? null),
      ok('newQuote is on the v2 page', quoteInPage(row?.check.newQuote ?? null, BRASSLINE_V2), row?.check.newQuote ?? null),
      ok('the source is live', row?.nowSource?.live === true, row?.nowSource?.live ?? null),
      numbersAllowed(run, events, [BRASSLINE_V2]),
    ];
  },
};

// Spec case 16, without the original product's judge: the page timed out, so the answer must not call the price unchanged.
const case115: EvalCase = {
  id: 115,
  parts: [
    part(
      ['Last Tuesday I asked what Cinderwell\'s Foundry plan costs. Has it changed?'],
      cinderwellScenario,
      (store) => {
        seedExchange(
          store,
          ist('2026-11-10', '2026-11-10T08:50:00.000Z'),
          'What does Cinderwell\'s Foundry plan cost?',
          'Cinderwell Foundry is 44 USD per month.',
          'Cinderwell',
          ['Cinderwell'],
          [
            {
              entity: 'Cinderwell',
              attribute: 'price',
              value: '44 USD/month',
              scope: monthScope('Foundry', 'USD'),
              quote: 'Cinderwell Foundry is 44 USD per month.',
              url: CINDERWELL_PRICING,
              text: CINDERWELL_PAGE,
            },
          ],
        );
      },
    ),
  ],
  check(run) {
    const events = eventsAt(run);
    const answer = shown(run);
    return [
      intentIs(events, 'recheck'),
      chosenIs(events, '2026-11-10'),
      verdictIs(events, 'Cinderwell', 'price', 'source_unavailable'),
      ok(
        'the pricing page was fetched',
        turnOf(run, 0, 0).log.some((call) => call.kind === 'fetchPage' && call.url === CINDERWELL_PRICING),
        turnOf(run, 0, 0).log,
      ),
      ok(
        'answer says the page could not be reached',
        /could not be fetched|could not be reached|timed out|unavailable/i.test(answer),
        answer,
      ),
      ok('answer gives the last verified value', /\b44\b/.test(answer), answer),
      ok('answer gives that value\'s date', namesDate(answer, 10, 'Nov'), answer),
      ok('answer does not say no change about Cinderwell', !claimsNoChangeAbout(answer, /Cinderwell/), answer),
      numbersAllowed(run, events, []),
    ];
  },
};

// Spec case 15: a third-party page that still shows the old price must not produce unchanged.
const case116: EvalCase = {
  id: 116,
  parts: [
    part(
      ['On 4 November I asked what Hearthmail\'s Grove plan costs. Has that price changed?'],
      hearthmailScenario,
      (store) => {
        seedExchange(
          store,
          ist('2026-11-04', '2026-11-04T04:30:00.000Z'),
          'What does Hearthmail\'s Grove plan cost?',
          'Hearthmail Grove is 15 USD per month.',
          'Hearthmail',
          ['Hearthmail'],
          [
            {
              entity: 'Hearthmail',
              attribute: 'price',
              value: '15 USD/month',
              scope: monthScope('Grove', 'USD'),
              quote: 'Hearthmail Grove is 15 USD per month.',
              url: REVIEWDESK_NOTE,
              text: HEARTHMAIL_BLOG,
              firstParty: false,
            },
          ],
        );
      },
    ),
  ],
  check(run) {
    const events = eventsAt(run);
    const row = verdictFor(events, 'Hearthmail', 'price');
    return [
      intentIs(events, 'recheck'),
      chosenIs(events, '2026-11-04'),
      verdictIs(events, 'Hearthmail', 'price', 'changed'),
      ok('newValue contains 21', (row?.check.newValue ?? '').includes('21'), row?.check.newValue ?? null),
      ok('newQuote is on the vendor page', quoteInPage(row?.check.newQuote ?? null, HEARTHMAIL_V2), row?.check.newQuote ?? null),
      ok('the source is the vendor page', row?.nowSource?.url === HEARTHMAIL_PRICING, row?.nowSource?.url ?? null),
      ok('the source is live', row?.nowSource?.live === true, row?.nowSource?.live ?? null),
      ok('decidedBy is not fast_path', row !== undefined && row.check.decidedBy !== 'fast_path', row?.check.decidedBy ?? null),
      numbersAllowed(run, events, [HEARTHMAIL_V2, HEARTHMAIL_BLOG]),
    ];
  },
};

// Spec case 1's news rule: a post on or after the asked day is reported with its date; an older post is not "since" that day.
const case117: EvalCase = {
  id: 117,
  parts: [
    part(
      ['On Monday I asked about Loomery and Palletory. Has either shipped something new since that day?'],
      newsScenario,
      (store) => {
        seedExchange(
          store,
          ist('2026-11-09', '2026-11-09T04:30:00.000Z'),
          'What does Loomery\'s Studio plan cost?',
          LOOMERY_QUOTE,
          'Loomery',
          ['Loomery'],
          [
            {
              entity: 'Loomery',
              attribute: 'price',
              value: '26 USD/month',
              scope: monthScope('Studio', 'USD'),
              quote: LOOMERY_QUOTE,
              url: LOOMERY_PRICING,
              text: LOOMERY_PAGE,
            },
          ],
        );
        seedExchange(
          store,
          ist('2026-11-09', '2026-11-09T05:30:00.000Z'),
          'What does Palletory\'s Studio plan cost?',
          PALLETORY_QUOTE,
          'Palletory',
          ['Palletory'],
          [
            {
              entity: 'Palletory',
              attribute: 'price',
              value: '38 USD/month',
              scope: monthScope('Studio', 'USD'),
              quote: PALLETORY_QUOTE,
              url: PALLETORY_PRICING,
              text: PALLETORY_PAGE,
            },
          ],
        );
      },
    ),
  ],
  check(run) {
    const events = eventsAt(run);
    const answer = shown(run);
    const news = turnOf(run, 0, 0).log.filter(
      (call) => call.kind === 'search' && call.query.toLowerCase().includes('news'),
    );
    const entities = verdictsOf(events).map((row) => row.claim.entity);
    const oldAsSince = sentencesOf(answer).filter((sentence) => /barcode labels/i.test(sentence) && /\bsince\b/i.test(sentence));
    return [
      intentIs(events, 'recheck'),
      chosenIs(events, '2026-11-09'),
      verdictIs(events, 'Loomery', 'price', 'unchanged'),
      verdictIs(events, 'Palletory', 'price', 'unchanged'),
      ok(
        'only the two stored products have rows',
        entities.length === 2 && entities.includes('Loomery') && entities.includes('Palletory'),
        entities,
      ),
      ok(
        'a news search is bounded to the asked day',
        news.some((call) => call.kind === 'search' && call.publishedOnOrAfter === '2026-11-09'),
        news,
      ),
      ok('the 12 Nov post is reported with its date', /shared drafts/i.test(answer) && namesDate(answer, 12, 'Nov'), answer),
      ok('the older post is not reported as since that day', oldAsSince.length === 0, oldAsSince),
      numbersAllowed(run, events, [LOOMERY_PAGE, PALLETORY_PAGE, LOOMERY_NEWS]),
    ];
  },
};

// Brief: "is that still right?" when this session has no earlier answer and the store has no claim.
const case118: EvalCase = {
  id: 118,
  parts: [part(['Is that still right?'], emptyScenario)],
  judges: ['J1'],
  check(run) {
    const events = eventsAt(run);
    const answer = shown(run);
    return [
      noVerdicts(events),
      ok('recall does not claim a stored hit', (recallOf(events)?.hits.length ?? 0) === 0, recallOf(events)?.hits.length ?? null),
      ok('answer does not say a price is unchanged', !claimsNoChangeAbout(answer, /price|plan|that/i), answer),
      ...judgeSaysNo(run, 'J1'),
      numbersAllowed(run, events, []),
    ];
  },
};

// Spec case 13: an annual price on the page is not a `changed` monthly value.
const case119: EvalCase = {
  id: 119,
  parts: [
    part(
      ['Last Thursday I asked what Vellumstack\'s Pro plan costs. Has the price changed?'],
      vellumstackScenario,
      (store) => {
        seedExchange(
          store,
          ist('2026-11-12', '2026-11-12T07:30:00.000Z'),
          'What does Vellumstack\'s Pro plan cost?',
          VELLUMSTACK_V1_QUOTE,
          'Vellumstack',
          ['Vellumstack'],
          [
            {
              entity: 'Vellumstack',
              attribute: 'price',
              value: '48 USD/month',
              scope: monthScope('Pro', 'USD'),
              quote: VELLUMSTACK_V1_QUOTE,
              url: VELLUMSTACK_PRICING,
              text: VELLUMSTACK_V1,
            },
          ],
        );
      },
    ),
  ],
  check(run) {
    const events = eventsAt(run);
    const row = verdictFor(events, 'Vellumstack', 'price');
    const changedToAnnual = row?.check.verdict === 'changed' && /\b480\b/.test(row.check.newValue ?? '');
    const periodReason = /period|month|annual|year/i.test(row?.check.reason ?? '');
    return [
      intentIs(events, 'recheck'),
      chosenIs(events, '2026-11-12'),
      ok(
        'Vellumstack Pro is unverifiable rather than changed to the annual figure',
        row?.check.verdict === 'unverifiable' && periodReason && !changedToAnnual,
        row?.check ?? null,
      ),
      numbersAllowed(run, events, [VELLUMSTACK_V2]),
    ];
  },
};

export const HELDOUT_CASE_LIST: readonly EvalCase[] = [
  case101,
  case102,
  case103,
  case104,
  case105,
  case106,
  case107,
  case108,
  case109,
  case110,
  case111,
  case112,
  case113,
  case114,
  case115,
  case116,
  case117,
  case118,
  case119,
];
