const { v4: uuidv4 } = require('uuid');
const game = require('./game');
const bidding = require('./bidding');
const gibIntegration = require('./gib-integration');

// Pöytien säilytys
const tables = new Map();

// Pöytäobjektin luonti
function createTableObject(code, creator) {
  return {
    code: code,
    players: {
      north: null,
      east: null,
      south: null,
      west: null
    },
    status: 'waiting', // 'waiting', 'playing', 'ended'
    gameState: null,
    biddingState: null,
    connections: new Set(),
    created: Date.now(),
    lastActivity: Date.now(),
    creator: creator
  };
}

// Generoi uniikki pöytäkoodi
function generateTableCode() {
  const code = Math.floor(1000 + Math.random() * 9000).toString();
  return tables.has(code) ? generateTableCode() : code;
}

// Pöydän luonti
function createTable(io, socket, data) {
  const { playerName, position } = data;
  
  if (!playerName || !position) {
    socket.emit('error', { message: 'Nimi tai positio puuttuu' });
    return;
  }
  
  // Tarkista onko pelaaja jo jossain pöydässä
  const currentTable = findTableBySocketId(socket.id);
  if (currentTable) {
    socket.emit('error', { message: 'Olet jo liittynyt pöytään' });
    return;
  }
  
  const tableCode = generateTableCode();
  const table = createTableObject(tableCode, socket.id);
  
  // Aseta pelaaja pöytään
  table.players[position] = { 
    name: playerName, 
    id: socket.id, 
    type: 'human' 
  };
  
  table.connections.add(socket.id);
  tables.set(tableCode, table);
  
  // Liitä socket room:iin
  socket.join(tableCode);
  
  // Ilmoita onnistuneesta pöydän luomisesta
  socket.emit('tableCreated', { 
    tableCode, 
    table: filterTableForClient(table)
  });
  
  console.log(`Pöytä ${tableCode} luotu, pelaaja ${playerName} (${position})`);
}

// Pöytään liittyminen
function joinTable(io, socket, data) {
  const { playerName, tableCode } = data;
  
  if (!playerName || !tableCode) {
    socket.emit('error', { message: 'Nimi tai pöytäkoodi puuttuu' });
    return;
  }
  
  const table = tables.get(tableCode);
  if (!table) {
    socket.emit('error', { message: 'Pöytää ei löydy' });
    return;
  }
  
  if (table.status !== 'waiting') {
    socket.emit('error', { message: 'Peli on jo käynnissä' });
    return;
  }
  
  // Tarkista onko pelaaja jo jossain pöydässä
  const currentTable = findTableBySocketId(socket.id);
  if (currentTable) {
    socket.emit('error', { message: 'Olet jo liittynyt pöytään' });
    return;
  }
  
  // Lähetä vapaat paikat
  const availablePositions = Object.entries(table.players)
    .filter(([pos, player]) => player === null)
    .map(([pos]) => pos);
    
  if (availablePositions.length === 0) {
    socket.emit('error', { message: 'Pöytä on täynnä' });
    return;
  }
  
  socket.emit('selectPosition', { 
    tableCode, 
    positions: availablePositions,
    currentPlayers: table.players
  });
}

// Paikan valinta
function selectPosition(io, socket, data) {
  const { tableCode, position, playerName } = data;
  
  if (!tableCode || !position || !playerName) {
    socket.emit('error', { message: 'Puutteelliset tiedot' });
    return;
  }
  
  const table = tables.get(tableCode);
  if (!table) {
    socket.emit('error', { message: 'Pöytää ei löydy' });
    return;
  }
  
  if (table.players[position]) {
    socket.emit('error', { message: 'Paikka on jo varattu' });
    return;
  }
  
  // Aseta pelaaja pöytään
  table.players[position] = { 
    name: playerName, 
    id: socket.id, 
    type: 'human' 
  };
  
  table.connections.add(socket.id);
  table.lastActivity = Date.now();
  
  // Liitä socket room:iin
  socket.join(tableCode);
  
  // Ilmoita kaikille pelaajille
  io.to(tableCode).emit('playerJoined', { 
    position, 
    playerName, 
    table: filterTableForClient(table)
  });
  
  console.log(`Pelaaja ${playerName} liittyi pöytään ${tableCode} positiolle ${position}`);
}

