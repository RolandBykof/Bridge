/**
 * BridgeCircle - Enhanced Server Code with Advanced GIB AI
 * Features: Opening Lead Tables, Bidding Conventions, Dummy Play Analysis,
 * Monte Carlo Simulation, Squeeze Play Recognition, Enhanced Card Play Logic
 */

require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');
const cors = require('cors');
const fs = require('fs');
const gibClient = require('./lib/gib_client_module.js');

// Initialize Express app and server
const app = express();
const server = http.createServer(app);
const io = socketIO(server);

// Server state
const tables = new Map(); // Active tables by code
const players = new Map(); // Players by Socket ID

// Constants
const CARD_SUITS = ["spades", "hearts", "diamonds", "clubs"];
const CARD_VALUES = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
const MAX_IDLE_TIME = 3600000; // 1 hour in milliseconds

// Advanced GIB AI Constants and Data Structures

// Opening Lead Tables
const OPENING_LEAD_TABLES = {
  // Against No Trump contracts
  NT: {
    // Lead longest and strongest suit
    priorities: ['longest_suit', 'strong_sequence', 'partner_bid_suit', 'fourth_highest'],
    sequences: {
      'AKQ': 'A', 'AKJ': 'A', 'AK': 'A',
      'KQJ': 'K', 'KQ10': 'K', 'KQ': 'K',
      'QJ10': 'Q', 'QJ9': 'Q', 'QJ': 'Q',
      'J109': 'J', 'J10': 'J',
      '1098': '10', '109': '10'
    }
  },
  
  // Against suit contracts
  SUIT: {
    priorities: ['trump_lead', 'singleton', 'doubleton', 'partner_suit', 'sequence'],
    trump_situations: {
      'short_trumps': 'lead_trump', // With 1-2 trumps
      'long_trumps': 'avoid_trump'  // With 4+ trumps
    }
  }
};

// Bidding Conventions
const BIDDING_CONVENTIONS = {
  // Stayman Convention
  STAYMAN: {
    inquiry: '2C',
    responses: {
      'no_major': '2D',
      'hearts': '2H', 
      'spades': '2S',
      'both_majors': '2H' // Bid hearts first
    }
  },
  
  // Blackwood Convention
  BLACKWOOD: {
    inquiry: '4N',
    responses: {
      0: '5C', 1: '5D', 2: '5H', 3: '5S', 4: '5N'
    },
    king_inquiry: '5N'
  },
  
  // Jacoby Transfers
  JACOBY_TRANSFERS: {
    '2D': 'hearts', // 2D shows hearts
    '2H': 'spades', // 2H shows spades
    '2S': 'clubs',  // 2S shows clubs
    '2N': 'diamonds' // 2N shows diamonds
  },
  
  // Point ranges for various bids
  POINT_RANGES: {
    '1N': [15, 17],
    '2N': [20, 21],
    '3N': [25, 27],
    'weak_two': [6, 10],
    'strong_two': [22, 40]
  }
};

// Card play analysis patterns
const PLAY_PATTERNS = {
  FINESSE: {
    'AQ_vs_K': 'play_queen_if_low_from_left',
    'AJ_vs_KQ': 'play_jack_if_low_from_left',
    'KJ_vs_AQ': 'play_jack_towards_king'
  },
  
  SQUEEZE_PATTERNS: {
    'simple_squeeze': {
      threats: 2,
      entries: 1,
      timing: 'exact'
    },
    'double_squeeze': {
      threats: 3,
      entries: 2,
      timing: 'flexible'
    }
  },
  
  ENDPLAY_PATTERNS: {
    'throw_in': 'eliminate_safe_exits',
    'strip_squeeze': 'remove_safe_cards_then_squeeze'
  }
};

// Monte Carlo simulation parameters
const MONTE_CARLO = {
  SIMULATIONS: 1000,
  CONFIDENCE_THRESHOLD: 0.7,
  MAX_DEPTH: 13 // Maximum tricks to look ahead
};

// Static files
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(cors());

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    uptime: process.uptime(),
    timestamp: Date.now()
  });
});

// Background processes
setInterval(cleanupProcess, 300000); // Cleanup every 5 minutes

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);
  let playerId = socket.id;
  
  // Create player record
  players.set(playerId, {
    socket,
    table: null,
    name: null,
    position: null,
    connected: Date.now()
  });
  
  // Message handling
  socket.on('getActiveTables', () => {
    sendActiveTables(socket);
  });
  
  socket.on('createTable', (data) => {
    createTable(socket, playerId, data);
  });
  
  socket.on('joinTable', (data) => {
    joinTable(socket, playerId, data);
  });
  
  socket.on('selectPosition', (data) => {
    selectPosition(socket, playerId, data);
  });
  
  socket.on('getTableInfo', (data) => {
    getTableInfo(socket, playerId, data);
  });
  
  socket.on('leaveTable', () => {
    removeFromTable(socket, playerId);
  });
  
  socket.on('startGame', (data) => {
    startGame(socket, playerId, data);
  });
  
  socket.on('sendChatMessage', (data) => {
    sendChatMessage(socket, playerId, data);
  });
  
  socket.on('makeBid', (data) => {
    makeBid(socket, playerId, data);
  });
  
  socket.on('playCard', (data) => {
    playCard(socket, playerId, data);
  });
  
  socket.on('startNewGame', (data) => {
    startNewGame(socket, playerId, data);
  });
  
  socket.on('createSoloGame', (data) => {
    createSoloGame(socket, playerId, data);
  });
  
  socket.on('resetSoloGame', (data) => {
    resetSoloGame(socket, playerId, data);
  });
  
  // Disconnect handling
  socket.on('disconnect', () => {
    console.log('Client disconnected:', playerId);
    handleDisconnect(playerId);
  });
  
  // Error handling
  socket.on('error', (error) => {
    console.error('Socket error:', error);
    handleDisconnect(playerId);
  });
});

/**
 * Advanced GIB AI Helper Functions
 */

/**
 * Calculate High Card Points with adjustments
 * @param {Object} hand - Hand object
 * @param {Object} options - Calculation options
 * @return {number} Adjusted points
 */
function calculateAdvancedPoints(hand, options = {}) {
  const hcp = calculateBasicHCP(hand);
  let adjustedPoints = hcp;
  
  // Distribution points
  for (const suit of CARD_SUITS) {
    const length = hand[suit].length;
    if (length >= 5) {
      adjustedPoints += (length - 4); // Long suit points
    }
    if (length === 0) {
      adjustedPoints += 3; // Void
    } else if (length === 1) {
      adjustedPoints += 2; // Singleton
    } else if (length === 2) {
      adjustedPoints += 1; // Doubleton
    }
  }
  
  // Honor concentration penalties
  for (const suit of CARD_SUITS) {
    const honors = hand[suit].filter(card => ['A', 'K', 'Q', 'J'].includes(card));
    if (honors.length >= 3 && hand[suit].length <= 3) {
      adjustedPoints -= 1; // Honor concentration penalty
    }
  }
  
  return Math.max(0, adjustedPoints);
}

/**
 * Calculate basic High Card Points
 * @param {Object} hand - Hand object
 * @return {number} HCP
 */
function calculateBasicHCP(hand) {
  const pointValues = { 'A': 4, 'K': 3, 'Q': 2, 'J': 1 };
  let total = 0;
  
  for (const suit of CARD_SUITS) {
    for (const card of hand[suit] || []) {
      total += pointValues[card] || 0;
    }
  }
  
  return total;
}

/**
 * Analyze hand shape and patterns
 * @param {Object} hand - Hand object
 * @return {Object} Hand analysis
 */
function analyzeHandShape(hand) {
  const distribution = CARD_SUITS.map(suit => hand[suit].length).sort((a, b) => b - a);
  const pattern = distribution.join('-');
  
  const analysis = {
    distribution,
    pattern,
    isBalanced: isBalancedHand(distribution),
    longestSuit: findLongestSuit(hand),
    shortestSuit: findShortestSuit(hand),
    suitQuality: analyzeSuitQuality(hand),
    voids: CARD_SUITS.filter(suit => hand[suit].length === 0),
    singletons: CARD_SUITS.filter(suit => hand[suit].length === 1),
    doubletons: CARD_SUITS.filter(suit => hand[suit].length === 2)
  };
  
  return analysis;
}

/**
 * Check if hand is balanced
 * @param {Array} distribution - Distribution array
 * @return {boolean} Is balanced
 */
function isBalancedHand(distribution) {
  const sorted = [...distribution].sort((a, b) => b - a);
  const patterns = [
    [4, 3, 3, 3], [4, 4, 3, 2], [5, 3, 3, 2]
  ];
  
  return patterns.some(pattern => 
    pattern.every((length, i) => length === sorted[i])
  );
}

/**
 * Find longest suit in hand
 * @param {Object} hand - Hand object
 * @return {string} Longest suit
 */
function findLongestSuit(hand) {
  return CARD_SUITS.reduce((longest, suit) =>
    hand[suit].length > hand[longest].length ? suit : longest
  );
}

/**
 * Find shortest suit in hand
 * @param {Object} hand - Hand object
 * @return {string} Shortest suit
 */
function findShortestSuit(hand) {
  return CARD_SUITS.reduce((shortest, suit) =>
    hand[suit].length < hand[shortest].length ? suit : shortest
  );
}

/**
 * Analyze suit quality (honors, sequences, etc.)
 * @param {Object} hand - Hand object
 * @return {Object} Suit quality analysis
 */
function analyzeSuitQuality(hand) {
  const suitAnalysis = {};
  
  for (const suit of CARD_SUITS) {
    const cards = hand[suit];
    const honors = cards.filter(card => ['A', 'K', 'Q', 'J', '10'].includes(card));
    const sequences = findSequences(cards);
    
    suitAnalysis[suit] = {
      length: cards.length,
      honors: honors.length,
      topHonors: cards.filter(card => ['A', 'K', 'Q'].includes(card)).length,
      sequences,
      quality: calculateSuitQuality(cards),
      biddable: isSuitBiddable(cards)
    };
  }
  
  return suitAnalysis;
}

/**
 * Find sequences in a suit
 * @param {Array} cards - Cards in suit
 * @return {Array} Found sequences
 */
function findSequences(cards) {
  const values = ['A', 'K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4', '3', '2'];
  const indices = cards.map(card => values.indexOf(card)).sort((a, b) => a - b);
  
  const sequences = [];
  let currentSeq = [indices[0]];
  
  for (let i = 1; i < indices.length; i++) {
    if (indices[i] === indices[i-1] + 1) {
      currentSeq.push(indices[i]);
    } else {
      if (currentSeq.length >= 2) {
        sequences.push(currentSeq.map(idx => values[idx]));
      }
      currentSeq = [indices[i]];
    }
  }
  
  if (currentSeq.length >= 2) {
    sequences.push(currentSeq.map(idx => values[idx]));
  }
  
  return sequences;
}

/**
 * Calculate suit quality score
 * @param {Array} cards - Cards in suit
 * @return {number} Quality score
 */
function calculateSuitQuality(cards) {
  let quality = 0;
  const honors = cards.filter(card => ['A', 'K', 'Q', 'J', '10'].includes(card));
  
  // Points for honors
  quality += honors.length * 2;
  
  // Bonus for sequences
  const sequences = findSequences(cards);
  quality += sequences.reduce((sum, seq) => sum + seq.length, 0);
  
  // Bonus for length
  if (cards.length >= 5) quality += cards.length - 4;
  
  return quality;
}

/**
 * Check if suit is biddable
 * @param {Array} cards - Cards in suit
 * @return {boolean} Is biddable
 */
function isSuitBiddable(cards) {
  if (cards.length < 4) return false;
  
  const honors = cards.filter(card => ['A', 'K', 'Q', 'J', '10'].includes(card));
  return honors.length >= 1 || cards.length >= 6;
}

/**
 * Advanced bidding system with conventions
 * @param {Object} table - Table object
 * @param {string} position - Bidder position
 * @param {Array} possibleBids - Available bids
 * @return {string} Calculated bid
 */
