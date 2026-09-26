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

const VENDOR_DIR = path.join(__dirname, 'vendor', 'bridge-solver-wasm');

const SUIT_TO_LETTER = { spades: 'S', hearts: 'H', diamonds: 'D', clubs: 'C' };
const LETTER_TO_SUIT = { S: 'spades', H: 'hearts', D: 'diamonds', C: 'clubs' };
const POSITION_TO_LETTER = { north: 'N', east: 'E', south: 'S', west: 'W' };

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

/**
 * Best legal card for the player on turn (tricks 1-13, opening lead included).
 *
 * `playedCards` is the full play history of this deal so far, in play order:
 * [{ suit, card }, ...] (server's internal suit/rank names).
 * `legalCards` is the list of { suit, card } the mover may legally play
 * (already filtered by the caller for follow-suit).
 *
 * Returns { suit, card, tricks, cost } or null if the solver could not
 * produce a usable answer (caller should fall back to a simple rule).
 */
async function bestCard({ hands, trump, declarer, leader, playedCards, legalCards }) {
  if (!legalCards || legalCards.length === 0) return null;

  const mod = await loadModule();
  const dealstr = formatDealString(hands);
  const trumpLetter = trump ? SUIT_TO_LETTER[trump] : 'N';

  const plays = playedCards.map(pc => cardToPBN(pc.suit, pc.card));
  const placeholder = cardToPBN(legalCards[0].suit, legalCards[0].card);
  const request = {
    dealstr,
    trump: trumpLetter,
    declarer: POSITION_TO_LETTER[declarer],
    leader: POSITION_TO_LETTER[leader],
    plays: [...plays, placeholder]
  };

  const analyzer = new mod.Analyzer();
  try {
    const raw = analyzer.dd_play_node(JSON.stringify(request), plays.length);
    const result = JSON.parse(raw);
    const alternatives = result.alternatives || [];
    if (alternatives.length === 0) return null;

    const legalSet = new Set(legalCards.map(c => cardToPBN(c.suit, c.card)));
    const legalAlternatives = alternatives.filter(a => legalSet.has(a.card));
    const pool = legalAlternatives.length > 0 ? legalAlternatives : alternatives;

    let best = pool[0];
    for (const alt of pool) {
      if (alt.cost < best.cost) best = alt;
    }

    const card = pbnToCard(best.card);
    return { suit: card.suit, card: card.card, tricks: best.tricks, cost: best.cost };
  } finally {
    analyzer.free();
  }
}

module.exports = { formatDealString, solveContract, bestCard };
