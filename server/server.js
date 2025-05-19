const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config();

// Palvelinmoduulien tuonti
const tableManager = require('./modules/table-manager');
const playerManager = require('./modules/player-manager');
const game = require('./modules/game');
const bidding = require('./modules/bidding');
const gibIntegration = require('./modules/gib-integration');

// Express-sovelluksen alustus
const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Staattiset tiedostot
app.use(express.static(path.join(__dirname, '../public')));

// Health check endpoint Azurea varten
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    uptime: process.uptime(),
    timestamp: Date.now()
  });
});

// GIB API proxy endpoints
app.get('/api/gib/deal', gibIntegration.getDealEndpoint);
app.get('/api/gib/robot', gibIntegration.getRobotMoveEndpoint);
app.get('/api/gib/bid-meanings', gibIntegration.getBidMeaningsEndpoint);

// Solo game handler functions
async function createSoloGame(io, socket, data) {
  const { playerName } = data;
  
  if (!playerName) {
    socket.emit('error', { message: 'Pelaajan nimi puuttuu' });
    return;
  }
  
  // Tarkista onko pelaaja jo jossain pöydässä
  const currentTable = tableManager.findTableBySocketId(socket.id);
  if (currentTable) {
    socket.emit('error', { message: 'Olet jo liittynyt pöytään' });
    return;
  }
  
  // Luo pöytä solo-pelaajaa varten
  const tableCode = Math.floor(1000 + Math.random() * 9000).toString();
  const table = {
    code: tableCode,
    players: {
      north: { name: 'GIB North', id: null, type: 'gib' },
      east: { name: 'GIB East', id: null, type: 'gib' },
      south: { name: playerName, id: socket.id, type: 'human' },
      west: { name: 'GIB West', id: null, type: 'gib' }
    },
    status: 'waiting',
    gameState: null,
    biddingState: null,
    connections: new Set([socket.id]),
    created: Date.now(),
    lastActivity: Date.now(),
    creator: socket.id,
    isSoloGame: true
  };
  
  // Tallenna pöytä
  const tables = tableManager.getTables();
  tables.set(tableCode, table);
  
  // Liitä socket room:iin
  socket.join(tableCode);
  
  // Aloita solo-peli
  startSoloGame(io, socket, { tableCode });
}

async function resetSoloGame(io, socket, data) {
  const { tableCode } = data;
  
  if (!tableCode) {
    socket.emit('error', { message: 'Pöytäkoodi puuttuu' });
    return;
  }
  
  const tables = tableManager.getTables();
  const table = tables.get(tableCode);
  
  if (!table) {
    socket.emit('error', { message: 'Pöytää ei löydy' });
    return;
  }
  
  if (!table.isSoloGame) {
    socket.emit('error', { message: 'Tämä ei ole solo-peli' });
    return;
  }
  
  // Resetoi peli ja aloita uusi
  table.status = 'waiting';
  table.gameState = null;
  table.biddingState = null;
  table.lastActivity = Date.now();
  
  // Aloita peli uudelleen
  startSoloGame(io, socket, { tableCode });
}

async function startSoloGame(io, socket, data) {
  const { tableCode } = data;
  
  if (!tableCode) {
    socket.emit('error', { message: 'Pöytäkoodi puuttuu' });
    return;
  }
  
  const tables = tableManager.getTables();
  const table = tables.get(tableCode);
  
  if (!table) {
    socket.emit('error', { message: 'Pöytää ei löydy' });
    return;
  }
  
  table.status = 'playing';
  table.lastActivity = Date.now();
  
  try {
    // Jaa kortit käyttäen GIB API:a
    const deal = await gibIntegration.getDeal();
    
    if (deal) {
      // Alusta pelitila jaetuilla korteilla
      table.gameState = game.initializeGameState(deal, table.players);
      table.biddingState = bidding.initializeBiddingState('south'); // Aloita aina etelästä
      
      // Lähetä pelin tila pelaajalle
      io.to(tableCode).emit('gameStarted', { 
        gameState: game.filterGameStateForClient(table.gameState, null),
        biddingState: table.biddingState,
        players: table.players
      });
      
      // Lähetä pelaajan omat kortit
      socket.emit('yourCards', {
        position: 'south',
        cards: table.gameState.hands['south']
      });
      
      console.log(`Solo-peli aloitettu pöydässä ${tableCode}`);
      
      // Jos ensimmäinen tarjoaja on GIB, käsittele GIB:n vuoro
      tableManager.handleGibTurn(io, table);
    } else {
      // Fallback jos GIB API ei vastaa
      table.gameState = game.generateRandomGameState(table.players);
      table.biddingState = bidding.initializeBiddingState('south');
      
      io.to(tableCode).emit('gameStarted', { 
        gameState: game.filterGameStateForClient(table.gameState, null),
        biddingState: table.biddingState,
        players: table.players
      });
      
      socket.emit('yourCards', {
        position: 'south',
        cards: table.gameState.hands['south']
      });
      
      // Jos ensimmäinen tarjoaja on GIB, käsittele GIB:n vuoro
      tableManager.handleGibTurn(io, table);
    }
  } catch (error) {
    console.error('Virhe pelin aloittamisessa:', error);
    socket.emit('error', { message: 'Virhe pelin aloittamisessa' });
    table.status = 'waiting';
  }
}

// Expose tables map for the solo game functions
tableManager.getTables = () => {
  // This assumes tableManager is using a Map called 'tables' internally
  // If that's not the case, you'll need to modify the tableManager module
  return tableManager.tables || new Map();
};

// Socket.io-yhteyksien käsittely
io.on('connection', (socket) => {
  console.log('Uusi asiakas yhdistetty:', socket.id);
  
  // Pelaajan hallinta
  socket.on('disconnect', () => playerManager.handleDisconnect(io, socket));
  
  // Lobby-toiminnot
  socket.on('getActiveTables', () => tableManager.sendActiveTables(socket));
  socket.on('createTable', (data) => tableManager.createTable(io, socket, data));
  socket.on('joinTable', (data) => tableManager.joinTable(io, socket, data));
  socket.on('selectPosition', (data) => tableManager.selectPosition(io, socket, data));
  socket.on('getTableInfo', (data) => tableManager.sendTableInfo(socket, data));
  socket.on('leaveTable', () => tableManager.leaveTable(io, socket));
  socket.on('startGame', (data) => tableManager.startGame(io, socket, data));
  
  // Solo-pelitoiminnot (UUDET)
  socket.on('createSoloGame', (data) => createSoloGame(io, socket, data));
  socket.on('resetSoloGame', (data) => resetSoloGame(io, socket, data));
  
  // Pelitoiminnot
  socket.on('makeBid', (data) => bidding.handlePlayerBid(io, socket, data));
  socket.on('playCard', (data) => game.handlePlayedCard(io, socket, data));
  
  // Chat-viestit
  socket.on('sendChatMessage', (data) => tableManager.handleChatMessage(io, socket, data));
});

// Vanhentuneiden pöytien siivous
setInterval(() => tableManager.cleanupOldTables(io), 600000); // 10 minuutin välein

// Palvelimen käynnistys
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Palvelin käynnissä portissa ${PORT}`);
});