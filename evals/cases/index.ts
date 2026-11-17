import type { EvalCase } from '../types';
import { evalCase as case01 } from './01';
import { evalCase as case02 } from './02';
import { evalCase as case03 } from './03';
import { evalCase as case04 } from './04';
import { evalCase as case05 } from './05';
import { evalCase as case06 } from './06';
import { evalCase as case07 } from './07';
import { evalCase as case08 } from './08';
import { evalCase as case09 } from './09';
import { evalCase as case10 } from './10';
import { evalCase as case11 } from './11';
import { evalCase as case12 } from './12';
import { evalCase as case13 } from './13';
import { evalCase as case14 } from './14';
import { evalCase as case15 } from './15';
import { evalCase as case16 } from './16';
import { evalCase as case17 } from './17';
import { evalCase as case18 } from './18';
import { evalCase as case19 } from './19';

export const CASES: readonly EvalCase[] = [
  case01,
  case02,
  case03,
  case04,
  case05,
  case06,
  case07,
  case08,
  case09,
  case10,
  case11,
  case12,
  case13,
  case14,
  case15,
  case16,
  case17,
  case18,
  case19,
];

export function caseById(id: number): EvalCase | undefined {
  return CASES.find((item) => item.id === id);
}
