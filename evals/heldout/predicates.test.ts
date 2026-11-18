import { describe, expect, it } from 'vitest';
import { citedSentencesOf, offersRelayLookup, shorterMove } from './cases';

// Changed after the first held-out run, per the Codex review of its failures; the first run's score is kept in
// evals/results/heldout-first.json. Each fix is tested on the saved answers and on the counterexamples it must reject.
describe('held-out case 104: shorterMove', () => {
  it('accepts the three saved rewrites', () => {
    expect(shorterMove('"Please tell the client the workshop is now in the east studio."\n\nOr even shorter: "Tell the client the workshop moved to the east studio."')).toBe(true);
    expect(shorterMove('Tell the client the workshop is now in the east studio.')).toBe(true);
  });
  it('rejects a rewrite that reverses the move, drops it, or is not shorter', () => {
    expect(shorterMove('"Tell the client the workshop moved from the east studio."')).toBe(false);
    expect(shorterMove('"Tell the client about the workshop."')).toBe(false);
    expect(shorterMove('"Please let the client know that the workshop has now been moved over to the east studio."')).toBe(false);
  });
});

describe('held-out case 111: offersRelayLookup', () => {
  it('accepts an offer to look the pricing up fresh', () => {
    expect(offersRelayLookup('I can look up the Copperlane Relay plan pricing fresh.')).toBe(true);
  });
  it('rejects a historical lookup and a refusal', () => {
    expect(offersRelayLookup('I can look up Copperlane Relay plan pricing from last Thursday.')).toBe(false);
    expect(offersRelayLookup("I can't look up Copperlane Relay plan pricing fresh.")).toBe(false);
  });
});

describe('held-out case 117: citedSentencesOf', () => {
  it('attaches a marker that follows the full stop to its sentence, as the validator does', () => {
    expect(citedSentencesOf('Loomery shipped shared drafts on 12 Nov 2026, news since your question. [3]\n\nNothing else.')).toEqual([
      'Loomery shipped shared drafts on 12 Nov 2026, news since your question. [3]',
      'Nothing else.',
    ]);
  });
  it('does not attach a marker to a sentence it does not follow', () => {
    expect(citedSentencesOf('Shared drafts shipped. Prices are unchanged [3].')).toEqual(['Shared drafts shipped.', 'Prices are unchanged [3].']);
  });
});