function calculateAdvancedBid(table, position, possibleBids) {
  const hand = table.gameState.hands[position];
  const points = calculateAdvancedPoints(hand);
  const shape = analyzeHandShape(hand);
  const bidHistory = table.biddingState.bidHistory;
  const partnerPosition = getPartnerPosition(position);
  const partnerBids = bidHistory.filter(bid => bid.player === partnerPosition);
  const opponentBids = bidHistory.filter(bid => 
    bid.player !== position && bid.player !== partnerPosition
  );
  
  // Check for conventional responses first
  const conventionalBid = checkBiddingConventions(
    table, position, hand, points, shape, bidHistory, possibleBids
  );
  
  if (conventionalBid && possibleBids.includes(conventionalBid)) {
    return conventionalBid;
  }
  
  // Opening bid logic
  if (bidHistory.length === 0 || bidHistory.every(bid => bid.bid === 'P')) {
    return calculateOpeningBid(hand, points, shape, possibleBids);
  }
  
  // Response to partner's opening
  if (partnerBids.length > 0 && partnerBids[partnerBids.length - 1].bid !== 'P') {
    return calculateResponseBid(hand, points, shape, partnerBids, possibleBids);
  }
  
  // Overcall logic
  if (opponentBids.length > 0) {
    return calculateOvercallBid(hand, points, shape, opponentBids, possibleBids);
  }
  
  // Default to pass
  return 'P';
}

/**
 * Check for bidding conventions
 */
function checkBiddingConventions(table, position, hand, points, shape, bidHistory, possibleBids) {
  const partnerBids = bidHistory.filter(bid => bid.player === getPartnerPosition(position));
  
  if (partnerBids.length === 0) return null;
  
  const lastPartnerBid = partnerBids[partnerBids.length - 1].bid;
  
  // Stayman responses
  if (lastPartnerBid === '1N' && possibleBids.includes('2C')) {
    const hasHonorsInMajor = 
      (hand.hearts.filter(c => ['A', 'K', 'Q', 'J'].includes(c)).length >= 1 && hand.hearts.length >= 4) ||
      (hand.spades.filter(c => ['A', 'K', 'Q', 'J'].includes(c)).length >= 1 && hand.spades.length >= 4);
    
    if (hasHonorsInMajor && points >= 8) {
      return '2C'; // Stayman
    }
  }
  
  // Stayman responses from opener
  if (lastPartnerBid === '2C' && bidHistory.some(bid => bid.player === position && bid.bid === '1N')) {
    if (hand.spades.length >= 4) return possibleBids.includes('2S') ? '2S' : '2D';
    if (hand.hearts.length >= 4) return possibleBids.includes('2H') ? '2H' : '2D';
    return possibleBids.includes('2D') ? '2D' : 'P';
  }
  
  // Jacoby Transfer responses
  if (lastPartnerBid === '1N') {
    if (hand.hearts.length >= 5 && points >= 6 && possibleBids.includes('2D')) {
      return '2D'; // Transfer to hearts
    }
    if (hand.spades.length >= 5 && points >= 6 && possibleBids.includes('2H')) {
      return '2H'; // Transfer to spades
    }
  }
  
  // Blackwood inquiry
  if (points >= 16 && shape.longestSuit !== 'notrump' && 
      hand[shape.longestSuit].length >= 8 && possibleBids.includes('4N')) {
    const suitGame = `4${getSuitSymbol(shape.longestSuit)}`;
    if (table.biddingState.highestBid && 
        compareBids(table.biddingState.highestBid, suitGame) >= 0) {
      return '4N'; // Blackwood
    }
  }
  
  return null;
}

/**
 * Calculate opening bid
 */
function calculateOpeningBid(hand, points, shape, possibleBids) {
  // 1NT opening
  if (shape.isBalanced && points >= 15 && points <= 17 && possibleBids.includes('1N')) {
    return '1N';
  }
  
  // 2NT opening
  if (shape.isBalanced && points >= 20 && points <= 21 && possibleBids.includes('2N')) {
    return '2N';
  }
  
  // Strong 2C opening
  if (points >= 22 && possibleBids.includes('2C')) {
    return '2C';
  }
  
  // Weak two bids
  if (points >= 6 && points <= 10) {
    for (const suit of ['spades', 'hearts', 'diamonds']) {
      if (hand[suit].length === 6 && shape.suitQuality[suit].quality >= 6) {
        const bid = `2${getSuitSymbol(suit)}`;
        if (possibleBids.includes(bid)) return bid;
      }
    }
  }
  
  // Standard opening bids (1-level)
  if (points >= 12) {
    // Longest suit first, but prefer majors
    const biddableSuits = CARD_SUITS
      .filter(suit => shape.suitQuality[suit].biddable)
      .sort((a, b) => {
        // Prefer longer suits
        if (hand[b].length !== hand[a].length) {
          return hand[b].length - hand[a].length;
        }
        // Prefer higher suits if same length
        return CARD_SUITS.indexOf(a) - CARD_SUITS.indexOf(b);
      });
    
    for (const suit of biddableSuits) {
      const bid = `1${getSuitSymbol(suit)}`;
      if (possibleBids.includes(bid)) return bid;
    }
    
    // Default to 1C if nothing else works
    if (possibleBids.includes('1C')) return '1C';
  }
  
  return 'P';
}

/**
 * Calculate response bid to partner's opening
 */
function calculateResponseBid(hand, points, shape, partnerBids, possibleBids) {
  const partnerOpening = partnerBids[0].bid;
  
  // Response to 1NT
  if (partnerOpening === '1N') {
    if (points >= 10) {
      // Game forcing
      if (shape.isBalanced && possibleBids.includes('3N')) return '3N';
      
      // Major suit game
      if (hand.spades.length >= 5 && possibleBids.includes('4S')) return '4S';
      if (hand.hearts.length >= 5 && possibleBids.includes('4H')) return '4H';
    }
    
    // Invitational
    if (points >= 8 && shape.isBalanced && possibleBids.includes('2N')) {
      return '2N';
    }
  }
  
  // Response to suit openings
  if (['1C', '1D', '1H', '1S'].includes(partnerOpening)) {
    const openingSuit = getSuitFromSymbol(partnerOpening.charAt(1));
    
    // Major suit support
    if (['hearts', 'spades'].includes(openingSuit) && hand[openingSuit].length >= 3) {
      if (points >= 6 && points <= 9) {
        const bid = `2${getSuitSymbol(openingSuit)}`;
        if (possibleBids.includes(bid)) return bid;
      }
      if (points >= 10 && points <= 12) {
        const bid = `3${getSuitSymbol(openingSuit)}`;
        if (possibleBids.includes(bid)) return bid;
      }
      if (points >= 13) {
        const bid = `4${getSuitSymbol(openingSuit)}`;
        if (possibleBids.includes(bid)) return bid;
      }
    }
    
    // New suit bid
    if (points >= 6) {
      const biddableSuits = CARD_SUITS
        .filter(suit => suit !== openingSuit && shape.suitQuality[suit].biddable)
        .sort((a, b) => hand[b].length - hand[a].length);
      
      for (const suit of biddableSuits) {
        const bid = `1${getSuitSymbol(suit)}`;
        if (possibleBids.includes(bid)) return bid;
      }
    }
  }
  
  return 'P';
}

/**
 * Calculate overcall bid
 */
function calculateOvercallBid(hand, points, shape, opponentBids, possibleBids) {
  // Simple overcall logic
  if (points >= 8 && points <= 16) {
    const longestSuit = shape.longestSuit;
    if (hand[longestSuit].length >= 5 && shape.suitQuality[longestSuit].quality >= 6) {
      const bid = `1${getSuitSymbol(longestSuit)}`;
      if (possibleBids.includes(bid)) return bid;
    }
  }
  
  // 1NT overcall
  if (shape.isBalanced && points >= 15 && points <= 18 && possibleBids.includes('1N')) {
    return '1N';
  }
  
  return 'P';
}

/**
 * Get partner position
 * @param {string} position - Player position
 * @return {string} Partner position
 */
function getPartnerPosition(position) {
  const partnerships = {
    'north': 'south',
    'south': 'north', 
    'east': 'west',
    'west': 'east'
  };
  return partnerships[position];
}

/**
 * Get suit symbol for bidding
 * @param {string} suit - Suit name
 * @return {string} Suit symbol
 */
function getSuitSymbol(suit) {
  const symbols = {
    'clubs': 'C',
    'diamonds': 'D', 
    'hearts': 'H',
    'spades': 'S'
  };
  return symbols[suit] || 'N';
}

/**
 * Get suit from symbol
 * @param {string} symbol - Suit symbol
 * @return {string} Suit name
 */
function getSuitFromSymbol(symbol) {
  const suits = {
    'C': 'clubs',
    'D': 'diamonds',
    'H': 'hearts', 
    'S': 'spades'
  };
  return suits[symbol];
}

/**
 * Compare two bids
 * @param {string} bid1 - First bid
 * @param {string} bid2 - Second bid
 * @return {number} Comparison result (-1, 0, 1)
 */
function compareBids(bid1, bid2) {
  if (bid1 === bid2) return 0;
  
  const suits = ['C', 'D', 'H', 'S', 'N'];
  const level1 = parseInt(bid1.charAt(0));
  const level2 = parseInt(bid2.charAt(0));
  
  if (level1 !== level2) return level1 - level2;
  
  const suit1 = suits.indexOf(bid1.charAt(1));
  const suit2 = suits.indexOf(bid2.charAt(1));
  
  return suit1 - suit2;
}

/**
 * Advanced card play with Monte Carlo simulation
 * @param {Object} table - Table object
 * @param {string} position - Player position
 * @return {Object} Best card to play
 */
function calculateAdvancedCardPlay(table, position) {
  const hand = table.gameState.hands[position];
  const currentTrick = table.gameState.currentTrick;
  const playedCards = table.gameState.playedCards;
  const contract = table.gameState.contract;
  const trumpSuit = table.gameState.trumpSuit;
  const declarer = table.gameState.declarer;
  const dummy = table.gameState.dummy;
  
  // Get legal moves
  const legalMoves = getLegalMoves(hand, currentTrick, trumpSuit);
  
  if (legalMoves.length === 1) {
    return legalMoves[0]; // Only one legal move
  }
  
  // Determine play strategy based on position and phase
  const isOpening = currentTrick.length === 0;
  const isDeclarer = position === declarer;
  const isDummy = position === dummy;
  const isDefender = !isDeclarer && !isDummy;
  
  if (isOpening) {
    return calculateOpeningLead(table, position, legalMoves);
  }
  
  if (isDeclarer || (isDummy && table.gameState.currentPlayer === dummy)) {
    return calculateDeclarerPlay(table, position, legalMoves);
  }
  
  if (isDefender) {
    return calculateDefenderPlay(table, position, legalMoves);
  }
  
  // Fallback to simple strategy
  return legalMoves[Math.floor(Math.random() * legalMoves.length)];
}

/**
 * Calculate opening lead using advanced tables
 * @param {Object} table - Table object
 * @param {string} position - Leader position
 * @param {Array} legalMoves - Legal card plays
 * @return {Object} Best opening lead
 */
function calculateOpeningLead(table, position, legalMoves) {
  const hand = table.gameState.hands[position];
  const contract = table.gameState.contract;
  const isNT = contract && contract.includes('N');
  const trumpSuit = table.gameState.trumpSuit;
  
  const leadTable = isNT ? OPENING_LEAD_TABLES.NT : OPENING_LEAD_TABLES.SUIT;
  
  // Check for sequences
  for (const suit of CARD_SUITS) {
    const suitCards = hand[suit];
    if (suitCards.length === 0) continue;
    
    const sequences = leadTable.sequences || OPENING_LEAD_TABLES.NT.sequences;
    
    for (const [sequence, leadCard] of Object.entries(sequences)) {
      if (hasSequence(suitCards, sequence)) {
        const move = legalMoves.find(m => m.suit === suit && m.card === leadCard);
        if (move) return move;
      }
    }
  }
  
  // Lead longest suit against NT
  if (isNT) {
    const longestSuit = CARD_SUITS.reduce((longest, suit) =>
      hand[suit].length > hand[longest].length ? suit : longest
    );
    
    if (hand[longestSuit].length >= 4) {
      // Fourth highest from longest
      const fourthHighest = hand[longestSuit][3];
      const move = legalMoves.find(m => m.suit === longestSuit && m.card === fourthHighest);
      if (move) return move;
      
      // Or any card from longest suit
      const anyFromLongest = legalMoves.find(m => m.suit === longestSuit);
      if (anyFromLongest) return anyFromLongest;
    }
  }
  
  // Against suit contracts, avoid trump unless short
  if (!isNT && trumpSuit) {
    const trumpLength = hand[trumpSuit].length;
    
    // Lead trump if short (1-2 cards)
    if (trumpLength <= 2 && trumpLength > 0) {
      const trumpMove = legalMoves.find(m => m.suit === trumpSuit);
      if (trumpMove) return trumpMove;
    }
    
    // Lead singleton or doubleton in side suits
    for (const suit of CARD_SUITS) {
      if (suit === trumpSuit) continue;
      
      if (hand[suit].length === 1) {
        const singletonMove = legalMoves.find(m => m.suit === suit);
        if (singletonMove) return singletonMove;
      }
    }
    
    // Lead from doubleton
    for (const suit of CARD_SUITS) {
      if (suit === trumpSuit) continue;
      
      if (hand[suit].length === 2) {
        const doubletonMove = legalMoves.find(m => m.suit === suit);
        if (doubletonMove) return doubletonMove;
      }
    }
  }
  
  // Default: lead from longest side suit
  const sideSuits = CARD_SUITS.filter(suit => suit !== trumpSuit);
  const longestSideSuit = sideSuits.reduce((longest, suit) =>
    hand[suit].length > hand[longest].length ? suit : longest
  );
  
  const defaultMove = legalMoves.find(m => m.suit === longestSideSuit);
  if (defaultMove) return defaultMove;
  
  // Last resort: random legal move
  return legalMoves[Math.floor(Math.random() * legalMoves.length)];
}

