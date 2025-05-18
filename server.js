const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    transports: ['websocket', 'polling'],
    cors: {
        origin: '*',
        methods: ['GET', 'POST']
    }
});
const PORT = process.env.PORT || 3000;

// CORS settings
app.use(cors());

// Log environment and port
console.log(`Starting server in environment: ${process.env.NODE_ENV || 'development'}`);
console.log(`Running on Azure: ${process.env.WEBSITE_SITE_NAME ? 'Yes' : 'No'}`);
console.log(`Server will listen on port ${PORT}`);

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// Pöytien hallinta
const tables = new Map(); // Kartta pöytäkoodeista pöytäobjekteihin

// Pöytäobjektin rakenne
function createTable(code) {
  return {
    code: code,
    players: {
      north: null,
      east: null,
      south: null, 
      west: null
    },
    status: 'waiting', // 'waiting', 'playing', 'ended'
    gameState: null, // Pelin tila (alustetaan kun peli alkaa)
    biddingState: null, // Tarjoustila (alustetaan kun peli alkaa)
    connections: new Set(), // Socketit jotka ovat yhteydessä tähän pöytään
    created: Date.now(),
    lastActivity: Date.now()
  };
}

// Generoi uniikki 4-numeroinen koodi
function generateTableCode() {
  let code;
  do {
    code = Math.floor(1000 + Math.random() * 9000).toString();
  } while (tables.has(code));
  return code;
}

