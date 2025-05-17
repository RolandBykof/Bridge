/**
 * BridgeCircle - UI Module
 * Handles UI rendering and user input processing
 */

// DOM references
const elements = {
    statusBar: document.getElementById('status-bar'),
    statusAnnouncer: document.getElementById('status-announcer'),
    cardAnnouncer: document.getElementById('card-announcer'),  // Uusi kortti-ilmoittaja
    cardFocusTarget: document.getElementById('card-focus-target'), // Uusi fokuskohde
    playerControls: document.getElementById('player-controls'),
    northHand: document.getElementById('north-hand'),
    eastHand: document.getElementById('east-hand'),
    westHand: document.getElementById('west-hand'),
    southHand: document.getElementById('south-hand'),
    centerArea: document.getElementById('center-area'),
    playedCardsContainer: document.getElementById('played-cards-container'),
    helpSection: document.getElementById('help-section'),
    helpList: document.getElementById('help-list'),
    toggleHelpButton: document.getElementById('toggle-help-button'),
    closeHelpButton: document.getElementById('close-help-button'),
    dealButton: document.getElementById('deal-button'),
    fullscreenButton: document.getElementById('fullscreen-button'), // Uusi kokoruututila-nappi
    biddingArea: document.getElementById('bidding-area'),
    biddingHistory: document.getElementById('bidding-history'),
    biddingControls: document.getElementById('bidding-controls')
};

// UI state
const uiState = {
    showHelp: false,
    lastAnnouncement: '',
    bidLevel: null, // For bidding shortcuts
};

// Keyboard shortcuts configuration
const keyboardShortcuts = [
    // Card viewing shortcuts (Own cards)
    { key: '1', alt: true, description: 'Read your spades', action: () => announceHandSuit('south', 'spades') },
    { key: '2', alt: true, description: 'Read your hearts', action: () => announceHandSuit('south', 'hearts') },
    { key: '3', alt: true, description: 'Read your diamonds', action: () => announceHandSuit('south', 'diamonds') },
    { key: '4', alt: true, description: 'Read your clubs', action: () => announceHandSuit('south', 'clubs') },
    { key: '5', alt: true, description: 'Read all your cards', action: () => announceEntireHand('south') },
    
    // Card viewing shortcuts (Dummy's cards)
    { key: '6', alt: true, description: 'Read dummy spades', action: () => announceHandSuit('north', 'spades') },
    { key: '7', alt: true, description: 'Read dummy hearts', action: () => announceHandSuit('north', 'hearts') },
    { key: '8', alt: true, description: 'Read dummy diamonds', action: () => announceHandSuit('north', 'diamonds') },
    { key: '9', alt: true, description: 'Read dummy clubs', action: () => announceHandSuit('north', 'clubs') },
    { key: '0', alt: true, description: 'Read all dummy cards', action: () => announceEntireHand('north') },
    
    // Game state shortcuts
    { key: 'z', alt: true, description: 'Read current trick', action: () => announceCurrentTrick() },
    { key: 'x', alt: true, description: 'Read game state', action: () => announceGameState() },
    { key: 'c', alt: true, description: 'Announce current player', action: () => announceCurrentPlayer() },
    { key: 'v', alt: true, description: 'Read last played trick', action: () => announceLastTrick() },
    
    // Bidding shortcuts
    { key: 'p', alt: true, description: 'Bid Pass', action: () => makeBidShortcut('P') },
    { key: 'd', alt: true, description: 'Bid Double', action: () => makeBidShortcut('X') },
    { key: 'f', alt: true, description: 'Bid Redouble', action: () => makeBidShortcut('XX') },
    
    // Card playing shortcuts - high cards only
    { key: '1', ctrl: true, description: 'Play highest spade', action: () => playHighestCard('spades') },
    { key: '2', ctrl: true, description: 'Play highest heart', action: () => playHighestCard('hearts') },
    { key: '3', ctrl: true, description: 'Play highest diamond', action: () => playHighestCard('diamonds') },
    { key: '4', ctrl: true, description: 'Play highest club', action: () => playHighestCard('clubs') },
    
    // Direct suit keys - dual purpose in bidding and play
    { key: 's', description: 'Bidding: Spades | Play: Focus lowest spade', action: null }, // Handled separately
    { key: 'h', description: 'Bidding: Hearts | Play: Focus lowest heart', action: null }, // Handled separately
    { key: 'd', description: 'Bidding: Diamonds | Play: Focus lowest diamond', action: null }, // Handled separately
    { key: 'c', description: 'Bidding: Clubs | Play: Focus lowest club', action: null }, // Handled separately
    { key: 'n', description: 'Bidding: No Trump', action: null }, // Handled separately
    
    // General shortcuts
    { key: 'h', alt: true, description: 'Show/hide help', action: () => toggleHelp() },
    { key: 'n', alt: true, description: 'Deal new cards', action: () => dealNewCards() },
    { key: 'i', alt: true, description: 'Repeat last announcement', action: () => repeatLastAnnouncement() },
    { key: 'o', alt: true, description: 'Announce score', action: () => announceScore() },
    { key: 'm', alt: true, description: 'Restart game', action: () => restartGame() }
];