/**
 * Check if hand has a specific sequence
 * @param {Array} cards - Cards in suit
 * @param {string} sequence - Sequence to check
 * @return {boolean} Has sequence
 */
function hasSequence(cards, sequence) {
  const cardSet = new Set(cards);
  return sequence.split('').every(card => cardSet.has(card));
}

/**
 * Calculate declarer play with dummy analysis
 * @param {Object} table - Table object
 * @param {string} position - Player position
 * @param {Array} legalMoves - Legal moves
 * @return {Object} Best declarer play
 */
function calculateDeclarerPlay(table, position, legalMoves) {
  const declarerHand = table.gameState.hands[table.gameState.declarer];
  const dummyHand = table.gameState.hands[table.gameState.dummy];
  const contract = table.gameState.contract;
  const tricksNeeded = parseInt(contract.charAt(0)) + 6;
  const currentTricks = table.gameState.tricks;
  const declarerSide = table.gameState.declarer === 'north' || table.gameState.declarer === 'south' ? 'ns' : 'ew';
  
  // Run Monte Carlo simulation for each legal move
  const moveScores = legalMoves.map(move => ({
    move,
    score: runMonteCarloSimulation(table, move, position, MONTE_CARLO.SIMULATIONS)
  }));
  
  // Sort by score and return best move
  moveScores.sort((a, b) => b.score - a.score);
  
  return moveScores[0].move;
}

/**
 * Calculate defender play
 * @param {Object} table - Table object
 * @param {string} position - Player position
 * @param {Array} legalMoves - Legal moves
 * @return {Object} Best defender play
 */
function calculateDefenderPlay(table, position, legalMoves) {
  const currentTrick = table.gameState.currentTrick;
  const contract = table.gameState.contract;
  const tricksNeeded = parseInt(contract.charAt(0)) + 6;
  const trumpSuit = table.gameState.trumpSuit;
  
  // Defensive strategies
  
  // 1. Try to win the trick if possible
  const winningMoves = legalMoves.filter(move => 
    canWinTrick(move, currentTrick, trumpSuit)
  );
  
  if (winningMoves.length > 0) {
    // Choose cheapest winner
    return winningMoves.reduce((cheapest, move) => 
      compareCardValues(move.card, cheapest.card) < 0 ? move : cheapest
    );
  }
  
  // 2. If partner is winning, play low
  if (currentTrick.length > 0) {
    const partnerPosition = getPartnerPosition(position);
    const isPartnerWinning = isPartnerWinningTrick(currentTrick, partnerPosition, trumpSuit);
    
    if (isPartnerWinning) {
      // Play lowest card
      return legalMoves.reduce((lowest, move) => 
        compareCardValues(move.card, lowest.card) < 0 ? move : lowest
      );
    }
  }
  
  // 3. Try to promote partner's honors
  const promotionMove = findPromotionPlay(table, position, legalMoves);
  if (promotionMove) return promotionMove;
  
  // 4. Lead through strength, up to weakness
  const throughStrengthMove = findThroughStrengthPlay(table, position, legalMoves);
  if (throughStrengthMove) return throughStrengthMove;
  
  // Default: play middle card
  const middleIndex = Math.floor(legalMoves.length / 2);
  return legalMoves[middleIndex];
}

/**
 * Run Monte Carlo simulation for a move
 * @param {Object} table - Table object
 * @param {Object} move - Move to evaluate
 * @param {string} position - Player position
 * @param {number} simulations - Number of simulations
 * @return {number} Average score for the move
 */
function runMonteCarloSimulation(table, move, position, simulations) {
  let totalScore = 0;
  
  for (let i = 0; i < simulations; i++) {
    // Create simulation state
    const simState = createSimulationState(table, move, position);
    
    // Play out the rest of the deal
    const result = simulatePlayOut(simState);
    
    // Score based on contract success
    totalScore += scoreSimulationResult(result, table.gameState.contract, table.gameState.declarer);
  }
  
  return totalScore / simulations;
}

/**
 * Create simulation state for Monte Carlo
 * @param {Object} table - Original table
 * @param {Object} move - Move being evaluated
 * @param {string} position - Player position
 * @return {Object} Simulation state
 */
function createSimulationState(table, move, position) {
  // Clone table state
  const simState = JSON.parse(JSON.stringify(table.gameState));
  
  // Apply the move
  simState.currentTrick.push({
    player: position,
    suit: move.suit,
    card: move.card
  });
  
  // Remove card from hand
  const hand = simState.hands[position];
  const cardIndex = hand[move.suit].indexOf(move.card);
  if (cardIndex > -1) {
    hand[move.suit].splice(cardIndex, 1);
  }
  
  // Distribute unknown cards randomly for simulation
  distributeUnknownCards(simState, position);
  
  return simState;
}

/**
 * Simulate playing out the rest of the deal
 * @param {Object} simState - Simulation state
 * @return {Object} Final result
 */
function simulatePlayOut(simState) {
  const maxTricks = 13;
  let tricksPlayed = 0;
  
  // Count tricks already played
  tricksPlayed = Math.floor(simState.playedCards.length / 4);
  
  // Play remaining tricks
  while (tricksPlayed < maxTricks) {
    // Complete current trick if needed
    while (simState.currentTrick.length < 4) {
      const nextPlayer = getNextPlayer(simState.currentTrick[simState.currentTrick.length - 1]?.player || simState.currentPlayer);
      const nextMove = getRandomLegalMove(simState, nextPlayer);
      
      if (!nextMove) break; // No legal moves
      
      simState.currentTrick.push({
        player: nextPlayer,
        suit: nextMove.suit,
        card: nextMove.card
      });
      
      // Remove card from hand
      const hand = simState.hands[nextPlayer];
      const cardIndex = hand[nextMove.suit].indexOf(nextMove.card);
      if (cardIndex > -1) {
        hand[nextMove.suit].splice(cardIndex, 1);
      }
    }
    
    // Determine trick winner
    if (simState.currentTrick.length === 4) {
      const winner = determineTrickWinnerSimulation(simState.currentTrick, simState.trumpSuit);
      
      // Update trick count
      if (winner === 'north' || winner === 'south') {
        simState.tricks.ns++;
      } else {
        simState.tricks.ew++;
      }
      
      // Start new trick
      simState.currentTrick = [];
      simState.currentPlayer = winner;
      tricksPlayed++;
    } else {
      break; // Couldn't complete trick
    }
  }
  
  return simState;
}

/**
 * Get random legal move for simulation
 * @param {Object} simState - Simulation state
 * @param {string} position - Player position
 * @return {Object} Random legal move
 */
function getRandomLegalMove(simState, position) {
  const hand = simState.hands[position];
  const legalMoves = getLegalMoves(hand, simState.currentTrick, simState.trumpSuit);
  
  if (legalMoves.length === 0) return null;
  
  return legalMoves[Math.floor(Math.random() * legalMoves.length)];
}

/**
 * Distribute unknown cards for simulation
 * @param {Object} simState - Simulation state
 * @param {string} knownPosition - Position with known cards
 */
function distributeUnknownCards(simState, knownPosition) {
  // This is a simplified implementation
  // In a real simulation, we'd track which cards are known vs unknown
  // and distribute only the unknown cards randomly among unknown hands
}

/**
 * Score simulation result
 * @param {Object} result - Simulation result
 * @param {string} contract - Contract
 * @param {string} declarer - Declarer position
 * @return {number} Score
 */
function scoreSimulationResult(result, contract, declarer) {
  const tricksNeeded = parseInt(contract.charAt(0)) + 6;
  const declarerSide = declarer === 'north' || declarer === 'south' ? 'ns' : 'ew';
  const tricksMade = result.tricks[declarerSide];
  
  if (tricksMade >= tricksNeeded) {
    return 1 + (tricksMade - tricksNeeded) * 0.1; // Bonus for overtricks
  } else {
    return -(tricksNeeded - tricksMade) * 0.5; // Penalty for going down
  }
}

/**
 * Get legal moves for a position
 * @param {Object} hand - Player's hand
 * @param {Array} currentTrick - Current trick
 * @param {string} trumpSuit - Trump suit
 * @return {Array} Legal moves
 */
function getLegalMoves(hand, currentTrick, trumpSuit) {
  const legalMoves = [];
  
  // If first card of trick, any card is legal
  if (currentTrick.length === 0) {
    for (const suit of CARD_SUITS) {
      for (const card of hand[suit] || []) {
        legalMoves.push({ suit, card });
      }
    }
    return legalMoves;
  }
  
  // Must follow suit if possible
  const leadSuit = currentTrick[0].suit;
  if (hand[leadSuit] && hand[leadSuit].length > 0) {
    for (const card of hand[leadSuit]) {
      legalMoves.push({ suit: leadSuit, card });
    }
    return legalMoves;
  }
  
  // Can't follow suit - any card is legal
  for (const suit of CARD_SUITS) {
    for (const card of hand[suit] || []) {
      legalMoves.push({ suit, card });
    }
  }
  
  return legalMoves;
}

/**
 * Check if a move can win the current trick
 * @param {Object} move - Move to check
 * @param {Array} currentTrick - Current trick
 * @param {string} trumpSuit - Trump suit
 * @return {boolean} Can win trick
 */
function canWinTrick(move, currentTrick, trumpSuit) {
  if (currentTrick.length === 0) return true; // Leading always "wins" initially
  
  const leadSuit = currentTrick[0].suit;
  const highestSoFar = getHighestCard(currentTrick, leadSuit, trumpSuit);
  
  // If playing trump when trump hasn't been played
  if (move.suit === trumpSuit && !currentTrick.some(card => card.suit === trumpSuit)) {
    return true;
  }
  
  // If playing in suit and higher than current highest
  if (move.suit === highestSoFar.suit) {
    return compareCardValues(move.card, highestSoFar.card) > 0;
  }
  
  return false;
}

/**
 * Get highest card in current trick
 * @param {Array} trick - Current trick
 * @param {string} leadSuit - Lead suit
 * @param {string} trumpSuit - Trump suit
 * @return {Object} Highest card
 */
function getHighestCard(trick, leadSuit, trumpSuit) {
  let highest = trick[0];
  
  for (let i = 1; i < trick.length; i++) {
    const card = trick[i];
    
    // Trump beats non-trump
    if (card.suit === trumpSuit && highest.suit !== trumpSuit) {
      highest = card;
    }
    // Higher trump beats lower trump
    else if (card.suit === trumpSuit && highest.suit === trumpSuit) {
      if (compareCardValues(card.card, highest.card) > 0) {
        highest = card;
      }
    }
    // Higher card in lead suit beats lower (if both not trump)
    else if (card.suit === leadSuit && highest.suit === leadSuit) {
      if (compareCardValues(card.card, highest.card) > 0) {
        highest = card;
      }
    }
    // Lead suit beats off-suit (if neither is trump)
    else if (card.suit === leadSuit && highest.suit !== leadSuit && highest.suit !== trumpSuit) {
      highest = card;
    }
  }
  
  return highest;
}

/**
 * Compare card values
 * @param {string} card1 - First card
 * @param {string} card2 - Second card
 * @return {number} Comparison result
 */