// Socket.io yhteyksien käsittely
io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);
  let currentTable = null;
  
  // Pöytien listaus
  socket.on('getActiveTables', () => {
    // Palauta vain perustiedot avoimista pöydistä
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
  });
  
  // Pöydän luominen
  socket.on('createTable', ({ playerName, position }) => {
    const tableCode = generateTableCode();
    const table = createTable(tableCode);
    table.players[position] = { name: playerName, id: socket.id, type: 'human' };
    table.connections.add(socket.id);
    tables.set(tableCode, table);
    
    currentTable = table;
    socket.join(tableCode); // Liitetään socket huoneeseen
    
    // Palauta täysi pöytäobjekti pöydän luojalle
    socket.emit('tableCreated', { 
      tableCode, 
      table: {
        code: table.code,
        players: table.players,
        status: table.status
      }
    });
    
    console.log(`Table ${tableCode} created by ${playerName} (${position})`);
  });
  
  // Pöytään liittyminen
  socket.on('joinTable', ({ playerName, tableCode }) => {
    const table = tables.get(tableCode);
    if (!table) {
      return socket.emit('error', { message: 'Pöytää ei löydy' });
    }
    
    if (table.status !== 'waiting') {
      return socket.emit('error', { message: 'Peli on jo käynnissä' });
    }
    
    // Lähetä vapaat paikat
    const availablePositions = Object.entries(table.players)
      .filter(([pos, player]) => player === null)
      .map(([pos]) => pos);
      
    if (availablePositions.length === 0) {
      return socket.emit('error', { message: 'Pöytä on täynnä' });
    }
    
    socket.emit('selectPosition', { 
      tableCode, 
      positions: availablePositions,
      currentPlayers: table.players
    });
  });
  
  // Paikan valinta
  socket.on('selectPosition', ({ tableCode, position, playerName }) => {
    const table = tables.get(tableCode);
    if (!table) {
      return socket.emit('error', { message: 'Pöytää ei löydy' });
    }
    
    if (table.players[position]) {
      return socket.emit('error', { message: 'Paikka on jo varattu' });
    }
    
    // Lisää pelaaja pöytään
    table.players[position] = { name: playerName, id: socket.id, type: 'human' };
    table.connections.add(socket.id);
    table.lastActivity = Date.now();
    currentTable = table;
    
    socket.join(tableCode);
    
    // Ilmoita kaikille pöydän pelaajille uudesta pelaajasta
    io.to(tableCode).emit('playerJoined', { 
      position, 
      playerName, 
      table: {
        code: table.code,
        players: table.players,
        status: table.status
      }
    });
    
    console.log(`Player ${playerName} joined table ${tableCode} as ${position}`);
  });
  
  // Pelin aloittaminen
  socket.on('startGame', async ({ tableCode }) => {
    const table = tables.get(tableCode);
    if (!table) return socket.emit('error', { message: 'Pöytää ei löydy' });
    
    // Tarkista että tällä on oikeus aloittaa peli (pöydän luoja tai joku muu pöydässä)
    if (!table.connections.has(socket.id)) {
      return socket.emit('error', { message: 'Sinulla ei ole oikeutta aloittaa peliä' });
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
    
    // Alusta pelitilamuuttujat
    try {
      // Jaa kortit käyttäen GIB API:a
      const deal = await getDealFromGIB();
      
      if (deal) {
        // Alusta pelitila jaetuilla korteilla
        table.gameState = initializeGameState(deal, table.players);
        table.biddingState = initializeBiddingState('south'); // Aloita aina etelästä
        
        // Lähetä pelin tila kaikille pelaajille
        io.to(tableCode).emit('gameStarted', { 
          gameState: filterGameStateForPlayer(table.gameState, null), // Yleinen tila
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
        
        console.log(`Game started on table ${tableCode}`);
        
        // Jos ensimmäinen tarjoaja on GIB, tee GIB:n tarjous automaattisesti
        if (table.biddingState.currentBidder && 
            table.players[table.biddingState.currentBidder].type === 'gib') {
          setTimeout(() => {
            processGIBBid(table, table.biddingState.currentBidder);
          }, 1000);
        }
      } else {
        // Fallback jos GIB API ei vastaa
        table.gameState = generateRandomGameState(table.players);
        table.biddingState = initializeBiddingState('south');
        
        io.to(tableCode).emit('gameStarted', { 
          gameState: filterGameStateForPlayer(table.gameState, null),
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
        
        // Jos ensimmäinen tarjoaja on GIB, tee GIB:n tarjous automaattisesti
        if (table.biddingState.currentBidder && 
            table.players[table.biddingState.currentBidder].type === 'gib') {
          setTimeout(() => {
            processGIBBid(table, table.biddingState.currentBidder);
          }, 1000);
        }
      }
    } catch (error) {
      console.error('Error starting game:', error);
      socket.emit('error', { message: 'Virhe pelin aloittamisessa' });
      table.status = 'waiting';
    }
  });
  
  // Tarjouksen tekeminen
  socket.on('makeBid', ({ tableCode, position, bid }) => {
    const table = tables.get(tableCode);
    if (!table) return socket.emit('error', { message: 'Pöytää ei löydy' });
    
    if (table.status !== 'playing') {
      return socket.emit('error', { message: 'Peli ei ole käynnissä' });
    }
    
    if (table.biddingState.biddingComplete) {
      return socket.emit('error', { message: 'Tarjousvaihe on jo päättynyt' });
    }
    
    // Tarkista että pelaaja on vuorossa
    if (table.biddingState.currentBidder !== position) {
      return socket.emit('error', { message: 'Ei ole sinun vuorosi tarjota' });
    }
    
    // Tarkista että tämä socket hallitsee tätä pelaajaa
    if (table.players[position].id !== socket.id) {
      return socket.emit('error', { message: 'Et voi tarjota tästä positiosta' });
    }
    
    table.lastActivity = Date.now();
    
    // Käsittele tarjous
    processPlayerBid(table, position, bid);
  });
  
  // Kortin pelaaminen
  socket.on('playCard', ({ tableCode, position, suit, card }) => {
    const table = tables.get(tableCode);
    if (!table) return socket.emit('error', { message: 'Pöytää ei löydy' });
    
    if (table.status !== 'playing') {
      return socket.emit('error', { message: 'Peli ei ole käynnissä' });
    }
    
    if (!table.biddingState.biddingComplete) {
      return socket.emit('error', { message: 'Tarjousvaihe on vielä kesken' });
    }
    
    // Tarkista että pelaaja on vuorossa
    if (table.gameState.currentPlayer !== position) {
      return socket.emit('error', { message: 'Ei ole sinun vuorosi pelata' });
    }
    
    // Tarkista että tämä socket hallitsee tätä pelaajaa tai pelaaja on dummy
    const isDummy = position === table.gameState.dummy;
    const isController = (isDummy && table.players[table.gameState.declarer].id === socket.id) || 
                         (!isDummy && table.players[position].id === socket.id);
    
    if (!isController) {
      return socket.emit('error', { message: 'Et voi pelata tästä positiosta' });
    }
    
    // Tarkista että kortti on pelaajan kädessä
    const hand = table.gameState.hands[position];
    if (!hand[suit] || !hand[suit].includes(card)) {
      return socket.emit('error', { message: 'Sinulla ei ole tätä korttia' });
    }
    
    // Tarkista väriin tunnustaminen
    if (table.gameState.currentTrick.length > 0) {
      const leadSuit = table.gameState.currentTrick[0].suit;
      if (suit !== leadSuit && hand[leadSuit].length > 0) {
        return socket.emit('error', { message: 'Sinun täytyy tunnustaa väriä' });
      }
    }
    
    table.lastActivity = Date.now();
    
    // Käsittele kortin pelaaminen
    processPlayedCard(table, position, suit, card);
  });
  
  // Chat-viesti
  socket.on('sendChatMessage', ({ tableCode, message }) => {
    const table = tables.get(tableCode);
    if (!table) return;
    
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
    
    if (!position) return; // Ei löydy pelaajaa tälle socketille
    
    // Lähetä chat-viesti kaikille pöydässä
    io.to(tableCode).emit('chatMessage', {
      sender: playerName,
      position,
      message,
      timestamp: Date.now()
    });
  });
  
  // Pöydästä poistuminen
  socket.on('leaveTable', () => {
    leaveCurrentTable();
  });
  
  // Yhteyden katkeaminen
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    leaveCurrentTable();
  });
  
  // Funktio pöydästä poistumiseen (käytetään sekä manuaaliseen poistumiseen että disconnectiin)
  function leaveCurrentTable() {
    if (!currentTable) return;
    
    // Etsi pelaajan positio
    let position = null;
    for (const [pos, player] of Object.entries(currentTable.players)) {
      if (player && player.id === socket.id) {
        position = pos;
        break;
      }
    }
    
    if (position) {
      // Pelin ollessa käynnissä, korvaa pelaaja GIB-tekoälyllä
      if (currentTable.status === 'playing') {
        currentTable.players[position] = {
          name: `GIB ${position}`,
          id: null,
          type: 'gib'
        };
        
        // Ilmoita muille pelaajille korvaamisesta
        io.to(currentTable.code).emit('playerReplaced', {
          position,
          table: {
            code: currentTable.code,
            players: currentTable.players,
            status: currentTable.status
          }
        });
        
        // Jatka peliä, jos korvattu pelaaja oli vuorossa
        if (currentTable.biddingState && !currentTable.biddingState.biddingComplete &&
            currentTable.biddingState.currentBidder === position) {
          // GIB tekee tarjouksen
          setTimeout(() => {
            processGIBBid(currentTable, position);
          }, 1000);
        } else if (currentTable.gameState && currentTable.biddingState.biddingComplete &&
                 currentTable.gameState.currentPlayer === position) {
          // GIB pelaa kortin
          setTimeout(() => {
            processGIBMove(currentTable, position);
          }, 1000);
        }
      } else {
        // Peli ei ole käynnissä, poista pelaaja pöydästä
        currentTable.players[position] = null;
        
        // Ilmoita muille pelaajille poistumisesta
        io.to(currentTable.code).emit('playerLeft', { 
          position,
          table: {
            code: currentTable.code,
            players: currentTable.players,
            status: currentTable.status
          }
        });
      }
    }
    
    currentTable.connections.delete(socket.id);
    socket.leave(currentTable.code);
    
    // Jos pöytä on tyhjä, poista se
    if (currentTable.connections.size === 0 && currentTable.status !== 'playing') {
      tables.delete(currentTable.code);
      console.log(`Table ${currentTable.code} removed (empty)`);
    }
    
    currentTable = null;
  }
});

// GIB API proxy server
app.get('/api/gib/deal', async (req, res) => {
    try {
        const response = await axios.get('http://gibrest.bridgebase.com/u_dealer/u_dealer.php', {
            params: {
                reuse: 'n',
                n: 1
            }
        });
        
        res.set('Content-Type', 'application/xml');
        res.send(response.data);
    } catch (error) {
        console.error('Error from GIB service:', error.message);
        res.status(500).json({ error: 'Error from GIB service' });
    }
});

app.get('/api/gib/robot', async (req, res) => {
    try {
        // Pass all query parameters to GIB
        const response = await axios.get('http://gibrest.bridgebase.com/u_bm/robot.php', {
            params: req.query
        });
        
        res.set('Content-Type', 'application/xml');
        res.send(response.data);
    } catch (error) {
        console.error('Error from GIB service:', error.message);
        res.status(500).json({ error: 'Error from GIB service' });
    }
});

app.get('/api/gib/bid-meanings', async (req, res) => {
    try {
        const response = await axios.get('http://gibrest.bridgebase.com/u_bm/u_bm.php', {
            params: req.query
        });
        
        res.set('Content-Type', 'application/xml');
        res.send(response.data);
    } catch (error) {
        console.error('Error from GIB service:', error.message);
        res.status(500).json({ error: 'Error from GIB service' });
    }
});

// Health check endpoint for Azure
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'OK',
        uptime: process.uptime(),
        timestamp: Date.now()
    });
});

