/**
 * BridgeCircle - Game Module
 * Käsittelee pelin logiikan ja pelitilan
 */

// Pelin tila
const gameState = {
    players: {
        north: { type: 'human', name: 'Pelaaja 1' },
        east: { type: 'gib', name: 'GIB-Itä' },
        south: { type: 'human', name: 'Sinä' },
        west: { type: 'gib', name: 'GIB-Länsi' }
    },
    currentPlayer: 'south',
    gamePhase: 'setup', // 'setup', 'bidding', 'play', 'end'
    statusMessage: 'Aloita jakamalla kortit.',
    hands: {
        north: { 
            spades: [], 
            hearts: [], 
            diamonds: [], 
            clubs: [] 
        },
        south: { 
            spades: [], 
            hearts: [], 
            diamonds: [], 
            clubs: [] 
        },
        east: {
            spades: [],
            hearts: [],
            diamonds: [],
            clubs: []
        },
        west: {
            spades: [],
            hearts: [],
            diamonds: [],
            clubs: []
        }
    },
    playedCards: [],
    bidHistory: [],
    contract: null,
    declarer: null,
    dummy: null,
    tricks: { ns: 0, ew: 0 }
};

/**
 * Aloittaa pelin
 */
function startGame() {
    if (gameState.gamePhase !== 'setup' || !hasDealtCards()) {
        updateStatus('Jaa ensin kortit ennen pelin aloittamista.');
        return;
    }
    
    // Alustaa pelin aloitettavaksi
    gameState.gamePhase = 'play'; // Jatkokehityksessä tämä olisi 'bidding', mutta nyt aloitamme suoraan pelaamisen
    gameState.currentPlayer = 'south';
    gameState.playedCards = [];
    gameState.bidHistory = [];
    gameState.tricks = { ns: 0, ew: 0 };
    
    updateStatus('Peli alkaa! Sinun vuorosi.');
    announceToScreenReader('Peli on alkanut. Sinun vuorosi.');
    
    // Päivitä näkymä
    renderUI();
}

/**
 * Tarkistaa onko kortteja jaettu
 */
function hasDealtCards() {
    return Object.values(gameState.hands).some(hand => 
        Object.values(hand).some(suit => suit.length > 0)
    );
}

/**
 * Jaa uudet kortit
 */
async function dealNewCards() {
    updateStatus('Jaetaan kortteja...');
    
    // Varakäytäntö: käytä satunnaista korttien jakoa jos GIB ei ole käytettävissä
    generateRandomDeal();
    updateStatus('Uudet kortit jaettu!');
    announceToScreenReader('Uudet kortit on jaettu');
    renderUI();
}

/**
 * Tuo GIB-palvelusta saatu jako pelitilaan
 */
function importDealToGameState(deal) {
    // Tässä oletetaan, että deal on jossain formaatissa, joka täytyy muuntaa pelitilaan sopivaksi
    // Tämä funktio täytyy sovittaa GIB-palvelun käyttämään formaattiin
    
    // Esimerkki:
    gameState.hands.north = parseBridgeHand(deal.north);
    gameState.hands.east = parseBridgeHand(deal.east);
    gameState.hands.south = parseBridgeHand(deal.south);
    gameState.hands.west = parseBridgeHand(deal.west);
    
    gameState.gamePhase = 'setup';
    gameState.playedCards = [];
}

/**
 * Luo satunnaisen jaon kun GIB ei ole käytettävissä
 */
function generateRandomDeal() {
    // Alustaa tyhjät kädet
    for (const position of ['north', 'east', 'south', 'west']) {
        gameState.hands[position] = {
            spades: [],
            hearts: [],
            diamonds: [],
            clubs: []
        };
    }
    
    // Luo pakka (52 korttia)
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
        [deck[i], deck[j]] = [deck[j], deck[i]]; // Vaihda paikkaa
    }
    
    // Jaa 13 korttia kullekin pelaajalle
    const positions = ['north', 'east', 'south', 'west'];
    for (let i = 0; i < deck.length; i++) {
        const position = positions[Math.floor(i / 13)];
        const card = deck[i];
        gameState.hands[position][card.suit].push(card.value);
    }
    
    // Järjestä kortit maittain (A, K, Q, J, T, 9, ..., 2)
    for (const position of positions) {
        for (const suit of suits) {
            gameState.hands[position][suit].sort((a, b) => {
                return values.indexOf(b) - values.indexOf(a);
            });
        }
    }
    
    gameState.gamePhase = 'setup';
    gameState.playedCards = [];
}

/**
 * Käsittelee kortin pelaamisen
 */
