# Held-out cases

19 cases, ids 101–119, written from `docs/02-evals.md` and the product brief. They use new products, prices, dates, and wording. `npm run evals:heldout` runs all of them three times and writes `evals/results/heldout.json` plus a dated stamp. It does not write `latest.json`, `full.json`, or `quick.json`.

| Id | What it tests | Spec |
| --- | --- | --- |
| 101 | Fresh answer cites both plan prices on one product page | Number subset and citations (scripted checks) |
| 102 | Fresh answer cites a price billed in euros | Same, for a currency other than US dollars (brief) |
| 103 | "Search the web for…" on a stable fact (which ocean is the largest) searches and cites that page | Brief; the opposite of case 17 |
| 104 | Two plain-chat turns shorten a note and explain a compass, and do not search, recall, or cite | Case 17 |
| 105 | "Last Thursday" has a turn on both dates; the one about the product is chosen | Case 3's date rule |
| 106 | "Yesterday" is the previous local day | Named date `yesterday` |
| 107 | "8/11" keeps both readings; the day that has a turn is chosen and said in words | Case 8 |
| 108 | Both Thursdays match, then "The 12th" chooses 12 Nov and does not ask again | Cases 7 and 11 |
| 109 | A 23:40 local turn is still "yesterday" at 00:25 the next calendar morning | Case 18a |
| 110 | Both Mondays match the topic, so the answer asks and issues no verdict | Case 7 |
| 111 | Nothing stored on the dates, and nothing near them; the answer offers a fresh lookup | Case 4 (J1) |
| 112 | Nothing on the asked dates; a same-topic turn on another day is offered, with no verdict yet | Case 6 |
| 113 | The stored quote is still on the live first-party page | Case 2 (`unchanged`, `fast_path`, one fetch) |
| 114 | The live page shows a new price | Case 3's `changed` row |
| 115 | The pricing page times out; 44 USD/month is paired with the last-verified day (6 Nov), not the question's day | Case 16 |
| 116 | The only page is a third-party note; the verdict does not affirm a replacement | Brief third-party-only condition |
| 117 | One Monday exchange holds both products; news on or after that day is cited, and the older post is excluded | Case 1's news rule |
| 118 | "Is that still right?" with no earlier answer in the session and nothing stored | Case 10's phrase, empty store (brief) |
| 119 | A page that now shows only an annual price is not `changed` to that annual figure | Case 13 |

The harness also checks that every turn finishes, that every stored claim's quote contains its value's numbers, and that a check is not dated to the earlier question.

## After the first run

The first run (`evals/results/heldout-first.json`, commit `20e0b11`, before any fix) scored **15 of 19 at 3 of 3**. That is the honest held-out number: nothing had been tuned against these cases. A Codex review of the four failures (independent of the author) found:

| Case | Finding | Change |
| --- | --- | --- |
| 116 | Product bug: a third-party page produced "unchanged". | The re-check now refuses "unchanged" or "changed" from a page that is not the vendor's own (`src/core/pipeline/recheck.ts`, with a regression test). |
| 118 | Product gap: with no earlier answer to re-check, minimi asked for a topic, which cannot identify the claim to re-check. | The no-record writer now asks which claim or earlier answer to check (paste or describe it). |
| 104 | Check too strict: it measured the whole reply (two rewrites) and required a movement verb. | Each rewrite is measured on its own; "is now in the east studio" counts; "moved from the east studio" still fails (`predicates.test.ts`). |
| 111 | Check too strict: "look up … pricing fresh" was not accepted as forward-looking. | "fresh" counts; a historical lookup or a refusal still fails (`predicates.test.ts`). |

Runs after these changes are written to `evals/results/heldout.json` and are reported as "after fixes", never in place of the first run.

### Second run after fixes

`0ce1ea0`: 17 of 19 at 3 of 3; 114 and 117 flaky. 114 (product): the re-check writer computed "an increase of 9 USD per month"; it now has the fresh writer's rule against computed differences, totals and percentages. 117 (check): the news citation came right after the full stop ("…question. [3]"), which the app's validator counts as citing that sentence; the check now uses the same rule (`citedSentencesOf`, tested).

### Third run after fixes

`6cdd446`: 18 of 19 at 3 of 3; 115 flaky. Its run 2 said "I can't say whether it still holds", which the "does not say the price still holds" check read as a claim that it holds (no negation rule in its second branch). The check now applies the same uncertainty rule as `claimsNoChangeAbout`, and still catches "still costs 44 USD" (tested).
Codex then found both check fixes too loose (`docs` review, not published): the 117 helper attached a marker even after a line break, and the 115 helper let a hedge anywhere in a sentence excuse a claim elsewhere in it. Both now follow the validator's and `claimsNoChangeAbout`'s rules exactly (marker on the same line after the full stop; hedge in the same clause), with Codex's counterexamples as tests. The re-check prompt's example no longer uses held-out figures.

### Fourth run after fixes

`c347286`: 18 of 19; 113 flaky. In run 1 the router set "refers to previous" for "On 9 November I asked … Is that price still correct?", against its own rule that a stated date means a date lookup, so no conversation was found. Code now enforces that rule (a stated date always wins), with a regression test.