// SPA fallback
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Apufunktiot pelilogiikalle

// Hae kortit GIB API:sta - huomaa XML-parseri korjaus Node.js serverille
async function getDealFromGIB() {
  try {
    const response = await axios.get('http://gibrest.bridgebase.com/u_dealer/u_dealer.php', {
      params: {
        reuse: 'n',
        n: 1
      }
    });
    
    const text = response.data;
    
    // Palvelimella tarvitaan jsdom DOM-parseria XML-parsintaa varten
    const { JSDOM } = require('jsdom');
    const { DOMParser } = new JSDOM().window;
    
    const parser = new DOMParser();
    const xml = parser.parseFromString(text, "text/xml");
    
    const dealElement = xml.getElementsByTagName('sc_deal')[0];
    if (!dealElement) {
      throw new Error('No cards received');
    }
    
    // Get hands
    const north = dealElement.getAttribute('north');
    const east = dealElement.getAttribute('east');
    const south = dealElement.getAttribute('south');
    const west = dealElement.getAttribute('west');
    
    return { north, east, south, west };
  } catch (error) {
    console.error('Error fetching deal from GIB:', error);
    return null;
  }
}

// Parse GIB hand format to app format
function parseGIBHand(gibHand) {
  const result = {
    spades: [],
    hearts: [],
    diamonds: [],
    clubs: []
  };
  
  if (!gibHand || typeof gibHand !== 'string') {
    console.warn('Invalid GIB hand format:', gibHand);
    return result;
  }
  
  try {
    // Valid bridge card values
    const validCardValues = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2'];
    
    // Extract cards for each suit
    let currentSuit = null;
    
    // Loop through the string character by character
    for (let i = 0; i < gibHand.length; i++) {
      const char = gibHand.charAt(i).toUpperCase();
      
      // Check if this is a suit marker
      if (char === 'S') {
        currentSuit = 'spades';
      } else if (char === 'H') {
        currentSuit = 'hearts';
      } else if (char === 'D') {
        currentSuit = 'diamonds';
      } else if (char === 'C') {
        currentSuit = 'clubs';
      } else if (currentSuit && validCardValues.includes(char)) {
        // This is a card value, add it to the current suit
        result[currentSuit].push(char);
      }
    }
  } catch (error) {
    console.error('Error parsing GIB hand:', error);
  }
  
  return result;
}

