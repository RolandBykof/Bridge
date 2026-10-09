/**
 * Shared deal helpers for the server, the solver wrapper and the practice
 * deal generator. Hands use the server's internal shape:
 * { north: { spades: ['A', '10', ...], hearts: [...], ... }, east: ..., ... }
 * with each suit sorted from the highest card down.
 */

const SUITS = ['spades', 'hearts', 'diamonds', 'clubs'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const POSITIONS = ['north', 'east', 'south', 'west'];
const HCP = { A: 4, K: 3, Q: 2, J: 1 };
const POSITION_LETTERS = { N: 'north', E: 'east', S: 'south', W: 'west' };

function emptyHands() {
  const hands = {};
  for (const position of POSITIONS) {
    hands[position] = { spades: [], hearts: [], diamonds: [], clubs: [] };
  }
  return hands;
}

function sortHands(hands) {
  for (const position of POSITIONS) {
    for (const suit of SUITS) {
      hands[position][suit].sort((a, b) => RANKS.indexOf(b) - RANKS.indexOf(a));
    }
  }
  return hands;
}

/**
 * Deal cards randomly (Fisher-Yates). `rng` returns a float in [0, 1) and can
 * be replaced with a seeded generator in tests.
 */
function dealCards(rng = Math.random) {
  const deck = [];
  for (const suit of SUITS) {
    for (const value of RANKS) {
      deck.push({ suit, value });
    }
  }

  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }

  const hands = emptyHands();
  for (let i = 0; i < deck.length; i++) {
    const card = deck[i];
    hands[POSITIONS[Math.floor(i / 13)]][card.suit].push(card.value);
  }
  return sortHands(hands);
}

/**
 * Count high card points (honor points) in a hand
 */
function countHcp(hand) {
  return Object.values(hand).flat()
    .reduce((sum, v) => sum + (HCP[v] || 0), 0);
}

function rankToCode(rank) {
  return rank === '10' ? 'T' : rank;
}

function codeToRank(code) {
  return code === 'T' ? '10' : code;
}

/**
 * Format all four hands as a PBN deal string, e.g. "N:952.J976.AJ876.9 ...".
 */
function formatDealString(hands) {
  const formatHand = (hand) => SUITS
    .map(suit => (hand[suit] || []).map(rankToCode).join(''))
    .join('.');
  return `N:${POSITIONS.map(pos => formatHand(hands[pos])).join(' ')}`;
}

/**
 * The inverse of formatDealString. Accepts any first seat ("N:", "E:", "S:"
 * or "W:"), lower case cards and "10" as well as "T". Throws on a malformed
 * deal: every hand must have 13 cards and the deal 52 different cards.
 */
function parseDealString(dealString) {
  const match = /^\s*([NESW])\s*:\s*(.+?)\s*$/i.exec(dealString || '');
  if (!match) throw new Error(`Invalid deal string: ${dealString}`);

  const handStrings = match[2].split(/\s+/);
  if (handStrings.length !== 4) throw new Error(`Deal must have four hands: ${dealString}`);

  const first = POSITIONS.indexOf(POSITION_LETTERS[match[1].toUpperCase()]);
  const hands = emptyHands();
  const seen = new Set();

  handStrings.forEach((handString, i) => {
    const position = POSITIONS[(first + i) % 4];
    const suitStrings = handString.split('.');
    if (suitStrings.length !== 4) throw new Error(`Hand must have four suits: ${handString}`);

    suitStrings.forEach((suitString, s) => {
      const codes = suitString.toUpperCase().replace(/10/g, 'T').split('').filter(Boolean);
      for (const code of codes) {
        const rank = codeToRank(code);
        if (!RANKS.includes(rank)) throw new Error(`Invalid card ${code} in ${handString}`);
        const key = `${SUITS[s]}${rank}`;
        if (seen.has(key)) throw new Error(`Card appears twice: ${SUITS[s]} ${rank}`);
        seen.add(key);
        hands[position][SUITS[s]].push(rank);
      }
    });

    const count = SUITS.reduce((sum, suit) => sum + hands[position][suit].length, 0);
    if (count !== 13) throw new Error(`${position} has ${count} cards, expected 13`);
  });

  return sortHands(hands);
}

/**
 * Turn the deal round the table so that the hand at `from` ends up at `to`;
 * every other hand moves the same number of seats. Returns new hands.
 */
function rotateHands(hands, from, to) {
  if (POSITIONS.indexOf(from) < 0 || POSITIONS.indexOf(to) < 0) {
    throw new Error(`Invalid seats: ${from} -> ${to}`);
  }
  const offset = (POSITIONS.indexOf(to) - POSITIONS.indexOf(from) + 4) % 4;
  const rotated = {};
  POSITIONS.forEach((position, i) => {
    const hand = hands[position];
    rotated[POSITIONS[(i + offset) % 4]] = Object.fromEntries(SUITS.map(suit => [suit, [...(hand[suit] || [])]]));
  });
  return rotated;
}

module.exports = {
  SUITS, RANKS, POSITIONS, HCP,
  dealCards, countHcp, formatDealString, parseDealString, rotateHands, rankToCode, codeToRank
};
