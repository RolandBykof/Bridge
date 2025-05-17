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
    currentTrick: [], // Cards in the current trick
    bidHistory: [],
    contract: null,
    trumpSuit: null, // For now, we'll default to no trump
    declarer: null,
    dummy: null,
    tricks: { ns: 0, ew: 0 },
    totalTricks: 0, // Track how many tricks have been played
    leadPlayer: 'south' // Player who leads the current trick
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
    gameState.currentPlayer = 'south'; // South always leads first in this simplified version
    gameState.leadPlayer = 'south';
    gameState.playedCards = [];
    gameState.currentTrick = [];
    gameState.bidHistory = [];
    gameState.tricks = { ns: 0, ew: 0 };
    gameState.totalTricks = 0;
    
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
    // Parse the GIB hand format to our game state format
    gameState.hands.north = gibService.parseGIBHand(deal.north);
    gameState.hands.east = gibService.parseGIBHand(deal.east);
    gameState.hands.south = gibService.parseGIBHand(deal.south);
    gameState.hands.west = gibService.parseGIBHand(deal.west);
    
    gameState.gamePhase = 'setup';
    gameState.playedCards = [];
    gameState.currentTrick = [];
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
    gameState.currentTrick = [];
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
    
    // Check if player must follow suit (if not first card in trick)
    if (gameState.currentTrick.length > 0) {
        const leadSuit = gameState.currentTrick[0].suit;
        if (suit !== leadSuit && gameState.hands.south[leadSuit].length > 0) {
            updateStatus(`You must follow suit (${getSuitName(leadSuit)}).`);
            return;
        }
    }
    
    // Add card to current trick and played cards history
    const playedCard = { player: 'south', suit, card };
    gameState.currentTrick.push(playedCard);
    gameState.playedCards.push(playedCard);
    
    // Remove card from player's hand
    gameState.hands.south[suit] = gameState.hands.south[suit].filter(c => c !== card);
    
    // Announce to screen reader
    announceToScreenReader(`You played ${getSuitName(suit)} ${card}`);
    
    // Check if trick is complete (4 cards)
    if (gameState.currentTrick.length === 4) {
        handleCompleteTrick();
    } else {
        // Move to next player
        gameState.currentPlayer = getNextPlayer('south');
        updateStatus(`${gameState.players[gameState.currentPlayer].name} is thinking...`);
        
        // Update view
        renderUI();
        
        // If next player is GIB, get actual GIB move
        if (gameState.players[gameState.currentPlayer].type === 'gib') {
            setTimeout(() => {
                getGIBMove(gameState.currentPlayer);
            }, 1000);
        }
    }
}

/**
 * Handles a complete trick (4 cards played)
 */
function handleCompleteTrick() {
    // Determine trick winner
    const winner = determineTrickWinner();
    
    // Update trick counts
    if (winner === 'north' || winner === 'south') {
        gameState.tricks.ns += 1;
    } else {
        gameState.tricks.ew += 1;
    }
    
    gameState.totalTricks += 1;
    
    // Clear current trick
    gameState.currentTrick = [];
    
    // Set winner as next lead player
    gameState.leadPlayer = winner;
    gameState.currentPlayer = winner;
    
    // Check if game is over (13 tricks played)
    if (gameState.totalTricks >= 13) {
        endGame();
        return;
    }
    
    // Announce winner and update status
    const winnerMessage = `${getPositionName(winner)} won the trick!`;
    updateStatus(winnerMessage);
    announceToScreenReader(winnerMessage);
    
    // Update UI
    renderUI();
    
    // If next player is GIB, get GIB move after delay
    if (gameState.players[winner].type === 'gib') {
        setTimeout(() => {
            getGIBMove(winner);
        }, 1500); // Slightly longer delay between tricks
    }
}

/**
 * Determines who won the trick
 */
function determineTrickWinner() {
    const values = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
    const leadSuit = gameState.currentTrick[0].suit;
    const trumpSuit = gameState.trumpSuit; // Will be null if no trump
    
    let highestCard = gameState.currentTrick[0];
    let winningPlayer = gameState.currentTrick[0].player;
    
    for (let i = 1; i < gameState.currentTrick.length; i++) {
        const currentCard = gameState.currentTrick[i];
        
        // Check if this card is a trump while highest is not
        if (trumpSuit && currentCard.suit === trumpSuit && highestCard.suit !== trumpSuit) {
            highestCard = currentCard;
            winningPlayer = currentCard.player;
        }
        // Check if both cards are trumps
        else if (trumpSuit && currentCard.suit === trumpSuit && highestCard.suit === trumpSuit) {
            if (values.indexOf(currentCard.card) > values.indexOf(highestCard.card)) {
                highestCard = currentCard;
                winningPlayer = currentCard.player;
            }
        }
        // Check if current card is lead suit and highest is also lead suit
        else if (currentCard.suit === leadSuit && highestCard.suit === leadSuit) {
            if (values.indexOf(currentCard.card) > values.indexOf(highestCard.card)) {
                highestCard = currentCard;
                winningPlayer = currentCard.player;
            }
        }
        // If current card is lead suit but highest is not (and not trump)
        else if (currentCard.suit === leadSuit && highestCard.suit !== leadSuit && 
                 (!trumpSuit || highestCard.suit !== trumpSuit)) {
            highestCard = currentCard;
            winningPlayer = currentCard.player;
        }
    }
    
    return winningPlayer;
}