// Alusta pelitila
function initializeGameState(deal, players) {
  const hands = {
    north: parseGIBHand(deal.north),
    east: parseGIBHand(deal.east),
    south: parseGIBHand(deal.south),
    west: parseGIBHand(deal.west)
  };
  
  return {
    players: players,
    currentPlayer: 'south', // Tarjousvaiheessa south aloittaa
    gamePhase: 'bidding',
    hands: hands,
    playedCards: [],
    currentTrick: [],
    contract: null,
    trumpSuit: null,
    declarer: null,
    dummy: null,
    tricks: { ns: 0, ew: 0 },
    totalTricks: 0,
    leadPlayer: 'south'
  };
}

// Alusta tarjoustila
function initializeBiddingState(dealer) {
  return {
    currentBidder: dealer,
    bidHistory: [],
    currentBiddingRound: 1,
    consecutivePasses: 0,
    biddingComplete: false,
    highestBid: null,
    contract: null,
    declarer: null,
    dummy: null,
    trumpSuit: null,
    selectedSystem: 'natural',
    dealer: dealer
  };
}

// Generoi satunnainen pelitila jos GIB ei ole saatavilla
function generateRandomGameState(players) {
  // Yksinkertainen satunnainen korttien jako
  const deck = [];
  const suits = ['spades', 'hearts', 'diamonds', 'clubs'];
  const values = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
  
  for (const suit of suits) {
    for (const value of values) {
      deck.push({ suit, value });
    }
  }
  
  // Sekoita pakka
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  
  // Jaa kortit
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
  
  // Järjestä kortit
  for (const position of positions) {
    for (const suit of suits) {
      hands[position][suit].sort((a, b) => values.indexOf(b) - values.indexOf(a));
    }
  }
  
  return {
    players: players,
    currentPlayer: 'south',
    gamePhase: 'bidding',
    hands: hands,
    playedCards: [],
    currentTrick: [],
    contract: null,
    trumpSuit: null,
    declarer: null,
    dummy: null,
    tricks: { ns: 0, ew: 0 },
    totalTricks: 0,
    leadPlayer: 'south'
  };
}

// Suodata pelitila pelaajan mukaan (piilota toisten kortit)
function filterGameStateForPlayer(gameState, position) {
  // Tee kopio pelitilasta
  const filteredState = { ...gameState };
  
  // Jos pelitilaa ei ole tai position on null/undefined, palautetaan yleinen versio
  if (!gameState || !position) {
    // Piilota kaikkien pelaajien kortit
    const filteredHands = {};
    for (const pos of ['north', 'east', 'south', 'west']) {
      filteredHands[pos] = {
        spades: [],
        hearts: [],
        diamonds: [],
        clubs: []
      };
    }
    return {
      ...filteredState,
      hands: filteredHands
    };
  }
  
  // Kopioi kädet ja piilota muiden pelaajien kortit
  const filteredHands = {};
  for (const pos of ['north', 'east', 'south', 'west']) {
    // Jos tämä on pelaajan positio tai dummy kun pelaaminen on alkanut
    if (pos === position || (gameState.dummy === pos && gameState.gamePhase === 'play' && 
                             (gameState.declarer === position || position === gameState.dummy))) {
      filteredHands[pos] = { ...gameState.hands[pos] };
    } else {
      // Emme näytä kortteja, mutta näytämme lukumäärät
      filteredHands[pos] = {
        spades: Array(gameState.hands[pos].spades.length).fill('?'),
        hearts: Array(gameState.hands[pos].hearts.length).fill('?'),
        diamonds: Array(gameState.hands[pos].diamonds.length).fill('?'),
        clubs: Array(gameState.hands[pos].clubs.length).fill('?')
      };
    }
  }
  
  return {
    ...filteredState,
    hands: filteredHands
  };
}

