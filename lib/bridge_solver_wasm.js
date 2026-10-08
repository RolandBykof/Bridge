/**
 * Thin CommonJS wrapper around the vendored bridge-solver WebAssembly module
 * (bridge-craftwork/bridge-solver v2.0.0, MIT OR Apache-2.0 -- see
 * lib/vendor/bridge-solver-wasm/). The WASM package ships as an ES module;
 * this file loads it once via a cached dynamic import() and exposes a small
 * CommonJS API for the rest of the server.
 */

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { chooseOpeningLead } = require('./opening_lead');
const DdReview = require('../public/js/dd-review');

const VENDOR_DIR = path.join(__dirname, 'vendor', 'bridge-solver-wasm');

const SUIT_TO_LETTER = { spades: 'S', hearts: 'H', diamonds: 'D', clubs: 'C' };
const LETTER_TO_SUIT = { S: 'spades', H: 'hearts', D: 'diamonds', C: 'clubs' };
const POSITION_TO_LETTER = { north: 'N', east: 'E', south: 'S', west: 'W' };
const RANK_ORDER = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

let modulePromise = null;

function loadModule() {
  if (!modulePromise) {
    modulePromise = (async () => {
      const entry = pathToFileURL(path.join(VENDOR_DIR, 'bridge_solver_wasm.js')).href;
      const mod = await import(entry);
      const wasmBytes = fs.readFileSync(path.join(VENDOR_DIR, 'bridge_solver_wasm_bg.wasm'));
      await mod.default({ module_or_path: wasmBytes });
      mod.start(); // turns Rust panics into readable console messages
      return mod;
    })().catch(err => {
      modulePromise = null; // allow a retry on the next call instead of caching a failure forever
      throw err;
    });
  }
  return modulePromise;
}

function rankToCode(rank) {
  return rank === '10' ? 'T' : rank;
}

function codeToRank(code) {
  return code === 'T' ? '10' : code;
}

function cardToPBN(suit, rank) {
  return `${SUIT_TO_LETTER[suit]}${rankToCode(rank)}`;
}

function pbnToCard(code) {
  return {
    suit: LETTER_TO_SUIT[code.charAt(0).toUpperCase()],
    card: codeToRank(code.slice(1).toUpperCase())
  };
}

/**
 * Format all four hands as a PBN deal string, e.g. "N:952.J976.AJ876.9 ...".
 * `hands` uses the server's internal shape: { north: { spades: [...], ... }, ... }.
 */
function formatDealString(hands) {
  const order = ['north', 'east', 'south', 'west'];
  const formatHand = (hand) => ['spades', 'hearts', 'diamonds', 'clubs']
    .map(suit => (hand[suit] || []).map(rankToCode).join(''))
    .join('.');
  return `N:${order.map(pos => formatHand(hands[pos])).join(' ')}`;
}

const SUIT_COLUMN = { clubs: 0, diamonds: 1, hearts: 2, spades: 3 }; // no-trump is column 4

/**
 * Number of tricks the declaring side takes with perfect defense and perfect
 * declarer play (used for the post-deal comparison). `trump` is a suit name
 * (spades/hearts/diamonds/clubs) or null for no-trump; `declarer` is the
 * declaring position (north/east/south/west).
 *
 * Uses dd_table() rather than the free solve_contract() function: the two
 * always agree for the declaring side actually holding the balance of
 * power, but solve_contract()'s third ("leader") argument was found not to
 * reliably select the N/S vs. E/W declaring side in testing, whereas
 * dd_table()'s 20-cell table is internally consistent (a partnership's two
 * members always report the same trick count, as double-dummy play
 * requires) and matches known-good references exactly.
 */
async function solveContract(hands, trump, declarer) {
  const mod = await loadModule();
  const dealstr = formatDealString(hands);
  const analyzer = new mod.Analyzer();
  try {
    const table = JSON.parse(analyzer.dd_table(dealstr));
    const rowIndex = (declarer === 'north' || declarer === 'south') ? 0 : 1;
    const colIndex = trump ? SUIT_COLUMN[trump] : 4;
    return table.tricks[rowIndex][colIndex];
  } finally {
    analyzer.free();
  }
}

