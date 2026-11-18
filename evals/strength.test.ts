import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../src/core/config';
import type { AgentEvent } from '../src/core/contracts';
import { createStore } from '../src/core/store/index';
import { FakeClock } from '../src/core/testing/fakes';
import { asksToConfirm, checkNotDatedToQuestion, judgeSaysNo, turnsFinished } from './assert';
import { parseJudgeReply } from './judge';
import type { CaseRun } from './types';

function run(traces: { message: string; events: AgentEvent[]; answerText: string }[], judge: CaseRun['judge'] = null): CaseRun {
  const dir = mkdtempSync(join(tmpdir(), 'minimi-eval-strength-'));
  return {
    parts: [{ traces: traces.map((trace) => ({ ...trace, log: [] })), log: [], tz: 'Asia/Kolkata' }],
    store: createStore(join(dir, 'store.db'), new FakeClock('2026-11-13T13:00:00.000Z'), defaultConfig),
    judge,
  };
}

const DONE: AgentEvent = { type: 'done', turnId: 't', intent: 'chat' } as AgentEvent;

describe('asksToConfirm (case 6)', () => {
  it('accepts the three confirming questions the writer actually produced (evals/results latest, sha 596b1eb)', () => {
    expect(asksToConfirm('Is the earlier conversation listed above, the nearest match, the one you were thinking of?')).toBe(true);
    expect(asksToConfirm("I couldn't tell which one you meant. Was it that earlier conversation?")).toBe(true);
    expect(asksToConfirm('Is that match the conversation you meant?')).toBe(true);
  });

  it('rejects an answer that only names the date, or asks an unrelated question', () => {
    expect(asksToConfirm('The nearest saved conversation is from 5 Nov 2026.')).toBe(false);
    expect(asksToConfirm('Want me to look up Postgres hosting pricing now?')).toBe(false);
  });
});

describe('turnsFinished', () => {
  it('fails an empty answer, a turn with an error, and a turn without done', () => {
    expect(turnsFinished(run([{ message: 'm', events: [DONE], answerText: '' }])).pass).toBe(false);
    expect(
      turnsFinished(run([{ message: 'm', events: [{ type: 'error', stage: 'route', message: 'timeout' } as AgentEvent, DONE], answerText: 'x' }])).pass,
    ).toBe(false);
    expect(turnsFinished(run([{ message: 'm', events: [], answerText: 'x' }])).pass).toBe(false);
  });

  it('passes a completed, non-empty turn', () => {
    expect(turnsFinished(run([{ message: 'm', events: [DONE], answerText: 'An answer.' }])).pass).toBe(true);
  });
});

describe('parseJudgeReply', () => {
  it('reads the first word as the verdict, through markdown and punctuation', () => {
    expect(parseJudgeReply('**No**. It does not.').answer).toBe('no');
    expect(parseJudgeReply('Yes. "That never happened."')).toEqual({ answer: 'yes', quote: 'That never happened.' });
  });

  it('does not read "Not", "Nope" or "Yesterday" as a verdict', () => {
    expect(parseJudgeReply('Not really.').answer).toBe('unparsed');
    expect(parseJudgeReply('Nope.').answer).toBe('unparsed');
    expect(parseJudgeReply('Yesterday it said...').answer).toBe('unparsed');
  });
});