// Käsittele pelaajan tarjous
function processPlayerBid(table, position, bid) {
  if (!table.biddingState) return;
  
  // Tarkista että tarjous on validi
  const isValidBid = validateBid(bid, table.biddingState.highestBid);
  if (!isValidBid) {
    // Lähetä virheilmoitus vain tälle pelaajalle
    const playerId = table.players[position].id;
    if (playerId) {
      io.to(playerId).emit('error', { message: 'Epäkelpo tarjous' });
    }
    return;
  }
  
  // Lisää tarjous historiaan
  const bidInfo = {
    player: position,
    bid: bid,
    round: table.biddingState.currentBiddingRound
  };
  
  table.biddingState.bidHistory.push(bidInfo);
  
  // Päivitä consecutivePasses
  if (bid === 'P') {
    table.biddingState.consecutivePasses++;
  } else {
    table.biddingState.consecutivePasses = 0;
    
    // Päivitä korkein tarjous jos ei pass, double tai redouble
    if (!['P', 'X', 'XX'].includes(bid)) {
      table.biddingState.highestBid = bid;
    }
  }
  
  // Tarkista onko tarjousvaihe päättynyt
  if (checkBiddingComplete(table.biddingState)) {
    finalizeBidding(table);
  } else {
    // Siirry seuraavaan tarjoajaan
    moveToNextBidder(table.biddingState);
    
    // Ilmoita kaikille pelaajille tarjouksesta ja uudesta vuorosta
    io.to(table.code).emit('bidMade', {
      position,
      bid,
      nextBidder: table.biddingState.currentBidder,
      biddingState: table.biddingState
    });
    
    // Jos seuraava tarjoaja on GIB, tee GIB:n tarjous
    if (table.players[table.biddingState.currentBidder].type === 'gib') {
      setTimeout(() => {
        processGIBBid(table, table.biddingState.currentBidder);
      }, 1000);
    }
  }
}

// Validoi tarjous
function validateBid(bid, currentHighestBid) {
  // Validate basic bid structure
  if (!bid) return false;
  
  // Pass is always valid
  if (bid === 'P') return true;
  
  // TODO: Implement full validation logic for doubles, redoubles, etc.
  // For now, assume all bids are valid
  return true;
}

// Tarkista onko tarjousvaihe päättynyt
function checkBiddingComplete(biddingState) {
  // Tarjous päättyy kun on 3 passia jonossa (ei alussa)
  // Tai kun on 4 passia alussa
  const bids = biddingState.bidHistory;
  
  if (bids.length >= 4 && 
      bids[0].bid === 'P' && 
      bids[1].bid === 'P' && 
      bids[2].bid === 'P' && 
      bids[3].bid === 'P') {
    return true;
  }
  
  // Check for 3 passes after a bid
  if (biddingState.consecutivePasses === 3 && bids.length >= 4) {
    return true;
  }
  
  return false;
}

// Siirry seuraavaan tarjoajaan
function moveToNextBidder(biddingState) {
  const positions = ['north', 'east', 'south', 'west'];
  const currentIndex = positions.indexOf(biddingState.currentBidder);
  biddingState.currentBidder = positions[(currentIndex + 1) % 4];
}

// Tee GIB:n tarjous
function processGIBBid(table, position) {
  if (!table.biddingState || table.biddingState.biddingComplete) return;
  
  // Yksinkertainen logiikka GIB:n tarjoukselle
  // Tosielämässä käyttäisimme oikeaa GIB API -kutsua tähän
  
  // Hae validit tarjoukset
  const possibleBids = ['P']; // Pass on aina vaihtoehto
  
  // Tarkista voiko kahdentaa
  if (table.biddingState.highestBid) {
    possibleBids.push('X');
  }
  
  // Lisää kaikki numerotarjoukset
  if (!table.biddingState.highestBid) {
    possibleBids.push('1C', '1D', '1H', '1S', '1N');
  } else {
    // TODO: Implement logic to add bids higher than current highest
    possibleBids.push('P'); // Yksinkertaisuuden vuoksi vain pass
  }
  
  // Valitse satunnainen tarjous, 80% todennäköisyydellä pass
  const bidIndex = Math.random() < 0.8 ? 0 : Math.floor(Math.random() * possibleBids.length);
  const selectedBid = possibleBids[bidIndex];
  
  // Tee valittu tarjous
  processPlayerBid(table, position, selectedBid);
}

