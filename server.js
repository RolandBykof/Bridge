/**
 * BridgeCircle - Server Code
 * Socket.io implementation for the bridge application
 */

require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');
const cors = require('cors');
const fs = require('fs');

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
 * Handle player disconnection
 * @param {string} playerId - Player's ID
 */
function handleDisconnect(playerId) {
  const player = players.get(playerId);
  if (!player) return;
  
  // If player was in a table, remove from it
  if (player.table) {
    const table = tables.get(player.table);
    if (table) {
      // If game is in progress, replace player with GIB AI
      if (table.state === 'playing') {
        replacePlayer(table, player.position);
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
function removePlayerFromTable(player, table) {
  const position = player.position;
  
  // If game is in progress, replace player with GIB
  if (table.state === 'playing') {
    replacePlayer(table, position);
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
function replacePlayer(table, position) {
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
    setTimeout(() => {
      makeGIBMove(table, position);
    }, 1500);
  } else if (table.biddingState && table.biddingState.currentBidder === position) {
    setTimeout(() => {
      makeGIBBid(table, position);
    }, 1500);
  }
}

/**
 * Start game
 * @param {Object} socket - Socket.IO socket
 * @param {string} playerId - Player's ID
 * @param {Object} data - Game start data
 */
function startGame(socket, playerId, data) {
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
    table.gameState = createGameState(table);
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
      setTimeout(() => {
        makeGIBBid(table, table.biddingState.currentBidder);
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
      setTimeout(() => {
        makeGIBBid(table, table.biddingState.currentBidder);
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
    setTimeout(() => {
      makeGIBMove(table, table.gameState.currentPlayer);
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
      setTimeout(() => {
        makeGIBMove(table, table.gameState.currentPlayer);
      }, 1500);
    }
  }
}

/**
 * Make GIB AI bid
 * @param {Object} table - Table object
 * @param {string} position - GIB's position
 */
function makeGIBBid(table, position) {
  // Simple logic for GIB bidding
  
  // Get valid bids
  const possibleBids = getPossibleBids(table.biddingState.highestBid);
  
  // Use strategy to choose bid
  const bid = calculateBid(table, position, possibleBids);
  
  // Make the chosen bid
  processBid(table, position, bid);
}

/**
 * Calculate GIB AI bid
 * @param {Object} table - Table object
 * @param {string} position - GIB's position
 * @param {Array<string>} possibleBids - Possible bids
 * @return {string} Chosen bid
 */
function calculateBid(table, position, possibleBids) {
  // Get info about player's hand
  const hand = table.gameState.hands[position];
  
  // Simple GIB logic
  // Default to pass
  let bid = 'P';
  
  // 15+ points -> 1NT
  if (calculatePoints(hand) >= 15 && calculatePoints(hand) <= 17) {
    bid = possibleBids.includes('1N') ? '1N' : 'P';
  }
  // 12+ points -> 1 longest suit
  else if (calculatePoints(hand) >= 12) {
    const suits = ['spades', 'hearts', 'diamonds', 'clubs'];
    const longestSuit = suits.reduce((longest, suit) => 
      hand[suit].length > hand[longest].length ? suit : longest, suits[0]);
    
    if (longestSuit === 'spades' && hand[longestSuit].length >= 5) {
      bid = possibleBids.includes('1S') ? '1S' : 'P';
    } else if (longestSuit === 'hearts' && hand[longestSuit].length >= 5) {
      bid = possibleBids.includes('1H') ? '1H' : 'P';
    } else if (longestSuit === 'diamonds') {
      bid = possibleBids.includes('1D') ? '1D' : 'P';
    } else if (longestSuit === 'clubs') {
      bid = possibleBids.includes('1C') ? '1C' : 'P';
    }
  }
  
  // Ensure bid is possible
  return possibleBids.includes(bid) ? bid : 'P';
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
 * Make GIB AI move
 * @param {Object} table - Table object
 * @param {string} position - GIB's position
 */
function makeGIBMove(table, position) {
  // Choose card to play
  const hand = table.gameState.hands[position];
  let playableCards = [];
  
  // If this is first card in trick, use leading strategy
  if (table.gameState.currentTrick.length === 0) {
    // For simplicity, play a random card
    for (const suit of ['spades', 'hearts', 'diamonds', 'clubs']) {
      for (const card of hand[suit] || []) {
        playableCards.push({ suit, card });
      }
    }
  } else {
    // Otherwise follow suit if possible
    const leadingSuit = table.gameState.currentTrick[0].suit;
    
    if (hand[leadingSuit] && hand[leadingSuit].length > 0) {
      // Must follow suit
      for (const card of hand[leadingSuit]) {
        playableCards.push({ suit: leadingSuit, card });
      }
    } else {
      // Can play any card
      for (const suit of ['spades', 'hearts', 'diamonds', 'clubs']) {
        for (const card of hand[suit] || []) {
          playableCards.push({ suit, card });
        }
      }
    }
  }
  
  if (playableCards.length === 0) {
    console.error(`GIB player ${position} has no legal cards to play!`);
    return;
  }
  
  // Choose random card
  const chosenCardIndex = Math.floor(Math.random() * playableCards.length);
  const chosenCard = playableCards[chosenCardIndex];
  
  // Play chosen card
  processCardPlay(table, position, chosenCard.suit, chosenCard.card);
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
function processTrick(table) {
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
    setTimeout(() => {
      makeGIBMove(table, table.gameState.currentPlayer);
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
function startNewGame(socket, playerId, data) {
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
  startGame(socket, playerId, data);
}

/**
 * Create solo game against GIB AI
 * @param {Object} socket - Socket.IO socket
 * @param {string} playerId - Player's ID
 * @param {Object} data - Solo game creation data
 */
function createSoloGame(socket, playerId, data) {
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
  startGame(socket, playerId, { tableCode });
  
  console.log(`Solo game ${tableCode} created, player ${playerName}`);
}

/**
 * Reset solo game
 * @param {Object} socket - Socket.IO socket
 * @param {string} playerId - Player's ID
 * @param {Object} data - Solo game reset data
 */
function resetSoloGame(socket, playerId, data) {
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
  startGame(socket, playerId, { tableCode });
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
 * Calculate hand points (HCP)
 * @param {Object} hand - Hand object
 * @return {number} Points
 */
function calculatePoints(hand) {
  const pointValues = {
    'A': 4, 'K': 3, 'Q': 2, 'J': 1
  };
  
  let total = 0;
  
  for (const suit of ['spades', 'hearts', 'diamonds', 'clubs']) {
    for (const card of hand[suit] || []) {
      if (pointValues[card]) {
        total += pointValues[card];
      }
    }
  }
  
  return total;
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
 * Create new game state
 * @param {Object} table - Table object
 * @return {Object} Game state object
 */
function createGameState(table) {
  // Deal cards
  const cards = dealCards();
  
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

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
