/**
 * BridgeCircle - Main Application
 * Main application module and initialization
 */

// Multiplayer mode flag
window.isMultiplayerGame = false;
window.yourPosition = null;

// When DOM is ready, initialize application
document.addEventListener('DOMContentLoaded', initializeApp);

/**
 * Initializes the application
 */
async function initializeApp() {
    console.log('BridgeCircle application starting...');
    
    // Check if we're on the solo page
    const isSoloMode = window.location.pathname.includes('solo.html');
    
    // In solo mode, initialize the original game
    if (isSoloMode) {
        window.isMultiplayerGame = false;
        await initializeSoloGame();
    } else {
        // In multiplayer mode, lobby.js handles initialization
        window.isMultiplayerGame = true;
        // The lobby.js will call initializeMultiplayerGame when needed
    }
    
    console.log('BridgeCircle application initialized in', 
                window.isMultiplayerGame ? 'multiplayer' : 'solo', 'mode');
}

/**
 * Initialize solo game (original functionality)
 */
async function initializeSoloGame() {
    // Try to initialize GIB service
    try {
        await gibService.initialize();
        if (gibService.isAvailable()) {
            console.log('GIB service is available.');
        } else {
            console.log('GIB service could not be initialized, using simulated game.');
        }
    } catch (error) {
        console.error('Error initializing GIB service:', error);
    }
    
    // Set event listeners for UI elements
    setupEventListeners();
    
    // Render UI
    renderUI();
    
    // Handle potential CORS issues
    handleCORSIssues();
    
    // Tarkista onko selaimen kokoruututila tuettu
    checkFullscreenSupport();
}

/**
 * Initialize multiplayer game (called from lobby.js)
 */
function initializeMultiplayerGame(gameState, biddingState, players) {
    console.log('Initializing multiplayer game:', gameState);
    
    // Set isMultiplayerGame flag to true
    window.isMultiplayerGame = true;
    
    // Find what position we're playing
    for (const [position, player] of Object.entries(players)) {
        if (player && player.id === socket.id) {
            window.yourPosition = position;
            break;
        }
    }
    
    console.log('Your position:', window.yourPosition);
    
    // Initialize game state with received data
    setupMultiplayerGameState(gameState, biddingState, players);
    
    // Set up event listeners for UI elements (but not GIB-related ones)
    setupMultiplayerEventListeners();
    
    // Render UI
    renderMultiplayerUI();
    
    // Check fullscreen support
    checkFullscreenSupport();
}

/**
 * Setup the game state for multiplayer
 */
function setupMultiplayerGameState(receivedGameState, receivedBiddingState, players) {
    // Initialize gameState with the received values
    // Need to convert certain structures to match our expected formats
    
    // Set player information
    gameState.players = players;
    
    // Set current player and game phase
    gameState.currentPlayer = receivedGameState.currentPlayer;
    gameState.gamePhase = receivedGameState.gamePhase;
    
    // Hand information will be received separately
    // Each player only knows their own cards initially
    
    // Other game state properties
    gameState.playedCards = receivedGameState.playedCards || [];
    gameState.currentTrick = receivedGameState.currentTrick || [];
    gameState.contract = receivedGameState.contract;
    gameState.trumpSuit = receivedGameState.trumpSuit;
    gameState.declarer = receivedGameState.declarer;
    gameState.dummy = receivedGameState.dummy;
    gameState.tricks = receivedGameState.tricks || { ns: 0, ew: 0 };
    gameState.totalTricks = receivedGameState.totalTricks || 0;
    gameState.leadPlayer = receivedGameState.leadPlayer;
    
    // Setup bidding state if we're in bidding phase
    if (gameState.gamePhase === 'bidding' && receivedBiddingState) {
        biddingState.currentBidder = receivedBiddingState.currentBidder;
        biddingState.bidHistory = receivedBiddingState.bidHistory || [];
        biddingState.currentBiddingRound = receivedBiddingState.currentBiddingRound || 1;
        biddingState.consecutivePasses = receivedBiddingState.consecutivePasses || 0;
        biddingState.biddingComplete = receivedBiddingState.biddingComplete || false;
        biddingState.highestBid = receivedBiddingState.highestBid;
        biddingState.contract = receivedBiddingState.contract;
        biddingState.declarer = receivedBiddingState.declarer;
        biddingState.dummy = receivedBiddingState.dummy;
        biddingState.trumpSuit = receivedBiddingState.trumpSuit;
        biddingState.selectedSystem = receivedBiddingState.selectedSystem || 'natural';
        biddingState.dealer = receivedBiddingState.dealer || 'south';
    }
    
    updateStatus("Game initialized. " + 
        (gameState.gamePhase === 'bidding' ? "Bidding phase. " : "Play phase. ") + 
        "You are playing as " + getPositionName(window.yourPosition) + ".");
}