// Pöydän tietojen lähetys
function sendTableInfo(socket, data) {
  const { tableCode } = data;
  
  if (!tableCode) {
    socket.emit('error', { message: 'Pöytäkoodi puuttuu' });
    return;
  }
  
  const table = tables.get(tableCode);
  if (!table) {
    socket.emit('error', { message: 'Pöytää ei löydy' });
    return;
  }
  
  socket.emit('tableInfo', { 
    table: filterTableForClient(table)
  });
}

// Pöydästä poistuminen
function leaveTable(io, socket) {
  const table = findTableBySocketId(socket.id);
  if (!table) {
    socket.emit('error', { message: 'Et ole liittynyt mihinkään pöytään' });
    return;
  }
  
  // Etsi pelaajan positio
  let position = null;
  for (const [pos, player] of Object.entries(table.players)) {
    if (player && player.id === socket.id) {
      position = pos;
      break;
    }
  }
  
  if (!position) {
    return;
  }
  
  // Jos peli on käynnissä, korvaa pelaaja GIB-tekoälyllä
  if (table.status === 'playing') {
    table.players[position] = {
      name: `GIB ${position}`,
      id: null,
      type: 'gib'
    };
    
    // Ilmoita muille pelaajille
    io.to(table.code).emit('playerReplaced', {
      position,
      table: filterTableForClient(table)
    });
    
    // Jos korvattu pelaaja oli vuorossa, GIB:n vuoro
    handleGibTurn(io, table, position);
  } else {
    // Poista pelaaja pöydästä
    table.players[position] = null;
    
    // Ilmoita muille pelaajille
    io.to(table.code).emit('playerLeft', { 
      position,
      table: filterTableForClient(table)
    });
  }
  
  // Poista socket pöydän yhteyksistä
  table.connections.delete(socket.id);
  socket.leave(table.code);
  
  // Jos pöytä on tyhjä, poista se
  if (table.connections.size === 0 && table.status !== 'playing') {
    tables.delete(table.code);
    console.log(`Pöytä ${table.code} poistettu (tyhjä)`);
  }
}

// Pelin aloittaminen
async function startGame(io, socket, data) {
  const { tableCode } = data;
  
  if (!tableCode) {
    socket.emit('error', { message: 'Pöytäkoodi puuttuu' });
    return;
  }
  
  const table = tables.get(tableCode);
  if (!table) {
    socket.emit('error', { message: 'Pöytää ei löydy' });
    return;
  }
  
  // Tarkista onko oikeus aloittaa peli
  if (!table.connections.has(socket.id)) {
    socket.emit('error', { message: 'Sinulla ei ole oikeutta aloittaa peliä' });
    return;
  }
  
  table.status = 'playing';
  table.lastActivity = Date.now();
  
  // Korvaa puuttuvat pelaajat GIB-tekoälyllä
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
    // Jaa kortit käyttäen GIB API:a
    const deal = await gibIntegration.getDeal();
    
    if (deal) {
      // Alusta pelitila jaetuilla korteilla
      table.gameState = game.initializeGameState(deal, table.players);
      table.biddingState = bidding.initializeBiddingState('south'); // Aloita aina etelästä
      
      // Lähetä pelin tila kaikille pelaajille
      io.to(tableCode).emit('gameStarted', { 
        gameState: game.filterGameStateForClient(table.gameState, null),
        biddingState: table.biddingState,
        players: table.players
      });
      
      // Lähetä kunkin pelaajan omat kortit yksityisesti
      for (const [position, player] of Object.entries(table.players)) {
        if (player.type === 'human' && player.id) {
          io.to(player.id).emit('yourCards', {
            position: position,
            cards: table.gameState.hands[position]
          });
        }
      }
      
      console.log(`Peli aloitettu pöydässä ${tableCode}`);
      
      // Jos ensimmäinen tarjoaja on GIB, käsittele GIB:n vuoro
      handleGibTurn(io, table);
    } else {
      // Fallback jos GIB API ei vastaa
      table.gameState = game.generateRandomGameState(table.players);
      table.biddingState = bidding.initializeBiddingState('south');
      
      io.to(tableCode).emit('gameStarted', { 
        gameState: game.filterGameStateForClient(table.gameState, null),
        biddingState: table.biddingState,
        players: table.players
      });
      
      for (const [position, player] of Object.entries(table.players)) {
        if (player.type === 'human' && player.id) {
          io.to(player.id).emit('yourCards', {
            position: position,
            cards: table.gameState.hands[position]
          });
        }
      }
      
      // Jos ensimmäinen tarjoaja on GIB, käsittele GIB:n vuoro
      handleGibTurn(io, table);
    }
  } catch (error) {
    console.error('Virhe pelin aloittamisessa:', error);
    socket.emit('error', { message: 'Virhe pelin aloittamisessa' });
    table.status = 'waiting';
  }
}