// Simple number keys for bidding levels
const bidLevelKeys = ['1', '2', '3', '4', '5', '6', '7'];
// Simple suit keys for bidding
const bidSuitKeys = {
    's': 'S', // Spades
    'h': 'H', // Hearts
    'd': 'D', // Diamonds
    'c': 'C', // Clubs
    'n': 'N'  // No Trump
};

/**
 * Renders the UI
 */
function renderUI() {
    renderPlayerControls();
    renderHands();
    renderStatusBar();
    renderPlayedCards();
    renderHelpList();
    
    // Render different UI based on game phase
    if (gameState.gamePhase === 'bidding') {
        renderBiddingUI();
        hidePlayUI();
    } else if (gameState.gamePhase === 'play' || gameState.gamePhase === 'end') {
        hideBiddingUI();
        renderPlayUI();
    }
    
    toggleHelp();
}

/**
 * Renders the help list
 */
function renderHelpList() {
    elements.helpList.innerHTML = '';
    
    keyboardShortcuts.forEach(shortcut => {
        // Skip shortcuts with no action (they're handled separately)
        if (!shortcut.action) return;
        
        const modifiers = [];
        if (shortcut.alt) modifiers.push('Alt');
        if (shortcut.shift) modifiers.push('Shift');
        if (shortcut.ctrl) modifiers.push('Ctrl');
        
        const keyCombo = modifiers.length > 0 
            ? `${modifiers.join('+')} + ${shortcut.key.toUpperCase()}`
            : shortcut.key.toUpperCase();
            
        const li = document.createElement('li');
        li.innerHTML = `<strong>${keyCombo}</strong>: ${shortcut.description}`;
        elements.helpList.appendChild(li);
    });
    
    // Add the dual-purpose keys
    const gamePhase = gameState.gamePhase;
    const phaseText = gamePhase === 'bidding' ? 'Select suit for bidding' : 
                     gamePhase === 'play' ? 'Focus on lowest card of suit' : 
                     'Depends on game phase';
    
    const dualPurposeKeys = [
        { key: 'S', desc: 'Spades' },
        { key: 'H', desc: 'Hearts' },
        { key: 'D', desc: 'Diamonds' },
        { key: 'C', desc: 'Clubs' }
    ];
    
    dualPurposeKeys.forEach(key => {
        const li = document.createElement('li');
        li.innerHTML = `<strong>${key.key}</strong>: ${phaseText} (${key.desc})`;
        elements.helpList.appendChild(li);
    });
    
    // Add the No Trump key for bidding
    if (gameState.gamePhase === 'bidding') {
        const li = document.createElement('li');
        li.innerHTML = `<strong>N</strong>: Select No Trump for bidding`;
        elements.helpList.appendChild(li);
    }
}

/**
 * Renders player controls section
 */
function renderPlayerControls() {
    elements.playerControls.innerHTML = '';
    
    Object.entries(gameState.players).forEach(([position, player]) => {
        const isCurrentPlayer = position === gameState.currentPlayer;
        
        const playerDiv = document.createElement('div');
        playerDiv.innerHTML = `
            <h3>${getPositionName(position)}</h3>
            <div class="player-badge ${isCurrentPlayer ? 'current' : ''}">
                <span>${player.name}</span>
            </div>
        `;
        
        elements.playerControls.appendChild(playerDiv);
    });
}

/**
 * Renders hands
 */
function renderHands() {
    // Render north
    renderHand('north', elements.northHand);
    
    // Render south
    renderHand('south', elements.southHand, true);
    
    // Update east and west (only card counts)
    elements.eastHand.innerHTML = `
        <h3>East ${gameState.players.east.type === 'gib' ? '(GIB)' : ''}</h3>
        <p>Cards: ${
            Object.values(gameState.hands.east).reduce((sum, cards) => sum + cards.length, 0) || '?'
        }</p>
    `;
    
    elements.westHand.innerHTML = `
        <h3>West ${gameState.players.west.type === 'gib' ? '(GIB)' : ''}</h3>
        <p>Cards: ${
            Object.values(gameState.hands.west).reduce((sum, cards) => sum + cards.length, 0) || '?'
        }</p>
    `;
}

/**
 * Renders one hand
 */
