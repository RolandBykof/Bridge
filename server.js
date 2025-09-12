/**
 * BridgeCircle - Human Players Only Server
 * Multiplayer bridge game server that requires real human players
 */

require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');
const cors = require('cors');

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

// Background cleanup process
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
  
  socket.on('createTable', ({ playerName, position, tableName }) => {
    console.log(`Creating table for ${playerName} at position ${position}`);
    
    const tableCode = createTableCode(); 

    const table = {
        code: tableCode,
        name: tableName || null,
        players: {
            north: null,
            east: null,
            south: null,
            west: null
        },
        state: 'waiting',
        gameState: null,
        biddingState: null,
        created: Date.now(),
        lastActivity: Date.now(),
        creator: socket.id,
        dealNumber: 0,
        currentDealer: 'south'
    };

    // Add player to table
    table.players[position] = {
        name: playerName,
        id: socket.id,
        type: 'human'
    };

    // Store table
    tables.set(tableCode, table);
    console.log(`Table ${tableCode} created. Total tables:`, tables.size);

    // Update player object
    const player = players.get(socket.id);
    if (player) {
        player.table = tableCode;
        player.name = playerName;
        player.position = position;
    }

    // Socket joins room
    socket.join(tableCode);

    // Send table created confirmation
    socket.emit('tableCreated', { 
        tableCode,
        table: filterTable(table),
        playerPosition: position
    });
    
    socket.emit('tableInfo', {
        table: filterTable(table),
        playerPosition: position
    });
    
    console.log(`Table ${tableCode} created successfully`);
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
  
  // Disconnect handling
  socket.on('disconnect', () => {
    console.log('Client disconnected:', playerId);
    handleDisconnect(playerId);
  });
  
  socket.on('error', (error) => {
    console.error('Socket error:', error);
    handleDisconnect(playerId);
  });
});

/**
 * Handle player disconnection
 */
function handleDisconnect(playerId) {
  const player = players.get(playerId);
  if (!player) return;
  
  // If player was in a table, remove from it
  if (player.table) {
    const table = tables.get(player.table);
    if (table) {
      removePlayerFromTable(player, table);
    }
  }
  
  // Remove player
  players.delete(playerId);
}

/**
 * Join an existing table
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
 */
function selectPosition(socket, playerId, data) {
    const { tableCode, position, playerName } = data;
    
    console.log(`selectPosition: ${playerName} wants ${position} in table ${tableCode}`);
    
    if (!tableCode || !position || !playerName) {
        sendError(socket, 'Incomplete information');
        return;
    }
    
    const table = tables.get(tableCode);
    if (!table) {
        sendError(socket, 'Table not found');
        return;
    }
    
    // Check if same player is trying to rejoin
    const existingPlayer = table.players[position];
    if (existingPlayer) {
        if (existingPlayer.id === playerId || existingPlayer.name === playerName) {
            console.log(`Player ${playerName} already in position ${position}, updating connection`);
            table.players[position].id = playerId;
            
            const player = players.get(playerId);
            if (player) {
                player.table = tableCode;
                player.position = position;
                player.name = playerName;
            }
            
            socket.join(tableCode);
            
            socket.emit('tableInfo', {
                table: filterTable(table),
                playerPosition: position
            });
            
            return;
        } else {
            sendError(socket, 'Position is already taken');
            return;
        }
    }
    
    const player = players.get(playerId);
    
    // Add player to table
    table.players[position] = {
        name: playerName,
        id: playerId,
        type: 'human'
    };
    
    // Update player info
    if (player) {
        player.table = tableCode;
        player.position = position;
        player.name = playerName;
    }
    
    // Join socket to room
    socket.join(tableCode);
    
    // Send table info to new player
    socket.emit('tableInfo', {
        table: filterTable(table),
        playerPosition: position
    });

    // Notify all players about new player
    sendToTablePlayers(table, {
        type: 'playerJoined',
        position,
        playerName,
        table: filterTable(table)
    });

    console.log(`Player ${playerName} joined table ${tableCode} at position ${position}`);
}