// GIB-vuoron käsittely
function handleGibTurn(io, table, position) {
  if (!table.biddingState || !table.gameState) return;
  
  // Tarkista mikä vaihe pelissä on menossa
  if (!table.biddingState.biddingComplete) {
    // Tarjousvaihe
    const currentBidder = position || table.biddingState.currentBidder;
    if (table.players[currentBidder]?.type === 'gib') {
      setTimeout(() => {
        bidding.makeGibBid(io, table, currentBidder);
      }, 1500);
    }
  } else {
    // Pelivaihe
    const currentPlayer = position || table.gameState.currentPlayer;
    if (table.players[currentPlayer]?.type === 'gib') {
      setTimeout(() => {
        game.makeGibMove(io, table, currentPlayer);
      }, 1500);
    }
  }
}

// Chat-viestin käsittely
function handleChatMessage(io, socket, data) {
  const { tableCode, message } = data;
  
  if (!tableCode || !message) {
    return;
  }
  
  const table = tables.get(tableCode);
  if (!table) {
    return;
  }
  
  // Etsi pelaajan nimi ja positio
  let playerName = 'Unknown';
  let position = null;
  
  for (const [pos, player] of Object.entries(table.players)) {
    if (player && player.id === socket.id) {
      playerName = player.name;
      position = pos;
      break;
    }
  }
  
  if (!position) return;
  
  // Lähetä chat-viesti kaikille pöydässä
  io.to(tableCode).emit('chatMessage', {
    sender: playerName,
    position,
    message,
    timestamp: Date.now()
  });
}

// Aktiivisten pöytien listaus
function sendActiveTables(socket) {
  const activeTablesInfo = Array.from(tables.entries())
    .filter(([_, table]) => table.status === 'waiting')
    .map(([code, table]) => {
      const playerCount = Object.values(table.players).filter(p => p !== null).length;
      return {
        code,
        players: playerCount,
        created: table.created
      };
    });
  
  socket.emit('activeTablesList', { tables: activeTablesInfo });
}

// Vanhojen pöytien siivous
function cleanupOldTables(io) {
  const now = Date.now();
  const MAX_IDLE_TIME = 3600000; // 1 tunti
  
  for (const [code, table] of tables.entries()) {
    if (now - table.lastActivity > MAX_IDLE_TIME) {
      io.to(code).emit('tableRemoved', {
        message: 'Pöytä suljettu passiivisuuden vuoksi'
      });
      
      tables.delete(code);
      console.log(`Pöytä ${code} poistettu passiivisuuden vuoksi`);
    }
  }
}

// Apufunktiot
function findTableBySocketId(socketId) {
  for (const table of tables.values()) {
    if (table.connections.has(socketId)) {
      return table;
    }
  }
  return null;
}

function filterTableForClient(table) {
  return {
    code: table.code,
    players: table.players,
    status: table.status,
    created: table.created
  };
}

module.exports = {
  createTable,
  joinTable,
  selectPosition,
  sendTableInfo,
  leaveTable,
  startGame,
  sendActiveTables,
  handleChatMessage,
  cleanupOldTables,
  findTableBySocketId
};