function compareCardValues(card1, card2) {
  const values = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
  return values.indexOf(card1) - values.indexOf(card2);
}

/**
 * Check if partner is winning current trick
 * @param {Array} trick - Current trick
 * @param {string} partnerPosition - Partner's position
 * @param {string} trumpSuit - Trump suit
 * @return {boolean} Is partner winning
 */
function isPartnerWinningTrick(trick, partnerPosition, trumpSuit) {
  if (trick.length === 0) return false;
  
  const leadSuit = trick[0].suit;
  const highestCard = getHighestCard(trick, leadSuit, trumpSuit);
  
  return trick.some(card => 
    card.player === partnerPosition && 
    card.suit === highestCard.suit && 
    card.card === highestCard.card
  );
}

/**
 * Find promotion play for partner
 * @param {Object} table - Table object
 * @param {string} position - Player position
 * @param {Array} legalMoves - Legal moves
 * @return {Object|null} Promotion move
 */
function findPromotionPlay(table, position, legalMoves) {
  // This is a simplified implementation
  // In reality, we'd analyze partner's likely holdings and try to promote them
  
  const partnerPosition = getPartnerPosition(position);
  const currentTrick = table.gameState.currentTrick;
  
  if (currentTrick.length === 0) {
    // Leading - try to find a suit where partner might have honors
    for (const move of legalMoves) {
      if (['J', 'Q', 'K'].includes(move.card)) {
        return move; // Lead an honor to potentially promote partner's cards
      }
    }
  }
  
  return null;
}

/**
 * Find through strength play
 * @param {Object} table - Table object
 * @param {string} position - Player position
 * @param {Array} legalMoves - Legal moves
 * @return {Object|null} Through strength move
 */
function findThroughStrengthPlay(table, position, legalMoves) {
  // This is a simplified implementation
  // "Lead through strength, up to weakness" is a defensive principle
  
  return null; // Placeholder for more complex analysis
}

/**
 * Determine trick winner in simulation
 * @param {Array} trick - Completed trick
 * @param {string} trumpSuit - Trump suit
 * @return {string} Winner position
 */
function determineTrickWinnerSimulation(trick, trumpSuit) {
  if (trick.length === 0) return null;
  
  const leadSuit = trick[0].suit;
  const highestCard = getHighestCard(trick, leadSuit, trumpSuit);
  
  return trick.find(card => 
    card.suit === highestCard.suit && 
    card.card === highestCard.card
  ).player;
}

/**
 * Enhanced GIB bid making with real GIB AI
 * @param {Object} table - Table object
 * @param {string} position - GIB position
 */
async function makeAdvancedGIBBid(table, position) {
  try {
    console.log(`Getting GIB bid for ${position}...`);
    
    // Tarkista onko GIB käytössä
    const useGIB = process.env.USE_GIB_DEALER === 'true';
    
    if (useGIB) {
      // Luo rajoitettu pelidata
      const limitedGameState = createLimitedGameStateForGIB(table, position);
      
      console.log(`Sending limited game state to GIB for ${position}`);
      const gibResponse = await gibClient.getRobotMove(limitedGameState);
      
      if (gibResponse && gibResponse.bid) {
        console.log(`GIB ${position} bids: ${gibResponse.bid}`);
        processBid(table, position, gibResponse.bid);
        return;
      } else {
        console.log(`GIB ${position} failed, using fallback bid`);
      }
    }
    
    // Varasuunnitelma: käytä paikallista AI:ta
    const possibleBids = getPossibleBids(table.biddingState.highestBid);
    const calculatedBid = calculateAdvancedBid(table, position, possibleBids);
    
    console.log(`Local AI ${position} bids: ${calculatedBid}`);
    processBid(table, position, calculatedBid);
    
  } catch (error) {
    console.error(`Error getting GIB bid for ${position}:`, error.message);
    
    // Viimeinen varasuunnitelma
    const possibleBids = getPossibleBids(table.biddingState.highestBid);
    const fallbackBid = possibleBids.includes('P') ? 'P' : possibleBids[0];
    console.log(`Using emergency fallback bid: ${fallbackBid}`);
    processBid(table, position, fallbackBid);
  }
}

/**
 * Enhanced GIB card play with real GIB AI
 * @param {Object} table - Table object
 * @param {string} position - GIB position
 */
async function makeAdvancedGIBMove(table, position) {
  try {
    console.log(`Getting GIB move for ${position}...`);
    
    // Tarkista onko GIB käytössä
    const useGIB = process.env.USE_GIB_DEALER === 'true';
    
    if (useGIB) {
      // Luo rajoitettu pelidata
      const limitedGameState = createLimitedGameStateForGIB(table, position);
      
      console.log(`Sending limited game state to GIB for ${position}`);
      const gibResponse = await gibClient.getRobotMove(limitedGameState);
      
      if (gibResponse && gibResponse.suit && gibResponse.card) {
        console.log(`GIB ${position} plays: ${gibResponse.suit} ${gibResponse.card}`);
        
        // Validoi siirto
        if (isValidCardPlay(table, position, gibResponse.suit, gibResponse.card)) {
          processCardPlay(table, position, gibResponse.suit, gibResponse.card);
          return;
        } else {
          console.log(`GIB move invalid, using fallback`);
        }
      } else {
        console.log(`GIB ${position} failed, using fallback move`);
      }
    }
    
    // Varasuunnitelma: käytä paikallista AI:ta
    const fallbackMove = calculateAdvancedCardPlay(table, position);
    if (fallbackMove) {
      console.log(`Local AI ${position} plays: ${fallbackMove.suit} ${fallbackMove.card}`);
      processCardPlay(table, position, fallbackMove.suit, fallbackMove.card);
    } else {
      console.error(`No move available for ${position}`);
    }
    
  } catch (error) {
    console.error(`Error getting GIB move for ${position}:`, error.message);
    
    // Viimeinen varasuunnitelma
    const fallbackMove = calculateSimpleCardPlay(table, position);
    if (fallbackMove) {
      console.log(`Using emergency fallback move: ${fallbackMove.suit} ${fallbackMove.card}`);
      processCardPlay(table, position, fallbackMove.suit, fallbackMove.card);
    } else {
      console.error(`No fallback move available for ${position}`);
    }
  }
}

/**
 * Get vulnerability for position
 * @param {Object} table - Table object
 * @param {string} position - Player position
 * @return {string} Vulnerability (-/N/E/B)
 */
function getVulnerability(table, position) {
  // Simplified vulnerability - you can implement proper vulnerability rotation
  return '-'; // None vulnerable
}

/**
 * Validate if card play is legal
 * @param {Object} table - Table object
 * @param {string} position - Player position  
 * @param {string} suit - Card suit
 * @param {string} card - Card value
 * @return {boolean} Is valid
 */
function isValidCardPlay(table, position, suit, card) {
  const hand = table.gameState.hands[position];
  const currentTrick = table.gameState.currentTrick;
  
  // Check if player has the card
  if (!hand[suit] || !hand[suit].includes(card)) {
    return false;
  }
  
  // If leading, any card is valid
  if (currentTrick.length === 0) {
    return true;
  }
  
  // Must follow suit if possible
  const leadSuit = currentTrick[0].suit;
  if (suit !== leadSuit && hand[leadSuit] && hand[leadSuit].length > 0) {
    return false;
  }
  
  return true;
}

/**
 * Luo GIB:lle rajoitettu pelidata (ei huijausta)
 * @param {Object} table - Table object
 * @param {string} gibPosition - GIB:n positio
 * @return {Object} Rajoitettu pelidata
 */
function createLimitedGameStateForGIB(table, gibPosition) {
  const gameState = {
    position: gibPosition,
    gamePhase: table.gameState ? table.gameState.gamePhase : 'bidding',
    
    // VAIN GIB:n omat kortit
    hands: {
      [gibPosition]: table.gameState.hands[gibPosition]
    },
    
    // Julkiset tiedot
    biddingHistory: table.biddingState ? table.biddingState.bidHistory.map(b => b.bid) : [],
    playedCards: table.gameState ? table.gameState.playedCards : [],
    currentTrick: table.gameState ? table.gameState.currentTrick : [],
    
    // Pelitiedot
    contract: table.gameState ? table.gameState.contract : null,
    declarer: table.gameState ? table.gameState.declarer : null,
    dealer: table.biddingState ? table.biddingState.dealer : 'south',
    vulnerable: getVulnerability(table, gibPosition)
  };
  
  // Dummy näkyy VAIN pelivaiheessa
  if (table.gameState && table.gameState.gamePhase === 'play' && table.gameState.dummy) {
    gameState.hands[table.gameState.dummy] = table.gameState.hands[table.gameState.dummy];
  }
  
  return gameState;
}

/**
 * Simple fallback card play logic
 * @param {Object} table - Table object
 * @param {string} position - Player position
 * @return {Object|null} Card to play
 */
function calculateSimpleCardPlay(table, position) {
  const hand = table.gameState.hands[position];
  const currentTrick = table.gameState.currentTrick;
  const trumpSuit = table.gameState.trumpSuit;
  
  // Get legal moves
  const legalMoves = getLegalMoves(hand, currentTrick, trumpSuit);
  
  if (legalMoves.length === 0) {
    return null;
  }
  
  // If leading, play highest card from longest suit
  if (currentTrick.length === 0) {
    let longestSuit = 'spades';
    let maxLength = 0;
    
    for (const suit of ['spades', 'hearts', 'diamonds', 'clubs']) {
      if (hand[suit] && hand[suit].length > maxLength) {
        longestSuit = suit;
        maxLength = hand[suit].length;
      }
    }
    
    const suitMoves = legalMoves.filter(m => m.suit === longestSuit);
    if (suitMoves.length > 0) {
      // Play highest card
      return suitMoves.reduce((highest, move) => 
        compareCardValues(move.card, highest.card) > 0 ? move : highest
      );
    }
  }
  
  // Otherwise play lowest legal card
  return legalMoves.reduce((lowest, move) => 
    compareCardValues(move.card, lowest.card) < 0 ? move : lowest
  );
}

/**
 * Deal cards using simple dealing
 * @param {Object} table - Table object
 * @return {Object} Dealt hands
 */
async function dealCardsWithGIB(table) {
  try {
    console.log('Dealing cards...');
    return dealCards(); // Use local dealing for now
  } catch (error) {
    console.error('Error dealing cards:', error.message);
    return dealCards(); // Fallback to original function
  }
}

// Original server functions with enhanced GIB integration

/**
 * Handle player disconnection
 * @param {string} playerId - Player's ID
 */
async function handleDisconnect(playerId) {
  const player = players.get(playerId);
  if (!player) return;
  
  // If player was in a table, remove from it
  if (player.table) {
    const table = tables.get(player.table);
    if (table) {
      // If game is in progress, replace player with GIB AI
      if (table.state === 'playing') {
        await replacePlayer(table, player.position);
      } else {
        // Otherwise just remove player from table
        removePlayerFromTable(player, table);
      }
    }
  }
  
  // Remove player
  players.delete(playerId);
}

/**
 * Create a new table
 * @param {Object} socket - Socket.IO socket
 * @param {string} playerId - Player's ID
 * @param {Object} data - Table creation data
 */
function createTable(socket, playerId, data) {
  const { playerName, position } = data;
  
  if (!playerName || !position) {
    sendError(socket, 'Name or position missing');
    return;
  }
  
  const player = players.get(playerId);
  
  // Check if player is already in a table
  if (player.table) {
    sendError(socket, 'You are already in a table');
    return;
  }
  
  // Create table code
  const tableCode = createTableCode();
  
  // Create table object
  const table = {
    code: tableCode,
    players: {
      north: null,
      east: null,
      south: null,
      west: null
    },
    state: 'waiting', // 'waiting', 'playing', 'ended'
    gameState: null,
    biddingState: null,
    created: Date.now(),
    lastActivity: Date.now(),
    creator: playerId,
    isSoloGame: false
  };
  
  // Add player to table
  table.players[position] = {
    name: playerName,
    id: playerId,
    type: 'human'
  };
  
  // Save table and update player info
  tables.set(tableCode, table);
  player.table = tableCode;
  player.name = playerName;
  player.position = position;
  
  // Send successful table creation message
  socket.emit('tableCreated', {
    tableCode,
    table: filterTable(table)
  });
  
  console.log(`Table ${tableCode} created, player ${playerName} (${position})`);
}