/**
 * Set up event listeners for multiplayer game
 */
function setupMultiplayerEventListeners() {
    // Set up UI element event listeners, but not GIB-related ones
    // since GIB is handled by the server in multiplayer
    
    // Help buttons
    document.getElementById('toggle-help-button').addEventListener('click', () => {
        toggleHelp();
    });
    
    document.getElementById('close-help-button').addEventListener('click', () => {
        uiState.showHelp = false;
        toggleHelp();
    });
    
    // Fullscreen button
    document.getElementById('fullscreen-button').addEventListener('click', () => {
        toggleFullscreenMode();
    });
    
    // Keyboard shortcuts
    document.addEventListener('keydown', handleMultiplayerKeydown);
}

/**
 * Handle keyboard events for multiplayer game
 */
function handleMultiplayerKeydown(e) {
    // Similar to the original keydown handler, but adjusted for multiplayer
    // where certain actions need to be sent to the server
    
    // Process keyboard shortcuts
    for (const shortcut of keyboardShortcuts) {
        if (shortcut.action && // Skip shortcuts with no action
            e.key.toLowerCase() === shortcut.key.toLowerCase() && 
            (!shortcut.alt || e.altKey) && 
            (!shortcut.shift || e.shiftKey) && 
            (!shortcut.ctrl || e.ctrlKey)) {
            
            e.preventDefault();
            
            // Skip GIB-related shortcuts in multiplayer
            if (shortcut.description.includes('GIB')) {
                continue;
            }
            
            shortcut.action();
            return;
        }
    }
    
    // Handle other key functionality as in original game
    // but with multiplayer adaptations
}

/**
 * Receive player's cards in multiplayer game
 */
function receiveYourCards(position, cards) {
    // Update the player's hand with received cards
    gameState.hands[position] = cards;
    
    // Render the updated hand
    renderHand(position, position === 'north' ? 
               document.getElementById('north-hand') : 
               document.getElementById('south-hand'), 
               true);
    
    // Announce cards to screen reader
    announceToScreenReader(`Your cards have been dealt. You are playing as ${getPositionName(position)}.`);
}

/**
 * Update play phase cards (after bidding completes)
 */
function updatePlayPhaseCards(position, cards, dummyCards) {
    // Update player's cards
    gameState.hands[position] = cards;
    
    // Update dummy cards if provided
    if (dummyCards && gameState.dummy) {
        gameState.hands[gameState.dummy] = dummyCards;
    }
    
    // Render the updated hands
    renderHand(position, position === 'north' ? 
               document.getElementById('north-hand') : 
               document.getElementById('south-hand'), 
               true);
    
    if (dummyCards && gameState.dummy) {
        renderHand(gameState.dummy, 
                  gameState.dummy === 'north' ? 
                  document.getElementById('north-hand') : 
                  document.getElementById('south-hand'), 
                  true);
        
        announceToScreenReader(`Dummy's cards are now visible.`);
    }
}

/**
 * Handle bid made in multiplayer game
 */