// Viimeistele tarjousvaihe
function finalizeBidding(table) {
  table.biddingState.biddingComplete = true;
  
  // Jos kaikki passasivat, ei sopimusta
  if (table.biddingState.bidHistory.length === 4 && 
      table.biddingState.bidHistory.every(bid => bid.bid === 'P')) {
    
    // Resetoi peli
    table.gameState.gamePhase = 'setup';
    
    // Ilmoita pelaajille
    io.to(table.code).emit('allPassed', {
      message: "All players passed. Deal again."
    });
    
    table.status = 'waiting';
    return;
  }
  
  // Määritä lopullinen sopimus
  determineContract(table);
  
  // Määritä pelinviejä ja lepääjä
  determineDeclarerAndDummy(table);
  
  // Aseta valttimaa
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
  
  // Siirry pelivaiheeseen
  switchToPlayPhase(table);
}

// Määritä lopullinen sopimus
function determineContract(table) {
  // Etsi korkein tarjous
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
  
  // Muodosta sopimus
  let contract = highestBid;
  if (doubled) contract += 'X';
  if (redoubled) contract += 'XX';
  
  table.biddingState.contract = contract;
  
  return contract;
}

// Määritä pelinviejä ja lepääjä
function determineDeclarerAndDummy(table) {
  // Etsi sopimuksen maa
  const contractSuit = table.biddingState.contract.charAt(1);
  
  // Etsi partnershippi joka ensimmäisenä tarjosi tätä maata
  const pairs = {
    'north-south': ['north', 'south'],
    'east-west': ['east', 'west']
  };
  
  let declarerPair = null;
  let firstPlayer = null;
  
  for (const bidInfo of table.biddingState.bidHistory) {
    if (bidInfo.bid.charAt(1) === contractSuit && !['P', 'X', 'XX'].includes(bidInfo.bid)) {
      const player = bidInfo.player;
      
      // Määritä mihin pariin tämä pelaaja kuuluu
      for (const [pair, players] of Object.entries(pairs)) {
        if (players.includes(player)) {
          declarerPair = pair;
          
          // Tarkista oliko tämä pelaaja parin ensimmäinen tätä maata tarjoava
          if (!firstPlayer || players.indexOf(firstPlayer) === -1) {
            firstPlayer = player;
          }
          break;
        }
      }
      
      if (declarerPair && firstPlayer) {
        break;
      }
    }
  }
  
  // Aseta pelinviejä ja lepääjä
  if (declarerPair && firstPlayer) {
    table.biddingState.declarer = firstPlayer;
    const dummyIndex = (pairs[declarerPair].indexOf(firstPlayer) + 1) % 2;
    table.biddingState.dummy = pairs[declarerPair][dummyIndex];
  } else {
    // Fallback
    table.biddingState.declarer = 'south';
    table.biddingState.dummy = 'north';
  }
}

// Siirry pelivaiheeseen
function switchToPlayPhase(table) {
  // Siirrä tarjouksen tila pelitilaan
  table.gameState.contract = table.biddingState.contract;
  table.gameState.trumpSuit = table.biddingState.trumpSuit;
  table.gameState.declarer = table.biddingState.declarer;
  table.gameState.dummy = table.biddingState.dummy;
  
  // Päivitä pelivaihe
  table.gameState.gamePhase = 'play';
  
  // Aseta ensimmäinen pelaaja (pelinviejän vasemmalla puolella)
  const positions = ['north', 'east', 'south', 'west'];
  const declarerIndex = positions.indexOf(table.biddingState.declarer);
  table.gameState.currentPlayer = positions[(declarerIndex + 1) % 4];
  table.gameState.leadPlayer = table.gameState.currentPlayer;
  
  // Ilmoita pelaajille
  io.to(table.code).emit('biddingComplete', {
    contract: table.gameState.contract,
    declarer: table.gameState.declarer,
    dummy: table.gameState.dummy,
    trumpSuit: table.gameState.trumpSuit,
    currentPlayer: table.gameState.currentPlayer,
    gameState: filterGameStateForPlayer(table.gameState, null) // Yleinen tila
  });
  
  // Lähetä pelaajille heidän omat korttinsa
  for (const [position, player] of Object.entries(table.players)) {
    if (player.type === 'human' && player.id) {
      io.to(player.id).emit('playPhaseCards', {
        position: position,
        cards: table.gameState.hands[position],
        // Lähetä lepääjän kortit pelinviejälle
        dummyCards: position === table.gameState.declarer ? 
                    table.gameState.hands[table.gameState.dummy] : null
      });
    }
  }
  
  // Jos ensimmäinen pelaaja on GIB, tee GIB:n siirto
  if (table.players[table.gameState.currentPlayer].type === 'gib') {
    setTimeout(() => {
      processGIBMove(table, table.gameState.currentPlayer);
    }, 1500);
  }
}