function renderHand(position, element, isPlayable = false) {
    const hand = gameState.hands[position];
    const isCurrentPlayer = position === gameState.currentPlayer;
    const isNSTeamWon = gameState.declarer === 'south' || gameState.declarer === 'north';
    
    // Check if this is a hand played by a human (south or north when NS won)
    const isPlayableByHuman = position === 'south' || 
                             (position === 'north' && isNSTeamWon && 
                              gameState.players.north.type === 'human');
    
    let html = `<h3>${position === 'south' ? 'Your Hand (South)' : getPositionName(position)} ${gameState.players[position].type === 'gib' ? '(GIB)' : ''}</h3>`;
    
    // Added condition for showing north's cards
    const showCards = position === 'south' || 
                     (position === 'north' && 
                      (gameState.gamePhase === 'play' && isNSTeamWon));
    
    if (!showCards && position === 'north') {
        // Hide north's cards until conditions are met
        html += `<p>Cards will be visible when play begins, if South or North is declarer.</p>`;
        element.innerHTML = html;
        return;
    }
    
    // Add cards by suit
    Object.entries(hand).forEach(([suit, cards]) => {
        const suitClass = `suit-${suit}`;
        
        html += `
            <div class="suit-row">
                <div class="suit-label ${suitClass}">
                    ${getSuitSymbol(suit)} ${getSuitName(suit)}
                </div>
                <div class="cards-buttons">
        `;
        
        if (cards.length > 0) {
            // Add cards
            cards.forEach(card => {
                const cardClass = `card-${suit}`;
                
                // Modified: Cards are playable from both south and north when NS won
                if (gameState.gamePhase === 'play' && isPlayableByHuman) {
                    // Playable cards as buttons
                    html += `
                        <button 
                            class="card-button ${cardClass}"
                            data-suit="${suit}"
                            data-card="${card}"
                            ${!isCurrentPlayer ? 'disabled' : ''}
                            aria-label="Play ${getSuitName(suit)} ${card}"
                        >
                            ${card}
                        </button>
                    `;
                } else {
                    // Other cards as text
                    html += `
                        <span class="card-display ${cardClass}" aria-label="${getSuitName(suit)} ${card}">
                            ${card}
                        </span>
                    `;
                }
            });
        } else {
            html += `<span class="text-gray-400">(empty)</span>`;
        }
        
        html += `
                </div>
            </div>
        `;
    });
    
    element.innerHTML = html;
    
    // Add listeners for playable cards
    if (gameState.gamePhase === 'play' && isPlayableByHuman) {
        element.querySelectorAll('.card-button').forEach(button => {
            button.addEventListener('click', (e) => {
                const suit = e.target.dataset.suit;
                const card = e.target.dataset.card;
                playCard(suit, card);
            });
        });
    }
}

/**
 * Announces cards in a specific suit from a hand and focuses on the lowest card
 */
function announceHandSuit(position, suit) {
    // Check if we can view these cards
    const isNSTeamWon = gameState.declarer === 'south' || gameState.declarer === 'north';
    const canViewCards = position === 'south' || 
                        (position === 'north' && gameState.gamePhase === 'play' && isNSTeamWon);
    
    if (!canViewCards) {
        const message = `Cannot view ${getPositionName(position)}'s cards at this time.`;
        announceToScreenReader(message);
        return;
    }
    
    const hand = gameState.hands[position];
    const cards = hand[suit] || [];
    
    if (cards.length === 0) {
        const message = `${getPositionName(position)} has no ${getSuitName(suit)}s.`;
        announceToScreenReader(message);
        return;
    }
    
    const message = `${getPositionName(position)}'s ${getSuitName(suit)}s: ${cards.join(', ')}`;
    announceToScreenReader(message);
    
    // Add a delay before focusing to allow screen reader to finish
    // Only focus if it's the current player's turn and game is in play phase
    const isCurrentPlayer = position === gameState.currentPlayer;
    const isPlayable = gameState.gamePhase === 'play' && isCurrentPlayer;
    
    if (isPlayable) {
        // Estimate a delay based on message length - approximately 100ms per character
        // with a minimum of 2 seconds
        const estimatedReadTime = Math.max(2000, message.length * 100);
        
        setTimeout(() => {
            focusLowestCardOfSuit(position, suit);
        }, estimatedReadTime);
    }
}

/**
 * Focuses on the lowest card of a specific suit
 */
function focusLowestCardOfSuit(position, suit) {
    // Check if the current player can play cards
    const isNSTeamWon = gameState.declarer === 'south' || gameState.declarer === 'north';
    const isPlayersTurn = (gameState.currentPlayer === position) && 
                         (position === 'south' || 
                          (position === 'north' && isNSTeamWon && 
                           gameState.players.north.type === 'human'));
    
    if (!isPlayersTurn || gameState.gamePhase !== 'play') {
        return; // Don't focus if not player's turn or not in play phase
    }
    
    // Get the cards of the suit
    const hand = gameState.hands[position];
    const cards = hand[suit] || [];
    
    if (cards.length === 0) {
        return; // No cards of this suit
    }
    
    // Check if the player must follow suit
    let canPlayThisSuit = true;
    if (gameState.currentTrick.length > 0) {
        const leadSuit = gameState.currentTrick[0].suit;
        if (suit !== leadSuit && hand[leadSuit].length > 0) {
            canPlayThisSuit = false; // Must follow lead suit
        }
    }
    
    if (!canPlayThisSuit) {
        // Announce that player must follow lead suit
        const leadSuit = gameState.currentTrick[0].suit;
        announceToScreenReader(`You must follow the lead suit (${getSuitName(leadSuit)}).`);
        return;
    }
    
    // Find the lowest card button for this suit
    const values = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
    const sortedCards = [...cards].sort((a, b) => values.indexOf(a) - values.indexOf(b));
    const lowestCard = sortedCards[0];
    
    // Get the hand element
    const handElement = position === 'south' ? elements.southHand : elements.northHand;
    
    // Find the button for this card
    const cardButton = handElement.querySelector(`button[data-suit="${suit}"][data-card="${lowestCard}"]`);
    
    if (cardButton) {
        // Focus the button
        cardButton.focus();
        
        // Announce that focus has moved
        announceToScreenReader(`Focused on ${getSuitName(suit)} ${lowestCard}.`);
    }
}