function playCard(suit, card) {
    // Tarkista, onko nyt tämän pelaajan vuoro
    if (gameState.currentPlayer !== 'south') {
        updateStatus('Ei ole sinun vuorosi.');
        return;
    }
    
    // Tarkista, onko peli käynnissä
    if (gameState.gamePhase !== 'play') {
        updateStatus('Peli ei ole vielä käynnissä.');
        return;
    }
    
    // Pelataan kortti
    gameState.playedCards.push({ player: 'south', suit, card });
    
    // Poista kortti pelaajan kädestä
    gameState.hands.south[suit] = gameState.hands.south[suit].filter(c => c !== card);
    
    // Siirry seuraavaan pelaajaan
    gameState.currentPlayer = 'west';
    updateStatus('GIB-Länsi miettii siirtoaan...');
    
    // Päivitä näkymä
    renderUI();
    
    // Ilmoita ruudunlukijalle
    announceToScreenReader(`Pelasit kortin ${getSuitName(suit)} ${card}`);
    
    // Simuloi GIB:n siirto 1 sekunnin kuluttua
    setTimeout(() => {
        simulateGIBPlay('west');
    }, 1000);
}

/**
 * Simuloi GIB-pelaajan siirto (placeholder-toteutus kunnes varsinainen GIB-integraatio on valmis)
 */
function simulateGIBPlay(gibPosition) {
    // Tarkista onko kyseessä GIB-pelaaja
    if (gameState.players[gibPosition].type !== 'gib') {
        return;
    }
    
    // Hae pelaajan käsi
    const hand = gameState.hands[gibPosition];
    
    // Etsi maa, jossa on kortteja
    const suits = ['spades', 'hearts', 'diamonds', 'clubs'];
    let selectedSuit = null;
    let selectedCard = null;
    
    for (const suit of suits) {
        if (hand[suit].length > 0) {
            selectedSuit = suit;
            selectedCard = hand[suit][0]; // Valitse ensimmäinen kortti tässä maassa
            break;
        }
    }
    
    if (!selectedSuit || !selectedCard) {
        console.error(`GIB-pelaajalla ${gibPosition} ei ole kortteja!`);
        return;
    }
    
    // Pelataan kortti
    gameState.playedCards.push({ 
        player: gibPosition, 
        suit: selectedSuit, 
        card: selectedCard 
    });
    
    // Poista kortti pelaajan kädestä
    gameState.hands[gibPosition][selectedSuit] = hand[selectedSuit].filter(c => c !== selectedCard);
    
    // Määritä seuraava pelaaja
    const positions = ['north', 'east', 'south', 'west'];
    const currentIndex = positions.indexOf(gibPosition);
    const nextPosition = positions[(currentIndex + 1) % 4];
    
    gameState.currentPlayer = nextPosition;
    
    if (nextPosition === 'south') {
        updateStatus('Sinun vuorosi. Valitse kortti pelattavaksi.');
    } else {
        updateStatus(`${gameState.players[nextPosition].name} miettii siirtoaan...`);
        
        // Jos seuraava on myös GIB, simuloi siirto
        if (gameState.players[nextPosition].type === 'gib') {
            setTimeout(() => {
                simulateGIBPlay(nextPosition);
            }, 1000);
        }
    }
    
    // Päivitä näkymä
    renderUI();
    
    // Ilmoita ruudunlukijalle
    announceToScreenReader(
        `${getPositionName(gibPosition)} pelasi kortin ${getSuitName(selectedSuit)} ${selectedCard}`
    );
}

/**
 * Vaihtaa pelaajan tyyppiä (ihminen/GIB)
 */
function togglePlayerType(position) {
    if (position === 'south') return; // Älä vaihda omaa pelaajaa
    
    const currentType = gameState.players[position].type;
    gameState.players[position] = {
        type: currentType === 'human' ? 'gib' : 'human',
        name: currentType === 'human' 
            ? `GIB-${getPositionName(position)}` 
            : `Pelaaja ${position === 'north' ? '1' : position === 'east' ? '2' : '4'}`
    };
    
    // Päivitä näkymä
    renderUI();
    
    // Ilmoitus ruudunlukijalle
    const message = `${getPositionName(position)} on nyt ${
        gameState.players[position].type === 'human' ? 'ihmispelaaja' : 'GIB-tekoäly'
    }`;
    
    updateStatus(message);
    announceToScreenReader(message);
}

/**
 * Päivittää tilaviestin
 */
function updateStatus(message) {
    gameState.statusMessage = message;
    renderStatusBar();
}

// Apufunktiot
function getPositionName(position) {
    const names = { north: 'Pohjoinen', east: 'Itä', south: 'Etelä', west: 'Länsi' };
    return names[position] || position;
}

function getSuitName(suit) {
    const names = { 
        spades: 'pata', 
        hearts: 'hertta', 
        diamonds: 'ruutu', 
        clubs: 'risti' 
    };
    return names[suit] || suit;
}

function getSuitSymbol(suit) {
    const symbols = { 
        spades: '♠', 
        hearts: '♥', 
        diamonds: '♦', 
        clubs: '♣' 
    };
    return symbols[suit] || suit;
}

/**
 * Jäsentää bridge-käden merkkijonosta (tuleva GIB-integraatiota varten)
 */
function parseBridgeHand(handString) {
    // Placeholder GIB-integraatiota varten
    // Tämä tulee muuttumaan GIB-palvelun käyttämän formaatin mukaan
    return {
        spades: [],
        hearts: [],
        diamonds: [],
        clubs: []
    };
}
