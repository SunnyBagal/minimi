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