/**
 * Announces all cards in a hand
 */
function announceEntireHand(position) {
    // Check if we can view these cards
    const isNSTeamWon = gameState.declarer === 'south' || gameState.declarer === 'north';
    const canViewCards = position === 'south' || 
                        (position === 'north' && gameState.gamePhase === 'play' && isNSTeamWon);
    
    if (!canViewCards) {
        const message = `Cannot view ${getPositionName(position)}'s cards at this time.`;
        announceToScreenReader(message);
        return;
    }
    
    const hand = gameState.hands[position];
    let message = `${getPositionName(position)}'s hand: `;
    
    for (const suit of ['spades', 'hearts', 'diamonds', 'clubs']) {
        const cards = hand[suit] || [];
        if (cards.length > 0) {
            message += `${getSuitName(suit)}s: ${cards.join(', ')}. `;
        } else {
            message += `No ${getSuitName(suit)}s. `;
        }
    }
    
    // For "read all cards" commands, we don't focus on any specific card
    announceToScreenReader(message);
}

/**
 * Announces the current trick
 */
function announceCurrentTrick() {
    if (gameState.gamePhase !== 'play') {
        announceToScreenReader('The game is not in play phase yet.');
        return;
    }
    
    if (gameState.currentTrick.length === 0) {
        announceToScreenReader('No cards played in the current trick yet.');
        return;
    }
    
    let message = 'Current trick: ';
    
    for (const card of gameState.currentTrick) {
        message += `${getPositionName(card.player)} played ${getSuitName(card.suit)} ${card.card}. `;
    }
    
    announceToScreenReader(message);
}

/**
 * Announces the game state
 */
function announceGameState() {
    let message = `Game phase: ${gameState.gamePhase}. `;
    
    if (gameState.gamePhase === 'play' || gameState.gamePhase === 'end') {
        message += `Contract: ${formatContract(gameState.contract)} by ${getPositionName(gameState.declarer)}. `;
        message += `North-South tricks: ${gameState.tricks.ns}. East-West tricks: ${gameState.tricks.ew}. `;
        message += `Current player: ${getPositionName(gameState.currentPlayer)}.`;
    } else if (gameState.gamePhase === 'bidding') {
        message += `Current bidder: ${getPositionName(biddingState.currentBidder)}.`;
    }
    
    announceToScreenReader(message);
}

/**
 * Announces the current player
 */
function announceCurrentPlayer() {
    if (gameState.gamePhase === 'play') {
        announceToScreenReader(`Current player: ${getPositionName(gameState.currentPlayer)}.`);
    } else if (gameState.gamePhase === 'bidding') {
        announceToScreenReader(`Current bidder: ${getPositionName(biddingState.currentBidder)}.`);
    } else {
        announceToScreenReader(`Game phase: ${gameState.gamePhase}. No current player.`);
    }
}

/**
 * Announces the last completed trick
 */
function announceLastTrick() {
    if (gameState.playedCards.length === 0) {
        announceToScreenReader('No tricks have been played yet.');
        return;
    }
    
    // Find the last 4 cards that don't belong to the current trick
    const currentTrickIds = gameState.currentTrick.map(card => `${card.player}:${card.suit}:${card.card}`);
    const pastCards = gameState.playedCards.filter(card => 
        !currentTrickIds.includes(`${card.player}:${card.suit}:${card.card}`)
    );
    
    if (pastCards.length === 0) {
        announceToScreenReader('No previous tricks to announce.');
        return;
    }
    
    // Get the last complete trick (4 cards)
    const startIndex = Math.max(0, pastCards.length - (pastCards.length % 4 === 0 ? 4 : pastCards.length % 4));
    const lastTrick = pastCards.slice(startIndex);
    
    let message = 'Last played trick: ';
    
    for (const card of lastTrick) {
        message += `${getPositionName(card.player)} played ${getSuitName(card.suit)} ${card.card}. `;
    }
    
    announceToScreenReader(message);
}

/**
 * Makes a bid using keyboard shortcut
 */
function makeBidShortcut(bid) {
    if (gameState.gamePhase !== 'bidding' || biddingState.currentBidder !== 'south') {
        announceToScreenReader("It's not your turn to bid.");
        return;
    }
    
    // For regular bids, we need both level and suit
    if (!['P', 'X', 'XX'].includes(bid)) {
        announceToScreenReader('Invalid bid format.');
        return;
    }
    
    makeBid('south', bid);
}

/**
 * Handles bid level selection for two-step bidding
 */
function handleBidLevelKey(level) {
    if (gameState.gamePhase !== 'bidding' || biddingState.currentBidder !== 'south') {
        announceToScreenReader("It's not your turn to bid.");
        return;
    }
    
    uiState.bidLevel = level;
    announceToScreenReader(`Bid level ${level} selected. Press S, H, D, C, or N to select suit.`);
}

