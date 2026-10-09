/**
 * Declarer practice at a table: the game mode 'declarerPractice'. The server
 * keeps this state in table.practice and calls these functions from
 * beginDeal(), endGame() and the messages it sends.
 *
 * The table creator is always declarer. Each deal comes from the deal bank
 * (bank.js), turned round so that the bank's declarer (South) sits in the
 * creator's seat, and starts straight from the play phase.
 */

const { POSITIONS, rotateHands } = require('../deal');
const { parseContract } = require('./constraints');
const { MIXED_ID, getSpec } = require('./specs');

const MODE = 'declarerPractice';

function practiceTypeLabel(specId) {
  const spec = getSpec(specId);
  return spec ? spec.label : 'Mixed';
}

/** The practice type id, or null for an unknown one. */
function validPracticeType(specId) {
  return specId === MIXED_ID || getSpec(specId) ? specId : null;
}

function createPracticeState(practiceType) {
  return {
    specId: validPracticeType(practiceType) || MIXED_ID,
    playedIds: [],
    current: null,
    stats: { played: 0, made: 0 }
  };
}

function partnerOf(position) {
  return POSITIONS[(POSITIONS.indexOf(position) + 2) % 4];
}

/**
 * Picks the next deal for the table and makes it current. Deals already
 * played at the table are left out until the whole bank has been played.
 * Returns the hands, turned so that `declarer` is declarer. Throws if the
 * bank has no deals of the table's type.
 */
function pickPracticeDeal(practice, bank, declarer, rng = Math.random) {
  const entry = bank.pickDeal(practice.specId, practice.playedIds, rng);
  if (!entry) throw new Error(`No practice deals available for ${practice.specId}`);
  if (entry.recycled) practice.playedIds = [];

  practice.playedIds.push(entry.id);
  practice.current = {
    id: entry.id,
    spec: entry.spec,
    label: practiceTypeLabel(entry.spec),
    contract: parseContract(entry.contract).text,
    declarer,
    ddTricks: entry.ddTricks,
    note: entry.note || null
  };
  return rotateHands(entry.hands, entry.declarer, declarer);
}

/** The contract fields of biddingState for the current deal. */
function practiceContract(current) {
  const contract = parseContract(current.contract);
  return {
    contract: contract.text,
    declarer: current.declarer,
    dummy: partnerOf(current.declarer),
    trumpSuit: contract.trump
  };
}

/**
 * The result of the current deal for gameOver. A replay shows its result
 * but does not change the table's statistics.
 */
function recordPracticeResult(practice, declarerTricks, isReplay) {
  const current = practice.current;
  const made = declarerTricks >= parseContract(current.contract).required;
  if (!isReplay) {
    practice.stats.played += 1;
    if (made) practice.stats.made += 1;
  }
  return {
    made,
    actualTricks: declarerTricks,
    ddTricks: current.ddTricks,
    contract: current.contract,
    label: current.label,
    note: current.note,
    stats: { ...practice.stats }
  };
}

/**
 * What the players may know about the practice: never the deal itself, so
 * the defenders' cards can't leak to a client. The note can give the hand
 * away, so it is sent only with the result (recordPracticeResult()).
 */
function practicePublic(practice) {
  if (!practice) return null;
  const current = practice.current;
  return {
    specId: practice.specId,
    label: practiceTypeLabel(practice.specId),
    stats: { ...practice.stats },
    current: current ? {
      contract: current.contract,
      declarer: current.declarer,
      label: current.label
    } : null
  };
}

module.exports = {
  MODE, practiceTypeLabel, validPracticeType, createPracticeState, partnerOf,
  pickPracticeDeal, practiceContract, recordPracticeResult, practicePublic
};
