/**
 * PBN (Portable Bridge Notation) for deal sets and saved deals, see jaot.html.
 *
 * parsePbn() reads only what a new playing of a deal needs: the hands, the
 * dealer, the vulnerability and the board number. Auctions, play, contracts
 * and results in the file are skipped on purpose -- an imported deal always
 * starts from a fresh auction ("clean slate"). formatPbn() writes the full
 * record of a played deal, auction and play included.
 */

const { POSITIONS, SUITS, parseDealString, formatDealString, rankToCode } = require('./deal');

const MAX_DEALS = 200;

// Standard duplicate cycle of 16 boards, indexed by board number.
const VULNERABILITY_CYCLE = [
  'None', 'NS', 'EW', 'Both', 'NS', 'EW', 'Both', 'None',
  'EW', 'Both', 'None', 'NS', 'Both', 'None', 'NS', 'EW'
];

const LETTER_TO_POSITION = { N: 'north', E: 'east', S: 'south', W: 'west' };
const POSITION_TO_LETTER = { north: 'N', east: 'E', south: 'S', west: 'W' };
const SUIT_LETTERS = { spades: 'S', hearts: 'H', diamonds: 'D', clubs: 'C' };

// Tags that describe how the deal was played somewhere else. Their presence
// is reported (the creator is told they are ignored), never used.
const PLAYED_TAGS = ['Auction', 'Play', 'Contract', 'Declarer', 'Result'];

function boardIndex(board) {
  return Number.isInteger(board) && board > 0 ? board : 1;
}

function vulnerabilityForBoard(board) {
  return VULNERABILITY_CYCLE[(boardIndex(board) - 1) % 16];
}

/** Board 1 = North, 2 = East, 3 = South, 4 = West, then again. */
function dealerForBoard(board) {
  return POSITIONS[(boardIndex(board) - 1) % 4];
}

/** PBN vulnerability spellings -> 'None'/'NS'/'EW'/'Both', or null. */
function normalizeVulnerable(value) {
  const v = String(value || '').trim().toLowerCase();
  if (['none', 'love', '-'].includes(v)) return 'None';
  if (v === 'ns') return 'NS';
  if (v === 'ew') return 'EW';
  if (['all', 'both'].includes(v)) return 'Both';
  return null;
}

function normalizeDealer(value) {
  return LETTER_TO_POSITION[String(value || '').trim().toUpperCase()] || null;
}

/**
 * Splits PBN text into games: arrays of { name, value } tags. Commentary
 * ({...} blocks, lines starting with ';' or '%') and the data lines of
 * sections such as Auction, Play or OptimumResultTable are dropped. A game
 * ends at an empty line, or when one of its identifying tags appears again
 * (files without blank lines between deals). Note tags repeat within a game
 * and never end it.
 */
const GAME_START_TAGS = ['Event', 'Site', 'Date', 'Board', 'Deal'];

function readGames(text) {
  const withoutComments = text.replace(/\{[^}]*\}/g, ' ');
  const games = [];
  let current = null;
  const finish = () => {
    if (current && current.length > 0) games.push(current);
    current = null;
  };

  for (const rawLine of withoutComments.split(/\r\n|\r|\n/)) {
    const line = rawLine.trim();
    if (line === '') {
      finish();
      continue;
    }
    if (line.startsWith(';') || line.startsWith('%')) continue;

    const tagPattern = /\[\s*([A-Za-z0-9_]+)\s+"((?:[^"\\]|\\.)*)"\s*\]/g;
    let match;
    while ((match = tagPattern.exec(line)) !== null) {
      const name = match[1];
      const value = match[2].replace(/\\(.)/g, '$1');
      if (current && GAME_START_TAGS.includes(name) && current.some(tag => tag.name === name)) finish();
      if (!current) current = [];
      current.push({ name, value });
    }
    // Anything else on the line is section data (calls, cards, tables).
  }
  finish();
  return games;
}

/**
 * Reads a deal set. Returns
 *   { deals: [{ board, dealer, vulnerable, hands }],
 *     skipped: [{ board, reason }],
 *     truncated: boolean,      // more than maxDeals valid deals
 *     hadPlayedDeals: boolean } // the file had auctions/play/results (ignored)
 * A file without any tags is read as plain deal lines ("N:AKQ.... ...").
 */
