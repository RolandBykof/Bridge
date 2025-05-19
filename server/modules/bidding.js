const cardUtils = require('../utils/card-utils');
const game = require('./game');

// Bidding systems
const biddingSystems = {
  natural: {
    name: "Natural Bidding",
    description: "Simple natural bidding system for beginners",
    meanings: {
      "1C": "12-21 HCP, 3+ clubs",
      "1D": "12-21 HCP, 3+ diamonds",
      "1H": "12-21 HCP, 5+ hearts",
      "1S": "12-21 HCP, 5+ spades",
      "1N": "15-17 HCP, balanced distribution",
      "2C": "22+ HCP or 8.5+ playing tricks",
      // ... muut tarjoukset
    }
  },
  sayc: {
    name: "Standard American Yellow Card",
    description: "Common bidding system in North America"
    // ... SAYC-systeemin tarjoukset
  }
};

// Valid suit order (lowest to highest)
const suitOrder = ['C', 'D', 'H', 'S', 'N'];
const validLevels = ['1', '2', '3', '4', '5', '6', '7'];
const specialBids = ['P', 'X', 'XX'];

// Alusta tarjoustila
function initializeBiddingState(dealer = 'south') {
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

// Käsittele pelaajan tarjous
function handlePlayerBid(io, socket, data) {
  const { tableCode, position, bid } = data;
  
  if (!tableCode || !position || !bid) {
    socket.emit('error', { message: 'Puutteelliset tarjoustiedot' });
    return;
  }
  
  const tableManager = require('./table-manager');
  const table = tableManager.findTableBySocketId(socket.id);
  
  if (!table || table.code !== tableCode) {
    socket.emit('error', { message: 'Et ole tässä pöydässä' });
    return;
  }
  
  if (table.status !== 'playing') {
    socket.emit('error', { message: 'Peli ei ole käynnissä' });
    return;
  }
  
  if (table.biddingState.biddingComplete) {
    socket.emit('error', { message: 'Tarjousvaihe on jo päättynyt' });
    return;
  }
  
  // Tarkista että pelaaja on vuorossa
  if (table.biddingState.currentBidder !== position) {
    socket.emit('error', { message: 'Ei ole sinun vuorosi tarjota' });
    return;
  }
  
  // Tarkista että tämä socket hallitsee tätä pelaajaa
  if (table.players[position].id !== socket.id) {
    socket.emit('error', { message: 'Et voi tarjota tästä positiosta' });
    return;
  }
  
  // Tarkista tarjouksen validius
  if (!validateBid(bid, table.biddingState.highestBid)) {
    socket.emit('error', { message: 'Epäkelpo tarjous' });
    return;
  }
  
  // Käsittele tarjous
  processPlayerBid(io, table, position, bid);
}

// Käsittele tarjous
function processPlayerBid(io, table, position, bid) {
  table.lastActivity = Date.now();
  
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
    if (!specialBids.includes(bid)) {
      table.biddingState.highestBid = bid;
    }
  }
  
  // Tarkista onko tarjousvaihe päättynyt
  if (checkBiddingComplete(table.biddingState)) {
    finalizeBidding(io, table);
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
        makeGibBid(io, table, table.biddingState.currentBidder);
      }, 1500);
    }
  }
}

// Tarkista onko tarjousvaihe päättynyt
function checkBiddingComplete(biddingState) {
  const bids = biddingState.bidHistory;
  
  if (bids.length >= 4 && 
      bids[0].bid === 'P' && 
      bids[1].bid === 'P' && 
      bids[2].bid === 'P' && 
      bids[3].bid === 'P') {
    return true;
  }
  
  if (biddingState.consecutivePasses === 3 && bids.length >= 4) {
    return true;
  }
  
  return false;
}