function handleMultiplayerBid(position, bid, nextBidder, updatedBiddingState) {
    // Update bidding state
    biddingState.currentBidder = nextBidder;
    biddingState.bidHistory.push({
        player: position,
        bid: bid,
        round: biddingState.currentBiddingRound
    });
    
    // Update other bidding state properties
    if (bid === 'P') {
        biddingState.consecutivePasses++;
    } else {
        biddingState.consecutivePasses = 0;
        
        // Update highest bid if not pass, double, or redouble
        if (!['P', 'X', 'XX'].includes(bid)) {
            biddingState.highestBid = bid;
        }
    }
    
    // Announce bid to screen reader
    const bidText = bid === 'P' ? 'passes' : 
                   bid === 'X' ? 'doubles' : 
                   bid === 'XX' ? 'redoubles' : `bids ${bid}`;
    announceToScreenReader(`${getPositionName(position)} ${bidText}.`);
    
    // Update UI
    renderBiddingUI();
    
    // If it's your turn to bid and you're a human player
    if (nextBidder === window.yourPosition && gameState.players[window.yourPosition].type === 'human') {
        announceToScreenReader(`It's your turn to bid.`);
    }
}

/**
 * Make a bid in multiplayer game
 * Overrides the makeBid function in bidding.js for multiplayer
 */
function makeBid(player, bid) {
    // Only allow the current player to bid
    if (player !== biddingState.currentBidder) {
        console.error(`Not ${player}'s turn to bid`);
        return false;
    }
    
    // Check if this is the player's position
    if (player !== window.yourPosition) {
        console.error(`You can only make bids for your position (${window.yourPosition})`);
        return false;
    }
    
    // Check if bid is valid
    if (!isValidBid(bid, biddingState.highestBid)) {
        console.error(`Invalid bid: ${bid}`);
        return false;
    }
    
    // Send bid to server
    socket.emit('makeBid', {
        tableCode: document.getElementById('game-table-code').textContent,
        position: player,
        bid: bid
    });
    
    return true;
}

/**
 * Handle bidding complete in multiplayer game
 */
function handleBiddingComplete(contract, declarer, dummy, trumpSuit, currentPlayer, updatedGameState) {
    // Update game state
    gameState.contract = contract;
    gameState.declarer = declarer;
    gameState.dummy = dummy;
    gameState.trumpSuit = trumpSuit;
    gameState.currentPlayer = currentPlayer;
    gameState.gamePhase = 'play';
    
    // Update bidding state
    biddingState.biddingComplete = true;
    biddingState.contract = contract;
    biddingState.declarer = declarer;
    biddingState.dummy = dummy;
    biddingState.trumpSuit = trumpSuit;
    
    // Announce to screen reader
    const contractMessage = `Final contract: ${formatContract(contract)} by ${getPositionName(declarer)}. ${getPositionName(currentPlayer)} leads.`;
    announceToScreenReader(contractMessage);
    
    // Update UI
    hideBiddingUI();
    renderPlayUI();
    
    // If it's your turn to play and you're a human player
    if (currentPlayer === window.yourPosition && gameState.players[window.yourPosition].type === 'human') {
        announceToScreenReader(`It's your turn to play.`);
    }
}

/**
 * Play a card in multiplayer game
 * Overrides the playCard function in game.js for multiplayer
 */
function playCard(suit, card) {
    // Get current player
    const currentPlayer = gameState.currentPlayer;
    
    // Determine if player can play
    const isYourTurn = currentPlayer === window.yourPosition;
    const isDummy = currentPlayer === gameState.dummy;
    const youAreController = window.yourPosition === gameState.declarer && isDummy;
    
    // Check if it's your turn or if you control dummy
    if (!isYourTurn && !youAreController) {
        updateStatus('It\'s not your turn.');
        return;
    }
    
    // Check if game is in progress
    if (gameState.gamePhase !== 'play') {
        updateStatus('Game is not in play phase yet.');
        return;
    }
    
    // Check if player must follow suit (if not first card in trick)
    if (gameState.currentTrick.length > 0) {
        const leadSuit = gameState.currentTrick[0].suit;
        if (suit !== leadSuit && gameState.hands[currentPlayer][leadSuit].length > 0) {
            updateStatus(`You must follow suit (${getSuitName(leadSuit)}).`);
            return;
        }
    }
    
    // Send card play to server
    socket.emit('playCard', {
        tableCode: document.getElementById('game-table-code').textContent,
        position: currentPlayer,
        suit: suit,
        card: card
    });
}

/**
 * Handle card played in multiplayer game
 */