// Käsittele pelattu kortti
function processPlayedCard(table, position, suit, card) {
  // Lisää kortti tikkiin ja pelattuihin kortteihin
  const playedCard = { player: position, suit, card };
  table.gameState.currentTrick.push(playedCard);
  table.gameState.playedCards.push(playedCard);
  
  // Poista kortti pelaajan kädestä
  table.gameState.hands[position][suit] = 
    table.gameState.hands[position][suit].filter(c => c !== card);
  
  // Ilmoita kaikille pelaajille
  io.to(table.code).emit('cardPlayed', {
    position,
    suit,
    card,
    currentTrick: table.gameState.currentTrick
  });
  
  // Tarkista onko tikki täynnä (4 korttia)
  if (table.gameState.currentTrick.length === 4) {
    setTimeout(() => {
      handleCompleteTrick(table);
    }, 1000);
  } else {
    // Siirry seuraavaan pelaajaan
    table.gameState.currentPlayer = getNextPlayer(table.gameState.currentPlayer);
    
    // Ilmoita seuraavasta vuorosta
    io.to(table.code).emit('nextPlayer', {
      currentPlayer: table.gameState.currentPlayer
    });
    
    // Jos seuraava pelaaja on GIB, tee GIB:n siirto
    if (table.players[table.gameState.currentPlayer].type === 'gib') {
      setTimeout(() => {
        processGIBMove(table, table.gameState.currentPlayer);
      }, 1500);
    }
  }
}

// Käsittele täysi tikki
function handleCompleteTrick(table) {
  // Määritä tikin voittaja
  const winner = determineTrickWinner(table.gameState);
  
  // Päivitä tikit
  if (winner === 'north' || winner === 'south') {
    table.gameState.tricks.ns += 1;
  } else {
    table.gameState.tricks.ew += 1;
  }
  
  table.gameState.totalTricks += 1;
  
  // Tyhjennä nykyinen tikki
  const completedTrick = [...table.gameState.currentTrick];
  table.gameState.currentTrick = [];
  
  // Aseta voittaja seuraavaksi johtajaksi
  table.gameState.leadPlayer = winner;
  table.gameState.currentPlayer = winner;
  
  // Tarkista onko peli päättynyt (13 tikkiä pelattu)
  if (table.gameState.totalTricks >= 13) {
    // Peli päättyy
    endGame(table);
    return;
  }
  
  // Ilmoita tikin voittajasta
  io.to(table.code).emit('trickComplete', {
    winner,
    trick: completedTrick,
    tricks: table.gameState.tricks,
    nextPlayer: winner
  });
  
  // Jos seuraava pelaaja on GIB, tee GIB:n siirto
  if (table.players[table.gameState.currentPlayer].type === 'gib') {
    setTimeout(() => {
      processGIBMove(table, table.gameState.currentPlayer);
    }, 1500);
  }
}

// Määritä tikin voittaja
function determineTrickWinner(gameState) {
  const values = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
  const leadSuit = gameState.currentTrick[0].suit;
  const trumpSuit = gameState.trumpSuit; // Will be null if no trump
  
  let highestCard = gameState.currentTrick[0];
  let winningPlayer = gameState.currentTrick[0].player;
  
  for (let i = 1; i < gameState.currentTrick.length; i++) {
    const currentCard = gameState.currentTrick[i];
    
    // Tarkista onko tämä kortti valtti kun korkein ei ole
    if (trumpSuit && currentCard.suit === trumpSuit && highestCard.suit !== trumpSuit) {
      highestCard = currentCard;
      winningPlayer = currentCard.player;
    }
    // Tarkista ovatko molemmat kortit valtteja
    else if (trumpSuit && currentCard.suit === trumpSuit && highestCard.suit === trumpSuit) {
      if (values.indexOf(currentCard.card) > values.indexOf(highestCard.card)) {
        highestCard = currentCard;
        winningPlayer = currentCard.player;
      }
    }
    // Tarkista onko nykyinen kortti johtavaa maata ja korkein myös
    else if (currentCard.suit === leadSuit && highestCard.suit === leadSuit) {
      if (values.indexOf(currentCard.card) > values.indexOf(highestCard.card)) {
        highestCard = currentCard;
        winningPlayer = currentCard.player;
      }
    }
    // Jos nykyinen kortti on johtavaa maata mutta korkein ei (eikä valtti)
    else if (currentCard.suit === leadSuit && highestCard.suit !== leadSuit && 
             (!trumpSuit || highestCard.suit !== trumpSuit)) {
      highestCard = currentCard;
      winningPlayer = currentCard.player;
    }
  }
  
  return winningPlayer;
}