describe('judgeSaysNo', () => {
  it('a yes must quote a sentence that is in the shown answer', () => {
    const answer = 'I have nothing saved from 9 Nov 2026, so I can\'t look that conversation up.';
    const fabricated = run([{ message: 'm', events: [DONE], answerText: answer }], [
      { id: 'J3', question: 'q', answer: 'yes', quote: 'That conversation never happened.', raw: '' },
    ]);
    const [verdict, quoted] = judgeSaysNo(fabricated, 'J3');
    expect(verdict?.pass).toBe(false);
    expect(quoted?.pass).toBe(false);
    const real = run([{ message: 'm', events: [DONE], answerText: answer }], [
      { id: 'J3', question: 'q', answer: 'yes', quote: "I have nothing saved from 9 Nov 2026, so I can't look that conversation up.", raw: '' },
    ]);
    expect(judgeSaysNo(real, 'J3')[1]?.pass).toBe(true);
    // A fragment is not an offending sentence.
    const fragment = run([{ message: 'm', events: [DONE], answerText: answer }], [
      { id: 'J3', question: 'q', answer: 'yes', quote: 'that conversation up', raw: '' },
    ]);
    expect(judgeSaysNo(fragment, 'J3')[1]?.pass).toBe(false);
  });
});

describe('checkNotDatedToQuestion', () => {
  const recall = { type: 'recall', candidates: { dates: ['2026-11-10'], range: null, ambiguous: false, rule: 'x' }, hits: [], chosen: '2026-11-10' } as unknown as AgentEvent;
  // The check ran on 13 Nov (18:30 in Kolkata); the earlier question was on 10 Nov.
  const verdict = { type: 'verdict', row: { check: { checkedAtUtc: '2026-11-13T13:00:00.000Z' } } } as unknown as AgentEvent;
  it('fails "As of Tue 10 Nov 2026" written by the writer about a later check (case 11, sha 07453de)', () => {
    const r = run([{ message: 'The 10th.', events: [recall, verdict, DONE], answerText: '' }]);
    r.parts[0]!.traces[0]!.modelText = 'As of Tue 10 Nov 2026, Basalt DB is unchanged.';
    expect(checkNotDatedToQuestion(r).pass).toBe(false);
  });
  it('passes when the writer names no date, or names the question date without tying the check to it', () => {
    const r = run([{ message: 'The 10th.', events: [recall, verdict, DONE], answerText: '' }]);
    r.parts[0]!.traces[0]!.modelText = 'Basalt DB is unchanged. On 10 Nov you asked about Postgres hosting.';
    expect(checkNotDatedToQuestion(r).pass).toBe(true);
  });
  it('fails any other date given to the verification, in any format, and passes the check\'s own date', () => {
    const r = run([{ message: 'm', events: [recall, verdict, DONE], answerText: '' }]);
    r.parts[0]!.traces[0]!.modelText = 'I verified it on November 10, 2026.';
    expect(checkNotDatedToQuestion(r).pass).toBe(false);
    r.parts[0]!.traces[0]!.modelText = 'As of 13 Nov 2026 it still holds.';
    expect(checkNotDatedToQuestion(r).pass).toBe(true);
  });
});

describe('offersIn and asksToConfirm: not a refusal, not a negation, not a remark', () => {
  it('rejects the counterexamples from the r5 review', async () => {
    const { offersIn } = await import('./assert');
    expect(offersIn('A fresh Postgres hosting pricing check would be useful.', /postgres/i)).toBe(false);
    expect(offersIn("Don't send me the tool names.", /names?/i)).toBe(false);
    expect(asksToConfirm("I can't tell which one you meant. Want a fresh lookup?")).toBe(false);
  });
  it('accepts real offers and requests', async () => {
    const { offersIn } = await import('./assert');
    expect(offersIn('I can look up current Postgres hosting pricing for you.', /postgres/i)).toBe(true);
    expect(offersIn('If you send me the names of the tools, I will check each one.', /names?/i)).toBe(true);
  });
});

describe('offersIn: a polite request with "paste" (main case 5, run 2 on 94f69ea)', () => {
  it('accepts "Could you paste the names or list them in your own words?" and rejects a negated one', async () => {
    const { offersIn } = await import('./assert');
    const ask = /\b(tell|send|share|give|list|paste)\b[^.?!]*\b(names?|tools?)\b/i;
    expect(offersIn('Could you paste the names or list them in your own words?', ask)).toBe(true);
    expect(offersIn("Don't paste the names here.", ask)).toBe(false);
  });
});