/**
 * Join an existing table
 * @param {Object} socket - Socket.IO socket
 * @param {string} playerId - Player's ID
 * @param {Object} data - Table join data
 */
function joinTable(socket, playerId, data) {
  const { playerName, tableCode } = data;
  
  if (!playerName || !tableCode) {
    sendError(socket, 'Name or table code missing');
    return;
  }
  
  const table = tables.get(tableCode);
  if (!table) {
    sendError(socket, 'Table not found');
    return;
  }
  
  if (table.state !== 'waiting') {
    sendError(socket, 'Game is already in progress');
    return;
  }
  
  const player = players.get(playerId);
  
  // Check if player is already in a table
  if (player.table) {
    sendError(socket, 'You are already in a table');
    return;
  }
  
  // Get available positions
  const availablePositions = Object.entries(table.players)
    .filter(([pos, player]) => player === null)
    .map(([pos]) => pos);
    
  if (availablePositions.length === 0) {
    sendError(socket, 'Table is full');
    return;
  }
  
  // Update player info
  player.name = playerName;
  
  // Send available positions
  socket.emit('selectPosition', {
    tableCode,
    positions: availablePositions,
    currentPlayers: filterTablePlayers(table.players)
  });
}

/**
 * Select a position in table
 * @param {Object} socket - Socket.IO socket
 * @param {string} playerId - Player's ID
 * @param {Object} data - Position selection data
 */
function selectPosition(socket, playerId, data) {
  const { tableCode, position, playerName } = data;
  
  if (!tableCode || !position || !playerName) {
    sendError(socket, 'Incomplete information');
    return;
  }
  
  const table = tables.get(tableCode);
  if (!table) {
    sendError(socket, 'Table not found');
    return;
  }
  
  if (table.players[position]) {
    sendError(socket, 'Position is already taken');
    return;
  }
  
  const player = players.get(playerId);
  
  // Add player to table
  table.players[position] = {
    name: playerName,
    id: playerId,
    type: 'human'
  };
  
  // Update player info
  player.table = tableCode;
  player.position = position;
  
  // Notify all players in the table
  sendToTablePlayers(table, {
    type: 'playerJoined',
    position,
    playerName,
    table: filterTable(table)
  });
  
  console.log(`Player ${playerName} joined table ${tableCode} at position ${position}`);
}

/**
 * Get table information
 * @param {Object} socket - Socket.IO socket
 * @param {string} playerId - Player's ID
 * @param {Object} data - Table info request data
 */
function getTableInfo(socket, playerId, data) {
  const { tableCode } = data;
  
  if (!tableCode) {
    sendError(socket, 'Table code missing');
    return;
  }
  
  const table = tables.get(tableCode);
  if (!table) {
    sendError(socket, 'Table not found');
    return;
  }
  
  socket.emit('tableInfo', {
    table: filterTable(table)
  });
}

/**
 * Remove player from table
 * @param {Object} socket - Socket.IO socket
 * @param {string} playerId - Player's ID
 */
function removeFromTable(socket, playerId) {
  const player = players.get(playerId);
  if (!player || !player.table) {
    sendError(socket, 'You are not in any table');
    return;
  }
  
  const table = tables.get(player.table);
  if (!table) {
    // Table not found, clean player info
    player.table = null;
    player.position = null;
    return;
  }
  
  removePlayerFromTable(player, table);
}

/**
 * Remove player from table (helper function)
 * @param {Object} player - Player object
 * @param {Object} table - Table object
 */
async function removePlayerFromTable(player, table) {
  const position = player.position;
  
  // If game is in progress, replace player with GIB
  if (table.state === 'playing') {
    await replacePlayer(table, position);
  } else {
    // Otherwise remove player from table
    table.players[position] = null;
    
    // Notify other players
    sendToTablePlayers(table, {
      type: 'playerLeft',
      position,
      table: filterTable(table)
    });
  }
  
  // Clean player info
  player.table = null;
  player.position = null;
  
  // If table is empty, remove it
  const activePlayers = Object.values(table.players).filter(p => p !== null);
  if (activePlayers.length === 0) {
    tables.delete(table.code);
    console.log(`Table ${table.code} removed (empty)`);
  }
}

/**
 * Replace player with GIB AI
 * @param {Object} table - Table object
 * @param {string} position - Player's position
 */
async function replacePlayer(table, position) {
  const oldName = table.players[position] ? table.players[position].name : null;
  
  // Replace player with GIB
  table.players[position] = {
    name: `GIB ${position}`,
    id: null,
    type: 'gib'
  };
  
  // Notify other players
  sendToTablePlayers(table, {
    type: 'playerReplaced',
    position,
    oldName,
    table: filterTable(table)
  });
  
  // If replaced player was current player, GIB's turn
  if (table.gameState && table.gameState.currentPlayer === position) {
    setTimeout(async () => {
      await makeAdvancedGIBMove(table, position); // Use enhanced GIB
    }, 1500);
  } else if (table.biddingState && table.biddingState.currentBidder === position) {
    setTimeout(async () => {
      await makeAdvancedGIBBid(table, position); // Use enhanced GIB
    }, 1500);
  }
}

/**
 * Start game
 * @param {Object} socket - Socket.IO socket
 * @param {string} playerId - Player's ID
 * @param {Object} data - Game start data
 */
async function startGame(socket, playerId, data) {
  const { tableCode } = data;
  
  if (!tableCode) {
    sendError(socket, 'Table code missing');
    return;
  }
  
  const table = tables.get(tableCode);
  if (!table) {
    sendError(socket, 'Table not found');
    return;
  }
  
  const player = players.get(playerId);
  
  // Check if player has right to start game
  if (!player || player.table !== tableCode) {
    sendError(socket, 'You do not have permission to start the game');
    return;
  }
  
  table.state = 'playing';
  table.lastActivity = Date.now();
  
  // Replace missing players with GIB AI
  for (const position of ['north', 'east', 'south', 'west']) {
    if (!table.players[position]) {
      table.players[position] = {
        name: `GIB ${position}`,
        id: null,
        type: 'gib'
      };
    }
  }
  
  try {
    // Deal cards
    table.gameState = await createGameState(table);
    table.biddingState = createBiddingState(table);
    
    // Send game state to all players
    sendToTablePlayers(table, {
      type: 'gameStarted',
      gameState: filterGameState(table.gameState, null),
      biddingState: table.biddingState,
      players: filterTablePlayers(table.players)
    });
    
    // Send each player their own cards privately
    for (const [position, playerData] of Object.entries(table.players)) {
      if (playerData.type === 'human' && playerData.id) {
        const player = players.get(playerData.id);
        if (player && player.socket) {
          player.socket.emit('yourCards', {
            position,
            cards: table.gameState.hands[position]
          });
        }
      }
    }
    
    console.log(`Game started in table ${tableCode}`);
    
    // If first bidder is GIB, handle GIB's turn
    if (table.players[table.biddingState.currentBidder].type === 'gib') {
      setTimeout(async () => {
        await makeAdvancedGIBBid(table, table.biddingState.currentBidder); // Use enhanced GIB
      }, 1500);
    }
  } catch (error) {
    console.error('Error starting game:', error);
    sendError(socket, 'Error starting game');
    table.state = 'waiting';
  }
}

/**
 * Send chat message
 * @param {Object} socket - Socket.IO socket
 * @param {string} playerId - Player's ID
 * @param {Object} data - Chat message data
 */
function sendChatMessage(socket, playerId, data) {
  const { tableCode, message } = data;
  
  if (!tableCode || !message) {
    return;
  }
  
  const table = tables.get(tableCode);
  if (!table) {
    return;
  }
  
  const player = players.get(playerId);
  if (!player || !player.position) {
    return;
  }
  
  // Send chat message to all players in table
  sendToTablePlayers(table, {
    type: 'chatMessage',
    sender: player.name,
    position: player.position,
    message,
    timestamp: Date.now()
  });
}

/**
 * Make a bid
 * @param {Object} socket - Socket.IO socket
 * @param {string} playerId - Player's ID
 * @param {Object} data - Bid data
 */
function makeBid(socket, playerId, data) {
  const { tableCode, position, bid } = data;
  
  if (!tableCode || !position || !bid) {
    sendError(socket, 'Incomplete bid information');
    return;
  }
  
  const table = tables.get(tableCode);
  if (!table) {
    sendError(socket, 'Table not found');
    return;
  }
  
  if (table.state !== 'playing') {
    sendError(socket, 'Game is not in progress');
    return;
  }
  
  if (!table.biddingState || table.biddingState.biddingComplete) {
    sendError(socket, 'Bidding phase is already complete');
    return;
  }
  
  // Check if it's player's turn
  if (table.biddingState.currentBidder !== position) {
    sendError(socket, 'It is not your turn to bid');
    return;
  }
  
  // Check if this player controls this position
  const player = players.get(playerId);
  if (!player || player.position !== position) {
    sendError(socket, 'You cannot bid from this position');
    return;
  }
  
  // Check if bid is valid
  if (!isBidValid(bid, table.biddingState.highestBid)) {
    sendError(socket, 'Invalid bid');
    return;
  }
  
  // Process bid
  processBid(table, position, bid);
}

/**
 * Process a bid
 * @param {Object} table - Table object
 * @param {string} position - Bidder's position
 * @param {string} bid - The bid made
 */
function processBid(table, position, bid) {
  table.lastActivity = Date.now();
  
  // Add bid to history
  const bidInfo = {
    player: position,
    bid: bid,
    round: table.biddingState.currentRound
  };
  
  table.biddingState.bidHistory.push(bidInfo);
  
  // Update consecutive passes
  if (bid === 'P') {
    table.biddingState.consecutivePasses++;
  } else {
    table.biddingState.consecutivePasses = 0;
    
    // Update highest bid if not pass, double or redouble
    if (!['P', 'X', 'XX'].includes(bid)) {
      table.biddingState.highestBid = bid;
    }
  }
  
  // Check if bidding phase is complete
  if (isBiddingPhaseComplete(table.biddingState)) {
    finalizeBiddingPhase(table);
  } else {
    // Move to next bidder
    moveToNextBidder(table.biddingState);
    
    // Notify all players of bid and new turn
    sendToTablePlayers(table, {
      type: 'bidMade',
      position,
      bid,
      nextBidder: table.biddingState.currentBidder,
      biddingState: table.biddingState
    });
    
    // If next bidder is GIB, make GIB's bid
    if (table.players[table.biddingState.currentBidder].type === 'gib') {
      setTimeout(async () => {
        await makeAdvancedGIBBid(table, table.biddingState.currentBidder); // Use enhanced GIB
      }, 1500);
    }
  }
}

/**
 * Check if bidding phase is complete
 * @param {Object} biddingState - Bidding state
 * @return {boolean} Is bidding phase complete
 */
function isBiddingPhaseComplete(biddingState) {
  const bids = biddingState.bidHistory;
  
  // If four passes at beginning
  if (bids.length >= 4 && 
      bids[0].bid === 'P' && 
      bids[1].bid === 'P' && 
      bids[2].bid === 'P' && 
      bids[3].bid === 'P') {
    return true;
  }
  
  // If three passes after someone has bid
  if (biddingState.consecutivePasses === 3 && bids.length >= 4) {
    // Check that there is at least one non-pass bid
    const hasNonPass = bids.some(b => b.bid !== 'P');
    return hasNonPass;
  }
  
  return false;
}

/**
 * Move to next bidder
 * @param {Object} biddingState - Bidding state
 */
function moveToNextBidder(biddingState) {
  const positions = ['north', 'east', 'south', 'west'];
  const currentIndex = positions.indexOf(biddingState.currentBidder);
  biddingState.currentBidder = positions[(currentIndex + 1) % 4];
}

/**
 * Finalize bidding phase
 * @param {Object} table - Table object
 */