/**
 * Ends the game
 */
function endGame() {
    gameState.gamePhase = 'end';
    
    // Determine winner
    let resultMessage = '';
    if (gameState.tricks.ns > gameState.tricks.ew) {
        resultMessage = `Game over! North-South team wins with ${gameState.tricks.ns} tricks to ${gameState.tricks.ew}.`;
    } else if (gameState.tricks.ew > gameState.tricks.ns) {
        resultMessage = `Game over! East-West team wins with ${gameState.tricks.ew} tricks to ${gameState.tricks.ns}.`;
    } else {
        resultMessage = `Game over! It's a tie with both teams taking ${gameState.tricks.ns} tricks.`;
    }
    
    updateStatus(resultMessage);
    announceToScreenReader(resultMessage);
    
    // Update UI
    renderUI();
}

/**
 * Gets the next player in clockwise order
 */
function getNextPlayer(currentPosition) {
    const positions = ['north', 'east', 'south', 'west'];
    const currentIndex = positions.indexOf(currentPosition);
    return positions[(currentIndex + 1) % 4];
}

/**
 * Get move from GIB service
 */
async function getGIBMove(gibPosition) {
    // Check if this is a GIB player
    if (gameState.players[gibPosition].type !== 'gib') {
        return;
    }
    
    try {
        // Check if GIB service is available
        if (typeof gibService === 'undefined' || !gibService.isAvailable()) {
            // Fall back to simulation if GIB is not available
            console.warn('GIB service not available, using simulation instead');
            simulateGIBPlay(gibPosition);
            return;
        }
        
        // Prepare parameters for GIB API
        const params = prepareGIBParameters(gibPosition);
        
        // Get move from GIB service
        const move = await gibService.getGIBMove(params);
        
        // If no move received, fall back to simulation
        if (!move) {
            console.warn('No move received from GIB service, using simulation instead');
            simulateGIBPlay(gibPosition);
            return;
        }
        
        // Handle GIB's move
        if (move.type === 'play') {
            playGIBCard(gibPosition, move.card);
        } else {
            console.warn('Unexpected move type from GIB:', move.type);
            simulateGIBPlay(gibPosition);
        }
    } catch (error) {
        console.error('Error getting GIB move:', error);
        // Fall back to simulation in case of error
        simulateGIBPlay(gibPosition);
    }
}

/**
 * Prepare parameters for the GIB API
 */
function prepareGIBParameters(gibPosition) {
    // Convert all hands to GIB format
    const north = gibService.formatHandForGIB(gameState.hands.north);
    const east = gibService.formatHandForGIB(gameState.hands.east);
    const south = gibService.formatHandForGIB(gameState.hands.south);
    const west = gibService.formatHandForGIB(gameState.hands.west);
    
    // Convert played cards to GIB format
    let playHistory = '';
    for (const playedCard of gameState.playedCards) {
        // Skip cards in the current trick
        if (gameState.currentTrick.includes(playedCard)) {
            continue;
        }
        
        const suitCode = getSuitCode(playedCard.suit);
        playHistory += suitCode + playedCard.card + ' ';
    }
    playHistory = playHistory.trim();
    
    // Convert current trick to GIB format
    let currentTrickString = '';
    for (const playedCard of gameState.currentTrick) {
        const suitCode = getSuitCode(playedCard.suit);
        currentTrickString += suitCode + playedCard.card + ' ';
    }
    currentTrickString = currentTrickString.trim();
    
    // Prepare final parameters
    return {
        pov: gibPosition.charAt(0).toUpperCase(), // First letter uppercase (N, E, S, W)
        d: '-', // Default dealer
        s: south,
        w: west,
        n: north,
        e: east,
        h: playHistory + (playHistory && currentTrickString ? ' ' : '') + currentTrickString
    };
}

/**
 * Play the card returned by GIB
 */