function getTableInfo(socket, playerId, data) {
    const { tableCode } = data;
    
    console.log(`getTableInfo: tableCode=${tableCode}, playerId=${playerId}`);
    
    if (!tableCode) {
        console.log(`Table code missing`);
        sendError(socket, 'Table code missing');
        return;
    }
    
    const table = tables.get(tableCode);
    if (!table) {
        console.log(`Table ${tableCode} not found. Available tables:`, Array.from(tables.keys()));
        sendError(socket, 'Table not found');
        return;
    }
    
    console.log(`Table ${tableCode} found`);
    
    // Check if player is already in table
    let playerAlreadyInTable = false;
    let existingPosition = null;
    
    for (const [pos, player] of Object.entries(table.players)) {
        if (player && player.id === playerId) {
            playerAlreadyInTable = true;
            existingPosition = pos;
            console.log(`Player ${playerId} already in table at position ${pos}`);
            break;
        }
    }
    
    // If not found by socket.id, try to find by name
    if (!playerAlreadyInTable) {
        const currentPlayer = players.get(playerId);
        if (currentPlayer && currentPlayer.name) {
            for (const [pos, tablePlayer] of Object.entries(table.players)) {
                if (tablePlayer && 
                    tablePlayer.name === currentPlayer.name && 
                    tablePlayer.type === 'human') {
                    console.log(`Found player by name: ${currentPlayer.name} at position ${pos}, updating socket.id`);
                    table.players[pos].id = playerId;
                    currentPlayer.table = tableCode;
                    currentPlayer.position = pos;
                    playerAlreadyInTable = true;
                    existingPosition = pos;
                    break;
                }
            }
        }
    }
    
    // Join socket to room
    socket.join(tableCode);
    
    socket.emit('tableInfo', {
        table: filterTable(table),
        playerPosition: existingPosition
    });
    
    console.log(`Sent tableInfo for ${tableCode} to ${playerId}`);
}

/**
 * Remove player from table
 */
function removeFromTable(socket, playerId) {
  const player = players.get(playerId);
  if (!player || !player.table) {
    sendError(socket, 'You are not in any table');
    return;
  }
  
  const table = tables.get(player.table);
  if (!table) {
    player.table = null;
    player.position = null;
    return;
  }
  
  removePlayerFromTable(player, table);
}

/**
 * Remove player from table (helper function)
 */
function removePlayerFromTable(player, table) {
  const position = player.position;
  
  // Remove player from table
  table.players[position] = null;
  
  // Notify other players
  sendToTablePlayers(table, {
    type: 'playerLeft',
    position,
    table: filterTable(table)
  });
  
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
 * Start game - requires all 4 human players
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
  
  if (!player || player.table !== tableCode) {
    sendError(socket, 'You do not have permission to start the game');
    return;
  }
  
  // Check that all positions are filled with human players
  const positions = ['north', 'east', 'south', 'west'];
  for (const position of positions) {
    if (!table.players[position] || table.players[position].type !== 'human') {
      sendError(socket, 'All 4 positions must be filled with human players before starting');
      return;
    }
  }
  
  table.state = 'playing';
  table.lastActivity = Date.now();
  
  try {
    table.dealNumber = 1;
    table.currentDealer = 'south';
    
    // Deal cards and create game state
    table.gameState = createGameState(table);
    table.biddingState = createBiddingState(table);
    
    // Send game state to all players
    sendToTablePlayers(table, {
      type: 'gameStarted',
      gameState: filterGameState(table.gameState, null),
      biddingState: table.biddingState,
      players: filterTablePlayers(table.players),        
      dealNumber: table.dealNumber,                      
      dealer: table.currentDealer                        
    });
    
    sendAudioToTable(table, 'deal');

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
    
  } catch (error) {
    console.error('Error starting game:', error);
    sendError(socket, 'Error starting game');
    table.state = 'waiting';
  }
}

/**
 * Send chat message
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
  }
}

/**
 * Check if bidding phase is complete
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
    const hasNonPass = bids.some(b => b.bid !== 'P');
    return hasNonPass;
  }
  
  return false;
}

/**
 * Move to next bidder
 */
function moveToNextBidder(biddingState) {
  const positions = ['north', 'east', 'south', 'west'];
  const currentIndex = positions.indexOf(biddingState.currentBidder);
  biddingState.currentBidder = positions[(currentIndex + 1) % 4];
}

/**
 * Finalize bidding phase
 */
