/**
 * Hand constraints for declarer practice deals. Pure functions only.
 *
 * Constraints are written from the declarer's point of view, so the same
 * description works whichever seat declares. Roles:
 *   declarer, dummy, lho (declarer's left, the opening leader), rho,
 *   side (declarer + dummy) and defenders (lho + rho).
 *
 * Keys a role can have (pair roles add up both hands where it makes sense):
 *   hcp: [min, max]          high card points
 *   trumpLength: [min, max]  cards in the contract's trump suit (ignored in no-trump)
 *   balanced: true           4333, 4432 or 5332 (pair roles: both hands)
 *   maxSuitLength: n         no suit longer than n (pair roles: in either hand)
 *   noMajorFit: true         pair roles only: fewer than 8 hearts and 8 spades together
 */

const { SUITS, POSITIONS, countHcp } = require('../deal');

const STRAINS = { S: 'spades', H: 'hearts', D: 'diamonds', C: 'clubs', N: null };
const RANKS_HIGH_FIRST = ['A', 'K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4', '3', '2'];
const KNOWN_KEYS = ['hcp', 'trumpLength', 'balanced', 'maxSuitLength', 'noMajorFit'];
const PAIR_ROLES = ['side', 'defenders'];

/** '4S' -> { level: 4, strain: 'S', trump: 'spades', required: 10, text: '4S' } */
function parseContract(text) {
  const match = /^([1-7])([SHDCN])$/i.exec(String(text).trim());
  if (!match) throw new Error(`Invalid contract: ${text}`);
  const level = Number(match[1]);
  const strain = match[2].toUpperCase();
  return { level, strain, trump: STRAINS[strain], required: level + 6, text: `${level}${strain}` };
}

/** Seats of each role when `declarer` declares. */
function roleSeats(declarer = 'south') {
  const i = POSITIONS.indexOf(declarer);
  if (i < 0) throw new Error(`Invalid declarer: ${declarer}`);
  const seat = (offset) => POSITIONS[(i + offset) % 4];
  return {
    declarer: [seat(0)],
    lho: [seat(1)],
    dummy: [seat(2)],
    rho: [seat(3)],
    side: [seat(0), seat(2)],
    defenders: [seat(1), seat(3)]
  };
}

function suitLengths(hand) {
  const lengths = {};
  for (const suit of SUITS) lengths[suit] = (hand[suit] || []).length;
  return lengths;
}

function isBalanced(hand) {
  const shape = SUITS.map(suit => (hand[suit] || []).length).sort((a, b) => b - a).join('');
  return shape === '4333' || shape === '4432' || shape === '5332';
}

function inRange(value, range) {
  return value >= range[0] && value <= range[1];
}

/**
 * Constraints that apply to `contract` (a parsed contract): the spec's common
 * constraints, overridden role by role by suitConstraints or notrumpConstraints.
 */
function constraintsFor(spec, contract) {
  const extra = contract.trump ? spec.suitConstraints : spec.notrumpConstraints;
  const merged = {};
  for (const source of [spec.constraints || {}, extra || {}]) {
    for (const [role, rules] of Object.entries(source)) {
      merged[role] = { ...(merged[role] || {}), ...rules };
    }
  }
  return merged;
}

/** Throws if a spec names an unknown role or key, so typos don't pass silently. */
function validateConstraints(constraints) {
  const roles = Object.keys(roleSeats());
  for (const [role, rules] of Object.entries(constraints)) {
    if (!roles.includes(role)) throw new Error(`Unknown role: ${role}`);
    for (const key of Object.keys(rules)) {
      if (!KNOWN_KEYS.includes(key)) throw new Error(`Unknown constraint ${key} for ${role}`);
    }
    if (rules.noMajorFit && !PAIR_ROLES.includes(role)) {
      throw new Error(`noMajorFit only applies to side or defenders, not ${role}`);
    }
  }
}

function roleMatches(roleHands, rules, contract) {
  if (rules.hcp) {
    const hcp = roleHands.reduce((sum, hand) => sum + countHcp(hand), 0);
    if (!inRange(hcp, rules.hcp)) return false;
  }
  if (rules.trumpLength && contract.trump) {
    const length = roleHands.reduce((sum, hand) => sum + (hand[contract.trump] || []).length, 0);
    if (!inRange(length, rules.trumpLength)) return false;
  }
  if (rules.balanced && !roleHands.every(isBalanced)) return false;
  if (rules.maxSuitLength !== undefined) {
    const longest = Math.max(...roleHands.map(hand => Math.max(...Object.values(suitLengths(hand)))));
    if (longest > rules.maxSuitLength) return false;
  }
  if (rules.noMajorFit) {
    for (const suit of ['spades', 'hearts']) {
      const length = roleHands.reduce((sum, hand) => sum + (hand[suit] || []).length, 0);
      if (length >= 8) return false;
    }
  }
  return true;
}

/** Does the deal fit the spec for `contract` ('4S' or a parsed contract)? */
function matchesConstraints(hands, spec, contract, declarer = 'south') {
  const parsed = typeof contract === 'string' ? parseContract(contract) : contract;
  const seats = roleSeats(declarer);
  for (const [role, rules] of Object.entries(constraintsFor(spec, parsed))) {
    if (!roleMatches(seats[role].map(seat => hands[seat]), rules, parsed)) return false;
  }
  return true;
}

/**
 * Sure tricks for the declaring side: in each suit, the unbroken run of top
 * cards the partnership holds from the ace down, but no more than the longer
 * hand's length (AK opposite Qx cashes only two). A rough count -- entries,
 * blockages and ruffs by the defenders are ignored -- used to drop deals
 * where declarer can just cash the tricks without any technique.
 */
function topTricks(hands, declarer = 'south') {
  const [declarerSeat, dummySeat] = roleSeats(declarer).side;
  let total = 0;
  for (const suit of SUITS) {
    const ours = new Set([...hands[declarerSeat][suit], ...hands[dummySeat][suit]]);
    let run = 0;
    while (run < RANKS_HIGH_FIRST.length && ours.has(RANKS_HIGH_FIRST[run])) run++;
    total += Math.min(run, Math.max(hands[declarerSeat][suit].length, hands[dummySeat][suit].length));
  }
  return total;
}

module.exports = {
  parseContract, roleSeats, suitLengths, isBalanced, constraintsFor,
  validateConstraints, matchesConstraints, topTricks
};
