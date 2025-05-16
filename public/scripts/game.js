/**
 * BridgeCircle - Game Module
 * Handles game logic and game state
 */

// Game state
const gameState = {
    players: {
        north: { type: 'human', name: 'Player 1' },
        east: { type: 'gib', name: 'GIB-East' },
        south: { type: 'human', name: 'You' },
        west: { type: 'gib', name: 'GIB-West' }
    },
    currentPlayer: 'south',
    gamePhase: 'setup', // 'setup', 'bidding', 'play', 'end'
    statusMessage: 'Start by dealing cards.',
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
 * Starts the game
 */
function startGame() {
    if (gameState.gamePhase !== 'setup' || !hasDealtCards()) {
        updateStatus('Deal cards before starting the game.');
        return;
    }
    
    // Initialize game to be started
    gameState.gamePhase = 'play'; // In future development this would be 'bidding', but now we start directly with play
    gameState.currentPlayer = 'south';
    gameState.playedCards = [];
    gameState.bidHistory = [];
    gameState.tricks = { ns: 0, ew: 0 };
    
    updateStatus('Game starts! Your turn.');
    announceToScreenReader('Game has started. Your turn.');
    
    // Update view
    renderUI();
}

/**
 * Checks if cards have been dealt
 */
function hasDealtCards() {
    return Object.values(gameState.hands).some(hand => 
        Object.values(hand).some(suit => suit.length > 0)
    );
}

/**
 * Deal new cards
 */
async function dealNewCards() {
    updateStatus('Dealing cards...');
    
    try {
        // Try to get cards from GIB service if GIB integration is ready
        if (typeof gibService !== 'undefined' && gibService.isAvailable()) {
            const deal = await gibService.getDeal();
            if (deal) {
                importDealToGameState(deal);
                updateStatus('New cards dealt!');
                announceToScreenReader('New cards have been dealt');
                renderUI();
                return;
            }
        }
    } catch (error) {
        console.error('Error fetching cards from GIB service:', error);
    }
    
    // Fallback: use random card deal if GIB is not available
    generateRandomDeal();
    updateStatus('New cards dealt!');
    announceToScreenReader('New cards have been dealt');
    renderUI();
}

/**
 * Imports deal from GIB service to game state
 */
function importDealToGameState(deal) {
    // Here we assume that deal is in some format that needs to be converted to match game state
    // This function needs to be adapted to the format used by GIB service
    
    // Example:
    gameState.hands.north = parseBridgeHand(deal.north);
    gameState.hands.east = parseBridgeHand(deal.east);
    gameState.hands.south = parseBridgeHand(deal.south);
    gameState.hands.west = parseBridgeHand(deal.west);
    
    gameState.gamePhase = 'setup';
    gameState.playedCards = [];
}

/**
 * Creates a random deal when GIB is not available
 */
function generateRandomDeal() {
    // Initialize empty hands
    for (const position of ['north', 'east', 'south', 'west']) {
        gameState.hands[position] = {
            spades: [],
            hearts: [],
            diamonds: [],
            clubs: []
        };
    }
    
    // Create deck (52 cards)
    const deck = [];
    const suits = ['spades', 'hearts', 'diamonds', 'clubs'];
    const values = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
    
    for (const suit of suits) {
        for (const value of values) {
            deck.push({ suit, value });
        }
    }
    
    // Shuffle deck
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]]; // Swap positions
    }
    
    // Deal 13 cards to each player
    const positions = ['north', 'east', 'south', 'west'];
    for (let i = 0; i < deck.length; i++) {
        const position = positions[Math.floor(i / 13)];
        const card = deck[i];
        gameState.hands[position][card.suit].push(card.value);
    }
    
    // Sort cards by suit (A, K, Q, J, T, 9, ..., 2)
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
 * Handles playing a card
 */