function finalizeBiddingPhase(table) {
  table.biddingState.biddingComplete = true;
  
  // If all passed, no contract
  if (table.biddingState.bidHistory.length === 4 && 
      table.biddingState.bidHistory.every(bid => bid.bid === 'P')) {
    
    // Reset game
    table.gameState.gamePhase = 'setup';
    
    // Notify players
    sendToTablePlayers(table, {
      type: 'allPassed',
      message: "All players passed. Deal again."
    });
    
    table.state = 'waiting';
    return;
  }
  
  // Determine final contract
  determineContract(table);
  
  // Determine declarer and dummy
  determineDeclarerAndDummy(table);
  
  // Set trump suit
  if (table.biddingState.contract.charAt(1) === 'N') {
    table.biddingState.trumpSuit = null; // No trump
  } else {
    switch(table.biddingState.contract.charAt(1)) {
      case 'C': table.biddingState.trumpSuit = 'clubs'; break;
      case 'D': table.biddingState.trumpSuit = 'diamonds'; break;
      case 'H': table.biddingState.trumpSuit = 'hearts'; break;
      case 'S': table.biddingState.trumpSuit = 'spades'; break;
    }
  }
  
  // Move to play phase
  moveToPlayPhase(table);
}

/**
 * Determine the final contract
 * @param {Object} table - Table object
 */
function determineContract(table) {
  // Find highest bid
  let highestBid = null;
  let doubled = false;
  let redoubled = false;
  
  for (const bidInfo of table.biddingState.bidHistory) {
    if (!['P', 'X', 'XX'].includes(bidInfo.bid)) {
      highestBid = bidInfo.bid;
    } else if (bidInfo.bid === 'X' && highestBid) {
      doubled = true;
      redoubled = false;
    } else if (bidInfo.bid === 'XX' && doubled) {
      redoubled = true;
      doubled = false;
    }
  }
  
  if (!highestBid) {
    return null; // All passed
  }
  
  // Form contract
  let contract = highestBid;
  if (doubled) contract += 'X';
  if (redoubled) contract += 'XX';
  
  table.biddingState.contract = contract;
  
  return contract;
}

/**
 * Determine declarer and dummy
 * @param {Object} table - Table object
 */
function determineDeclarerAndDummy(table) {
  const contractSuit = table.biddingState.contract.charAt(1);
  
  // Find partnership that first bid this suit
  const partnerships = {
    'north-south': ['north', 'south'],
    'east-west': ['east', 'west']
  };
  
  let declarerPartnership = null;
  let firstPlayer = null;
  
  for (const bidInfo of table.biddingState.bidHistory) {
    if (bidInfo.bid.charAt(1) === contractSuit && !['P', 'X', 'XX'].includes(bidInfo.bid)) {
      const player = bidInfo.player;
      
      // Determine which partnership this player belongs to
      for (const [partnership, players] of Object.entries(partnerships)) {
        if (players.includes(player)) {
          declarerPartnership = partnership;
          
          // Check if this player was the first to bid this suit
          if (!firstPlayer || !players.includes(firstPlayer)) {
            firstPlayer = player;
          }
          break;
        }
      }
      
      if (declarerPartnership && firstPlayer) {
        break;
      }
    }
  }
  
  // Set declarer and dummy
  if (declarerPartnership && firstPlayer) {
    table.biddingState.declarer = firstPlayer;
    const dummyIndex = (partnerships[declarerPartnership].indexOf(firstPlayer) + 1) % 2;
    table.biddingState.dummy = partnerships[declarerPartnership][dummyIndex];
  } else {
    // Fallback
    table.biddingState.declarer = 'south';
    table.biddingState.dummy = 'north';
  }
}

/**
 * Move to play phase
 * @param {Object} table - Table object
 */
function moveToPlayPhase(table) {
  // Transfer bidding info to game state
  table.gameState.contract = table.biddingState.contract;
  table.gameState.trumpSuit = table.biddingState.trumpSuit;
  table.gameState.declarer = table.biddingState.declarer;
  table.gameState.dummy = table.biddingState.dummy;
  
  // Update game phase
  table.gameState.gamePhase = 'play';

  // Vaihda dummy GIB-ihmispelaajaksi, jos pelinviejä on ihminen ja dummy on GIB
const declarer = table.biddingState.declarer;
const dummy = table.biddingState.dummy;
const declarerPlayer = table.players[declarer];
const dummyPlayer = table.players[dummy];

if (
  declarerPlayer &&
  declarerPlayer.type === 'human' &&
  dummyPlayer &&
  dummyPlayer.type === 'gib'
) {
  // Korvaa dummy GIB ihmisellä
  table.players[dummy] = {
    name: declarerPlayer.name + ' (dummy)',
    id: declarerPlayer.id,
    type: 'human'
  };
  console.log(`Dummy ${dummy} otettiin ihmispelaajan ${declarerPlayer.name} hallintaan`);
}

  // Set first player (left of declarer)
  const positions = ['north', 'east', 'south', 'west'];
  const declarerIndex = positions.indexOf(table.biddingState.declarer);
  table.gameState.currentPlayer = positions[(declarerIndex + 1) % 4];
  table.gameState.leadingPlayer = table.gameState.currentPlayer;
  
  // Notify players
  sendToTablePlayers(table, {
    type: 'biddingComplete',
    contract: table.gameState.contract,
    declarer: table.gameState.declarer,
    dummy: table.gameState.dummy,
    trumpSuit: table.gameState.trumpSuit,
    currentPlayer: table.gameState.currentPlayer,
    gameState: filterGameState(table.gameState, null)
  });
  
  // Send players their cards
  for (const [position, playerData] of Object.entries(table.players)) {
    if (playerData.type === 'human' && playerData.id) {
      const player = players.get(playerData.id);
      if (player && player.socket) {
        player.socket.emit('playPhaseCards', {
          position,
          cards: table.gameState.hands[position],
          // Send dummy's cards to declarer
          dummyCards: position === table.gameState.declarer ? 
                        table.gameState.hands[table.gameState.dummy] : null
        });
      }
    }
  }
  
  // If first player is GIB, make GIB's move
  if (table.players[table.gameState.currentPlayer].type === 'gib') {
    setTimeout(async () => {
      await makeAdvancedGIBMove(table, table.gameState.currentPlayer); // Use enhanced GIB
    }, 1500);
  }
}

/**
 * Play a card
 * @param {Object} socket - Socket.IO socket
 * @param {string} playerId - Player's ID
 * @param {Object} data - Card play data
 */
function playCard(socket, playerId, data) {
  const { tableCode, position, suit, card } = data;
  
  if (!tableCode || !position || !suit || !card) {
    sendError(socket, 'Incomplete information for playing a card');
    return;
  }
  
  const table = tables.get(tableCode);
  if (!table) {
    sendError(socket, 'Table not found');
    return;
  }
  
  if (table.state !== 'playing') {
    sendError(socket, 'Game is not in progress');
    return;
  }
  
  if (!table.biddingState.biddingComplete) {
    sendError(socket, 'Bidding phase is still in progress');
    return;
  }
  
  // Check if it's player's turn
  if (table.gameState.currentPlayer !== position) {
    sendError(socket, 'It is not your turn to play');
    return;
  }
  
  // Check if this player controls this position or player is dummy controller
  const isDummy = position === table.gameState.dummy;
  const isController = isDummy ? 
                    (table.players[table.gameState.declarer].id === playerId) : 
                    (table.players[position].id === playerId);
  
  if (!isController) {
    sendError(socket, 'You cannot play from this position');
    return;
  }
  
  // Check if card is in player's hand
  const hand = table.gameState.hands[position];
  if (!hand[suit] || !hand[suit].includes(card)) {
    sendError(socket, 'You do not have this card');
    return;
  }
  
  // Check following suit
  if (table.gameState.currentTrick.length > 0) {
    const leadingSuit = table.gameState.currentTrick[0].suit;
    if (suit !== leadingSuit && hand[leadingSuit] && hand[leadingSuit].length > 0) {
      sendError(socket, 'You must follow suit');
      return;
    }
  }
  
  // Process card play
  processCardPlay(table, position, suit, card);
}

/**
 * Process card play
 * @param {Object} table - Table object
 * @param {string} position - Player's position
 * @param {string} suit - Card suit
 * @param {string} card - Card value
 */
function processCardPlay(table, position, suit, card) {
  table.lastActivity = Date.now();
  
  // Add card to trick and played cards
  const playedCard = { player: position, suit, card };
  table.gameState.currentTrick.push(playedCard);
  table.gameState.playedCards.push(playedCard);
  
  // Remove card from player's hand
  table.gameState.hands[position][suit] = 
    table.gameState.hands[position][suit].filter(c => c !== card);
  
  // Notify all players
  sendToTablePlayers(table, {
    type: 'cardPlayed',
    position,
    suit,
    card,
    currentTrick: table.gameState.currentTrick
  });
  
  // Check if trick is complete (4 cards)
  if (table.gameState.currentTrick.length === 4) {
    setTimeout(() => {
      processTrick(table);
    }, 1000);
  } else {
    // Move to next player
    table.gameState.currentPlayer = getNextPlayer(table.gameState.currentPlayer);
    
    // Notify about next turn
    sendToTablePlayers(table, {
      type: 'nextPlayer',
      currentPlayer: table.gameState.currentPlayer
    });
    
    // If next player is GIB, make GIB's move
    if (table.players[table.gameState.currentPlayer].type === 'gib') {
      setTimeout(async () => {
        await makeAdvancedGIBMove(table, table.gameState.currentPlayer); // Use enhanced GIB
      }, 1500);
    }
  }
}

/**
 * Make GIB AI bid (deprecated - use makeAdvancedGIBBid)
 * @param {Object} table - Table object
 * @param {string} position - GIB's position
 */
async function makeGIBBid(table, position) {
  await makeAdvancedGIBBid(table, position);
}

/**
 * Make GIB AI move (deprecated - use makeAdvancedGIBMove)
 * @param {Object} table - Table object
 * @param {string} position - GIB's position
 */
async function makeGIBMove(table, position) {
  await makeAdvancedGIBMove(table, position);
}

/**
 * Get possible bids
 * @param {string|null} highestBid - Highest bid so far
 * @return {Array<string>} Possible bids
 */
function getPossibleBids(highestBid) {
  const possibleBids = ['P']; // Pass is always possible
  
  // Double/redouble logic
  if (highestBid) {
    possibleBids.push('X');
  }
  
  // Create normal bids
  const levels = ['1', '2', '3', '4', '5', '6', '7'];
  const suits = ['C', 'D', 'H', 'S', 'N'];
  
  if (!highestBid) {
    // If no previous bids, all bids 1C-7N are possible
    for (const level of levels) {
      for (const suit of suits) {
        possibleBids.push(`${level}${suit}`);
      }
    }
  } else {
    // Create all bids higher than current highest
    const highestLevel = parseInt(highestBid.charAt(0));
    const highestSuit = highestBid.charAt(1);
    const highestSuitIndex = suits.indexOf(highestSuit);
    
    for (let level = highestLevel; level <= 7; level++) {
      for (let suitIndex = 0; suitIndex < suits.length; suitIndex++) {
        if (level === highestLevel && suitIndex <= highestSuitIndex) continue;
        possibleBids.push(`${level}${suits[suitIndex]}`);
      }
    }
  }
  
  return possibleBids;
}

/**
 * Check if bid is valid
 * @param {string} bid - Bid to check
 * @param {string|null} highestBid - Highest bid so far
 * @return {boolean} Is bid valid
 */
function isBidValid(bid, highestBid) {
  // Pass is always valid
  if (bid === 'P') return true;
  
  // Double and Redouble
  if (bid === 'X' || bid === 'XX') return true;
  
  // Regular bid - must be higher than current highest
  if (!highestBid) return true; // First bid is always valid
  
  const bidLevel = parseInt(bid.charAt(0));
  const bidSuit = bid.charAt(1);
  const highestLevel = parseInt(highestBid.charAt(0));
  const highestSuit = highestBid.charAt(1);
  
  const suits = ['C', 'D', 'H', 'S', 'N'];
  const bidSuitIndex = suits.indexOf(bidSuit);
  const highestSuitIndex = suits.indexOf(highestSuit);
  
  if (bidLevel > highestLevel) return true;
  if (bidLevel === highestLevel && bidSuitIndex > highestSuitIndex) return true;
  
  return false;
}

/**
 * Get next player
 * @param {string} currentPlayer - Current player
 * @return {string} Next player
 */
function getNextPlayer(currentPlayer) {
  const positions = ['north', 'east', 'south', 'west'];
  const currentIndex = positions.indexOf(currentPlayer);
  return positions[(currentIndex + 1) % 4];
}

/**
 * Process completed trick
 * @param {Object} table - Table object
 */
