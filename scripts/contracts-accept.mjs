// Records the current sha256 of src/core/contracts.ts in docs/contracts.sha256.
//
//   node scripts/contracts-accept.mjs [root]
//
// Run it only when a contract change has been agreed (see docs/briefs/RULES.md).
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { CONTRACTS_FILE, HASH_FILE, contractsHash, rootFromArgs } from './check-contracts.mjs';

const root = rootFromArgs();
const hash = contractsHash(root);
writeFileSync(path.join(root, HASH_FILE), `${hash}  ${CONTRACTS_FILE.split(path.sep).join('/')}\n`);
console.log(`contracts-accept: recorded ${hash}`);