const SEAT_ORDER = ['north', 'east', 'south', 'west'];
const SUITS = ['spades', 'hearts', 'diamonds', 'clubs'];

/**
 * The solver's alternatives for the card at `node` (0-based index into the
 * play), restricted to `legalCards`. `plays` are the PBN codes played before
 * it. Returns [{ card: PBN, tricks, cost }] or [] if the solver gave nothing.
 */
function nodeAlternatives(analyzer, baseRequest, plays, legalCards) {
  const placeholder = cardToPBN(legalCards[0].suit, legalCards[0].card);
  const request = { ...baseRequest, plays: [...plays, placeholder] };
  const result = JSON.parse(analyzer.dd_play_node(JSON.stringify(request), plays.length));
  const alternatives = result.alternatives || [];
  const legalSet = new Set(legalCards.map(c => cardToPBN(c.suit, c.card)));
  const legalAlternatives = alternatives.filter(a => legalSet.has(a.card));
  return legalAlternatives.length > 0 ? legalAlternatives : alternatives;
}

/**
 * The card to play among the cheapest alternatives. Several cards often tie
 * for the same (usually zero) cost -- the double dummy result genuinely
 * doesn't care which one is played, and the solver's list order is
 * arbitrary. The robot and the double dummy review both pick through here,
 * so the review shows the same card the robot played whenever that card was
 * optimal.
 *
 * Opening lead: the standard defensive leading principles (opening_lead.js).
 * Every other card: lowest rank first -- never burn a winner needlessly when
 * a low card is provably just as good.
 */
function pickAmongCheapest(pool, leadContext) {
  const minCost = Math.min(...pool.map(a => a.cost));
  const bestPool = pool.filter(a => a.cost === minCost);

  if (leadContext) {
    const choice = chooseOpeningLead({ ...leadContext, candidates: bestPool.map(a => pbnToCard(a.card)) });
    const chosen = choice && bestPool.find(a => a.card === cardToPBN(choice.suit, choice.card));
    if (chosen) return chosen;
  }

  const rankOf = (pbnCard) => RANK_ORDER.indexOf(codeToRank(pbnCard.slice(1).toUpperCase()));
  let best = bestPool[0];
  for (const alt of bestPool) {
    if (rankOf(alt.card) < rankOf(best.card)) best = alt;
  }
  return best;
}

/**
 * Best legal card for the player on turn (tricks 1-13, opening lead included).
 *
 * `playedCards` is the full play history of this deal so far, in play order:
 * [{ suit, card }, ...] (server's internal suit/rank names).
 * `legalCards` is the list of { suit, card } the mover may legally play
 * (already filtered by the caller for follow-suit).
 * `auction` is the bid history [{ player, bid }], used for the opening lead.
 *
 * Returns { suit, card, tricks, cost } or null if the solver could not
 * produce a usable answer (caller should fall back to a simple rule).
 */
async function bestCard({ hands, trump, declarer, leader, playedCards, legalCards, auction }) {
  if (!legalCards || legalCards.length === 0) return null;

  const mod = await loadModule();
  const request = {
    dealstr: formatDealString(hands),
    trump: trump ? SUIT_TO_LETTER[trump] : 'N',
    declarer: POSITION_TO_LETTER[declarer],
    leader: POSITION_TO_LETTER[leader]
  };
  const plays = playedCards.map(pc => cardToPBN(pc.suit, pc.card));

  const analyzer = new mod.Analyzer();
  try {
    const pool = nodeAlternatives(analyzer, request, plays, legalCards);
    if (pool.length === 0) return null;

    const leadContext = plays.length === 0
      ? { hand: hands[leader], trump: trump || null, auction: auction || [], leader }
      : null;
    const best = pickAmongCheapest(pool, leadContext);
    const card = pbnToCard(best.card);
    return { suit: card.suit, card: card.card, tricks: best.tricks, cost: best.cost };
  } finally {
    analyzer.free();
  }
}

