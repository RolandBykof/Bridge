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