function parsePbn(text, { maxDeals = MAX_DEALS } = {}) {
  const result = { deals: [], skipped: [], truncated: false, hadPlayedDeals: false };
  const source = String(text || '');

  const accept = (board, dealer, vulnerable, dealString) => {
    let hands;
    try {
      hands = parseDealString(dealString);
    } catch (error) {
      result.skipped.push({ board, reason: error.message });
      return true;
    }
    if (result.deals.length >= maxDeals) {
      result.truncated = true;
      return false;
    }
    result.deals.push({ board, dealer, vulnerable, hands });
    return true;
  };

  const games = readGames(source);

  if (games.length === 0) {
    // Plain deal lines, one deal per line.
    let ordinal = 0;
    for (const rawLine of source.split(/\r\n|\r|\n/)) {
      const line = rawLine.trim();
      if (!/^[NESW]\s*:/i.test(line)) continue;
      ordinal++;
      if (!accept(ordinal, dealerForBoard(ordinal), vulnerabilityForBoard(ordinal), line)) break;
    }
    return result;
  }

  let previous = {};
  let ordinal = 0;
  for (const tags of games) {
    // "#" means "same as in the previous game".
    const values = {};
    for (const { name, value } of tags) {
      values[name] = value.trim() === '#' && previous[name] !== undefined ? previous[name] : value;
    }
    previous = { ...previous, ...values };

    const hasDeal = values.Deal !== undefined;
    const hasBoard = values.Board !== undefined;
    if (!hasDeal && !hasBoard) continue; // a header or note without a deal
    ordinal++;

    const boardNumber = parseInt(values.Board, 10);
    const board = Number.isInteger(boardNumber) && boardNumber > 0 ? boardNumber : ordinal;
    if (!hasDeal) {
      result.skipped.push({ board, reason: 'no Deal tag' });
      continue;
    }
    if (PLAYED_TAGS.some(name => values[name] !== undefined && values[name].trim() !== '')) {
      result.hadPlayedDeals = true;
    }

    const dealer = normalizeDealer(values.Dealer) || dealerForBoard(board);
    const vulnerable = normalizeVulnerable(values.Vulnerable) || vulnerabilityForBoard(board);
    if (!accept(board, dealer, vulnerable, values.Deal)) break;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Writing

function escapeValue(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"');
}

/** Internal call ('P', '1N', 'X', '4S') -> PBN call ('Pass', '1NT', 'X', '4S'). */
function formatCall(bid) {
  if (bid === 'P') return 'Pass';
  if (bid === 'X' || bid === 'XX') return bid;
  return bid.replace(/^([1-7])N$/, '$1NT');
}

/** Internal contract ('3N', '4SX') -> PBN contract ('3NT', '4SX'). */
function formatContract(contract) {
  if (!contract) return '';
  return contract.replace(/^([1-7])N/, '$1NT');
}

function formatCard(card) {
  return `${SUIT_LETTERS[card.suit]}${rankToCode(card.card)}`;
}

function pbnDate(date) {
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())}`;
}

/**
 * Play section: one line per trick, columns always in seat order starting
 * from the opening leader (PBN standard), not in the order the cards fell.
 */
function formatPlay(playedCards, openingLeader) {
  const start = POSITIONS.indexOf(openingLeader);
  const columns = [0, 1, 2, 3].map(i => POSITIONS[(start + i) % 4]);
  const lines = [];
  for (let i = 0; i < playedCards.length; i += 4) {
    const trick = playedCards.slice(i, i + 4);
    lines.push(columns.map(seat => {
      const card = trick.find(c => c.player === seat);
      return card ? formatCard(card) : '-';
    }).join(' '));
  }
  return lines;
}

/**
 * One played deal as PBN text. `record`:
 *   { event, site, date (Date), board, dealer, vulnerable, hands,
 *     players: { north: 'Anna', ... }, auction: [{ player, bid }] or null,
 *     contract, declarer, declarerTricks, playedCards: [{ player, suit, card }],
 *     openingLeader }
 */
function formatPbn(record) {
  const lines = [];
  const tag = (name, value) => lines.push(`[${name} "${escapeValue(value)}"]`);
  const players = record.players || {};

  tag('Event', record.event || '');
  tag('Site', record.site || '');
  tag('Date', pbnDate(record.date || new Date()));
  tag('Board', record.board);
  tag('West', players.west || '');
  tag('North', players.north || '');
  tag('East', players.east || '');
  tag('South', players.south || '');
  tag('Dealer', POSITION_TO_LETTER[record.dealer] || '');
  tag('Vulnerable', record.vulnerable || 'None');
  tag('Deal', formatDealString(record.hands));
  tag('Declarer', POSITION_TO_LETTER[record.declarer] || '');
  tag('Contract', formatContract(record.contract));
  tag('Result', record.contract && Number.isInteger(record.declarerTricks) ? record.declarerTricks : '');

  if (Array.isArray(record.auction) && record.auction.length > 0) {
    tag('Auction', POSITION_TO_LETTER[record.dealer] || 'N');
    const calls = record.auction.map(b => formatCall(b.bid));
    for (let i = 0; i < calls.length; i += 4) lines.push(calls.slice(i, i + 4).join(' '));
  }

  if (Array.isArray(record.playedCards) && record.playedCards.length > 0 && record.openingLeader) {
    tag('Play', POSITION_TO_LETTER[record.openingLeader]);
    lines.push(...formatPlay(record.playedCards, record.openingLeader));
  }

  return lines.join('\r\n') + '\r\n';
}

module.exports = {
  MAX_DEALS,
  VULNERABILITY_CYCLE,
  vulnerabilityForBoard,
  dealerForBoard,
  normalizeVulnerable,
  parsePbn,
  formatPbn,
  formatCall,
  formatContract,
  SUITS
};