async function processTrick(table) {
  // Determine trick winner
  const winner = determineTrickWinner(table);
  
  // Update tricks
  if (winner === 'north' || winner === 'south') {
    table.gameState.tricks.ns += 1;
  } else {
    table.gameState.tricks.ew += 1;
  }
  
  table.gameState.totalTricks += 1;
  
  // Clear current trick
  const completedTrick = [...table.gameState.currentTrick];
  table.gameState.currentTrick = [];
  
  // Set winner as next leader
  table.gameState.leadingPlayer = winner;
  table.gameState.currentPlayer = winner;
  
  // Check if game is over (13 tricks played)
  if (table.gameState.totalTricks >= 13) {
    // Game ends
    endGame(table);
    return;
  }
  
  // Notify about trick winner
  sendToTablePlayers(table, {
    type: 'trickComplete',
    winner,
    trick: completedTrick,
    tricks: table.gameState.tricks,
    nextPlayer: winner
  });
  
  // If next player is GIB, make GIB's move
  if (table.players[table.gameState.currentPlayer].type === 'gib') {
    setTimeout(async () => {
      await makeAdvancedGIBMove(table, table.gameState.currentPlayer); // Use enhanced GIB
    }, 1500);
  }
}

/**
 * Determine trick winner
 * @param {Object} table - Table object
 * @return {string} Winner's position
 */
function determineTrickWinner(table) {
  const values = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
  const leadingSuit = table.gameState.currentTrick[0].suit;
  const trumpSuit = table.gameState.trumpSuit;
  
  let highestCard = table.gameState.currentTrick[0];
  let winnerPlayer = table.gameState.currentTrick[0].player;
  
  for (let i = 1; i < table.gameState.currentTrick.length; i++) {
    const currentCard = table.gameState.currentTrick[i];
    
    // Check if this card is trump when highest is not
    if (trumpSuit && currentCard.suit === trumpSuit && highestCard.suit !== trumpSuit) {
      highestCard = currentCard;
      winnerPlayer = currentCard.player;
    }
    // Check if both cards are trump
    else if (trumpSuit && currentCard.suit === trumpSuit && highestCard.suit === trumpSuit) {
      if (values.indexOf(currentCard.card) > values.indexOf(highestCard.card)) {
        highestCard = currentCard;
        winnerPlayer = currentCard.player;
      }
    }
    // Check if current card is leading suit and highest also
    else if (currentCard.suit === leadingSuit && highestCard.suit === leadingSuit) {
      if (values.indexOf(currentCard.card) > values.indexOf(highestCard.card)) {
        highestCard = currentCard;
        winnerPlayer = currentCard.player;
      }
    }
    // If current card is leading suit but highest is not (and not trump)
    else if (currentCard.suit === leadingSuit && highestCard.suit !== leadingSuit && 
            (!trumpSuit || highestCard.suit !== trumpSuit)) {
      highestCard = currentCard;
      winnerPlayer = currentCard.player;
    }
  }
  
  return winnerPlayer;
}

/**
 * End game
 * @param {Object} table - Table object
 */
function endGame(table) {
  table.gameState.gamePhase = 'end';
  
  // Calculate result based on contract
  let resultMessage = '';
  
  if (table.gameState.contract) {
    const level = parseInt(table.gameState.contract.charAt(0));
    const requiredTricks = level + 6; // Contract level + 6
    
    // Determine if contract was made
    const declarerSide = table.gameState.declarer === 'north' || table.gameState.declarer === 'south' ? 'ns' : 'ew';
    const madeTricts = table.gameState.tricks[declarerSide];
    
    if (madeTricts >= requiredTricks) {
      // Contract made
      resultMessage = `Contract ${formatContract(table.gameState.contract)} made! ${positionName(table.gameState.declarer)}-${positionName(table.gameState.dummy)} got ${madeTricts} tricks.`;
    } else {
      // Contract down
      resultMessage = `Contract ${formatContract(table.gameState.contract)} went down ${requiredTricks - madeTricts} trick(s). ${positionName(table.gameState.declarer)}-${positionName(table.gameState.dummy)} got ${madeTricts} tricks.`;
    }
  } else {
    // No contract - just report tricks
    if (table.gameState.tricks.ns > table.gameState.tricks.ew) {
      resultMessage = `Game over! North-South won ${table.gameState.tricks.ns} tricks vs. ${table.gameState.tricks.ew}.`;
    } else if (table.gameState.tricks.ew > table.gameState.tricks.ns) {
      resultMessage = `Game over! East-West won ${table.gameState.tricks.ew} tricks vs. ${table.gameState.tricks.ns}.`;
    } else {
      resultMessage = `Game over! Tie, both teams got ${table.gameState.tricks.ns} tricks.`;
    }
  }
  
  // Notify players about game end
  sendToTablePlayers(table, {
    type: 'gameOver',
    message: resultMessage,
    tricks: table.gameState.tricks,
    contract: table.gameState.contract
  });
  
  // Reset table for new game
  table.state = 'waiting';
  table.gameState = null;
  table.biddingState = null;
}

/**
 * Start new game
 * @param {Object} socket - Socket.IO socket
 * @param {string} playerId - Player's ID
 * @param {Object} data - New game data
 */
async function startNewGame(socket, playerId, data) {
  const { tableCode } = data;
  
  if (!tableCode) {
    sendError(socket, 'Table code missing');
    return;
  }
  
  const table = tables.get(tableCode);
  if (!table) {
    sendError(socket, 'Table not found');
    return;
  }
  
  const player = players.get(playerId);
  
  // Check if player has right to start game
  if (!player || player.table !== tableCode) {
    sendError(socket, 'You do not have permission to start the game');
    return;
  }
  
  // Start game
  await startGame(socket, playerId, data);
}

/**
 * Create solo game against GIB AI
 * @param {Object} socket - Socket.IO socket
 * @param {string} playerId - Player's ID
 * @param {Object} data - Solo game creation data
 */
async function createSoloGame(socket, playerId, data) {
  const { playerName } = data;
  
  if (!playerName) {
    sendError(socket, 'Player name missing');
    return;
  }
  
  const player = players.get(playerId);
  
  // Check if player is already in a table
  if (player.table) {
    sendError(socket, 'You are already in a table');
    return;
  }
  
  // Create table code
  const tableCode = createTableCode();
  
  // Create table object
  const table = {
    code: tableCode,
    players: {
      north: { name: 'GIB North', id: null, type: 'gib' },
      east: { name: 'GIB East', id: null, type: 'gib' },
      south: { name: playerName, id: playerId, type: 'human' },
      west: { name: 'GIB West', id: null, type: 'gib' }
    },
    state: 'waiting',
    gameState: null,
    biddingState: null,
    created: Date.now(),
    lastActivity: Date.now(),
    creator: playerId,
    isSoloGame: true
  };
  
  // Save table and update player info
  tables.set(tableCode, table);
  player.table = tableCode;
  player.name = playerName;
  player.position = 'south';
  
  // Send successful solo game creation message
  socket.emit('soloGameCreated', {
    tableCode
  });
  
  // Start game immediately
  await startGame(socket, playerId, { tableCode });  
  console.log(`Solo game ${tableCode} created, player ${playerName}`);
}

/**
 * Reset solo game
 * @param {Object} socket - Socket.IO socket
 * @param {string} playerId - Player's ID
 * @param {Object} data - Solo game reset data
 */
async function resetSoloGame(socket, playerId, data) {
  const { tableCode } = data;
  
  if (!tableCode) {
    sendError(socket, 'Table code missing');
    return;
  }
  
  const table = tables.get(tableCode);
  if (!table) {
    sendError(socket, 'Table not found');
    return;
  }
  
  if (!table.isSoloGame) {
    sendError(socket, 'This is not a solo game');
    return;
  }
  
  const player = players.get(playerId);
  
  // Check if player has right to reset game
  if (!player || player.table !== tableCode) {
    sendError(socket, 'You do not have permission to reset the game');
    return;
  }
  
  // Reset table
  table.state = 'waiting';
  table.gameState = null;
  table.biddingState = null;
  table.lastActivity = Date.now();
  
  // Start game again
  await startGame(socket, playerId, { tableCode });
}

/**
 * Send active tables to player
 * @param {Object} socket - Socket.IO socket
 */
function sendActiveTables(socket) {
  const activeTablesInfo = Array.from(tables.entries())
    .filter(([_, table]) => table.state === 'waiting' && !table.isSoloGame)
    .map(([code, table]) => {
      const playerCount = Object.values(table.players).filter(p => p !== null).length;
      return {
        code,
        players: playerCount,
        created: table.created
      };
    });
  
  socket.emit('activeTablesList', { 
    tables: activeTablesInfo 
  });
}

/**
 * Calculate hand points (HCP) - basic version for compatibility
 * @param {Object} hand - Hand object
 * @return {number} Points
 */
function calculatePoints(hand) {
  return calculateBasicHCP(hand);
}

/**
 * Send error message to socket
 * @param {Object} socket - Socket.IO socket
 * @param {string} message - Error message
 */
function sendError(socket, message) {
  socket.emit('error', { message });
}

/**
 * Send message to all players in table
 * @param {Object} table - Table object
 * @param {Object} message - Message to send
 */
function sendToTablePlayers(table, message) {
  for (const playerData of Object.values(table.players)) {
    if (playerData && playerData.id) {
      const player = players.get(playerData.id);
      if (player && player.socket) {
        player.socket.emit(message.type, message);
      }
    }
  }
}

/**
 * Create new table code
 * @return {string} Table code
 */
function createTableCode() {
  // Create 4-digit table code
  let code;
  do {
    code = Math.floor(1000 + Math.random() * 9000).toString();
  } while (tables.has(code));
  
  return code;
}

/**
 * Create new game state (with optional GIB dealing)
 * @param {Object} table - Table object
 * @return {Promise<Object>} Game state object
 */
async function createGameState(table) {
  // Deal cards - try GIB first, fallback to local dealing
  let cards;
  
  try {
    if (process.env.USE_GIB_DEALER === 'true') {
      cards = await dealCardsWithGIB(table);
      console.log('Using GIB-dealt cards');
    } else {
      cards = dealCards();
      console.log('Using locally dealt cards');
    }
  } catch (error) {
    console.error('Error in card dealing:', error);
    cards = dealCards(); // Always fallback to local dealing
  }
  
  return {
    players: table.players,
    currentPlayer: 'south', // South starts in bidding phase
    gamePhase: 'bidding',
    hands: cards,
    playedCards: [],
    currentTrick: [],
    contract: null,
    trumpSuit: null,
    declarer: null,
    dummy: null,
    tricks: { ns: 0, ew: 0 },
    totalTricks: 0,
    leadingPlayer: 'south'
  };
}

/**
 * Create new bidding state
 * @param {Object} table - Table object
 * @return {Object} Bidding state object
 */
function createBiddingState(table) {
  return {
    currentBidder: 'south',
    bidHistory: [],
    currentRound: 1,
    consecutivePasses: 0,
    biddingComplete: false,
    highestBid: null,
    contract: null,
    declarer: null,
    dummy: null,
    trumpSuit: null,
    dealer: 'south'
  };
}

/**
 * Deal cards
 * @return {Object} Hands object
 */
function dealCards() {
  // Create deck
  const deck = [];
  const suits = ['spades', 'hearts', 'diamonds', 'clubs'];
  const values = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
  
  for (const suit of suits) {
    for (const value of values) {
      deck.push({ suit, value });
    }
  }
  
  // Shuffle deck
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  
  // Deal cards
  const hands = {
    north: { spades: [], hearts: [], diamonds: [], clubs: [] },
    east: { spades: [], hearts: [], diamonds: [], clubs: [] },
    south: { spades: [], hearts: [], diamonds: [], clubs: [] },
    west: { spades: [], hearts: [], diamonds: [], clubs: [] }
  };
  
  const positions = ['north', 'east', 'south', 'west'];
  for (let i = 0; i < deck.length; i++) {
    const position = positions[Math.floor(i / 13)];
    const card = deck[i];
    hands[position][card.suit].push(card.value);
  }
  
  // Sort cards
  for (const position of positions) {
    for (const suit of suits) {
      hands[position][suit].sort((a, b) => values.indexOf(b) - values.indexOf(a));
    }
  }
  
  return hands;
}

/**
 * Filter table for client
 * @param {Object} table - Table object
 * @return {Object} Filtered table object
 */
function filterTable(table) {
  return {
    code: table.code,
    players: filterTablePlayers(table.players),
    state: table.state,
    created: table.created
  };
}

