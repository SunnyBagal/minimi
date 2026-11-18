/**
 * Held-out cases 101–119. Written from docs/02-evals.md and the product brief.
 * Each comment names the spec rule the case tests.
 */
import type { AgentEvent, Claim, MemoryStore } from '../../src/core/contracts';
import {
  allClaims,
  asksToConfirm,
  candidateDates,
  chosenIs,
  claimsNoChangeAbout,
  datesNamedIn,
  intentIs,
  judgeSaysNo,
  noVerdicts,
  numbersAllowed,
  numbersIn,
  ofType,
  ok,
  quoteInPage,
  recallOf,
  sentencesOf,
  turnOf,
  verdictFor,
  verdictIs,
  verdictsOf,
  writerTextOf,
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
  IVYLEDGER_PAGE,
  IVYLEDGER_PRICING,
  IVYLEDGER_QUOTE,
  LOOMERY_CHANGELOG,
  LOOMERY_PAGE,
  LOOMERY_PRICING,
  LOOMERY_QUOTE,
  LUMENBOARD_PRICING,
  MOTHLIGHT_PAGE,
  MOTHLIGHT_PRICING,
  NIMBUSMAIL_PLUS_14,
  NIMBUSMAIL_PLUS_18,
  NIMBUSMAIL_PRICING,
  NIMBUSMAIL_V1_OLDER,
  NIMBUSMAIL_V2,
  OCEAN_LARGEST,
  ORCHARDPAY_PRICING,
  PALLETORY_CHANGELOG,
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
} from './pages';
import {
  brasslineScenario,
  cinderwellScenario,
  emptyScenario,
  fernledgerScenario,
  hearthmailScenario,
  ivyledgerScenario,
  lumenboardScenario,
  newsScenario,
  nimbusmailScenario,
  oceanScenario,
  orchardpayScenario,
  rowanhostScenario,
  vellumstackScenario,
} from './scenarios';
import { servedEvidence } from './served';

