/**
 * Scripted model and clock for `--selftest`. No network. Cases 1 and 4 are
 * recheck plans; case 17 is chat. The pipeline on this branch only answers
 * chat, so 1 and 4 record assertion failures until Lane 5 is merged.
 */
import type { WriteInput } from '../src/core/contracts';
import { candidates, chatPlan, type FakeLlmScript, type FakeTimeRow } from '../src/core/testing/fakes';
import { CRM_NAMES } from './messages';

const monday = { kind: 'weekday' as const, weekday: 1 as const, modifier: 'bare' as const };
const lastTuesday = { kind: 'weekday' as const, weekday: 2 as const, modifier: 'last' as const };

function chatWrite(input: WriteInput): string[] {
  if (input.mode !== 'chat') return ['ok'];
  if (input.message.startsWith('Make this shorter')) return ['The meeting has been moved.'];
  return ['A mutex has one owner. A semaphore counts permits.'];
}

export function selftestScript(id: number): FakeLlmScript {
  if (id === 1) {
    return {
      route: chatPlan({
        intent: 'recheck',
        timeRef: monday,
        timeText: 'On Monday',
        topic: 'CRM tools',
        entities: [...CRM_NAMES],
        wantsNews: true,
      }),
    };
  }
  if (id === 4) {
    return {
      route: chatPlan({
        intent: 'recheck',
        timeRef: lastTuesday,
        timeText: 'Last Tuesday',
        topic: 'Postgres hosting',
        entities: ['Northwind PG', 'Basalt DB'],
        wantsNews: false,
      }),
      write(input) {
        if (input.mode === 'no_record') {
          return [
            'Nothing about Postgres hosting on 10 Nov or 3 Nov. I can look up Postgres hosting pricing now.',
          ];
        }
        return ['ok'];
      },
    };
  }
  if (id === 17) return { route: chatPlan(), write: chatWrite };
  return { route: chatPlan() };
}

export function selftestTime(id: number): FakeTimeRow[] {
  if (id === 1) return [{ ref: monday, result: candidates(['2026-11-09'], 'weekday Monday bare') }];
  if (id === 4) {
    return [{ ref: lastTuesday, result: candidates(['2026-11-10', '2026-11-03'], 'weekday Tuesday last') }];
  }
  return [];
}
