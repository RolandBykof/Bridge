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
const robot = require('./lib/robot');
const solver = require('./lib/bridge_solver_wasm');

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
const RECONNECT_TIMEOUT = 300000; // 5 minuuttia

// Minibridge
const HCP = { A: 4, K: 3, Q: 2, J: 1 };
const MINI_GAME_LEVEL = { N: 3, S: 4, H: 4, D: 5, C: 5 };
const MINI_TRUMP = { S: 'spades', H: 'hearts', D: 'diamonds', C: 'clubs', N: null };

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
  
  socket.on('createTable', ({ playerName, position, tableName, gameMode }) => {
    console.log(`Creating table for ${playerName} at position ${position}`);

    const tableCode = createTableCode();
    const mode = gameMode === 'minibridge' ? 'minibridge' : 'bridge';

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
        creatorPosition: position,
        dealNumber: 0,
        currentDealer: 'south',
        gameMode: mode,
        miniState: null,
        miniScore: { ns: 0, ew: 0 },
        // Cumulative standard duplicate-bridge score across deals at this table
        // (separate from miniScore, which is minibridge's own simplified
        // scoring) -- see scoreContractDeal() / getVulnerability() and endGame().
        bridgeScore: { ns: 0, ew: 0 },
        autoNextDeal: false,
        pendingNextDealTimeout: null,
        // Bumped by beginDeal() every time a deal starts. Lets a deferred
        // callback (trick resolution, a redeal timer, an in-flight GIB/solver
        // call) recognize that the deal it was working on has since been
        // abandoned (via requestNextDeal()) and silently no-op instead of
        // mutating the new deal's state.
        dealEpoch: 0
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

  socket.on('chooseMiniContract', (data) => {
    chooseMiniContract(socket, playerId, data);
  });

  socket.on('playCard', (data) => {
    playCard(socket, playerId, data);
  });
  
  socket.on('startNewGame', (data) => {
    startNewGame(socket, playerId, data);
  });

  socket.on('setAutoNextDeal', (data) => {
    setAutoNextDeal(socket, playerId, data);
  });

  socket.on('requestNextDeal', (data) => {
    requestNextDeal(socket, playerId, data);
  });

  socket.on('replayDeal', (data) => {
    replayDeal(socket, playerId, data);
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
  
  console.log(`Player ${playerId} disconnected from table ${player.table || 'none'}`);
  
  // Jos pelaaja on pöydässä
  if (player.table) {
    const table = tables.get(player.table);
    if (table) {
      // KORJAUS: Jos peli on käynnissä, älä poista pelaajaa välittömästi
      if (table.state === 'playing') {
        // Merkitse pelaaja katkenneeksi
        const position = player.position;
        if (position && table.players[position]) {
          table.players[position].disconnected = true;
          table.players[position].disconnectTime = Date.now();
          
          // Ilmoita muille pelaajille
          sendToTablePlayers(table, {
            type: 'playerDisconnected',
            position: position,
            playerName: player.name,
            message: `${player.name} (${positionName(position)}) lost connection. Waiting for reconnect...`
          });
          
          console.log(`Player ${player.name} marked as disconnected, waiting for reconnect`);
          
          // Aseta timeout pelaajan lopulliseen poistamiseen
          setTimeout(() => {
            const currentTable = tables.get(player.table);
            if (currentTable && currentTable.players[position]) {
              const tablePlayer = currentTable.players[position];
              // Jos pelaaja on edelleen katkennneena (ei ole liittynyt takaisin)
              if (tablePlayer.disconnected && tablePlayer.id === playerId) {
                console.log(`Player ${player.name} reconnect timeout - removing from game`);
                
                // Poista pelaaja lopullisesti
                removePlayerFromTable(player, currentTable);
                
                sendToTablePlayers(currentTable, {
                  type: 'playerRemovedTimeout',
                  position: position,
                  message: `${player.name} could not reconnect and was removed from the game.`
                });
              }
            }
          }, RECONNECT_TIMEOUT);
        }
      } else {
        // Jos peli ei ole käynnissä (waiting room), poista normaalisti
        removePlayerFromTable(player, table);
      }
    }
  }
  
  // Älä poista players Map:stä vielä jos peli on käynnissä
  // Näin pelaaja voi liittyä takaisin
  if (!player.table || !tables.get(player.table) || tables.get(player.table).state !== 'playing') {
    players.delete(playerId);
  }
}

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
    const { tableCode, playerName } = data;
    
    console.log(`getTableInfo: tableCode=${tableCode}, playerId=${playerId}, playerName=${playerName}`);
    
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
    
    console.log(`Table ${tableCode} found, state: ${table.state}`);
    
    // Päivitä pelaajan nimi jos annettu
    const currentPlayer = players.get(playerId);
    if (currentPlayer && playerName) {
        currentPlayer.name = playerName;
        console.log(`Updated player ${playerId} name to ${playerName}`);
    }
    
    // Tarkista onko pelaaja jo pöydässä socket.id:llä
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
    
    // KORJAUS: Jos ei löydy ID:llä, etsi nimellä (reconnect-tilanne)
    if (!playerAlreadyInTable && playerName) {
        for (const [pos, tablePlayer] of Object.entries(table.players)) {
            if (tablePlayer && 
                tablePlayer.name === playerName && 
                tablePlayer.type === 'human') {
                console.log(`Found player by name: ${playerName} at position ${pos}`);
                
                // KORJAUS: Tarkista oliko pelaaja katkennneena
                if (tablePlayer.disconnected) {
                    console.log(`Player ${playerName} was disconnected, reconnecting...`);
                    
                    // Päivitä socket.id ja poista disconnected-merkintä
                    table.players[pos].id = playerId;
                    table.players[pos].disconnected = false;
                    delete table.players[pos].disconnectTime;
                    
                    // Päivitä players Map
                    if (currentPlayer) {
                        currentPlayer.table = tableCode;
                        currentPlayer.position = pos;
                    } else {
                        players.set(playerId, {
                            socket: socket,
                            table: tableCode,
                            name: playerName,
                            position: pos,
                            connected: Date.now()
                        });
                    }
                    
                    playerAlreadyInTable = true;
                    existingPosition = pos;
                    
                    // Ilmoita muille pelaajille uudelleenliittymisestä
                    sendToTablePlayers(table, {
                        type: 'playerReconnected',
                        position: pos,
                        playerName: playerName,
                        message: `${playerName} (${positionName(pos)}) reconnected!`
                    });
                    
                    break;
                } else {
                    // Päivitä normaalisti jos ei ollut disconnected
                    table.players[pos].id = playerId;
                    if (currentPlayer) {
                        currentPlayer.table = tableCode;
                        currentPlayer.position = pos;
                    }
                    playerAlreadyInTable = true;
                    existingPosition = pos;
                    break;
                }
            }
        }
    }
    
    // Liitä socket huoneeseen
    socket.join(tableCode);
    
    // Jos peli on käynnissä ja pelaaja on pöydässä, lähetä pelin tila
    if (table.state === 'playing' && existingPosition) {
        console.log(`Reconnecting ${playerId} to game ${tableCode} as ${existingPosition}`);
        
        socket.emit('gameReconnect', {
            table: filterTable(table),
            playerPosition: existingPosition,
            gameState: filterGameState(table.gameState, existingPosition),
            biddingState: table.biddingState,
            dealNumber: table.dealNumber || 1,
            dealer: table.currentDealer || 'south',
            gameMode: table.gameMode || 'bridge',
            miniState: table.miniState || null,
            miniScore: table.miniScore || { ns: 0, ew: 0 },
            bridgeScore: table.bridgeScore || { ns: 0, ew: 0 },
            autoNextDeal: !!table.autoNextDeal
        });

        // Lähetä pelaajan kortit
        if (table.gameState && table.gameState.hands && table.gameState.hands[existingPosition]) {
            socket.emit('yourCards', {
                position: existingPosition,
                cards: table.gameState.hands[existingPosition]
            });
        }

        // Jos dummy on näkyvissä, lähetä sekin (minibridgessä myös contract-vaiheessa)
        if (table.gameState && table.gameState.dummy &&
            (table.gameState.gamePhase === 'play' || table.gameState.gamePhase === 'contract') &&
            table.gameState.hands[table.gameState.dummy]) {
            socket.emit('dummyRevealed', {
                dummyPosition: table.gameState.dummy,
                dummyCards: table.gameState.hands[table.gameState.dummy]
            });
        }
        
        console.log(`Sent game reconnect for ${tableCode} to ${playerId}`);
        return;
    }
    
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

  if (table.creatorPosition && player.position !== table.creatorPosition) {
    sendError(socket, 'Only the player who created the table can start the game');
    return;
  }

  // Fill any empty seats with a robot, then start
  const positions = ['north', 'east', 'south', 'west'];
  const autoFilledWithRobot = [];
  for (const position of positions) {
    if (!table.players[position]) {
      table.players[position] = { name: 'Robot', id: null, type: 'robot' };
      autoFilledWithRobot.push(position);
    }
  }
  for (const position of positions) {
    if (!['human', 'robot'].includes(table.players[position].type)) {
      sendError(socket, 'All 4 positions must be filled before starting');
      return;
    }
  }

  table.state = 'playing';
  table.lastActivity = Date.now();

  try {
    table.dealNumber = 1;
    table.currentDealer = 'south';

    beginDeal(table, 'gameStarted', { autoFilledWithRobot });

    console.log(`Game started in table ${tableCode}`);

  } catch (error) {
    console.error('Error starting game:', error);
    sendError(socket, 'Error starting game');
    table.state = 'waiting';
  }
}

/**
 * Deal cards, resolve minibridge roles (if applicable) and notify players.
 * Shared by startGame() and startNextDeal() so both game modes stay in sync.
 */
function beginDeal(table, eventType, extraPayload = {}, fixedHands = null) {
  table.dealEpoch = (table.dealEpoch || 0) + 1;
  table.gameState = createGameState(table, fixedHands);
  if (fixedHands) table.gameState.isReplay = true;
  table.biddingState = createBiddingState(table);

  if (table.gameMode === 'minibridge') {
    const roles = determineMiniRoles(table);

    if (roles.redeal) {
      table.miniState = { phase: 'redeal', points: roles.points };

      sendToTablePlayers(table, {
        type: 'miniRedeal',
        points: roles.points,
        message: '20-20. Redealing.'
      });

      const epochAtSchedule = table.dealEpoch;
      setTimeout(() => {
        if (table && tables.has(table.code) && table.dealEpoch === epochAtSchedule) {
          try {
            table.currentDealer = getNextDealer(table.currentDealer || 'south');
            beginDeal(table, eventType);
          } catch (error) {
            console.error(`Error redealing minibridge table ${table.code}:`, error);
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
      }, 3000);
      return;
    }

    table.miniState = {
      phase: 'contract',
      points: roles.points,
      declarer: roles.declarer,
      dummy: roles.dummy
    };
    table.gameState.gamePhase = 'contract';
    table.gameState.declarer = roles.declarer;
    table.gameState.dummy = roles.dummy;
  }

  const payload = {
    type: eventType,
    dealNumber: table.dealNumber,
    dealer: table.currentDealer,
    gameState: filterGameState(table.gameState, null),
    biddingState: table.biddingState
  };

  if (eventType === 'gameStarted') {
    payload.players = filterTablePlayers(table.players);
    payload.creatorPosition = table.creatorPosition || null;
  }

  payload.autoNextDeal = !!table.autoNextDeal;

  if (table.gameMode === 'minibridge') {
    payload.gameMode = table.gameMode;
    payload.miniState = table.miniState;
  }

  Object.assign(payload, extraPayload);

  sendToTablePlayers(table, payload);
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

  // Minibridge: reveal dummy right after points, before the contract is chosen
  if (table.gameMode === 'minibridge' && table.miniState && table.miniState.phase === 'contract') {
    const dummyPosition = table.miniState.dummy;
    sendToTablePlayers(table, {
      type: 'dummyRevealed',
      dummyPosition: dummyPosition,
      dummyCards: table.gameState.hands[dummyPosition]
    });
    revealRobotDeclarerHandIfNeeded(table);
  }

  maybeTriggerRobot(table);
}

/**
 * Count high card points (honor points) in a hand
 */
function countHcp(hand) {
  return Object.values(hand).flat()
    .reduce((sum, v) => sum + (HCP[v] || 0), 0);
}

/**
 * Seating order starting from the dealer, going clockwise
 */
function orderFromDealer(dealer) {
  const seats = ['north', 'east', 'south', 'west'];
  const i = seats.indexOf(dealer);
  return [...seats.slice(i), ...seats.slice(0, i)];
}

/**
 * Determine points, playing side, declarer and dummy for a minibridge deal
 */
function determineMiniRoles(table) {
  const h = table.gameState.hands;
  const points = {
    north: countHcp(h.north), east: countHcp(h.east),
    south: countHcp(h.south), west: countHcp(h.west)
  };
  const ns = points.north + points.south;
  const ew = points.east + points.west;
  if (ns === ew) return { points, redeal: true };

  let [a, b] = ns > ew ? ['north', 'south'] : ['east', 'west'];
  if (points[b] > points[a]) [a, b] = [b, a];
  else if (points[a] === points[b]) {
    const order = orderFromDealer(table.currentDealer);
    if (order.indexOf(b) < order.indexOf(a)) [a, b] = [b, a];
  }
  return { points, declarer: a, dummy: b, redeal: false };
}

/**
 * Declarer chooses the minibridge contract (partscore or game)
 */
function chooseMiniContract(socket, playerId, data) {
  const { tableCode, type, strain } = data || {};
  const table = tables.get(tableCode);
  if (!table || table.gameMode !== 'minibridge') {
    sendError(socket, 'Not a minibridge table');
    return;
  }

  const ms = table.miniState;
  if (!ms || ms.phase !== 'contract') {
    sendError(socket, 'Contract cannot be chosen now');
    return;
  }

  const effectiveDeclarer = getEffectiveController(table) || ms.declarer;
  if (!table.players[effectiveDeclarer] || table.players[effectiveDeclarer].id !== playerId) {
    sendError(socket, 'Only the declarer chooses the contract');
    return;
  }

  if (!['S', 'H', 'D', 'C', 'N'].includes(strain) || !['partscore', 'game'].includes(type)) {
    sendError(socket, 'Invalid contract');
    return;
  }

  applyMiniContract(table, type, strain);
}

/**
 * Apply a chosen minibridge contract (partscore or game) and move to the
 * play phase. Shared by the declarer's own choice and the robot's choice.
 */
function applyMiniContract(table, type, strain) {
  const ms = table.miniState;
  const level = type === 'game' ? MINI_GAME_LEVEL[strain] : 1;
  Object.assign(table.biddingState, {
    contract: `${level}${strain}`,
    declarer: ms.declarer,
    dummy: ms.dummy,
    trumpSuit: MINI_TRUMP[strain],
    biddingComplete: true
  });

  ms.phase = 'play';
  table.lastActivity = Date.now();
  moveToPlayPhase(table);
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

  if (table.gameMode === 'minibridge') {
    sendError(socket, 'Bidding is not used in minibridge');
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

    maybeTriggerRobot(table);
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
    const epochAtSchedule = table.dealEpoch;
    setTimeout(() => {
      if (table.dealEpoch !== epochAtSchedule) return; // this deal was abandoned in the meantime
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
  // Kept separate from leadingPlayer (which is overwritten by each trick's
  // winner): the solver needs the deal's original opening leader throughout.
  table.gameState.openingLeader = table.gameState.currentPlayer;

  sendToTablePlayers(table, {
    type: 'biddingComplete',
    contract: table.gameState.contract,
    declarer: table.gameState.declarer,
    dummy: table.gameState.dummy,
    trumpSuit: table.gameState.trumpSuit,
    currentPlayer: table.gameState.currentPlayer,
    gameState: filterGameState(table.gameState, null)
  });

  revealRobotDeclarerHandIfNeeded(table);
  maybeTriggerRobot(table);
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
  // (or, if the declarer is a robot and dummy is human, that human controls both)
  const isDummy = position === table.gameState.dummy;
  const isDeclarerSeat = position === table.gameState.declarer;
  const override = getEffectiveController(table);

  let isController;
  if (override) {
    isController = (isDummy || isDeclarerSeat) && table.players[override].id === playerId;
  } else if (isDummy) {
    isController = table.players[table.gameState.declarer].id === playerId;
  } else {
    isController = table.players[position].id === playerId;
  }

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
  
// Check following suit (only if trick is in progress, not complete)
if (table.gameState.currentTrick.length > 0 && table.gameState.currentTrick.length < 4) {
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
    const epochAtSchedule = table.dealEpoch;
    setTimeout(() => {
      if (table.dealEpoch !== epochAtSchedule) return; // this deal was abandoned in the meantime
      processTrick(table);
    }, 3000);
  } else {
    // Move to next player
    table.gameState.currentPlayer = getNextPlayer(table.gameState.currentPlayer);

    sendToTablePlayers(table, {
      type: 'nextPlayer',
      currentPlayer: table.gameState.currentPlayer
    });

    maybeTriggerRobot(table);
  }

  // If this was first card played, reveal dummy cards
  // (minibridge already reveals dummy right after points are announced)
  if (table.gameState.playedCards.length === 1 && table.gameMode !== 'minibridge') {
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

  maybeTriggerRobot(table);
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
 * If the declarer is a robot and dummy is a human, that human takes over
 * declarer's decisions for the whole deal (contract choice and card play) --
 * the common practice when playing bridge with robots, since otherwise the
 * human would just be watching the robot play both hands. Returns the
 * human's position, or null if no such override applies.
 */
function getEffectiveController(table) {
  const gs = table.gameState;
  if (!gs || !gs.declarer || !gs.dummy) return null;
  const declarerPlayer = table.players[gs.declarer];
  const dummyPlayer = table.players[gs.dummy];
  if (declarerPlayer && declarerPlayer.type === 'robot' && dummyPlayer && dummyPlayer.type === 'human') {
    return gs.dummy;
  }
  return null;
}

/**
 * Privately sends the robot declarer's hand to the human who is taking over
 * for it (see getEffectiveController()). Never broadcast -- the defenders
 * must not see it.
 */
function revealRobotDeclarerHandIfNeeded(table) {
  const override = getEffectiveController(table);
  if (!override) return;

  const overridePlayerData = table.players[override];
  if (!overridePlayerData || !overridePlayerData.id) return;
  const player = players.get(overridePlayerData.id);
  if (!player || !player.socket) return;

  player.socket.emit('declarerHandRevealed', {
    declarerPosition: table.gameState.declarer,
    declarerCards: table.gameState.hands[table.gameState.declarer]
  });
}

/**
 * Position actually in control of the current decision: the current player,
 * unless that player is the dummy, in which case the declarer controls the
 * dummy's hand (same rule for bridge and minibridge) -- or, if the declarer
 * is a robot and dummy is human, the human at the dummy seat controls both.
 */
function currentController(table) {
  if (!table.gameState) return null;
  const gs = table.gameState;
  const cp = gs.currentPlayer;
  if (gs.gamePhase !== 'play') return cp;

  const override = getEffectiveController(table);
  if (override && (cp === gs.declarer || cp === gs.dummy)) {
    return override;
  }
  if (cp === gs.dummy) {
    return gs.declarer;
  }
  return cp;
}

/**
 * If the position now on turn is controlled by a robot, schedule its move
 * after a short "thinking" delay. Safe to call after every turn transition;
 * it is a no-op whenever the position on turn is a human (or reconnecting).
 */
function maybeTriggerRobot(table) {
  if (!table.gameState || table.state !== 'playing') return;

  const phase = table.gameState.gamePhase;
  let controller = null;
  if (phase === 'bidding') {
    controller = table.biddingState && table.biddingState.currentBidder;
  } else if (phase === 'contract') {
    controller = getEffectiveController(table) || (table.miniState && table.miniState.declarer);
  } else if (phase === 'play') {
    controller = currentController(table);
  } else {
    return;
  }

  if (!controller || !table.players[controller] || table.players[controller].type !== 'robot') {
    return;
  }

  const epochAtSchedule = table.dealEpoch;
  setTimeout(() => {
    if (!tables.has(table.code)) return; // table could vanish while we waited
    if (table.dealEpoch !== epochAtSchedule) return; // deal was abandoned/replayed in the meantime
    runRobotTurn(table, phase, epochAtSchedule).catch(err => {
      console.error(`Robot turn failed at table ${table.code}:`, err);
    });
  }, 1200 + Math.random() * 800);
}

/**
 * Perform the robot's move. Re-checks the table's actual state instead of
 * trusting the values captured when the timer was scheduled, since the
 * situation (redeal, disconnect, table teardown, a manually requested next
 * deal) may have changed meanwhile -- including while an async GIB or solver
 * call was in flight, which is why `epoch` is re-checked after each await
 * too, not just once at the top.
 */
async function runRobotTurn(table, expectedPhase, epoch) {
  if (!tables.has(table.code) || table.state !== 'playing' || !table.gameState) return;
  if (table.dealEpoch !== epoch) return;
  if (table.gameState.gamePhase !== expectedPhase) return;

  if (expectedPhase === 'bidding') {
    const position = table.biddingState.currentBidder;
    if (!table.players[position] || table.players[position].type !== 'robot') return;
    const bid = await robot.decideRobotBid(table, position);
    if (table.dealEpoch !== epoch) return; // this deal ended while GIB was thinking
    processBid(table, position, bid);
    return;
  }

  if (expectedPhase === 'contract') {
    const position = table.miniState.declarer;
    if (!table.players[position] || table.players[position].type !== 'robot') return;
    const { type, strain } = robot.decideMiniContract(table, position);
    applyMiniContract(table, type, strain);
    return;
  }

  if (expectedPhase === 'play') {
    const handToPlay = table.gameState.currentPlayer;
    const controller = currentController(table);
    if (!table.players[controller] || table.players[controller].type !== 'robot') return;
    if (table.gameState.trickLocked) return; // a trick is already being resolved

    const move = await robot.decideRobotCard(table, handToPlay);
    if (table.dealEpoch !== epoch) return; // this deal ended while the solver was thinking
    if (!move) return;
    processCardPlay(table, handToPlay, move.suit, move.card);
  }
}

/**
 * End game and start countdown for next deal
 */
async function endGame(table) {
    table.gameState.gamePhase = 'end';

    // Calculate result based on contract
    let resultMessage = '';
    let dealScore = null;
    let doubleDummyTricks = null;
    let actualTricks = null;
    let dealVulnerability = null;

    if (table.gameState.contract) {
        const level = parseInt(table.gameState.contract.charAt(0));
        const requiredTricks = level + 6;

        const declarerSide = table.gameState.declarer === 'north' || table.gameState.declarer === 'south' ? 'ns' : 'ew';
        const madeTricks = table.gameState.tricks[declarerSide];
        actualTricks = madeTricks;

        // Double dummy comparison (vaihe 11): how many tricks perfect play on
        // both sides would have made with this contract's trump. Shown to
        // everyone at the table, robots or not -- purely informational.
        try {
            doubleDummyTricks = await solver.solveContract(table.gameState.originalHands, table.gameState.trumpSuit, table.gameState.declarer);
        } catch (error) {
            console.error(`Double dummy comparison failed for table ${table.code}:`, error.message);
        }

        if (table.gameMode === 'minibridge') {
            dealScore = scoreMiniDeal(table.gameState.contract, madeTricks);
            // A replayed deal shows its own result but never touches the
            // cumulative score -- the original playing of the deal already
            // counted, and replaying it again is for practice/review.
            if (!table.gameState.isReplay) {
                // Undertrick points accrue to the defending side, like in duplicate bridge
                const defenderSide = declarerSide === 'ns' ? 'ew' : 'ns';
                if (dealScore >= 0) {
                    table.miniScore[declarerSide] += dealScore;
                } else {
                    table.miniScore[defenderSide] += -dealScore;
                }
            }
        } else {
            dealVulnerability = getVulnerability(table.dealNumber || 1);
            const declarerVulnerable = dealVulnerability === 'Both' ||
                dealVulnerability === declarerSide.toUpperCase();
            dealScore = scoreContractDeal(table.gameState.contract, madeTricks, declarerVulnerable);
            if (!table.gameState.isReplay) {
                const defenderSide = declarerSide === 'ns' ? 'ew' : 'ns';
                if (!table.bridgeScore) table.bridgeScore = { ns: 0, ew: 0 };
                if (dealScore >= 0) {
                    table.bridgeScore[declarerSide] += dealScore;
                } else {
                    table.bridgeScore[defenderSide] += -dealScore;
                }
            }
        }

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

    const gameOverPayload = {
        type: 'gameOver',
        message: resultMessage,
        tricks: table.gameState.tricks,
        contract: table.gameState.contract,
        dealNumber: table.dealNumber || 1,
        dealer: table.currentDealer || 'south',
        isReplay: !!table.gameState.isReplay
    };

    if (table.gameMode === 'minibridge') {
        gameOverPayload.dealScore = dealScore;
        gameOverPayload.totalScore = table.miniScore;
    } else if (table.gameState.contract) {
        gameOverPayload.dealScore = dealScore;
        gameOverPayload.totalScore = table.bridgeScore;
        gameOverPayload.vulnerable = dealVulnerability;
    }

    if (doubleDummyTricks !== null) {
        gameOverPayload.doubleDummyTricks = doubleDummyTricks;
        gameOverPayload.actualTricks = actualTricks;
    }

    gameOverPayload.autoNextDeal = !!table.autoNextDeal;

    sendToTablePlayers(table, gameOverPayload);

    console.log(`Game ${table.code} ended: ${resultMessage}`);

    if (table.pendingNextDealTimeout) {
        clearTimeout(table.pendingNextDealTimeout);
        table.pendingNextDealTimeout = null;
    }

    // Automatic new deal after 10 seconds, unless the table has turned this off
    // (a player can still always start the next deal manually, see requestNextDeal())
    if (table.autoNextDeal) {
        table.pendingNextDealTimeout = setTimeout(() => {
            table.pendingNextDealTimeout = null;
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
}

/**
 * Toggle whether the table automatically starts the next deal after a deal
 * ends. Shared table setting -- any seated player may change it, and every
 * player at the table is notified so their checkbox stays in sync.
 */
function setAutoNextDeal(socket, playerId, data) {
    const { tableCode, enabled } = data || {};
    const table = tables.get(tableCode);
    if (!table) {
        sendError(socket, 'Table not found');
        return;
    }

    const player = players.get(playerId);
    if (!player || player.table !== tableCode) {
        sendError(socket, 'You are not seated at this table');
        return;
    }

    table.autoNextDeal = !!enabled;

    // If a deal has already ended and the automatic next-deal countdown is
    // running, turning auto off should actually cancel it -- not just take
    // effect starting with some future deal.
    if (!table.autoNextDeal && table.pendingNextDealTimeout) {
        clearTimeout(table.pendingNextDealTimeout);
        table.pendingNextDealTimeout = null;
    }

    sendToTablePlayers(table, { type: 'autoNextDealChanged', enabled: table.autoNextDeal });
}

/**
 * Manually start the next deal. Works at any point in the current deal, not
 * only after it has ended -- the creator can abandon a deal they don't want
 * to finish playing. beginDeal()'s dealEpoch bump makes sure anything still
 * in flight for the abandoned deal (a trick-resolution timer, a redeal
 * timer, an in-flight GIB/solver call) recognizes it's stale and no-ops
 * instead of mutating the new deal.
 */
function requestNextDeal(socket, playerId, data) {
    const { tableCode } = data || {};
    const table = tables.get(tableCode);
    if (!table) {
        sendError(socket, 'Table not found');
        return;
    }

    const player = players.get(playerId);
    if (!player || player.table !== tableCode) {
        sendError(socket, 'You are not seated at this table');
        return;
    }

    if (table.creatorPosition && player.position !== table.creatorPosition) {
        sendError(socket, 'Only the player who created the table can start the next deal');
        return;
    }

    if (!table.gameState) {
        sendError(socket, 'No deal in progress');
        return;
    }

    const activePlayers = Object.values(table.players).filter(p => p !== null);
    if (activePlayers.length !== 4) {
        sendError(socket, 'Waiting for all players to be present');
        return;
    }

    const abandoned = table.gameState.gamePhase !== 'end';

    if (table.pendingNextDealTimeout) {
        clearTimeout(table.pendingNextDealTimeout);
        table.pendingNextDealTimeout = null;
    }

    startNextDeal(table, abandoned ? { abandoned: true } : {});
}

/**
 * Replay the just-finished deal: same cards, same dealer, fresh bidding and
 * play. Creator-only, like requestNextDeal(). The deal number and dealer are
 * left untouched (it's the same deal, not the next one), and if the replay
 * reaches the end again, its minibridge score is not added to the table's
 * cumulative total (see endGame()) -- it's for practice/review.
 */
function replayDeal(socket, playerId, data) {
    const { tableCode } = data || {};
    const table = tables.get(tableCode);
    if (!table) {
        sendError(socket, 'Table not found');
        return;
    }

    const player = players.get(playerId);
    if (!player || player.table !== tableCode) {
        sendError(socket, 'You are not seated at this table');
        return;
    }

    if (table.creatorPosition && player.position !== table.creatorPosition) {
        sendError(socket, 'Only the player who created the table can replay a deal');
        return;
    }

    if (!table.gameState || table.gameState.gamePhase !== 'end') {
        sendError(socket, 'The current deal has not ended yet');
        return;
    }

    const activePlayers = Object.values(table.players).filter(p => p !== null);
    if (activePlayers.length !== 4) {
        sendError(socket, 'Waiting for all players to be present');
        return;
    }

    if (table.pendingNextDealTimeout) {
        clearTimeout(table.pendingNextDealTimeout);
        table.pendingNextDealTimeout = null;
    }

    const handsToReplay = table.gameState.originalHands;

    try {
        table.state = 'playing';
        table.lastActivity = Date.now();
        beginDeal(table, 'newDealStarted', { replayed: true }, handsToReplay);
        console.log(`Replaying deal ${table.dealNumber} for table ${table.code}`);
    } catch (error) {
        console.error(`Error replaying deal for table ${table.code}:`, error);
        sendToTablePlayers(table, {
            type: 'dealError',
            message: 'Error replaying the deal. You can start a new game manually.',
            error: error.message
        });
        table.state = 'waiting';
        table.gameState = null;
        table.biddingState = null;
    }
}

/**
 * Score a minibridge deal from the declarer side's point of view
 * (negative return value = contract went down)
 */
function scoreMiniDeal(contract, tricksMade) {
  const level = parseInt(contract[0], 10);
  const strain = contract[1];
  const need = level + 6;
  if (tricksMade < need) return -50 * (need - tricksMade);

  const per = strain === 'C' || strain === 'D' ? 20 : 30;
  const trickPoints = (n) => strain === 'N' ? 40 + 30 * (n - 1) : per * n;
  const contractPoints = trickPoints(level);
  const overtricks = (tricksMade - need) * (strain === 'N' ? 30 : per);
  const bonus = contractPoints >= 100 ? 300 : 50;
  return contractPoints + overtricks + bonus;
}

/**
 * Standard duplicate-bridge vulnerability cycle (16 boards, then repeats),
 * indexed by deal number. There's no separate "board" concept in this app --
 * table.dealNumber IS the board number for this purpose. Returns 'None',
 * 'NS', 'EW' or 'Both'.
 */
const VULNERABILITY_CYCLE = [
    'None', 'NS', 'EW', 'Both', 'NS', 'EW', 'Both', 'None',
    'EW', 'Both', 'None', 'NS', 'Both', 'None', 'NS', 'EW'
];
function getVulnerability(dealNumber) {
    const n = dealNumber && dealNumber > 0 ? dealNumber : 1;
    return VULNERABILITY_CYCLE[(n - 1) % 16];
}

/**
 * Score a completed contract deal in standard (rubber-style points, no
 * matchpoints/IMPs) duplicate bridge scoring, from the declaring side's point
 * of view (negative return value = contract went down, points go to the
 * defenders instead -- same convention as scoreMiniDeal above).
 */
function scoreContractDeal(contract, tricksMade, vulnerable) {
    const level = parseInt(contract.charAt(0), 10);
    const strain = contract.charAt(1); // C/D/H/S/N
    const redoubled = contract.endsWith('XX');
    const doubled = !redoubled && contract.endsWith('X');
    const required = level + 6;

    if (tricksMade < required) {
        const down = required - tricksMade;
        let penalty;
        if (!doubled && !redoubled) {
            penalty = (vulnerable ? 100 : 50) * down;
        } else {
            penalty = 0;
            for (let i = 1; i <= down; i++) {
                if (!vulnerable) {
                    penalty += i === 1 ? 100 : (i <= 3 ? 200 : 300);
                } else {
                    penalty += i === 1 ? 200 : 300;
                }
            }
            if (redoubled) penalty *= 2;
        }
        return -penalty;
    }

    const perTrick = (strain === 'C' || strain === 'D') ? 20 : 30;
    const trickValue = (n) => strain === 'N' ? 40 + 30 * (n - 1) : perTrick * n;
    let contractPoints = trickValue(level);
    const overtricks = tricksMade - required;

    let overtrickPoints;
    if (!doubled && !redoubled) {
        overtrickPoints = (strain === 'N' ? 30 : perTrick) * overtricks;
    } else {
        overtrickPoints = (vulnerable ? 200 : 100) * overtricks * (redoubled ? 2 : 1);
    }

    if (doubled) contractPoints *= 2;
    if (redoubled) contractPoints *= 4;

    const madeBonus = contractPoints >= 100 ? (vulnerable ? 500 : 300) : 50;

    let slamBonus = 0;
    if (level === 6) slamBonus = vulnerable ? 750 : 500;
    else if (level === 7) slamBonus = vulnerable ? 1500 : 1000;

    const insultBonus = redoubled ? 100 : (doubled ? 50 : 0);

    return contractPoints + overtrickPoints + madeBonus + slamBonus + insultBonus;
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
 * Start next deal (automatically, or on request)
 */
function startNextDeal(table, extraPayload = {}) {
    try {
        table.currentDealer = getNextDealer(table.currentDealer || 'south');
        table.dealNumber = (table.dealNumber || 1) + 1;

        console.log(`Starting deal ${table.dealNumber}, dealer: ${table.currentDealer} for table ${table.code}`);

        table.state = 'playing';
        table.lastActivity = Date.now();

        beginDeal(table, 'newDealStarted', extraPayload);

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
        created: table.created,
        gameMode: table.gameMode || 'bridge'
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
function createGameState(table, fixedHands) {
  const cards = fixedHands ? JSON.parse(JSON.stringify(fixedHands)) : dealCards();

  return {
    players: table.players,
    currentPlayer: 'south',
    gamePhase: 'bidding',
    hands: cards,
    // Snapshot of the full deal before any card is removed by play. The
    // double-dummy solver needs every player's complete original hand to
    // replay the deal; `hands` above is mutated as cards are played and
    // cannot be used for that (see lib/robot.js, endGame()).
    originalHands: JSON.parse(JSON.stringify(cards)),
    playedCards: [],
    currentTrick: [],
    contract: null,
    trumpSuit: null,
    declarer: null,
    dummy: null,
    tricks: { ns: 0, ew: 0 },
    totalTricks: 0,
    leadingPlayer: 'south',
    trickLocked: false,
    // 'None'/'NS'/'EW'/'Both' -- see getVulnerability(). Computed for every
    // deal regardless of game mode, but only meaningful (and announced) for
    // standard bridge; minibridge's own scoring (scoreMiniDeal) ignores it.
    vulnerable: getVulnerability(table.dealNumber)
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
    created: table.created,
    gameMode: table.gameMode || 'bridge',
    creatorPosition: table.creatorPosition || null
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

  // Remove hands info (sent separately, and only to their owner/dummy-viewers)
  delete filteredState.hands;
  // originalHands is solver-internal (double-dummy comparisons, robot card
  // play) and holds every player's true starting cards unmasked -- it must
  // never reach a client, or any player could read everyone else's hand.
  delete filteredState.originalHands;

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
  console.log(`BridgeCircle Server running on port ${PORT}`);
  console.log('Features:');
  console.log('- Human players, with robots auto-filling empty seats at start');
  console.log('- Real-time multiplayer bridge');
  console.log('- Automatic dealing and scoring');
  console.log('- Table management and chat');
});