/**
 * Filter table players for client
 * @param {Object} tablePlayers - Table players
 * @return {Object} Filtered players
 */
function filterTablePlayers(tablePlayers) {
  const filteredPlayers = {};
  
  for (const [position, player] of Object.entries(tablePlayers)) {
    if (player) {
      filteredPlayers[position] = {
        name: player.name,
        type: player.type
      };
    } else {
      filteredPlayers[position] = null;
    }
  }
  
  return filteredPlayers;
}

/**
 * Filter game state for client
 * @param {Object} gameState - Game state
 * @param {string|null} position - Player's position
 * @return {Object} Filtered game state
 */
function filterGameState(gameState, position) {
  // If gameState doesn't exist or position is null/undefined, return general version
  if (!gameState) return null;
  
  // Copy basic info
  const filteredState = { ...gameState };
  
  // Remove hands info (sent separately)
  delete filteredState.hands;
  
  return filteredState;
}

/**
 * Cleanup old tables
 */
function cleanupProcess() {
  const now = Date.now();
  
  for (const [code, table] of tables.entries()) {
    if (now - table.lastActivity > MAX_IDLE_TIME) {
      // Notify all players in table
      sendToTablePlayers(table, {
        type: 'tableRemoved',
        message: 'Table closed due to inactivity'
      });
      
      // Clean up table
      for (const playerData of Object.values(table.players)) {
        if (playerData && playerData.id) {
          const player = players.get(playerData.id);
          if (player) {
            player.table = null;
            player.position = null;
          }
        }
      }
      
      tables.delete(code);
      console.log(`Table ${code} removed due to inactivity`);
    }
  }
}

/**
 * Format position name
 * @param {string} position - Position identifier
 * @return {string} Position name
 */
function positionName(position) {
  switch(position) {
    case 'north': return 'North';
    case 'east': return 'East';
    case 'south': return 'South';
    case 'west': return 'West';
    default: return position;
  }
}

/**
 * Format contract
 * @param {string} contract - Contract
 * @return {string} Formatted contract
 */
function formatContract(contract) {
  if (!contract) return "No contract";
  
  const level = contract.charAt(0);
  const suit = contract.charAt(1);
  let suitSymbol;
  
  switch(suit) {
    case 'C': suitSymbol = '♣'; break;
    case 'D': suitSymbol = '♦'; break;
    case 'H': suitSymbol = '♥'; break;
    case 'S': suitSymbol = '♠'; break;
    case 'N': suitSymbol = 'NT'; break;
    default: suitSymbol = suit;
  }
  
  let result = `${level}${suitSymbol}`;
  
  // Add doubling info
  if (contract.includes('XX')) {
    result += ' XX';
  } else if (contract.includes('X')) {
    result += ' X';
  }
  
  return result;
}

// Advanced squeeze play detection and recognition
/**
 * Detect squeeze opportunities
 * @param {Object} table - Table object
 * @param {string} declarerPosition - Declarer position
 * @return {Object} Squeeze analysis
 */
function detectSqueezePlay(table, declarerPosition) {
  const gameState = table.gameState;
  const declarerHand = gameState.hands[declarerPosition];
  const dummyHand = gameState.hands[gameState.dummy];
  const tricksRemaining = 13 - gameState.totalTricks;
  
  // Simple squeeze detection logic
  const squeezeAnalysis = {
    hasSqueezeOpportunity: false,
    squeezeType: null,
    threatenedSuits: [],
    squeezedOpponents: [],
    timing: null
  };
  
  // Check for basic squeeze conditions
  // 1. Need at least 2 threats
  // 2. Need proper timing (usually in the last few tricks)
  // 3. Need communication between declarer and dummy
  
  if (tricksRemaining <= 5) {
    // Analyze suit lengths and threats
    const threats = analyzeSuitThreats(declarerHand, dummyHand, gameState);
    
    if (threats.length >= 2) {
      squeezeAnalysis.hasSqueezeOpportunity = true;
      squeezeAnalysis.threatenedSuits = threats;
      squeezeAnalysis.squeezeType = threats.length === 2 ? 'simple' : 'double';
      squeezeAnalysis.timing = tricksRemaining <= 3 ? 'exact' : 'positional';
    }
  }
  
  return squeezeAnalysis;
}

/**
 * Analyze suit threats for squeeze play
 * @param {Object} declarerHand - Declarer's hand
 * @param {Object} dummyHand - Dummy's hand
 * @param {Object} gameState - Game state
 * @return {Array} Threat suits
 */
function analyzeSuitThreats(declarerHand, dummyHand, gameState) {
  const threats = [];
  
  for (const suit of CARD_SUITS) {
    const declarerCards = declarerHand[suit] || [];
    const dummyCards = dummyHand[suit] || [];
    const combinedLength = declarerCards.length + dummyCards.length;
    
    // A suit is a threat if it has good cards and proper length
    if (combinedLength >= 2) {
      const hasHighHonors = [...declarerCards, ...dummyCards].some(card => 
        ['A', 'K', 'Q'].includes(card)
      );
      
      if (hasHighHonors) {
        threats.push(suit);
      }
    }
  }
  
  return threats;
}

/**
 * Execute squeeze play
 * @param {Object} table - Table object
 * @param {string} position - Player position
 * @param {Object} squeezeAnalysis - Squeeze analysis
 * @return {Object} Best squeeze card
 */
function executeSqueezePlay(table, position, squeezeAnalysis) {
  const hand = table.gameState.hands[position];
  const legalMoves = getLegalMoves(hand, table.gameState.currentTrick, table.gameState.trumpSuit);
  
  if (!squeezeAnalysis.hasSqueezeOpportunity) {
    return null; // No squeeze opportunity
  }
  
  // Find the squeeze card (usually a winner in a long suit)
  for (const suit of CARD_SUITS) {
    if (!squeezeAnalysis.threatenedSuits.includes(suit)) {
      const suitMoves = legalMoves.filter(move => move.suit === suit);
      if (suitMoves.length > 0) {
        // Play highest card in non-threat suit to apply pressure
        const highestCard = suitMoves.reduce((highest, move) => 
          compareCardValues(move.card, highest.card) > 0 ? move : highest
        );
        return highestCard;
      }
    }
  }
  
  return null;
}

/**
 * Advanced endplay detection
 * @param {Object} table - Table object
 * @param {string} position - Player position
 * @return {Object} Endplay opportunities
 */
function detectEndplayOpportunities(table, position) {
  const gameState = table.gameState;
  const hand = gameState.hands[position];
  const tricksRemaining = 13 - gameState.totalTricks;
  
  const endplayAnalysis = {
    hasEndplayOpportunity: false,
    endplayType: null,
    targetOpponent: null,
    strippingSuits: [],
    throwInCard: null
  };
  
  // Endplay works best in the last few tricks
  if (tricksRemaining <= 4) {
    // Look for throw-in opportunities
    const opponents = getOpponents(position);
    
    for (const opponent of opponents) {
      const throwInOpportunity = analyzeThrowInOpportunity(table, position, opponent);
      if (throwInOpportunity.viable) {
        endplayAnalysis.hasEndplayOpportunity = true;
        endplayAnalysis.endplayType = 'throw_in';
        endplayAnalysis.targetOpponent = opponent;
        endplayAnalysis.throwInCard = throwInOpportunity.card;
        break;
      }
    }
  }
  
  return endplayAnalysis;
}

/**
 * Analyze throw-in opportunity against specific opponent
 * @param {Object} table - Table object
 * @param {string} position - Player position
 * @param {string} opponent - Opponent position
 * @return {Object} Throw-in analysis
 */
function analyzeThrowInOpportunity(table, position, opponent) {
  // This is a simplified analysis
  // In reality, we'd need to track which cards opponents have played
  // and deduce their remaining holdings
  
  return {
    viable: false,
    card: null,
    reason: 'Insufficient information for throw-in analysis'
  };
}

/**
 * Get opponent positions
 * @param {string} position - Player position
 * @return {Array} Opponent positions
 */
function getOpponents(position) {
  const partnerships = {
    'north': ['east', 'west'],
    'south': ['east', 'west'],
    'east': ['north', 'south'],
    'west': ['north', 'south']
  };
  
  return partnerships[position] || [];
}

/**
 * Advanced finesse calculation
 * @param {Object} table - Table object
 * @param {string} position - Player position
 * @param {string} suit - Suit to finesse
 * @return {Object} Finesse analysis
 */
function calculateFinesse(table, position, suit) {
  const declarerHand = table.gameState.hands[table.gameState.declarer];
  const dummyHand = table.gameState.hands[table.gameState.dummy];
  const combinedCards = [...(declarerHand[suit] || []), ...(dummyHand[suit] || [])];
  
  const finesseAnalysis = {
    hasFinesseOpportunity: false,
    finesseType: null,
    playSequence: [],
    successProbability: 0
  };
  
  // Check for common finesse patterns
  const hasAceQueen = combinedCards.includes('A') && combinedCards.includes('Q');
  const hasAceJack = combinedCards.includes('A') && combinedCards.includes('J');
  const hasKingJack = combinedCards.includes('K') && combinedCards.includes('J');
  
  if (hasAceQueen && !combinedCards.includes('K')) {
    finesseAnalysis.hasFinesseOpportunity = true;
    finesseAnalysis.finesseType = 'AQ_vs_K';
    finesseAnalysis.successProbability = 0.5; // 50% chance King is in right position
    finesseAnalysis.playSequence = ['Play low towards Queen', 'If King appears, play Ace'];
  } else if (hasAceJack && !combinedCards.includes('K') && !combinedCards.includes('Q')) {
    finesseAnalysis.hasFinesseOpportunity = true;
    finesseAnalysis.finesseType = 'AJ_vs_KQ';
    finesseAnalysis.successProbability = 0.25; // 25% chance both honors are well-placed
    finesseAnalysis.playSequence = ['Play low towards Jack', 'Hope both K and Q are in right hand'];
  } else if (hasKingJack && !combinedCards.includes('A') && !combinedCards.includes('Q')) {
    finesseAnalysis.hasFinesseOpportunity = true;
    finesseAnalysis.finesseType = 'KJ_vs_AQ';
    finesseAnalysis.successProbability = 0.25;
    finesseAnalysis.playSequence = ['Play Jack towards King', 'Hope A or Q is in wrong position'];
  }
  
  return finesseAnalysis;
}

/**
 * Enhanced communication analysis between declarer and dummy
 * @param {Object} table - Table object
 * @return {Object} Communication analysis
 */
function analyzeCommunication(table) {
  const declarerHand = table.gameState.hands[table.gameState.declarer];
  const dummyHand = table.gameState.hands[table.gameState.dummy];
  const trumpSuit = table.gameState.trumpSuit;
  
  const communication = {
    entries: {
      declarer: 0,
      dummy: 0
    },
    suits: {},
    recommendations: []
  };
  
  // Count entries (high cards that can win tricks)
  for (const suit of CARD_SUITS) {
    const declarerSuit = declarerHand[suit] || [];
    const dummySuit = dummyHand[suit] || [];
    
    // Count potential entries
    const declarerEntries = declarerSuit.filter(card => ['A', 'K'].includes(card)).length;
    const dummyEntries = dummySuit.filter(card => ['A', 'K'].includes(card)).length;
    
    communication.entries.declarer += declarerEntries;
    communication.entries.dummy += dummyEntries;
    
    communication.suits[suit] = {
      declarerLength: declarerSuit.length,
      dummyLength: dummySuit.length,
      combinedLength: declarerSuit.length + dummySuit.length,
      entries: declarerEntries + dummyEntries,
      balanced: Math.abs(declarerSuit.length - dummySuit.length) <= 1
    };
  }
  
  // Generate recommendations
  if (communication.entries.dummy === 0) {
    communication.recommendations.push('Dummy has no entries - be careful about entry management');
  }
  
  if (communication.entries.declarer > communication.entries.dummy * 2) {
    communication.recommendations.push('Declarer hand is entry-rich - consider advanced plays');
  }
  
  return communication;
}

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Enhanced BridgeCircle Server with Advanced GIB AI running on port ${PORT}`);
  console.log('Features enabled:');
  console.log('- Opening Lead Tables');
  console.log('- Bidding Conventions (Stayman, Blackwood, Transfers)');
  console.log('- Dummy Play Analysis');
  console.log('- Monte Carlo Simulation');
  console.log('- Squeeze Play Recognition');
  console.log('- Enhanced Card Play Logic');
});