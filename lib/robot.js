/**
 * Robot player decisions: bidding, minibridge contract choice and card play.
 *
 * Bidding uses BridgeBase's free GIB robot as the primary engine, since it
 * reliably plays out full auctions (verified 2026-09-25, see
 * bridge-robotti-suunnitelma.html). Card play (opening lead included) uses
 * the vendored bridge-solver double-dummy WASM module instead of GIB, since
 * GIB's public robot.php endpoint only answers "what's the opening lead",
 * not "what's the next card" once a trick already has a card in it.
 *
 * Every path here has a local, network-independent fallback so a slow or
 * unreachable GIB never stalls a game.
 */

const gibClient = require('./gib_client_module');
const solver = require('./bridge_solver_wasm');

const HCP = { A: 4, K: 3, Q: 2, J: 1 };
const RANK_ORDER = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const SUITS = ['spades', 'hearts', 'diamonds', 'clubs'];
const SUIT_LETTER = { spades: 'S', hearts: 'H', diamonds: 'D', clubs: 'C' };
const GIB_TIMEOUT_MS = 9000;

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('GIB request timed out')), ms))
  ]);
}

function countHcp(hand) {
  return SUITS.reduce((sum, suit) =>
    sum + (hand[suit] || []).reduce((s, v) => s + (HCP[v] || 0), 0), 0);
}

function suitRank(suit) {
  return ['clubs', 'diamonds', 'hearts', 'spades'].indexOf(suit);
}

/**
 * Same rule as the server's own isBidValid(), duplicated here to keep this
 * module independent of server.js (avoids a circular require).
 */
function isBidValid(bid, highestBid) {
  if (bid === 'P') return true;
  if (bid === 'X' || bid === 'XX') return true;
  if (!highestBid) return true;

  const bidLevel = parseInt(bid.charAt(0), 10);
  const bidSuit = bid.charAt(1);
  const highestLevel = parseInt(highestBid.charAt(0), 10);
  const highestSuit = highestBid.charAt(1);
  const suits = ['C', 'D', 'H', 'S', 'N'];
  const bidSuitIndex = suits.indexOf(bidSuit);
  const highestSuitIndex = suits.indexOf(highestSuit);

  if (bidLevel > highestLevel) return true;
  if (bidLevel === highestLevel && bidSuitIndex > highestSuitIndex) return true;
  return false;
}

/**
 * Local, network-independent safety net for bidding: opens a reasonable
 * suit with an opening hand, passes otherwise. This is deliberately simple
 * -- GIB is the real bidding engine and has tested reliably end-to-end; this
 * only has to guarantee the auction never gets stuck if GIB is unreachable.
 */
function decideFallbackBid(table, position) {
  if (table.biddingState.bidHistory.length > 0) return 'P';

  const hand = table.gameState.hands[position];
  const points = countHcp(hand);
  if (points < 12) return 'P';

  let bestSuit = 'clubs';
  let bestLen = -1;
  for (const suit of SUITS) {
    const len = (hand[suit] || []).length;
    if (len > bestLen || (len === bestLen && suitRank(suit) > suitRank(bestSuit))) {
      bestLen = len;
      bestSuit = suit;
    }
  }
  return `1${SUIT_LETTER[bestSuit]}`;
}

/**
 * Decide a robot's bid: GIB first, then the local fallback, 'P' as the last
 * resort. The returned bid is always validated before being handed back so
 * a malformed or stale GIB answer can never reach processBid().
 */
async function decideRobotBid(table, position) {
  const highestBid = table.biddingState.highestBid;

  try {
    const gameState = {
      position,
      dealer: table.currentDealer,
      vulnerable: '-',
      hands: table.gameState.hands,
      biddingHistory: table.biddingState.bidHistory,
      gamePhase: 'bidding'
    };
    const result = await withTimeout(gibClient.getRobotMove(gameState), GIB_TIMEOUT_MS);
    if (result && result.type === 'bid' && isBidValid(result.bid, highestBid)) {
      return result.bid;
    }
    console.error(`Robot bid: GIB returned an unusable bid for ${position}:`, result && result.bid);
  } catch (err) {
    console.error(`Robot bid: GIB request failed for ${position}:`, err.message);
  }

  const fallback = decideFallbackBid(table, position);
  return isBidValid(fallback, highestBid) ? fallback : 'P';
}