/** Legal cards for `position` in `hands` given the cards of the open trick. */
function legalCardsFor(hands, position, trick) {
  const hand = hands[position];
  if (trick.length > 0) {
    const ledSuit = trick[0].suit;
    if (hand[ledSuit] && hand[ledSuit].length > 0) {
      return hand[ledSuit].map(card => ({ suit: ledSuit, card }));
    }
  }
  const cards = [];
  for (const suit of SUITS) {
    for (const card of hand[suit] || []) cards.push({ suit, card });
  }
  return cards;
}

/**
 * One double-dummy-perfect line for the whole deal, from the opening lead to
 * the last card. Built card by card with the same tie-breaking as the robot
 * (pickAmongCheapest), so where the robot's play was optimal the review
 * shows that same play.
 *
 * `actualLead` ({ suit, card }, optional) is the opening lead made at the
 * table. When it was one of the best leads the line starts with it, so the
 * review never shows a different but equally good lead than the one the
 * players saw.
 *
 * Returns { plays: [{ player, suit, card }] x52, declaringTricks,
 * actualLeadCost } -- actualLeadCost is the tricks the actual lead cost the
 * defence (0 when the line starts with it), or null without an actual lead.
 */
async function optimalLine({ hands, trump, declarer, leader, auction, actualLead }) {
  const mod = await loadModule();
  const request = {
    dealstr: formatDealString(hands),
    trump: trump ? SUIT_TO_LETTER[trump] : 'N',
    declarer: POSITION_TO_LETTER[declarer],
    leader: POSITION_TO_LETTER[leader]
  };

  const remaining = {};
  for (const position of SEAT_ORDER) {
    remaining[position] = {};
    for (const suit of SUITS) remaining[position][suit] = (hands[position][suit] || []).slice();
  }

  const analyzer = new mod.Analyzer();
  try {
    const codes = [];
    const plays = [];
    let trick = [];
    let mover = leader;
    let actualLeadCost = null;

    for (let i = 0; i < 52; i++) {
      const legalCards = legalCardsFor(remaining, mover, trick);
      const pool = nodeAlternatives(analyzer, request, codes, legalCards);
      if (pool.length === 0) throw new Error(`Solver gave no alternatives at card ${i + 1}`);

      let chosen = null;
      if (i === 0 && actualLead) {
        const actual = pool.find(a => a.card === cardToPBN(actualLead.suit, actualLead.card));
        if (actual) {
          actualLeadCost = actual.cost;
          if (actual.cost === Math.min(...pool.map(a => a.cost))) chosen = actual;
        }
      }
      if (!chosen) {
        const leadContext = i === 0
          ? { hand: hands[leader], trump: trump || null, auction: auction || [], leader }
          : null;
        chosen = pickAmongCheapest(pool, leadContext);
      }

      const card = pbnToCard(chosen.card);
      const play = { player: mover, suit: card.suit, card: card.card };
      codes.push(chosen.card);
      plays.push(play);
      const suitCards = remaining[mover][card.suit];
      suitCards.splice(suitCards.indexOf(card.card), 1);

      trick.push(play);
      if (trick.length === 4) {
        mover = DdReview.trickWinner(trick, trump || null);
        trick = [];
      } else {
        mover = SEAT_ORDER[(SEAT_ORDER.indexOf(mover) + 1) % 4];
      }
    }

    const tricks = DdReview.buildTricks(plays, trump || null, declarer);
    return { plays, declaringTricks: tricks[tricks.length - 1].declarerTricks, actualLeadCost };
  } finally {
    // Not followed by release_memory(): in testing (v2.0.0, Node) it panicked
    // inside dlmalloc ("psize <= size + max_overhead") and left the shared
    // module unusable, which would also break robot card play.
    analyzer.free();
  }
}

module.exports = { formatDealString, solveContract, bestCard, optimalLine };