function playGIBCard(gibPosition, cardCode) {
    // Parse card code (e.g. "S2" -> suit: "spades", card: "2")
    const suitMap = {
        'S': 'spades',
        'H': 'hearts',
        'D': 'diamonds',
        'C': 'clubs'
    };
    
    const suit = suitMap[cardCode.charAt(0)];
    const card = cardCode.charAt(1);
    
    if (!suit || !card) {
        console.error(`Invalid card code from GIB: ${cardCode}`);
        simulateGIBPlay(gibPosition);
        return;
    }
    
    // Validate card (make sure it's in the player's hand)
    if (!gameState.hands[gibPosition][suit] || !gameState.hands[gibPosition][suit].includes(card)) {
        console.error(`GIB tried to play a card not in its hand: ${suit} ${card}`);
        simulateGIBPlay(gibPosition);
        return;
    }
    
    // Play the card
    const playedCard = { 
        player: gibPosition, 
        suit, 
        card 
    };
    
    gameState.currentTrick.push(playedCard);
    gameState.playedCards.push(playedCard);
    
    // Remove card from player's hand
    gameState.hands[gibPosition][suit] = gameState.hands[gibPosition][suit].filter(c => c !== card);
    
    // Announce to screen reader
    announceToScreenReader(
        `${getPositionName(gibPosition)} played ${getSuitName(suit)} ${card}`
    );
    
    // Check if trick is complete
    if (gameState.currentTrick.length === 4) {
        handleCompleteTrick();
    } else {
        // Move to next player
        const nextPlayer = getNextPlayer(gibPosition);
        gameState.currentPlayer = nextPlayer;
        
        if (nextPlayer === 'south') {
            updateStatus('Your turn. Choose a card to play.');
        } else {
            updateStatus(`${gameState.players[nextPlayer].name} is thinking...`);
            
            // If next player is also GIB, simulate move
            if (gameState.players[nextPlayer].type === 'gib') {
                setTimeout(() => {
                    getGIBMove(nextPlayer);
                }, 1000);
            }
        }
        
        // Update view
        renderUI();
    }
}

/**
 * Get suit code for GIB API
 */
function getSuitCode(suit) {
    const codes = { 
        'spades': 'S', 
        'hearts': 'H', 
        'diamonds': 'D', 
        'clubs': 'C' 
    };
    return codes[suit] || '';
}

/**
 * Simulates GIB player's move - FALLBACK ONLY
 * This is a fallback when the GIB service fails
 */
function simulateGIBPlay(gibPosition) {
    // Check if this is a GIB player
    if (gameState.players[gibPosition].type !== 'gib') {
        return;
    }
    
    console.warn('Using GIB simulation as fallback');
    
    // Get player's hand
    const hand = gameState.hands[gibPosition];
    
    // Find legal cards to play
    let playableCards = [];
    
    // If this is the first card in the trick, any card is legal
    if (gameState.currentTrick.length === 0) {
        for (const suit of ['spades', 'hearts', 'diamonds', 'clubs']) {
            if (hand[suit].length > 0) {
                hand[suit].forEach(card => {
                    playableCards.push({ suit, card });
                });
            }
        }
    } else {
        // If not first card, must follow suit if possible
        const leadSuit = gameState.currentTrick[0].suit;
        
        if (hand[leadSuit].length > 0) {
            // Must follow suit
            hand[leadSuit].forEach(card => {
                playableCards.push({ suit: leadSuit, card });
            });
        } else {
            // Can play any card
            for (const suit of ['spades', 'hearts', 'diamonds', 'clubs']) {
                if (hand[suit].length > 0) {
                    hand[suit].forEach(card => {
                        playableCards.push({ suit, card });
                    });
                }
            }
        }
    }
    
    if (playableCards.length === 0) {
        console.error(`GIB player ${gibPosition} has no legal cards to play!`);
        return;
    }
    
    // Select a card (simple AI - just pick first legal card)
    const selectedCard = playableCards[0];
    
    // Play the card
    const playedCard = { 
        player: gibPosition, 
        suit: selectedCard.suit, 
        card: selectedCard.card 
    };
    
    gameState.currentTrick.push(playedCard);
    gameState.playedCards.push(playedCard);
    
    // Remove card from player's hand
    gameState.hands[gibPosition][selectedCard.suit] = 
        hand[selectedCard.suit].filter(c => c !== selectedCard.card);
    
    // Announce to screen reader
    announceToScreenReader(
        `${getPositionName(gibPosition)} played ${getSuitName(selectedCard.suit)} ${selectedCard.card}`
    );
    
    // Check if trick is complete
    if (gameState.currentTrick.length === 4) {
        handleCompleteTrick();
    } else {
        // Move to next player
        const nextPlayer = getNextPlayer(gibPosition);
        gameState.currentPlayer = nextPlayer;
        
        if (nextPlayer === 'south') {
            updateStatus('Your turn. Choose a card to play.');
        } else {
            updateStatus(`${gameState.players[nextPlayer].name} is thinking...`);
            
            // If next player is also GIB, get GIB move
            if (gameState.players[nextPlayer].type === 'gib') {
                setTimeout(() => {
                    getGIBMove(nextPlayer);
                }, 1000);
            }
        }
        
        // Update view
        renderUI();
    }
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
