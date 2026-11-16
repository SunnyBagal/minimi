// Contracts check, part of `npm run gate`.
//
//   node scripts/check-contracts.mjs [root]
//
// Fails (exit code 1) when the sha256 of src/core/contracts.ts differs from the
// hash recorded in docs/contracts.sha256. The file is frozen; a deliberate
// change is accepted with `npm run contracts:accept`.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const CONTRACTS_FILE = path.join('src', 'core', 'contracts.ts');
export const HASH_FILE = path.join('docs', 'contracts.sha256');

/**
 * @param {string} root the repository root
 * @returns {string} sha256 of the contracts file, in hex
 */
export function contractsHash(root) {
  return createHash('sha256').update(readFileSync(path.join(root, CONTRACTS_FILE))).digest('hex');
}

/**
 * @param {string} root the repository root
 * @returns {string | null} what is wrong, or null when the hash matches
 */
export function checkContracts(root) {
  const actual = contractsHash(root);
  let recorded;
  try {
    recorded = readFileSync(path.join(root, HASH_FILE), 'utf8').trim().split(/\s+/)[0] ?? '';
  } catch {
    return `${HASH_FILE} is missing. Run "npm run contracts:accept" once the contracts are agreed.`;
  }
  if (recorded !== actual) {
    return `${CONTRACTS_FILE} has changed: recorded ${recorded || '(empty)'}, found ${actual}. The file is frozen; see "contracts.ts" in docs/briefs/RULES.md.`;
  }
  return null;
}

/** The repository root: the given argument, or the parent of this script's directory. */
export function rootFromArgs() {
  return path.resolve(process.argv[2] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const problem = checkContracts(rootFromArgs());
  if (problem !== null) {
    console.error(`check-contracts: ${problem}`);
    process.exit(1);
  }
  console.log('check-contracts: ok');
}