const MONTHLY = /\b(?:per month|a month|each month|monthly|\/month)\b/i;
const USD = /(?:\bUSD\b|US\$|\$|\bdollars?\b)/i;
const EURO = /(?:€|\bEUR\b|\beuros?\b)/i;
const NOT_USD = /(?:\bUSD\b|US\$|\$|\bdollars?\b)/i;
const OFFER = /\b(?:I can|I could|I'll|I will|I'd be happy|happy to|let me|want me to|shall I|should I|would you like|do you want)\b/i;
const REFUSAL = /\b(?:can't|cannot|can not|unable|won't|will not|not able|don't|do not|never)\b/i;

const PEBBLE_QUESTION = 'What does Pebblecart\'s Harbor plan cost?';
const NIMBUS_QUESTION = 'What does the Nimbusmail Plus plan cost?';
const ROWAN_QUESTION = 'What does the Rowanhost Cabin plan cost?';
const FERN_QUESTION = 'What does Fernledger pricing look like for the Growth plan?';
const EAST_STUDIO = 'Please let the client know the workshop has been moved to the east studio.';
const CINDERWELL_VERIFIED_AT = '2026-11-06T04:30:00.000Z';

function namesDate(text: string, day: number, month: string): boolean {
  const m = month.slice(0, 3);
  return new RegExp(`\\b${day}\\s+${m}`, 'i').test(text) || new RegExp(`\\b${m}[a-z]*\\s+${day}\\b`, 'i').test(text);
}

function part(
  messages: readonly string[],
  scenario: FixtureScenario,
  prepare?: (store: MemoryStore) => void,
  clock?: string,
): CasePart {
  return { seeds: [], prepare, clock: clock ?? CLOCK, tz: TZ, scenario, messages };
}

function shown(run: CaseRun, index = 0): string {
  return turnOf(run, 0, index).answerText;
}

function eventsAt(run: CaseRun, index = 0): AgentEvent[] {
  return turnOf(run, 0, index).events;
}

function sourcesFor(scenario: FixtureScenario, run: CaseRun, index = 0): string[] {
  return servedEvidence(scenario, turnOf(run, 0, index).log, run.parts[0]?.tz ?? TZ);
}

function citationUrl(events: AgentEvent[], n: number): string | undefined {
  for (const event of ofType(events, 'citations')) {
    const item = event.items.find((entry) => entry.n === n);
    if (item !== undefined) return item.url;
  }
  return undefined;
}

function citesUrl(text: string, events: AgentEvent[], url: string): boolean {
  for (const match of text.matchAll(/\[(\d+)\]/g)) {
    if (citationUrl(events, Number(match[1])) === url) return true;
  }
  return false;
}

function containersOf(answer: string): string[] {
  const lines = answer.split('\n');
  const rows = lines.filter((line) => line.includes('|'));
  const prose = lines.filter((line) => !line.includes('|')).join('\n');
  return [...rows, ...sentencesOf(prose)];
}

function clausesIn(container: string): string[] {
  if (container.includes('|')) return [container];
  const parts = container
    .split(/[,;]|\s(?:but|while|whereas|although|and)\s/i)
    .map((clause) => clause.trim())
    .filter((clause) => clause !== '');
  return parts.length > 0 ? parts : [container];
}

/** Plan, amount, currency and period in one clause or table row; a marker on that sentence may cover every price in it. */
function priceBound(
  answer: string,
  events: AgentEvent[],
  url: string,
  plan: RegExp,
  amount: string,
  currency: RegExp,
  otherAmounts: readonly string[],
  rejectCurrency?: RegExp,
): boolean {
  const amountPattern = new RegExp(`\\b${amount}\\b`);
  return containersOf(answer).some((container) => {
    if (!citesUrl(container, events, url)) return false;
    return clausesIn(container).some((clause) => {
      if (!plan.test(clause) || !amountPattern.test(clause) || !currency.test(clause) || !MONTHLY.test(clause)) return false;
      if (otherAmounts.some((other) => new RegExp(`\\b${other}\\b`).test(clause))) return false;
      if (rejectCurrency !== undefined && rejectCurrency.test(clause)) return false;
      return true;
    });
  });
}

function flagsEmpty(events: AgentEvent[]): Assertion[] {
  const flags = ofType(events, 'flags');
  return [
    ok('a flags event is present', flags.length > 0, flags.length),
    ok(
      'uncitedNumbers is empty',
      flags.length > 0 && flags.every((event) => event.uncitedNumbers.length === 0),
      flags.map((event) => event.uncitedNumbers),
    ),
  ];
}

/** Full month name, in the same sentence as the numeric date the user typed. */
function readsNumericDate(text: string, raw: string, day: number, month: string, year = 2026): boolean {
  const forward = new RegExp(`\\b${day}\\s+${month}\\s+${year}\\b`, 'i');
  const reverse = new RegExp(`\\b${month}\\s+${day},?\\s+${year}\\b`, 'i');
  return sentencesOf(text).some((sentence) => sentence.includes(raw) && (forward.test(sentence) || reverse.test(sentence)));
}

function confirmationAt(answer: string): number {
  const match = answer.match(/\b(?:which one do you mean|which (?:day|date|thursday|monday|conversation|one)|did you mean|do you mean)\b[^?\n]*\?/i);
  return match?.index ?? -1;
}

/** Each date shares a line with the stored question, and that block is before the confirmation. */
function showsDatedOptions(answer: string, question: string, days: readonly number[]): boolean {
  const at = confirmationAt(answer);
  if (at < 0) return false;
  const before = answer.slice(0, at);
  return days.every((day) =>
    before.split('\n').some((line) => namesDate(line, day, 'Nov') && /\b2026\b/.test(line) && line.includes(question)),
  );
}

function renewsDateQuestion(text: string): boolean {
  return sentencesOf(text).some((sentence) => {
    if (!sentence.endsWith('?')) return false;
    if (/which one do you mean/i.test(sentence)) return true;
    return /\b(?:which|what)\b/i.test(sentence) && /\b(?:day|date|thursday|one)\b/i.test(sentence);
  });
}

/**
 * Sentences with any citation markers that follow their full stop attached, the rule the app's own
 * validator uses (src/core/search/validate.ts, TRAILING_CITATIONS): "… since your question. [3]" cites that sentence.
 * Added after the second held-out run (case 117), per its review.
 */
export function citedSentencesOf(text: string): string[] {
  // Move a citation run that directly follows a terminator on the same line (horizontal space only)
  // inside the sentence it closes; a marker after a line break stays detached, as in the validator.
  return sentencesOf(text.replace(/([.!?])((?:[ \t]*\[\d+\])+)/g, '$2$1'));
}

function claimOn(run: CaseRun, entity: string, value: string, localDate: string): Claim | undefined {
  const hits = run.store.findTurns({ dates: [localDate], excludeTurnIds: [], limit: 50 });
  const turnIds = new Set(hits.flatMap((hit) => (hit.assistantTurn === null ? [] : [hit.assistantTurn.id])));
  return allClaims(run.store).find((claim) => claim.entity === entity && claim.value === value && turnIds.has(claim.turnId));
}

// After the first held-out run (Codex review): "look up … pricing fresh" is forward-looking too.
export function offersRelayLookup(text: string): boolean {
  return sentencesOf(text).some((sentence) => {
    if (REFUSAL.test(sentence) || !OFFER.test(sentence)) return false;
    if (!/\b(?:look(?:\s+\w+){0,3}\s+up|check)\b/i.test(sentence)) return false;
    return /\bRelay\b/.test(sentence) && /\b(?:pric\w*|cost)\b/i.test(sentence) && /\b(?:current|now|today|latest|fresh)\b/i.test(sentence);
  });
}

function attributesHistoricalPrice(text: string): boolean {
  return sentencesOf(text).some(
    (sentence) =>
      /\b(?:Relay|Copperlane)\b/.test(sentence) &&
      /\b(?:was|were|used to|previously|historically|back then|at the time)\b/i.test(sentence) &&
      /\b(?:pric|cost|\$|USD|euros?)\b/i.test(sentence),
  );
}

// After the third held-out run: a hedged sentence ("I can't say whether it still holds") is not a claim
// that it holds, the same uncertainty rule claimsNoChangeAbout uses.
const HOLDS = /\b(?:still costs|still priced|price still|still holds|continues to cost|remains \d)\b/i;
const HEDGE = /\b(?:can't|cannot|can not|couldn't|could not|unable|not sure|don't know|do not know|whether|unclear|unconfirmed)\b/i;

export function stillHolds(answer: string): boolean {
  if (claimsNoChangeAbout(answer, /Cinderwell/)) return true;
  return sentencesOf(answer).some((sentence) => {
    if (!/(?:Cinderwell|Foundry|\b44\b)/.test(sentence)) return false;
    // The hedge must sit in the clause that makes the claim, as in claimsNoChangeAbout.
    return sentence
      .split(/[,;:]|\s(?:but|and|while|whereas|although)\s/i)
      .some((clause) => HOLDS.test(clause) && !HEDGE.test(clause));
  });
}

function saysItCannotIdentify(text: string): boolean {
  return sentencesOf(text).some(
    (sentence) =>
      /\b(?:can't|cannot|can not|don't know|do not know|unable|not able|couldn't|could not|not sure)\b/i.test(sentence) &&
      /\b(?:which|what|identify|tell)\b/i.test(sentence) &&
      /\b(?:answer|claim|conversation|message|one|that)\b/i.test(sentence),
  );
}

function asksWhichToCheck(text: string): boolean {
  return sentencesOf(text).some(
    (sentence) => sentence.includes('?') && /\b(?:which|what)\b/i.test(sentence) && /\b(?:answer|claim|conversation|one|message)\b/i.test(sentence),
  );
}

function claimsACompletedCheck(text: string): boolean {
  if (claimsNoChangeAbout(text, /price|plan|that/i)) return true;
  return sentencesOf(text).some((sentence) => {
    if (/\b(?:can't|cannot|can not|couldn't|could not|whether|not sure|don't know|do not know|unable)\b/i.test(sentence)) return false;
    return /\b(?:I checked|I verified|I confirmed|I looked (?:it|that|this) up|still (?:right|correct|true)|that is (?:right|correct)|no change|unchanged)\b/i.test(sentence);
  });
}

function namesALookupDate(text: string): boolean {
  if (/\b\d{4}-\d{2}-\d{2}\b/.test(text) || /\b\d{1,2}\/\d{1,2}\b/.test(text) || /\b20\d{2}\b/.test(text)) return true;
  return sentencesOf(text).some((sentence) => datesNamedIn(sentence).length > 0);
}

/** Each complete rewrite the reply offers: its quoted passages, or its lines when nothing is quoted. */
function rewriteCandidates(text: string): string[] {
  const quoted = [...text.matchAll(/["“]([^"”]+)["”]/g)].map((match) => (match[1] ?? '').trim());
  const pool = quoted.length > 0 ? quoted : text.split('\n');
  return pool.map((candidate) => candidate.trim()).filter((candidate) => candidate !== '');
}

// After the first held-out run (Codex review): measure each rewrite on its own, not the whole reply,
// and accept "is now in/at the east studio" as keeping the move; "moved from the east studio" still fails.
export function shorterMove(text: string): boolean {
  return rewriteCandidates(text).some(
    (candidate) =>
      candidate.length < EAST_STUDIO.length &&
      /east studio/i.test(candidate) &&
      !/\bfrom\s+the\s+east studio\b/i.test(candidate) &&
      (/\b(?:moved|move|moving|relocated|relocate)\b[^.]*\b(?:to|into)\b[^.]*east studio/i.test(candidate) ||
        /\b(?:is|are)\s+now\s+(?:in|at)\s+the\s+east studio/i.test(candidate)),
  );
}

function explainsCompass(text: string): boolean {
  return /needle/i.test(text) && /earth/i.test(text) && /magnetic field/i.test(text) && /\b(?:align\w*|points?|lines up|follows)\b/i.test(text);
}

function newsSearch(run: CaseRun, entity: string): boolean {
  return turnOf(run, 0, 0).log.some(
    (call) => call.kind === 'search' && call.query.toLowerCase().includes(`${entity.toLowerCase()} news`) && call.publishedOnOrAfter === '2026-11-09',
  );
}

// Spec: a fresh answer cites each plan price from the page, and every number was on a page this turn served.
const case101: EvalCase = {
  id: 101,
  parts: [part(['What do Lumenboard\'s Studio and Field plans cost per month?'], lumenboardScenario)],
  check(run) {
    const events = eventsAt(run);
    const answer = shown(run);
    return [
      intentIs(events, 'fresh'),
      ok('searched', turnOf(run, 0, 0).log.some((call) => call.kind === 'search'), turnOf(run, 0, 0).log),
      ok(
        'Studio is 36 USD/month with a marker to the pricing page',
        priceBound(answer, events, LUMENBOARD_PRICING, /\bStudio\b/, '36', USD, ['64']),
        answer,
      ),
      ok(
        'Field is 64 USD/month with a marker to the pricing page',
        priceBound(answer, events, LUMENBOARD_PRICING, /\bField\b/, '64', USD, ['36']),
        answer,
      ),
      ...flagsEmpty(events),
      numbersAllowed(run, events, sourcesFor(lumenboardScenario, run)),
    ];
  },
};

// Brief: a fresh euro price, with the amount, currency and month bound together and cited.
const case102: EvalCase = {
  id: 102,
  parts: [part(['What does Orchardpay\'s Grove plan cost per month?'], orchardpayScenario)],
  check(run) {
    const events = eventsAt(run);
    const answer = shown(run);
    return [
      intentIs(events, 'fresh'),
      ok(
        'Grove is 29 euros per month with a marker to the pricing page',
        priceBound(answer, events, ORCHARDPAY_PRICING, /\bGrove\b/, '29', EURO, [], NOT_USD),
        answer,
      ),
      ...flagsEmpty(events),
      numbersAllowed(run, events, sourcesFor(orchardpayScenario, run)),
    ];
  },
};

// Brief: an explicit "search for this" on a stable topic still searches and cites the page.
const case103: EvalCase = {
  id: 103,
  parts: [part(['Search the web for which ocean is the largest.'], oceanScenario)],
  check(run) {
    const events = eventsAt(run);
    const answer = shown(run);
    const stated = sentencesOf(answer).some(
      (sentence) => /Pacific/i.test(sentence) && /largest/i.test(sentence) && /ocean/i.test(sentence) && citesUrl(sentence, events, OCEAN_LARGEST),
    );
    return [
      intentIs(events, 'fresh'),
      ok('at least one search', turnOf(run, 0, 0).log.some((call) => call.kind === 'search'), turnOf(run, 0, 0).log),
      ok('answer states the Pacific is the largest ocean and cites the page', stated, answer),
      numbersAllowed(run, events, sourcesFor(oceanScenario, run)),
    ];
  },
};

// Spec case 17: plain chat does not search, recall, or cite, even when a price is stored.
const case104: EvalCase = {
  id: 104,
  parts: [
    part(
      [`Make this shorter: '${EAST_STUDIO}'`, 'How does a compass find north?'],
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
    const rewrite = traces[0]?.answerText ?? '';
    const compass = traces[1]?.answerText ?? '';
    const answer = traces.map((trace) => trace.answerText).join('\n');
    return [
      ok('two traces', traces.length === 2, traces.length),
      ...traces.flatMap((trace) => [
        intentIs(trace.events, 'chat'),
        ok('provider log is empty', trace.log.length === 0, trace.log),
        ok('no recall event', recallOf(trace.events) === undefined, recallOf(trace.events)?.chosen ?? null),
        noVerdicts(trace.events),
        ok('no citations', ofType(trace.events, 'citations').length === 0, ofType(trace.events, 'citations').length),
        numbersAllowed(run, trace.events, servedEvidence(emptyScenario, trace.log, TZ)),
      ]),
      ok('the rewrite is shorter and keeps the east-studio move', shorterMove(rewrite), rewrite),
      ok('the compass answer says the needle aligns with Earth\'s magnetic field', explainsCompass(compass), compass),
      ok('the stored Harborlane claim is not mentioned', !/harborlane/i.test(answer), answer),
    ];
  },
};

// Spec case 3's date rule: "last Thursday" has two candidate dates; the one about this product is chosen.
const case105: EvalCase = {
  id: 105,
  parts: [
    part(['What did I ask you last Thursday about Pebblecart?'], emptyScenario, (store) => {
      seedExchange(
        store,
        ist('2026-11-05', '2026-11-05T04:00:00.000Z'),
        'Where is the spare kiln key kept?',
        'The spare kiln key hangs on the hook.',
        'kiln key',
        ['kiln'],
        [],
      );
      seedExchange(
        store,
        ist('2026-11-12', '2026-11-12T04:30:00.000Z'),
        PEBBLE_QUESTION,
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
      ok('recall.asked.question is the 12 Nov Pebblecart question', recallOf(events)?.asked?.question === PEBBLE_QUESTION, recallOf(events)?.asked?.question ?? null),
      ok('the shown answer restates that question', answer.includes(PEBBLE_QUESTION), answer),
      noVerdicts(events),
      numbersAllowed(run, events, sourcesFor(emptyScenario, run)),
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
      ok('answer mentions Mothlight', /Mothlight/.test(answer), answer),
      noVerdicts(events),
      numbersAllowed(run, events, sourcesFor(emptyScenario, run)),
    ];
  },
};

// Spec case 8: a numeric date with no year has both readings; the chosen one is said in words.
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
      ok('answer reads 8/11 as 8 November 2026', readsNumericDate(answer, '8/11', 8, 'November'), answer),
      ok('answer restates Quillharbor', /Quillharbor/.test(answer), answer),
      noVerdicts(events),
      numbersAllowed(run, events, sourcesFor(emptyScenario, run)),
    ];
  },
};

// Spec case 11: after an ambiguous date, "the 12th" chooses that day and does not ask again.
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
    const claim = claimOn(run, 'Nimbusmail', '18 USD/month', '2026-11-12');
    const only = rows.length === 1 ? rows[0] : undefined;
    return [
      candidateDates(first, ['2026-11-12', '2026-11-05']),
      chosenIs(first, null),
      ok('candidates are ambiguous', recallOf(first)?.candidates.ambiguous === true, recallOf(first)?.candidates.ambiguous ?? null),
      ok(
        'turn 1 shows each Thursday with its question, then asks which',
        showsDatedOptions(shown(run, 0), NIMBUS_QUESTION, [12, 5]),
        shown(run, 0),
      ),
      noVerdicts(first),
      chosenIs(second, '2026-11-12'),
      ok('turn 2 does not ask the date again', !renewsDateQuestion(follow), follow),
      ok(
        'turn 2 is exactly the 12 Nov Nimbusmail Plus claim at 18 USD/month',
        claim !== undefined &&
          only !== undefined &&
          only.claim.id === claim.id &&
          only.claim.value === '18 USD/month' &&
          only.claim.scope.plan === 'Plus' &&
          only.claim.scope.period === 'month' &&
          only.claim.scope.currency === 'USD',
        rows.map((row) => ({ id: row.claim.id, value: row.claim.value })),
      ),
      verdictIs(second, 'Nimbusmail', 'price', 'unchanged'),
      numbersAllowed(run, first, sourcesFor(nimbusmailScenario, run, 0)),
      numbersAllowed(run, second, sourcesFor(nimbusmailScenario, run, 1)),
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
      numbersAllowed(run, events, sourcesFor(emptyScenario, run)),
    ];
  },
};

// Spec case 7: both candidate dates match the topic, so the answer asks and does not pick one.
const case110: EvalCase = {
  id: 110,
  parts: [
    part(
      ['Last Monday I asked about the Rowanhost Cabin plan. Has the price changed since then?'],
      rowanhostScenario,
      (store) => {
        for (const when of [ist('2026-11-09', '2026-11-09T10:30:00.000Z'), ist('2026-11-02', '2026-11-02T10:30:00.000Z')]) {
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
      ok(
        'shows each Monday with its question, then asks which',
        showsDatedOptions(shown(run), ROWAN_QUESTION, [9, 2]),
        shown(run),
      ),
      noVerdicts(events),
      numbersAllowed(run, events, sourcesFor(rowanhostScenario, run)),
    ];
  },
};

// Spec case 4: nothing stored on the dates named, and nothing near them. Judge J1.
const case111: EvalCase = {
  id: 111,
  parts: [part(['Last Thursday I asked what Copperlane\'s Relay plan costs. Has that price changed?'], emptyScenario)],
  judges: ['J1'],
  check(run) {
    const events = eventsAt(run);
    const answer = shown(run);
    const writer = writerTextOf(run, events);
    const recall = recallOf(events);
    return [
      ok('recall.hits is empty', (recall?.hits.length ?? -1) === 0, recall?.hits.length ?? null),
      ok('nothing near', (recall?.nearest?.length ?? 0) === 0, recall?.nearest?.length ?? null),
      ok('answer names 12 Nov', namesDate(answer, 12, 'Nov'), answer),
      ok('answer names 5 Nov', namesDate(answer, 5, 'Nov'), answer),
      noVerdicts(events),
      ok('writer offers to look up or check current Relay pricing', offersRelayLookup(writer), writer),
      ok('writer does not attribute a historical Relay price', !attributesHistoricalPrice(writer), writer),
      ...judgeSaysNo(run, 'J1'),
      numbersAllowed(run, events, sourcesFor(emptyScenario, run)),
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
          FERN_QUESTION,
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
      ok('exact hits are empty', (recallOf(events)?.hits.length ?? -1) === 0, recallOf(events)?.hits.length ?? null),
      ok('answer names 11 Nov', namesDate(answer, 11, 'Nov'), answer),
      ok('answer names 4 Nov', namesDate(answer, 4, 'Nov'), answer),
      ok(
        'nearest is the seeded Fernledger question on 7 Nov',
        nearest.some((hit) => hit.userTurn.localDate === '2026-11-07' && hit.matched === 'topic' && hit.userTurn.content === FERN_QUESTION),
        nearest.map((hit) => [hit.userTurn.localDate, hit.matched, hit.userTurn.content]),
      ),
      ok('answer names 7 Nov', namesDate(answer, 7, 'Nov'), answer),
      ok('writer asks to confirm that conversation', asksToConfirm(writerTextOf(run, events)), writerTextOf(run, events)),
      noVerdicts(events),
      numbersAllowed(run, events, sourcesFor(fernledgerScenario, run)),
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
      numbersAllowed(run, events, sourcesFor(ivyledgerScenario, run)),
    ];
  },
};

// Spec case 3's changed row: the new Meter price is exactly 31 USD/month on the live vendor page.
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
    const value = row?.check.newValue ?? '';
    const amounts = numbersIn(value);
    const quote = row?.check.newQuote ?? null;
    const source = row?.nowSource ?? null;
    return [
      intentIs(events, 'recheck'),
      chosenIs(events, '2026-11-05'),
      verdictIs(events, 'Brassline', 'price', 'changed'),
      ok(
        'newValue is exactly 31 USD per month for Meter',
        row !== undefined &&
          amounts.length === 1 &&
          Number(amounts[0]) === 31 &&
          USD.test(value) &&
          MONTHLY.test(value) &&
          row.claim.scope.plan === 'Meter' &&
          row.claim.scope.period === 'month' &&
          row.claim.scope.currency === 'USD',
        row?.check ?? null,
      ),
      ok(
        'the quote holds 31 and comes from the live Brassline page',
        quote !== null &&
          /\b31\b/.test(quote) &&
          !/\b310\b/.test(quote) &&
          /Meter/.test(quote) &&
          quoteInPage(quote, BRASSLINE_V2) &&
          source !== null &&
          source.url === BRASSLINE_PRICING &&
          source.live === true,
        { quote, url: source?.url ?? null, live: source?.live ?? null },
      ),
      numbersAllowed(run, events, sourcesFor(brasslineScenario, run)),
    ];
  },
};

// Spec case 16: the page timed out. The last verified day is not the day of the question.
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
          CINDERWELL_VERIFIED_AT,
        );
      },
    ),
  ],
  check(run) {
    const events = eventsAt(run);
    const answer = shown(run);
    const paired = sentencesOf(answer).some(
      (sentence) =>
        /Cinderwell/.test(sentence) &&
        /Foundry/.test(sentence) &&
        /\b44\b/.test(sentence) &&
        /\bUSD\b/.test(sentence) &&
        /month/.test(sentence) &&
        namesDate(sentence, 6, 'Nov') &&
        /\b2026\b/.test(sentence) &&
        /page/i.test(sentence) &&
        /could not be fetched|could not be reached|timed out|unavailable/i.test(sentence),
    );
    return [
      intentIs(events, 'recheck'),
      chosenIs(events, '2026-11-10'),
      verdictIs(events, 'Cinderwell', 'price', 'source_unavailable'),
      ok(
        'the pricing page was fetched',
        turnOf(run, 0, 0).log.some((call) => call.kind === 'fetchPage' && call.url === CINDERWELL_PRICING),
        turnOf(run, 0, 0).log,
      ),
      ok('Cinderwell Foundry pairs 44 USD/month with 6 Nov and the failed fetch', paired, answer),
      ok('answer does not say the price still holds', !stillHolds(answer), answer),
      numbersAllowed(run, events, sourcesFor(cinderwellScenario, run)),
    ];
  },
};

