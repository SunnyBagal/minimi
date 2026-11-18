/**
 * The held-out set. `npm run evals:heldout` runs these ids, not cases 1–19.
 */
import type { EvalCase } from '../types';
import { HELDOUT_CASE_LIST } from './cases';

export const HELDOUT_CASES: readonly EvalCase[] = HELDOUT_CASE_LIST;

export function heldoutById(id: number): EvalCase | undefined {
  return HELDOUT_CASES.find((item) => item.id === id);
}