// Validoi tarjous
function validateBid(bid, currentHighestBid) {
  // Pass is always valid
  if (bid === 'P') return true;
  
  // Double is valid if the last non-pass bid was made by the opponents and wasn't doubled
  // ... (alkuperäinen logiikka bidding.js-tiedostosta)
  
  // Simplified for this example
  if (bid === 'X' || bid === 'XX') return true;
  
  // Regular bid - must be higher than current highest bid
  if (!currentHighestBid) return true; // First bid is always valid
  
  const bidLevel = parseInt(bid.charAt(0));
  const bidSuit = bid.charAt(1);
  const highestLevel = parseInt(currentHighestBid.charAt(0));
  const highestSuit = currentHighestBid.charAt(1);
  
  if (bidLevel > highestLevel) return true;
  if (bidLevel === highestLevel && suitOrder.indexOf(bidSuit) > suitOrder.indexOf(highestSuit)) return true;
  
  return false;
}

// Liiku seuraavaan tarjoajaan
function moveToNextBidder(biddingState) {
  const positions = ['north', 'east', 'south', 'west'];
  const currentIndex = positions.indexOf(biddingState.currentBidder);
  biddingState.currentBidder = positions[(currentIndex + 1) % 4];
}

// Viimeistele tarjousvaihe
function finalizeBidding(io, table) {
  table.biddingState.biddingComplete = true;
  
  // Jos kaikki passasivat, ei sopimusta
  if (table.biddingState.bidHistory.length === 4 && 
      table.biddingState.bidHistory.every(bid => bid.bid === 'P')) {
    
    // Resetoi peli
    table.gameState.gamePhase = 'setup';
    
    // Ilmoita pelaajille
    io.to(table.code).emit('allPassed', {
      message: "Kaikki pelaajat passasivat. Jaa uudelleen."
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
  switchToPlayPhase(io, table);
}

// Määritä lopullinen sopimus
function determineContract(table) {
  // Etsi korkein tarjous
  let highestBid = null;
  let doubled = false;
  let redoubled = false;
  
  for (const bidInfo of table.biddingState.bidHistory) {
    if (!specialBids.includes(bidInfo.bid)) {
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
  // ... (alkuperäinen logiikka bidding.js-tiedostosta)
  
  const contractSuit = table.biddingState.contract.charAt(1);
  
  // Etsi partnershippi joka ensimmäisenä tarjosi tätä maata
  const pairs = {
    'north-south': ['north', 'south'],
    'east-west': ['east', 'west']
  };
  
  let declarerPair = null;
  let firstPlayer = null;
  
  for (const bidInfo of table.biddingState.bidHistory) {
    if (bidInfo.bid.charAt(1) === contractSuit && !specialBids.includes(bidInfo.bid)) {
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
function switchToPlayPhase(io, table) {
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
    gameState: game.filterGameStateForClient(table.gameState, null)
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
  const tableManager = require('./table-manager');
  if (table.players[table.gameState.currentPlayer].type === 'gib') {
    setTimeout(() => {
      tableManager.handleGibTurn(io, table);
    }, 1500);
  }
}

// GIB-tarjous
function makeGibBid(io, table, position) {
  // Yksinkertainen logiikka GIB-tarjoukselle
  
  // Hae validit tarjoukset
  const possibleBids = getPossibleBids(table.biddingState.highestBid);
  
  // Käytä strategiaa tarjouksen valintaan
  const bid = calculateGibBid(table, position, possibleBids);
  
  // Tee valittu tarjous
  processPlayerBid(io, table, position, bid);
}

// Laske GIB-tarjous
function calculateGibBid(table, position, possibleBids) {
  // Hae tiedot pelaajan kädestä
  const hand = table.gameState.hands[position];
  const hcp = calculateHCP(hand);
  const distribution = calculateDistribution(hand);
  
  let selectedBid = 'P'; // Oletuksena pass
  
  // Avaustarjoukset
  if (table.biddingState.bidHistory.length === 0 || 
      table.biddingState.bidHistory.every(bid => bid.bid === 'P')) {
    
    if (hcp >= 15 && hcp <= 17 && distribution === 'balanced') {
      selectedBid = possibleBids.includes('1N') ? '1N' : 'P';
    } 
    else if (hcp >= 12) {
      // Etsi pisin maa
      const suits = ['spades', 'hearts', 'diamonds', 'clubs'];
      let longestSuit = suits[0];
      let maxLength = 0;
      
      for (const suit of suits) {
        if (hand[suit].length > maxLength) {
          maxLength = hand[suit].length;
          longestSuit = suit;
        }
      }
      
      // Tarjoa pisintä maata
      if (longestSuit === 'spades' && maxLength >= 5) {
        selectedBid = possibleBids.includes('1S') ? '1S' : 'P';
      } else if (longestSuit === 'hearts' && maxLength >= 5) {
        selectedBid = possibleBids.includes('1H') ? '1H' : 'P';
      } else if (longestSuit === 'diamonds') {
        selectedBid = possibleBids.includes('1D') ? '1D' : 'P';
      } else if (longestSuit === 'clubs') {
        selectedBid = possibleBids.includes('1C') ? '1C' : 'P';
      }
    }
  } else {
    // Vastauskäsi tai muut tarjoukset - yksinkertainen logiikka
    if (hcp >= 10 && table.biddingState.consecutivePasses < 2) {
      // Randomisoi joku järkevä tarjous
      const nonPassBids = possibleBids.filter(b => b !== 'P');
      if (nonPassBids.length > 0) {
        const randomIndex = Math.floor(Math.random() * nonPassBids.length);
        selectedBid = nonPassBids[randomIndex];
      }
    }
  }
  
  // Varmista että tarjous on mahdollinen
  return possibleBids.includes(selectedBid) ? selectedBid : 'P';
}

// Laske käden pisteet (HCP)
function calculateHCP(hand) {
  const pointValues = {
    'A': 4, 'K': 3, 'Q': 2, 'J': 1
  };
  
  let total = 0;
  
  for (const suit of ['spades', 'hearts', 'diamonds', 'clubs']) {
    for (const card of hand[suit]) {
      if (pointValues[card]) {
        total += pointValues[card];
      }
    }
  }
  
  return total;
}

// Määritä käden jakautuminen
function calculateDistribution(hand) {
  const suitLengths = [
    hand.spades.length,
    hand.hearts.length,
    hand.diamonds.length,
    hand.clubs.length
  ].sort((a, b) => a - b);
  
  // Check for balanced distribution (4-3-3-3, 4-4-3-2, or 5-3-3-2)
  if ((suitLengths[0] >= 2 && suitLengths[0] <= 3) && 
      (suitLengths[1] === 3) && 
      (suitLengths[2] === 3 || suitLengths[2] === 4) && 
      (suitLengths[3] <= 5)) {
    return 'balanced';
  }
  
  return 'unbalanced';
}

// Hae mahdolliset tarjoukset
function getPossibleBids(currentHighestBid) {
  const possibleBids = ['P']; // Pass is always possible
  
  // Double/redouble logic
  if (currentHighestBid) {
    possibleBids.push('X');
  }
  
  // Generate regular bids
  if (!currentHighestBid) {
    // If no bids yet, all bids from 1C to 7N are possible
    for (const level of validLevels) {
      for (const suit of suitOrder) {
        possibleBids.push(`${level}${suit}`);
      }
    }
  } else {
    // Generate all bids higher than the current highest
    const highestLevel = parseInt(currentHighestBid.charAt(0));
    const highestSuit = currentHighestBid.charAt(1);
    const highestSuitIndex = suitOrder.indexOf(highestSuit);
    
    for (let level = highestLevel; level <= 7; level++) {
      for (let suitIndex = 0; suitIndex < suitOrder.length; suitIndex++) {
        if (level === highestLevel && suitIndex <= highestSuitIndex) continue;
        possibleBids.push(`${level}${suitOrder[suitIndex]}`);
      }
    }
  }
  
  return possibleBids;
}

module.exports = {
  initializeBiddingState,
  handlePlayerBid,
  makeGibBid,
  validateBid,
  biddingSystems
};