function finalizeBiddingPhase(table) {
  table.biddingState.biddingComplete = true;
  
  // If all passed, deal new hand
  if (table.biddingState.bidHistory.length === 4 && 
      table.biddingState.bidHistory.every(bid => bid.bid === 'P')) {
    
    sendToTablePlayers(table, {
      type: 'allPassed',
      message: "All players passed. Starting new deal."
    });
    
    // Start new deal automatically
    setTimeout(() => {
      startNextDeal(table);
    }, 3000);
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
 */
function determineContract(table) {
  let highestBid = null;
  let doubled = false;
  let redoubled = false;
  
  for (const bidInfo of table.biddingState.bidHistory) {
    if (!['P', 'X', 'XX'].includes(bidInfo.bid)) {
      highestBid = bidInfo.bid;
      doubled = false;
      redoubled = false;
    } else if (bidInfo.bid === 'X' && highestBid) {
      doubled = true;
      redoubled = false;
    } else if (bidInfo.bid === 'XX' && doubled) {
      redoubled = true;
      doubled = false;
    }
  }
  
  if (!highestBid) {
    return null;
  }
  
  let contract = highestBid;
  if (redoubled) {
    contract += 'XX';
  } else if (doubled) {
    contract += 'X';
  }
  
  table.biddingState.contract = contract;
  return contract;
}

/**
 * Determine declarer and dummy
 */
function determineDeclarerAndDummy(table) {
  const contractSuit = table.biddingState.contract.charAt(1);
  
  const partnerships = {
    'north-south': ['north', 'south'],
    'east-west': ['east', 'west']
  };
  
  let declarerPartnership = null;
  let firstPlayer = null;
  
  for (const bidInfo of table.biddingState.bidHistory) {
    if (bidInfo.bid.charAt(1) === contractSuit && !['P', 'X', 'XX'].includes(bidInfo.bid)) {
      const player = bidInfo.player;
      
      for (const [partnership, players] of Object.entries(partnerships)) {
        if (players.includes(player)) {
          declarerPartnership = partnership;
          
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
  
  if (declarerPartnership && firstPlayer) {
    table.biddingState.declarer = firstPlayer;
    const dummyIndex = (partnerships[declarerPartnership].indexOf(firstPlayer) + 1) % 2;
    table.biddingState.dummy = partnerships[declarerPartnership][dummyIndex];
  } else {
    table.biddingState.declarer = 'south';
    table.biddingState.dummy = 'north';
  }
}

/**
 * Move to play phase
 */
function moveToPlayPhase(table) {
  // Transfer bidding info to game state
  table.gameState.contract = table.biddingState.contract;
  table.gameState.trumpSuit = table.biddingState.trumpSuit;
  table.gameState.declarer = table.biddingState.declarer;
  table.gameState.dummy = table.biddingState.dummy;
  table.gameState.gamePhase = 'play';

  // Set first player (left of declarer)
  const positions = ['north', 'east', 'south', 'west'];
  const declarerIndex = positions.indexOf(table.biddingState.declarer);
  table.gameState.currentPlayer = positions[(declarerIndex + 1) % 4];
  table.gameState.leadingPlayer = table.gameState.currentPlayer;
  
  sendToTablePlayers(table, {
    type: 'biddingComplete',
    contract: table.gameState.contract,
    declarer: table.gameState.declarer,
    dummy: table.gameState.dummy,
    trumpSuit: table.gameState.trumpSuit,
    currentPlayer: table.gameState.currentPlayer,
    gameState: filterGameState(table.gameState, null)
  });
  
  // Send players their cards for play phase
  for (const [position, playerData] of Object.entries(table.players)) {
    if (playerData.type === 'human' && playerData.id) {
      const player = players.get(playerData.id);
      if (player && player.socket) {
        player.socket.emit('playPhaseCards', {
          position,
          cards: table.gameState.hands[position]
        });
      }
    }
  }
}

/**
 * Play a card
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
  
  if (table.gameState.trickLocked) {
    sendError(socket, 'Please wait, previous trick is being processed');
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
  sendAudioToTable(table, 'hit');

  // Check if trick is complete (4 cards)
  if (table.gameState.currentTrick.length === 4) {
    table.gameState.trickLocked = true;
    setTimeout(() => {
      processTrick(table);
    }, 3000);
  } else {
    // Move to next player
    table.gameState.currentPlayer = getNextPlayer(table.gameState.currentPlayer);
    
    sendToTablePlayers(table, {
      type: 'nextPlayer',
      currentPlayer: table.gameState.currentPlayer
    });
  }

  // If this was first card played, reveal dummy cards
  if (table.gameState.playedCards.length === 1) {
    const dummyPosition = table.gameState.dummy;
    if (dummyPosition && table.gameState.hands[dummyPosition]) {
      sendToTablePlayers(table, {
        type: 'dummyRevealed',
        dummyPosition: dummyPosition,
        dummyCards: table.gameState.hands[dummyPosition]
      });
    }
  }
}

/**
 * Get next player
 */
function getNextPlayer(currentPlayer) {
  const positions = ['north', 'east', 'south', 'west'];
  const currentIndex = positions.indexOf(currentPlayer);
  return positions[(currentIndex + 1) % 4];
}

/**
 * Process completed trick
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
  table.gameState.trickLocked = false;  

  // Set winner as next leader
  table.gameState.leadingPlayer = winner;
  table.gameState.currentPlayer = winner;
  
  // Check if game is over (13 tricks played)
  if (table.gameState.totalTricks >= 13) {
    endGame(table);
    return;
  }
  
  sendToTablePlayers(table, {
    type: 'trickComplete',
    winner,
    trick: completedTrick,
    tricks: table.gameState.tricks,
    nextPlayer: winner
  });
}

/**
 * Determine trick winner
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
 * End game and start countdown for next deal
 */
function endGame(table) {
    table.gameState.gamePhase = 'end';
    
    // Calculate result based on contract
    let resultMessage = '';
    
    if (table.gameState.contract) {
        const level = parseInt(table.gameState.contract.charAt(0));
        const requiredTricks = level + 6;
        
        const declarerSide = table.gameState.declarer === 'north' || table.gameState.declarer === 'south' ? 'ns' : 'ew';
        const madeTricks = table.gameState.tricks[declarerSide];
        
        if (madeTricks >= requiredTricks) {
            const overtricks = madeTricks - requiredTricks;
            if (overtricks > 0) {
                resultMessage = `Contract ${formatContract(table.gameState.contract)} made with ${overtricks} overtrick${overtricks > 1 ? 's' : ''}! ${positionName(table.gameState.declarer)}-${positionName(table.gameState.dummy)} got ${madeTricks} tricks.`;
            } else {
                resultMessage = `Contract ${formatContract(table.gameState.contract)} made exactly! ${positionName(table.gameState.declarer)}-${positionName(table.gameState.dummy)} got ${madeTricks} tricks.`;
            }
        } else {
            const down = requiredTricks - madeTricks;
            resultMessage = `Contract ${formatContract(table.gameState.contract)} went down ${down} trick${down > 1 ? 's' : ''}. ${positionName(table.gameState.declarer)}-${positionName(table.gameState.dummy)} got ${madeTricks} tricks.`;
        }
    } else {
        if (table.gameState.tricks.ns > table.gameState.tricks.ew) {
            resultMessage = `Game over! North-South won ${table.gameState.tricks.ns} tricks vs. ${table.gameState.tricks.ew}.`;
        } else if (table.gameState.tricks.ew > table.gameState.tricks.ns) {
            resultMessage = `Game over! East-West won ${table.gameState.tricks.ew} tricks vs. ${table.gameState.tricks.ns}.`;
        } else {
            resultMessage = `Game over! Tie, both teams got ${table.gameState.tricks.ns} tricks.`;
        }
    }
    
    table.lastActivity = Date.now();
    
    sendToTablePlayers(table, {
        type: 'gameOver',
        message: resultMessage,
        tricks: table.gameState.tricks,
        contract: table.gameState.contract,
        dealNumber: table.dealNumber || 1,
        dealer: table.currentDealer || 'south'
    });
    
    console.log(`Game ${table.code} ended: ${resultMessage}`);
    
    // Automatic new deal after 10 seconds
    setTimeout(() => {
        if (table && tables.has(table.code)) {
            const activePlayers = Object.values(table.players).filter(p => p !== null);
            
            if (activePlayers.length === 4) { // Only start if all players still present
                console.log(`Starting next deal for table ${table.code}`);
                startNextDeal(table);
            } else {
                console.log(`Table ${table.code} missing players, not starting next deal`);
            }
        }
    }, 10000);
    
    sendToTablePlayers(table, {
        type: 'autoDealCountdownStarted',
        nextDealNumber: (table.dealNumber || 1) + 1,
        nextDealer: getNextDealer(table.currentDealer || 'south'),
        countdown: 10
    });
}

/**
 * Get next dealer in rotation
 */
function getNextDealer(currentDealer) {
    const dealerOrder = ['south', 'west', 'north', 'east'];
    const currentIndex = dealerOrder.indexOf(currentDealer);
    return dealerOrder[(currentIndex + 1) % 4];
}

/**
 * Start next deal automatically
 */
function startNextDeal(table) {
    try {
        table.currentDealer = getNextDealer(table.currentDealer || 'south');
        table.dealNumber = (table.dealNumber || 1) + 1;
        
        console.log(`Starting deal ${table.dealNumber}, dealer: ${table.currentDealer} for table ${table.code}`);
        
        table.state = 'playing';
        table.lastActivity = Date.now();
        
        table.gameState = createGameState(table);
        table.biddingState = createBiddingState(table);
        
        sendToTablePlayers(table, {
            type: 'newDealStarted',
            dealNumber: table.dealNumber,
            dealer: table.currentDealer,
            gameState: filterGameState(table.gameState, null),
            biddingState: table.biddingState
        });
        
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
        
        console.log(`Deal ${table.dealNumber} started successfully for table ${table.code}`);
        
    } catch (error) {
        console.error(`Error starting next deal for table ${table.code}:`, error);
        
        sendToTablePlayers(table, {
            type: 'dealError',
            message: 'Error starting new deal. You can start a new game manually.',
            error: error.message
        });
        
        table.state = 'waiting';
        table.gameState = null;
        table.biddingState = null;
    }
}

/**
 * Start new game
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
  
  if (!player || player.table !== tableCode) {
    sendError(socket, 'You do not have permission to start the game');
    return;
  }
  
  // Start game
  startGame(socket, playerId, data);
}

/**
 * Send active tables to player
 */
function sendActiveTables(socket) {
  const activeTablesInfo = Array.from(tables.entries())
    .filter(([_, table]) => table.state === 'waiting')
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
 * Check if bid is valid
 */
function isBidValid(bid, highestBid) {
  if (bid === 'P') return true;
  
  if (bid === 'X' || bid === 'XX') return true;
  
  if (!highestBid) return true;
  
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
 * Send error message to socket
 */
function sendError(socket, message) {
  socket.emit('error', { message });
}

/**
 * Send audio message to all players in table
 */
function sendAudioToTable(table, audioType) {
    const message = {
        type: 'toista_aani',
        aaniTyyppi: audioType
    };
    
    sendToTablePlayers(table, message);
}

/**
 * Send message to all players in table
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
 */
function createTableCode() {
  let code;
  do {
    code = Math.floor(1000 + Math.random() * 9000).toString();
  } while (tables.has(code));
  
  return code;
}

/**
 * Create new game state
 */
function createGameState(table) {
  const cards = dealCards();
  
  return {
    players: table.players,
    currentPlayer: 'south',
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
    leadingPlayer: 'south',
    trickLocked: false
  };
}

/**
 * Create new bidding state
 */
function createBiddingState(table) {
    const dealerPosition = table.currentDealer;
    
    return {
        currentBidder: dealerPosition,
        bidHistory: [],
        currentRound: 1,
        consecutivePasses: 0,
        biddingComplete: false,
        highestBid: null,
        contract: null,
        declarer: null,
        dummy: null,
        trumpSuit: null,
        dealer: dealerPosition
    };
}

/**
 * Deal cards randomly
 */
function dealCards() {
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
 */
function filterGameState(gameState, position) {
  if (!gameState) return null;
  
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
      sendToTablePlayers(table, {
        type: 'tableRemoved',
        message: 'Table closed due to inactivity'
      });
      
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
  console.log(`BridgeCircle Human-Only Server running on port ${PORT}`);
  console.log('Features:');
  console.log('- Human players only (no AI/robots)');
  console.log('- Real-time multiplayer bridge');
  console.log('- Automatic dealing and scoring');
  console.log('- Table management and chat');
});