// Päätä peli
function endGame(table) {
  table.gameState.gamePhase = 'end';
  
  // Laske tulos sopimuksen perusteella
  let resultMessage = '';
  
  if (table.gameState.contract) {
    const level = parseInt(table.gameState.contract.charAt(0));
    const tricksNeeded = level + 6; // Sopimustaso + 6
    
    // Määritä tehtiinkö sopimus
    const declarerSide = table.gameState.declarer === 'north' || table.gameState.declarer === 'south' ? 'ns' : 'ew';
    const tricksTaken = table.gameState.tricks[declarerSide];
    
    if (tricksTaken >= tricksNeeded) {
      // Sopimus tehty
      resultMessage = `Contract ${formatContract(table.gameState.contract)} made! ${getPositionName(table.gameState.declarer)}-${getPartnerName(table.gameState.declarer)} took ${tricksTaken} tricks.`;
    } else {
      // Sopimus pieti
      resultMessage = `Contract ${formatContract(table.gameState.contract)} defeated by ${tricksNeeded - tricksTaken}. ${getPositionName(table.gameState.declarer)}-${getPartnerName(table.gameState.declarer)} took ${tricksTaken} tricks.`;
    }
  } else {
    // Ei sopimusta - raportoi vain tikit
    if (table.gameState.tricks.ns > table.gameState.tricks.ew) {
      resultMessage = `Game over! North-South team wins with ${table.gameState.tricks.ns} tricks to ${table.gameState.tricks.ew}.`;
    } else if (table.gameState.tricks.ew > table.gameState.tricks.ns) {
      resultMessage = `Game over! East-West team wins with ${table.gameState.tricks.ew} tricks to ${table.gameState.tricks.ns}.`;
    } else {
      resultMessage = `Game over! It's a tie with both teams taking ${table.gameState.tricks.ns} tricks.`;
    }
  }
  
  // Ilmoita pelaajille pelin päättymisestä
  io.to(table.code).emit('gameOver', {
    message: resultMessage,
    tricks: table.gameState.tricks,
    contract: table.gameState.contract
  });
  
  // Resetoi pöytä uutta peliä varten
  table.status = 'waiting';
  table.gameState = null;
  table.biddingState = null;
}

// Tee GIB siirto (kortin pelaaminen)
function processGIBMove(table, position) {
  // Valitse pelattava kortti
  const hand = table.gameState.hands[position];
  let playableCards = [];
  
  // Jos tämä on ensimmäinen kortti tikkiin, käytä johtamisstrategiaa
  if (table.gameState.currentTrick.length === 0) {
    // Yksinkertaisuuden vuoksi, pelaa satunnainen kortti
    for (const suit of ['spades', 'hearts', 'diamonds', 'clubs']) {
      for (const card of hand[suit]) {
        playableCards.push({ suit, card });
      }
    }
  } else {
    // Muuten tunnusta väriin jos mahdollista
    const leadSuit = table.gameState.currentTrick[0].suit;
    
    if (hand[leadSuit].length > 0) {
      // Pitää tunnustaa väriin
      for (const card of hand[leadSuit]) {
        playableCards.push({ suit: leadSuit, card });
      }
    } else {
      // Voi pelata minkä tahansa kortin
      for (const suit of ['spades', 'hearts', 'diamonds', 'clubs']) {
        for (const card of hand[suit]) {
          playableCards.push({ suit, card });
        }
      }
    }
  }
  
  if (playableCards.length === 0) {
    console.error(`GIB player ${position} has no legal cards to play!`);
    return;
  }
  
  // Valitse satunnainen kortti
  const selectedCardIndex = Math.floor(Math.random() * playableCards.length);
  const selectedCard = playableCards[selectedCardIndex];
  
  // Pelaa valittu kortti
  processPlayedCard(table, position, selectedCard.suit, selectedCard.card);
}

// Apufunktioita

// Seuraava pelaaja myötäpäivään
function getNextPlayer(currentPosition) {
  const positions = ['north', 'east', 'south', 'west'];
  const currentIndex = positions.indexOf(currentPosition);
  return positions[(currentIndex + 1) % 4];
}

// Partnerin nimi
function getPartnerName(position) {
  const partners = {
    'north': 'South',
    'south': 'North',
    'east': 'West',
    'west': 'East'
  };
  return partners[position] || '';
}

// Formatoi sopimus näyttämistä varten
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
  
  // Lisää kahdennus/vastakahdennus jos tarpeen
  if (contract.includes('XX')) {
    result += ' XX';
  } else if (contract.includes('X')) {
    result += ' X';
  }
  
  return result;
}

// Ilmansuunnan nimi
function getPositionName(position) {
  const names = { north: 'North', east: 'East', south: 'South', west: 'West' };
  return names[position] || position;
}

// Puhdista taulukot vanhentuneista pöydistä
function cleanupOldTables() {
  const now = Date.now();
  const MAX_IDLE_TIME = 3600000; // 1 tunti
  
  for (const [code, table] of tables.entries()) {
    // Poista pöydät jotka ovat olleet toimettomina liian kauan
    if (now - table.lastActivity > MAX_IDLE_TIME) {
      // Ilmoita pöydässä oleville pelaajille
      io.to(code).emit('tableRemoved', {
        message: 'Table closed due to inactivity'
      });
      
      tables.delete(code);
      console.log(`Table ${code} removed due to inactivity`);
    }
  }
}

// Puhdista vanhat pöydät säännöllisesti
setInterval(cleanupOldTables, 600000); // 10 minuutin välein

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});