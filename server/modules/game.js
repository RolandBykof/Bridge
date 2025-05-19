const cardUtils = require('../utils/card-utils');

// Pelin tilan alustus
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

// Parse GIB hand
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

// Generoi satunnainen pelitila
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

// Suodata pelitila pelaajan mukaan
function filterGameStateForClient(gameState, position) {
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

// Käsittele pelattu kortti
function handlePlayedCard(io, socket, data) {
  const { tableCode, position, suit, card } = data;
  
  if (!tableCode || !position || !suit || !card) {
    socket.emit('error', { message: 'Puutteelliset tiedot kortin pelaamiseen' });
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
  
  if (!table.biddingState.biddingComplete) {
    socket.emit('error', { message: 'Tarjousvaihe on vielä kesken' });
    return;
  }
  
  // Tarkista että pelaaja on vuorossa
  if (table.gameState.currentPlayer !== position) {
    socket.emit('error', { message: 'Ei ole sinun vuorosi pelata' });
    return;
  }
  
  // Tarkista että tämä socket hallitsee tätä pelaajaa tai pelaaja on dummy
  const isDummy = position === table.gameState.dummy;
  const isController = (isDummy && table.players[table.gameState.declarer].id === socket.id) || 
                      (!isDummy && table.players[position].id === socket.id);
  
  if (!isController) {
    socket.emit('error', { message: 'Et voi pelata tästä positiosta' });
    return;
  }
  
  // Tarkista että kortti on pelaajan kädessä
  const hand = table.gameState.hands[position];
  if (!hand[suit] || !hand[suit].includes(card)) {
    socket.emit('error', { message: 'Sinulla ei ole tätä korttia' });
    return;
  }
  
  // Tarkista väriin tunnustaminen
  if (table.gameState.currentTrick.length > 0) {
    const leadSuit = table.gameState.currentTrick[0].suit;
    if (suit !== leadSuit && hand[leadSuit].length > 0) {
      socket.emit('error', { message: 'Sinun täytyy tunnustaa väriä' });
      return;
    }
  }
  
  // Käsittele kortin pelaaminen
  processPlayedCard(io, table, position, suit, card);
}

// Käsittele kortin pelaaminen
function processPlayedCard(io, table, position, suit, card) {
  table.lastActivity = Date.now();
  
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
      handleCompleteTrick(io, table);
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
        makeGibMove(io, table, table.gameState.currentPlayer);
      }, 1500);
    }
  }
}

// GIB:n siirto
function makeGibMove(io, table, position) {
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
  processPlayedCard(io, table, position, selectedCard.suit, selectedCard.card);
}

// Käsittele täysi tikki
function handleCompleteTrick(io, table) {
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
    endGame(io, table);
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
      makeGibMove(io, table, table.gameState.currentPlayer);
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
function endGame(io, table) {
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

// Apufunktiot
function getNextPlayer(currentPosition) {
  const positions = ['north', 'east', 'south', 'west'];
  const currentIndex = positions.indexOf(currentPosition);
  return positions[(currentIndex + 1) % 4];
}

function getPositionName(position) {
  const names = { north: 'North', east: 'East', south: 'South', west: 'West' };
  return names[position] || position;
}

function getPartnerName(position) {
  const partners = {
    'north': 'South',
    'south': 'North',
    'east': 'West',
    'west': 'East'
  };
  return partners[position] || '';
}

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

module.exports = {
  initializeGameState,
  generateRandomGameState,
  filterGameStateForClient,
  handlePlayedCard,
  makeGibMove,
  determineTrickWinner
};