/**
 * Handles bid suit selection to complete a bid
 */
function handleBidSuitKey(suit) {
    if (gameState.gamePhase !== 'bidding' || biddingState.currentBidder !== 'south' || !uiState.bidLevel) {
        if (!uiState.bidLevel) {
            announceToScreenReader("Please select a bid level (1-7) first.");
        } else {
            announceToScreenReader("It's not your turn to bid.");
        }
        return;
    }
    
    const bid = `${uiState.bidLevel}${suit}`;
    
    // Check if bid is valid
    if (!isValidBid(bid, biddingState.highestBid)) {
        announceToScreenReader(`Invalid bid: ${uiState.bidLevel}${getSuitNameForBid(suit)}.`);
        uiState.bidLevel = null; // Reset bid level
        return;
    }
    
    makeBid('south', bid);
    uiState.bidLevel = null; // Reset bid level
}

/**
 * Gets a suit name for bid announcement
 */
function getSuitNameForBid(suit) {
    switch(suit) {
        case 'C': return 'Clubs';
        case 'D': return 'Diamonds';
        case 'H': return 'Hearts';
        case 'S': return 'Spades';
        case 'N': return 'No Trump';
        default: return suit;
    }
}

/**
 * Handles suit key press during play phase
 */
function handleSuitKeyInPlayPhase(suitKey) {
    // Map key to suit
    const suitMap = {
        's': 'spades',
        'h': 'hearts',
        'd': 'diamonds',
        'c': 'clubs'
    };
    
    const suit = suitMap[suitKey];
    if (!suit) return;
    
    // Determine current player
    const isNSTeamWon = gameState.declarer === 'south' || gameState.declarer === 'north';
    const isCurrentPlayerHuman = (gameState.currentPlayer === 'south') || 
                               (isNSTeamWon && gameState.currentPlayer === 'north' && 
                                gameState.players.north.type === 'human');
    
    if (!isCurrentPlayerHuman) {
        announceToScreenReader("It's not your turn to play.");
        return;
    }
    
    // Get current player's hand
    const hand = gameState.hands[gameState.currentPlayer];
    const cards = hand[suit] || [];
    
    if (cards.length === 0) {
        announceToScreenReader(`You have no ${getSuitName(suit)}s.`);
        return;
    }
    
    // Check if player must follow suit
    let canPlayThisSuit = true;
    if (gameState.currentTrick.length > 0) {
        const leadSuit = gameState.currentTrick[0].suit;
        if (suit !== leadSuit && hand[leadSuit].length > 0) {
            // Notify player but still focus on the card
            announceToScreenReader(`Reminder: You must follow the lead suit (${getSuitName(leadSuit)}). Focusing on ${getSuitName(suit)}.`);
            canPlayThisSuit = false;
        }
    }
    
    // Focus on the lowest card
    const values = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
    const sortedCards = [...cards].sort((a, b) => values.indexOf(a) - values.indexOf(b));
    const lowestCard = sortedCards[0];
    
    // Get the hand element for the current player
    const handElement = gameState.currentPlayer === 'south' ? elements.southHand : elements.northHand;
    
    // Find the button for this card
    const cardButton = handElement.querySelector(`button[data-suit="${suit}"][data-card="${lowestCard}"]`);
    
    if (cardButton) {
        // Focus the button
        cardButton.focus();
        
        // Announce that focus has moved (with suit playability warning if needed)
        if (canPlayThisSuit) {
            announceToScreenReader(`Focused on ${getSuitName(suit)} ${lowestCard}.`);
        }
    } else {
        announceToScreenReader(`Could not find playable ${getSuitName(suit)} card.`);
    }
}

/**
 * Plays the highest card of a suit
 */
function playHighestCard(suit) {
    // Determine which player is active
    const isNSTeamWon = gameState.declarer === 'south' || gameState.declarer === 'north';
    const isCurrentPlayerHuman = (gameState.currentPlayer === 'south') || 
                               (isNSTeamWon && gameState.currentPlayer === 'north' && 
                                gameState.players.north.type === 'human');
    
    if (gameState.gamePhase !== 'play' || !isCurrentPlayerHuman) {
        announceToScreenReader("It's not your turn to play.");
        return;
    }
    
    const hand = gameState.hands[gameState.currentPlayer];
    const cards = hand[suit] || [];
    
    if (cards.length === 0) {
        announceToScreenReader(`You have no ${getSuitName(suit)}s to play.`);
        return;
    }
    
    // Check if player must follow suit
    if (gameState.currentTrick.length > 0) {
        const leadSuit = gameState.currentTrick[0].suit;
        if (suit !== leadSuit && hand[leadSuit].length > 0) {
            announceToScreenReader(`You must follow the lead suit (${getSuitName(leadSuit)}).`);
            return;
        }
    }
    
    // Get the highest card (we need to convert card ranks for comparison)
    const values = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
    const sortedCards = [...cards].sort((a, b) => values.indexOf(b) - values.indexOf(a));
    const highestCard = sortedCards[0];
    
    // Play the card
    playCard(suit, highestCard);
}

/**
 * Repeats the last announcement
 */