// Brief: the only page is a third-party note, so the verdict cannot affirm a replacement.
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
    const verdict = row?.check.verdict;
    const nonAffirmative = verdict === 'unverifiable' || verdict === 'source_unavailable';
    return [
      intentIs(events, 'recheck'),
      chosenIs(events, '2026-11-04'),
      ok('verdict is unverifiable or source_unavailable', nonAffirmative, verdict ?? null),
      ok('newValue is null', row?.check.newValue === null, row?.check.newValue ?? null),
      ok('there is no verified replacement', row?.nowSource === null, row?.nowSource?.url ?? null),
      ok('decidedBy is not fast_path', row !== undefined && row.check.decidedBy !== 'fast_path', row?.check.decidedBy ?? null),
      ok(
        'the vendor page was not fetched',
        !turnOf(run, 0, 0).log.some((call) => call.kind === 'fetchPage' && call.url === HEARTHMAIL_PRICING),
        turnOf(run, 0, 0).log,
      ),
      numbersAllowed(run, events, sourcesFor(hearthmailScenario, run)),
    ];
  },
};

// Spec case 1's news rule: both products are one Monday exchange, and only news on or after that day is reported.
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
          'What do the Loomery Studio and Palletory Studio plans cost?',
          `${LOOMERY_QUOTE} ${PALLETORY_QUOTE}`,
          'Loomery and Palletory',
          ['Loomery', 'Palletory'],
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
    const entities = verdictsOf(events).map((row) => row.claim.entity);
    const passage = citedSentencesOf(answer).some(
      (sentence) => /shared drafts/i.test(sentence) && namesDate(sentence, 12, 'Nov') && citesUrl(sentence, events, LOOMERY_CHANGELOG),
    );
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
      ok('Loomery news was searched from the asked day', newsSearch(run, 'Loomery'), turnOf(run, 0, 0).log),
      ok('Palletory news was searched from the asked day', newsSearch(run, 'Palletory'), turnOf(run, 0, 0).log),
      ok('shared drafts and 12 Nov cite the Loomery changelog', passage, answer),
      ok('the 2 Nov Palletory post is not in the answer', !/barcode labels/i.test(answer), answer),
      ok(
        'dated news does not cite the Palletory changelog',
        !ofType(events, 'citations').some((event) => event.items.some((item) => item.url === PALLETORY_CHANGELOG)),
        ofType(events, 'citations'),
      ),
      numbersAllowed(run, events, sourcesFor(newsScenario, run)),
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
    const writer = writerTextOf(run, events);
    const recall = recallOf(events);
    return [
      intentIs(events, 'recheck'),
      ok(
        'date lookup is empty',
        recall !== undefined && recall.candidates.dates.length === 0 && recall.candidates.range === null,
        recall?.candidates ?? null,
      ),
      ok('recall hits are empty', (recall?.hits.length ?? -1) === 0, recall?.hits.length ?? null),
      noVerdicts(events),
      ok('answer says what it cannot identify', saysItCannotIdentify(writer), writer),
      ok('answer asks which earlier answer or claim to check', asksWhichToCheck(writer), writer),
      ok('answer does not claim a completed check', !claimsACompletedCheck(writer), writer),
      ok('answer names no lookup date', !namesALookupDate(writer), writer),
      ...judgeSaysNo(run, 'J1'),
      numbersAllowed(run, events, sourcesFor(emptyScenario, run)),
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
    const reason = row?.check.reason ?? '';
    const originalId = row?.claim.id;
    const superseding = originalId === undefined ? [] : allClaims(run.store).filter((claim) => claim.supersedesId === originalId);
    return [
      intentIs(events, 'recheck'),
      chosenIs(events, '2026-11-12'),
      ok(
        'the reason distinguishes annual-only evidence from the monthly claim',
        row?.check.verdict === 'unverifiable' && /(?:annual|annually|\byear\b)/i.test(reason) && /month/i.test(reason),
        row?.check ?? null,
      ),
      ok('replacement value is null', row?.check.newValue === null, row?.check.newValue ?? null),
      ok('no new claim supersedes the monthly claim', superseding.length === 0, superseding.map((claim) => claim.value)),
      ok('the verdict is not changed to 480', row?.check.verdict !== 'changed' && !/\b480\b/.test(row?.check.newValue ?? ''), row?.check.newValue ?? null),
      numbersAllowed(run, events, sourcesFor(vellumstackScenario, run)),
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