function playCard(suit, card) {
    // Check if it's this player's turn
    if (gameState.currentPlayer !== 'south') {
        updateStatus('It\'s not your turn.');
        return;
    }
    
    // Check if game is in progress
    if (gameState.gamePhase !== 'play') {
        updateStatus('Game is not in progress yet.');
        return;
    }
    
    // Play the card
    gameState.playedCards.push({ player: 'south', suit, card });
    
    // Remove card from player's hand
    gameState.hands.south[suit] = gameState.hands.south[suit].filter(c => c !== card);
    
    // Move to next player
    gameState.currentPlayer = 'west';
    updateStatus('GIB-West is thinking...');
    
    // Update view
    renderUI();
    
    // Announce to screen reader
    announceToScreenReader(`You played ${getSuitName(suit)} ${card}`);
    
    // Simulate GIB's move after 1 second
    setTimeout(() => {
        simulateGIBPlay('west');
    }, 1000);
}

/**
 * Simulates GIB player's move (placeholder implementation until actual GIB integration is ready)
 */
function simulateGIBPlay(gibPosition) {
    // Check if this is a GIB player
    if (gameState.players[gibPosition].type !== 'gib') {
        return;
    }
    
    // Get player's hand
    const hand = gameState.hands[gibPosition];
    
    // Find suit with cards
    const suits = ['spades', 'hearts', 'diamonds', 'clubs'];
    let selectedSuit = null;
    let selectedCard = null;
    
    for (const suit of suits) {
        if (hand[suit].length > 0) {
            selectedSuit = suit;
            selectedCard = hand[suit][0]; // Choose first card in this suit
            break;
        }
    }
    
    if (!selectedSuit || !selectedCard) {
        console.error(`GIB player ${gibPosition} has no cards!`);
        return;
    }
    
    // Play the card
    gameState.playedCards.push({ 
        player: gibPosition, 
        suit: selectedSuit, 
        card: selectedCard 
    });
    
    // Remove card from player's hand
    gameState.hands[gibPosition][selectedSuit] = hand[selectedSuit].filter(c => c !== selectedCard);
    
    // Determine next player
    const positions = ['north', 'east', 'south', 'west'];
    const currentIndex = positions.indexOf(gibPosition);
    const nextPosition = positions[(currentIndex + 1) % 4];
    
    gameState.currentPlayer = nextPosition;
    
    if (nextPosition === 'south') {
        updateStatus('Your turn. Choose a card to play.');
    } else {
        updateStatus(`${gameState.players[nextPosition].name} is thinking...`);
        
        // If next player is also GIB, simulate move
        if (gameState.players[nextPosition].type === 'gib') {
            setTimeout(() => {
                simulateGIBPlay(nextPosition);
            }, 1000);
        }
    }
    
    // Update view
    renderUI();
    
    // Announce to screen reader
    announceToScreenReader(
        `${getPositionName(gibPosition)} played ${getSuitName(selectedSuit)} ${selectedCard}`
    );
}

/**
 * Toggles player type (human/GIB)
 */
function togglePlayerType(position) {
    if (position === 'south') return; // Don't change your own player
    
    const currentType = gameState.players[position].type;
    gameState.players[position] = {
        type: currentType === 'human' ? 'gib' : 'human',
        name: currentType === 'human' 
            ? `GIB-${getPositionName(position)}` 
            : `Player ${position === 'north' ? '1' : position === 'east' ? '2' : '4'}`
    };
    
    // Update view
    renderUI();
    
    // Announcement for screen reader
    const message = `${getPositionName(position)} is now ${
        gameState.players[position].type === 'human' ? 'human player' : 'GIB AI'
    }`;
    
    updateStatus(message);
    announceToScreenReader(message);
}

/**
 * Updates status message
 */
function updateStatus(message) {
    gameState.statusMessage = message;
    renderStatusBar();
}

// Helper functions
function getPositionName(position) {
    const names = { north: 'North', east: 'East', south: 'South', west: 'West' };
    return names[position] || position;
}

function getSuitName(suit) {
    const names = { 
        spades: 'spade', 
        hearts: 'heart', 
        diamonds: 'diamond', 
        clubs: 'club' 
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
 * Parses bridge hand from string (for future GIB integration)
 */
function parseBridgeHand(handString) {
    // Placeholder for GIB integration
    // This will change based on the format used by GIB service
    return {
        spades: [],
        hearts: [],
        diamonds: [],
        clubs: []
    };
}