function repeatLastAnnouncement() {
    if (uiState.lastAnnouncement) {
        announceToScreenReader(uiState.lastAnnouncement);
    } else {
        announceToScreenReader("No announcement to repeat.");
    }
}

/**
 * Announces the current score
 */
function announceScore() {
    if (gameState.gamePhase === 'play' || gameState.gamePhase === 'end') {
        announceToScreenReader(`North-South tricks: ${gameState.tricks.ns}. East-West tricks: ${gameState.tricks.ew}.`);
    } else {
        announceToScreenReader("No score available yet.");
    }
}

/**
 * Restarts the game
 */
function restartGame() {
    if (confirm("Are you sure you want to restart the game?")) {
        // Reset game state
        gameState.gamePhase = 'setup';
        gameState.playedCards = [];
        gameState.currentTrick = [];
        gameState.tricks = { ns: 0, ew: 0 };
        gameState.totalTricks = 0;
        gameState.contract = null;
        gameState.trumpSuit = null;
        gameState.declarer = null;
        gameState.dummy = null;
        
        // Reset players to default
        gameState.players.north = { type: 'gib', name: 'GIB-North' };
        gameState.players.east = { type: 'gib', name: 'GIB-East' };
        gameState.players.west = { type: 'gib', name: 'GIB-West' };
        
        // Update UI
        renderUI();
        updateStatus('Game restarted. Deal new cards to begin.');
        announceToScreenReader('Game restarted. Deal new cards to begin.');
    }
}

/**
 * Renders the bidding UI
 */
function renderBiddingUI() {
    // Show bidding area
    if (elements.biddingArea) {
        elements.biddingArea.style.display = 'block';
    }
    
    // Render bidding history
    renderBiddingHistory();
    
    // Render bidding controls if it's the user's turn
    if (biddingState.currentBidder === 'south') {
        renderBiddingControls();
    } else {
        // Hide controls if it's not the user's turn
        if (elements.biddingControls) {
            elements.biddingControls.innerHTML = `
                <h3>Your Bid</h3>
                <p>Waiting for ${getPositionName(biddingState.currentBidder)} to bid...</p>
            `;
        }
    }
}

/**
 * Render bidding history
 */
function renderBiddingHistory() {
    if (!elements.biddingHistory) return;
    
    let html = '<h3>Bidding History</h3>';
    
    if (biddingState.bidHistory.length === 0) {
        html += '<p>No bids yet.</p>';
    } else {
        // Create a table to display bidding history
        html += `
            <table class="bidding-table">
                <thead>
                    <tr>
                        <th>West</th>
                        <th>North</th>
                        <th>East</th>
                        <th>South</th>
                    </tr>
                </thead>
                <tbody>
        `;
        
        // Group bids by rounds
        const rounds = [];
        let currentRound = [];
        let dealer = biddingState.dealer;
        
        // Add empty cells for positions before the dealer
        const positions = ['west', 'north', 'east', 'south'];
        const dealerIndex = positions.indexOf(dealer);
        
        for (let i = 0; i < dealerIndex; i++) {
            currentRound.push(null);
        }
        
        // Add all bids to rounds
        for (const bid of biddingState.bidHistory) {
            currentRound.push(bid);
            
            // New round after every 4 bids
            if (currentRound.length === 4) {
                rounds.push([...currentRound]);
                currentRound = [];
            }
        }
        
        // Add the current partial round
        if (currentRound.length > 0) {
            rounds.push([...currentRound]);
        }
        
        // Render each round
        for (const round of rounds) {
            html += '<tr>';
            
            for (let i = 0; i < 4; i++) {
                const bid = round[i];
                
                if (!bid) {
                    html += '<td></td>';
                } else {
                    const bidText = formatBidForDisplay(bid.bid);
                    html += `<td>${bidText}</td>`;
                }
            }
            
            html += '</tr>';
        }
        
        html += '</tbody></table>';
    }
    
    elements.biddingHistory.innerHTML = html;
}

/**
 * Format a bid for display
 */
function formatBidForDisplay(bid) {
    if (bid === 'P') return 'Pass';
    if (bid === 'X') return 'X (Double)';
    if (bid === 'XX') return 'XX (Redouble)';
    
    const level = bid.charAt(0);
    const suit = bid.charAt(1);
    let suitSymbol;
    
    switch(suit) {
        case 'C': suitSymbol = '♣'; break;
        case 'D': suitSymbol = '♦'; break;
        case 'H': suitSymbol = '♥'; break;
        case 'S': suitSymbol = '♠'; break;
        case 'N': suitSymbol = 'NT'; break;
        default: suitSymbol = suit;
    }
    
    return `${level}${suitSymbol}`;
}

/**
 * Render bidding controls for the user
 */
