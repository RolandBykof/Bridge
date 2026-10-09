/**
 * Declarer practice deal generator ("deal and reject"):
 *   1. deal at random
 *   2. hand constraints (fast, thousands of deals a second)
 *   3. interest filter: declarer's sure tricks must fall short of the contract,
 *      so making it takes some technique
 *   4. double dummy check (slow, ~40 ms a deal)
 *
 * South is always declarer (West leads). The server turns the deal to the
 * player's seat when the deal starts.
 *
 * Run by scripts/generate-practice-deals.js, never by the game server: the
 * solver is synchronous WebAssembly and would hold up every table.
 */

const { dealCards, formatDealString } = require('../deal');
const { parseContract, constraintsFor, validateConstraints, matchesConstraints, topTricks } = require('./constraints');
const solver = require('../bridge_solver_wasm');

const DECLARER = 'south';

/** A dd bound -- a number, 'contract', 'contract+1', 'contract-1' -- as tricks. */
function resolveDdBound(bound, contract) {
  if (typeof bound === 'number') return bound;
  const match = /^contract\s*([+-]\s*\d+)?$/.exec(String(bound).trim());
  if (!match) throw new Error(`Invalid dd bound: ${bound}`);
  return contract.required + (match[1] ? Number(match[1].replace(/\s/g, '')) : 0);
}

function withinDd(tricks, dd, contract) {
  const min = dd && dd.min !== undefined ? resolveDdBound(dd.min, contract) : 0;
  const max = dd && dd.max !== undefined ? resolveDdBound(dd.max, contract) : 13;
  return tricks >= min && tricks <= max;
}

/** Throws on a spec the generator can't use. */
function validateSpec(spec) {
  if (!spec || !spec.id) throw new Error('Spec must have an id');
  if (!Array.isArray(spec.contracts) || spec.contracts.length === 0) {
    throw new Error(`${spec.id}: no contracts`);
  }
  for (const text of spec.contracts) {
    const contract = parseContract(text);
    validateConstraints(constraintsFor(spec, contract));
    if (spec.dd) {
      resolveDdBound(spec.dd.min ?? 0, contract);
      resolveDdBound(spec.dd.max ?? 13, contract);
    }
  }
}

/**
 * Generate up to `count` deals for `spec`, stopping at `timeLimitMs`.
 *
 * Options:
 *   skip        Set of deal strings (formatDealString) to leave out, e.g. the bank's
 *   onProgress  called with the running stats after each solved deal
 *   rng         random source for dealing and picking the contract
 *   solve       (hands, trump, declarer) => tricks; the solver by default
 *
 * Returns { deals: [{ pbn, hands, contract, declarer, ddTricks }], stats }.
 */
async function generateDeals(spec, {
  count, timeLimitMs = 60000, skip = new Set(), onProgress, rng = Math.random,
  solve = solver.declarerTricks
} = {}) {
  validateSpec(spec);
  const contracts = spec.contracts.map(parseContract);
  const deals = [];
  const seen = new Set(skip);
  const stats = { dealt: 0, passedConstraints: 0, passedInterest: 0, solved: 0, accepted: 0, ms: 0 };
  const start = Date.now();

  while (deals.length < count && Date.now() - start < timeLimitMs) {
    const contract = contracts[Math.floor(rng() * contracts.length)];
    const hands = dealCards(rng);
    stats.dealt++;

    if (!matchesConstraints(hands, spec, contract, DECLARER)) continue;
    stats.passedConstraints++;

    if (topTricks(hands, DECLARER) >= contract.required) continue;
    stats.passedInterest++;

    const pbn = formatDealString(hands);
    if (seen.has(pbn)) continue;

    const ddTricks = await solve(hands, contract.trump, DECLARER);
    stats.solved++;
    stats.ms = Date.now() - start;

    if (withinDd(ddTricks, spec.dd, contract)) {
      seen.add(pbn);
      deals.push({ pbn, hands, contract: contract.text, declarer: DECLARER, ddTricks });
      stats.accepted++;
    }
    if (onProgress) onProgress({ ...stats });
  }

  stats.ms = Date.now() - start;
  return { deals, stats };
}

module.exports = { generateDeals, validateSpec, withinDd, resolveDdBound, DECLARER };