/**
 * Minibridge contract choice: no bidding, so no GIB call is needed. Picks
 * the longest combined suit (8+ cards) as trump, otherwise no-trump, and
 * bids game if the combined point count supports it.
 */
function decideMiniContract(table, position) {
  const ms = table.miniState;
  const hand = table.gameState.hands[position];
  const dummyHand = table.gameState.hands[ms.dummy];
  const totalPoints = ms.points[ms.declarer] + ms.points[ms.dummy];

  let bestSuit = null;
  let bestLen = 0;
  for (const suit of SUITS) {
    const len = (hand[suit] || []).length + (dummyHand[suit] || []).length;
    if (len > bestLen) {
      bestLen = len;
      bestSuit = suit;
    }
  }

  if (bestLen >= 8) {
    return { type: totalPoints >= 26 ? 'game' : 'partscore', strain: SUIT_LETTER[bestSuit] };
  }
  return { type: totalPoints >= 25 ? 'game' : 'partscore', strain: 'N' };
}

/**
 * Cards `position` may legally play right now (follow suit if able).
 */
function getLegalCardsForPosition(table, position) {
  const hand = table.gameState.hands[position];
  const trick = table.gameState.currentTrick;

  if (trick.length > 0 && trick.length < 4) {
    const leadingSuit = trick[0].suit;
    if (hand[leadingSuit] && hand[leadingSuit].length > 0) {
      return hand[leadingSuit].map(card => ({ suit: leadingSuit, card }));
    }
  }

  const cards = [];
  for (const suit of SUITS) {
    for (const card of hand[suit] || []) cards.push({ suit, card });
  }
  return cards;
}

/**
 * Local safety net for card play if the double-dummy solver is unavailable:
 * follow suit with the lowest card, or lead the lowest card of the longest
 * suit. Never fails and never gets the game stuck.
 */
function pickLegalCardFallback(table, position) {
  const legal = getLegalCardsForPosition(table, position);
  const byRank = (a, b) => RANK_ORDER.indexOf(a.card) - RANK_ORDER.indexOf(b.card);

  if (table.gameState.currentTrick.length === 0) {
    const hand = table.gameState.hands[position];
    let longestSuit = SUITS[0];
    let longestLen = -1;
    for (const suit of SUITS) {
      const len = (hand[suit] || []).length;
      if (len > longestLen) {
        longestLen = len;
        longestSuit = suit;
      }
    }
    const inSuit = legal.filter(c => c.suit === longestSuit).sort(byRank);
    return inSuit[0] || [...legal].sort(byRank)[0];
  }

  return [...legal].sort(byRank)[0];
}

/**
 * Decide the card to play for `position` (which may be the dummy hand,
 * controlled by the declarer robot). Uses the double-dummy solver for every
 * trick including the opening lead; falls back to a simple legal-card rule
 * if the solver throws or returns nothing usable.
 */
async function decideRobotCard(table, position) {
  const legalCards = getLegalCardsForPosition(table, position);
  if (legalCards.length === 0) return null;
  if (legalCards.length === 1) return legalCards[0];

  try {
    const best = await solver.bestCard({
      hands: table.gameState.originalHands,
      trump: table.gameState.trumpSuit,
      declarer: table.gameState.declarer,
      leader: table.gameState.openingLeader,
      playedCards: table.gameState.playedCards,
      legalCards
    });
    if (best) return { suit: best.suit, card: best.card };
  } catch (err) {
    console.error(`Robot card play: solver failed for ${position}, using fallback:`, err.message);
  }

  return pickLegalCardFallback(table, position);
}

module.exports = {
  decideRobotBid,
  decideMiniContract,
  decideRobotCard
};