function renderBiddingControls() {
    if (!elements.biddingControls) return;
    
    // Get possible bids
    const possibleBids = getPossibleBids(biddingState.highestBid);
    
    let html = '<h3>Your Bid</h3>';
    
    // Create buttons for each possible bid
    html += '<div class="bidding-buttons">';
    
    // Special bids first (Pass, Double, Redouble)
    for (const specialBid of ['P', 'X', 'XX']) {
        if (possibleBids.includes(specialBid)) {
            const bidText = specialBid === 'P' ? 'Pass' : 
                          specialBid === 'X' ? 'Double (X)' : 'Redouble (XX)';
            
            html += `
                <button class="bid-button" data-bid="${specialBid}">
                    ${bidText}
                </button>
            `;
        }
    }
    
    // Contract bids grouped by level
    const contractBids = possibleBids.filter(bid => !['P', 'X', 'XX'].includes(bid));
    const bidsByLevel = {};
    
    for (const bid of contractBids) {
        const level = bid.charAt(0);
        if (!bidsByLevel[level]) bidsByLevel[level] = [];
        bidsByLevel[level].push(bid);
    }
    
    // Create bid buttons by level
    for (const level in bidsByLevel) {
        html += `<div class="bid-level-group">`;
        
        for (const bid of bidsByLevel[level]) {
            const suit = bid.charAt(1);
            let suitSymbol, suitClass;
            
            switch(suit) {
                case 'C': 
                    suitSymbol = '♣'; 
                    suitClass = 'bid-clubs';
                    break;
                case 'D': 
                    suitSymbol = '♦'; 
                    suitClass = 'bid-diamonds';
                    break;
                case 'H': 
                    suitSymbol = '♥'; 
                    suitClass = 'bid-hearts';
                    break;
                case 'S': 
                    suitSymbol = '♠'; 
                    suitClass = 'bid-spades';
                    break;
                case 'N': 
                    suitSymbol = 'NT'; 
                    suitClass = 'bid-notrump';
                    break;
                default: 
                    suitSymbol = suit;
                    suitClass = '';
            }
            
            html += `
                <button class="bid-button ${suitClass}" data-bid="${bid}">
                    ${level}${suitSymbol}
                </button>
            `;
        }
        
        html += `</div>`;
    }
    
    html += '</div>';
    
    // Show bid meanings if available
    html += '<div class="bid-meanings">';
    html += `<p><strong>System:</strong> ${biddingSystems[biddingState.selectedSystem].name}</p>`;
    html += '</div>';
    
    elements.biddingControls.innerHTML = html;
    
    // Add event listeners to bid buttons
    document.querySelectorAll('.bid-button').forEach(button => {
        button.addEventListener('click', (e) => {
            const bid = e.target.dataset.bid;
            makeBid('south', bid);
        });
        
        // Show bid meaning on hover
        button.addEventListener('mouseenter', (e) => {
            const bid = e.target.dataset.bid;
            const meaning = getBidMeaning(bid);
            
            const meaningElement = document.querySelector('.bid-meanings');
            if (meaningElement) {
                meaningElement.innerHTML = `
                    <p><strong>System:</strong> ${biddingSystems[biddingState.selectedSystem].name}</p>
                    <p><strong>${formatBidForDisplay(bid)}:</strong> ${meaning || 'No special meaning'}</p>
                `;
            }
        });
        
        // Reset bid meaning on mouse leave
        button.addEventListener('mouseleave', () => {
            const meaningElement = document.querySelector('.bid-meanings');
            if (meaningElement) {
                meaningElement.innerHTML = `
                    <p><strong>System:</strong> ${biddingSystems[biddingState.selectedSystem].name}</p>
                `;
            }
        });
    });
}

/**
 * Hide bidding UI
 */
function hideBiddingUI() {
    if (elements.biddingArea) {
        elements.biddingArea.style.display = 'none';
    }
}

/**
 * Render play phase UI
 */
function renderPlayUI() {
    // Show contract information in center area if it exists
    if (elements.centerArea && gameState.contract) {
        let html = '<h3>Contract</h3>';
        
        html += `
            <div class="contract-info">
                <p><strong>Contract:</strong> ${formatContract(gameState.contract)}</p>
                <p><strong>Declarer:</strong> ${getPositionName(gameState.declarer)}</p>
                <p><strong>Dummy:</strong> ${getPositionName(gameState.dummy)}</p>
                <p><strong>Trump:</strong> ${gameState.trumpSuit ? getSuitName(gameState.trumpSuit) : 'No Trump'}</p>
            </div>
        `;
        
        // Add current trick info
        html += '<h3>Current Trick</h3>';
        
        if (gameState.currentTrick.length === 0) {
            html += '<p>No cards played yet in this trick.</p>';
        } else {
            html += '<ul class="current-trick-list">';
            
            for (const card of gameState.currentTrick) {
                const cardClass = `card-${card.suit}`;
                
                html += `
                    <li>
                        <span class="font-medium">${getPositionName(card.player)}: </span>
                        <span class="${cardClass}">
                            ${getSuitSymbol(card.suit)} ${card.card}
                        </span>
                    </li>
                `;
            }
            
            html += '</ul>';
        }
        
        // Add score
        html += '<h3>Score</h3>';
        html += `
            <div class="score-info">
                <p>N-S: ${gameState.tricks.ns} tricks</p>
                <p>E-W: ${gameState.tricks.ew} tricks</p>
            </div>
        `;
        
        elements.centerArea.innerHTML = html;
    }
}

/**
 * Hide play UI
 */
