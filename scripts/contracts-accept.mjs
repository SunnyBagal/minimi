// Records the current sha256 of src/core/contracts.ts in docs/contracts.sha256.
//
//   node scripts/contracts-accept.mjs [root]
//
// Run it only after a contract change is agreed. It writes the sha256 of
// src/core/contracts.ts to docs/contracts.sha256.
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { CONTRACTS_FILE, HASH_FILE, contractsHash, rootFromArgs } from './check-contracts.mjs';

const root = rootFromArgs();
const hash = contractsHash(root);
writeFileSync(path.join(root, HASH_FILE), `${hash}  ${CONTRACTS_FILE.split(path.sep).join('/')}\n`);
console.log(`contracts-accept: recorded ${hash}`);