function handleMultiplayerCardPlayed(position, suit, card, currentTrick) {
    // Update game state
    gameState.currentTrick = currentTrick;
    
    // Remove card from player's hand
    if (gameState.hands[position] && gameState.hands[position][suit]) {
        gameState.hands[position][suit] = 
            gameState.hands[position][suit].filter(c => c !== card);
    }
    
    // Add to played cards history if not already there
    const playedCard = { player: position, suit, card };
    if (!gameState.playedCards.some(c => 
        c.player === position && c.suit === suit && c.card === card)) {
        gameState.playedCards.push(playedCard);
    }
    
    // Announce card play
    announceToScreenReader(`${getPositionName(position)} played ${getSuitName(suit)} ${card}`, true);
    
    // Update UI
    renderPlayedCards();
    renderHand(position, 
               position === 'north' ? document.getElementById('north-hand') : 
               position === 'south' ? document.getElementById('south-hand') : null);
    
    // Update center area to show current trick
    renderCenterArea();
}

/**
 * Handle trick completion in multiplayer game
 */
function handleTrickComplete(winner, trick, tricks, nextPlayer) {
    // Update game state
    gameState.currentTrick = [];
    gameState.tricks = tricks;
    gameState.currentPlayer = nextPlayer;
    gameState.totalTricks += 1;
    
    // Announce winner
    const winnerMessage = `${getPositionName(winner)} won the trick!`;
    announceToScreenReader(winnerMessage);
    
    // Update UI
    renderCenterArea();
    updateStatus(winnerMessage);
    
    // If it's your turn to play and you're a human player
    if (nextPlayer === window.yourPosition || 
        (nextPlayer === gameState.dummy && window.yourPosition === gameState.declarer)) {
        announceToScreenReader(`It's your turn to play.`);
    }
}

/**
 * Handle game over in multiplayer
 */
function handleGameOver(message, tricks, contract) {
    // Update game state
    gameState.gamePhase = 'end';
    gameState.tricks = tricks;
    
    // Announce result
    announceToScreenReader(message);
    
    // Update UI
    updateStatus(message);
    renderCenterArea();
}

/**
 * Handles CORS issues
 */
function handleCORSIssues() {
    // This is a simple check that can be expanded if needed
    const warningMessage = 'Using GIB service directly from browser may encounter CORS restrictions. ' +
                          'If GIB features don\'t work, consider using a proxy server.';
    
    if (typeof gibService !== 'undefined' && 
        gibService.apiBaseUrl.startsWith('http:') && 
        window.location.protocol === 'https:') {
        console.warn(warningMessage);
        console.warn('Mixed content: GIB service uses HTTP but application is on HTTPS.');
    }
}

/**
 * Checks if the browser supports fullscreen mode
 */
function checkFullscreenSupport() {
    const fullscreenButton = document.getElementById('fullscreen-button');
    
    if (!document.fullscreenEnabled && !document.webkitFullscreenEnabled && 
        !document.mozFullScreenEnabled && !document.msFullscreenEnabled) {
        // If fullscreen mode is not supported, hide button
        if (fullscreenButton) {
            fullscreenButton.style.display = 'none';
        }
        console.log('Fullscreen mode is not supported in this browser');
    } else {
        console.log('Fullscreen mode is supported');
    }
}

/**
 * Handles errors in a user-friendly way
 */
function handleError(error, context) {
    console.error(`Error (${context}):`, error);
    
    let message = 'An error occurred. Please try again.';
    
    // Define a more user-friendly error message based on context
    if (context === 'gib-deal') {
        message = 'Failed to fetch cards from GIB service. Using random cards instead.';
    } else if (context === 'gib-move') {
        message = 'Failed to fetch GIB move. Using simulated move instead.';
    } else if (context === 'multiplayer') {
        message = 'Error in multiplayer game. Please try reconnecting.';
    }
    
    // Show error message to user
    updateStatus(message);
    announceToScreenReader(message);
}

/**
 * Utility function for async operations
 */
async function asyncTryCatch(asyncFn, errorContext) {
    try {
        return await asyncFn();
    } catch (error) {
        handleError(error, errorContext);
        return null;
    }
}