function hidePlayUI() {
    // Clear center area
    if (elements.centerArea) {
        elements.centerArea.innerHTML = '<h3>Waiting for bidding to complete...</h3>';
    }
}

/**
 * Update status message
 */
function renderStatusBar() {
    elements.statusBar.textContent = gameState.statusMessage;
}

/**
 * Render played cards
 */
function renderPlayedCards() {
    if (gameState.playedCards.length > 0) {
        let html = '<ul class="played-cards-list">';
        
        gameState.playedCards.forEach(play => {
            const cardClass = `card-${play.suit}`;
            
            html += `
                <li>
                    <span class="font-medium">${getPositionName(play.player)}: </span>
                    <span class="${cardClass}">
                        ${getSuitSymbol(play.suit)} ${play.card}
                    </span>
                    <span class="sr-only"> (${getSuitName(play.suit)} ${play.card})</span>
                </li>
            `;
        });
        
        html += '</ul>';
        elements.playedCardsContainer.innerHTML = html;
    } else {
        elements.playedCardsContainer.innerHTML = '<p class="text-gray-500">No cards played yet.</p>';
    }
}

/**
 * Show/hide help section
 */
function toggleHelp() {
    uiState.showHelp = !uiState.showHelp;
    elements.helpSection.style.display = uiState.showHelp ? 'block' : 'none';
    elements.toggleHelpButton.textContent = uiState.showHelp ? 'Hide Help' : 'Show Help';
    elements.toggleHelpButton.setAttribute('aria-expanded', uiState.showHelp);
}

/**
 * Toggle fullscreen mode
 */
function toggleFullscreenMode() {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(err => {
            console.error(`Error attempting to enable fullscreen: ${err.message}`);
        });
        elements.fullscreenButton.textContent = 'Exit Full Screen';
        announceToScreenReader('Full screen mode activated');
    } else {
        document.exitFullscreen();
        elements.fullscreenButton.textContent = 'Full Screen';
        announceToScreenReader('Full screen mode deactivated');
    }
}

/**
 * Announce message to screen reader
 * @param {string} message - The message to announce
 * @param {boolean} isCardPlay - Whether this is a card play announcement
 */
function announceToScreenReader(message, isCardPlay = false) {
    uiState.lastAnnouncement = message; // Store for repetition
    
    if (isCardPlay) {
        // Käytä korttien ilmoittajaa korttien pelaamiselle
        elements.cardAnnouncer.textContent = '';
        setTimeout(() => {
            elements.cardAnnouncer.textContent = message;
        }, 50);
    } else {
        // Käytä tavallista ilmoittajaa muille ilmoituksille
        elements.statusAnnouncer.textContent = '';
        setTimeout(() => {
            elements.statusAnnouncer.textContent = message;
        }, 50);
    }
}

/**
 * Set event listeners for UI elements
 */
function setupEventListeners() {
    // Help buttons
    elements.toggleHelpButton.addEventListener('click', () => {
        toggleHelp();
    });
    
    elements.closeHelpButton.addEventListener('click', () => {
        uiState.showHelp = false;
        toggleHelp();
    });
    
    // Game functions
    elements.dealButton.addEventListener('click', dealNewCards);
    
    // Kokoruututila-nappi
    elements.fullscreenButton.addEventListener('click', () => {
        toggleFullscreenMode();
    });
    
    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        // Process keyboard shortcuts
        for (const shortcut of keyboardShortcuts) {
            if (shortcut.action && // Skip shortcuts with no action (they're handled separately)
                e.key.toLowerCase() === shortcut.key.toLowerCase() && 
                (!shortcut.alt || e.altKey) && 
                (!shortcut.shift || e.shiftKey) && 
                (!shortcut.ctrl || e.ctrlKey)) {
                
                e.preventDefault();
                shortcut.action();
                return;
            }
        }
        
        // Handle s, h, d, c keys with dual purpose:
        // 1. In bidding phase: suit selection for bidding
        // 2. In play phase: focus on lowest card of that suit
        const suitKey = e.key.toLowerCase();
        if (['s', 'h', 'd', 'c'].includes(suitKey) && !e.altKey && !e.ctrlKey && !e.shiftKey) {
            e.preventDefault();
            
            // Check game phase and handle accordingly
            if (gameState.gamePhase === 'bidding') {
                // Bidding phase - use for bid suit selection
                if (suitKey in bidSuitKeys) {
                    handleBidSuitKey(bidSuitKeys[suitKey]);
                }
            } else if (gameState.gamePhase === 'play') {
                // Play phase - focus on lowest card
                handleSuitKeyInPlayPhase(suitKey);
            }
            return;
        }
        
        // Handle bidding level selection (1-7)
        if (bidLevelKeys.includes(e.key) && !e.altKey && !e.ctrlKey && !e.shiftKey) {
            e.preventDefault();
            handleBidLevelKey(e.key);
            return;
        }
        
        // Handle 'n' key for No Trump in bidding
        if (e.key.toLowerCase() === 'n' && !e.altKey && !e.ctrlKey && !e.shiftKey) {
            e.preventDefault();
            if (gameState.gamePhase === 'bidding') {
                handleBidSuitKey('N');
            }
            return;
        }
    });
}