/**
 * BridgeCircle - UI Module
 * Handles UI rendering and user input processing
 */

// DOM references
const elements = {
    statusBar: document.getElementById('status-bar'),
    statusAnnouncer: document.getElementById('status-announcer'),
    playerControls: document.getElementById('player-controls'),
    northHand: document.getElementById('north-hand'),
    eastHand: document.getElementById('east-hand'),
    westHand: document.getElementById('west-hand'),
    southHand: document.getElementById('south-hand'),
    centerArea: document.getElementById('center-area'),
    playedCardsContainer: document.getElementById('played-cards-container'),
    helpSection: document.getElementById('help-section'),
    toggleHelpButton: document.getElementById('toggle-help-button'),
    closeHelpButton: document.getElementById('close-help-button'),
    dealButton: document.getElementById('deal-button'),
    startGameButton: document.getElementById('start-game-button')
};

// UI state
const uiState = {
    showHelp: false
};

/**
 * Renders the UI
 */
function renderUI() {
    renderPlayerControls();
    renderHands();
    renderStatusBar();
    renderPlayedCards();
    toggleHelp();
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
                ${position !== 'south' ? `
                    <button 
                        class="player-type-toggle"
                        data-position="${position}"
                        aria-label="Change ${getPositionName(position)} to ${player.type === 'human' ? 'GIB AI' : 'human'}"
                    >
                        ${player.type === 'human' ? 'Switch to GIB' : 'Switch to human'}
                    </button>
                ` : ''}
            </div>
        `;
        
        elements.playerControls.appendChild(playerDiv);
    });
    
    // Add listeners
    document.querySelectorAll('.player-type-toggle').forEach(button => {
        button.addEventListener('click', (e) => {
            const position = e.target.dataset.position;
            togglePlayerType(position);
        });
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
    
    let html = `<h3>${position === 'south' ? 'Your hand (South)' : getPositionName(position)} ${gameState.players[position].type === 'gib' ? '(GIB)' : ''}</h3>`;
    
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
                
                if (isPlayable) {
                    // Playable cards as buttons
                    html += `
                        <button 
                            class="card-button ${cardClass}"
                            data-suit="${suit}"
                            data-card="${card}"
                            ${!isCurrentPlayer || gameState.gamePhase !== 'play' ? 'disabled' : ''}
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
    if (isPlayable) {
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
    elements.helpSection.style.display = uiState.showHelp ? 'block' : 'none';
    elements.toggleHelpButton.textContent = uiState.showHelp ? 'Hide Help' : 'Show Help';
    elements.toggleHelpButton.setAttribute('aria-expanded', uiState.showHelp);
}

/**
 * Announce message to screen reader
 */
function announceToScreenReader(message) {
    elements.statusAnnouncer.textContent = '';
    setTimeout(() => {
        elements.statusAnnouncer.textContent = message;
    }, 50);
}

/**
 * Set event listeners for UI elements
 */
function setupEventListeners() {
    // Help buttons
    elements.toggleHelpButton.addEventListener('click', () => {
        uiState.showHelp = !uiState.showHelp;
        toggleHelp();
    });
    
    elements.closeHelpButton.addEventListener('click', () => {
        uiState.showHelp = false;
        toggleHelp();
    });
    
    // Game functions
    elements.dealButton.addEventListener('click', dealNewCards);
    elements.startGameButton.addEventListener('click', startGame);
    
    // Keyboard functions
    document.addEventListener('keydown', (e) => {
        // Alt + H shows help
        if (e.altKey && e.key === 'h') {
            uiState.showHelp = !uiState.showHelp;
            toggleHelp();
            e.preventDefault();
        }
        
        // Alt + 1-4 toggles player type
        if (e.altKey && ['1', '2', '4'].includes(e.key)) {
            const positions = ['north', 'east', 'west'];
            const positionMap = { '1': 0, '2': 1, '4': 2 };
            const index = positionMap[e.key];
            
            if (index !== undefined) {
                togglePlayerType(positions[index]);
                e.preventDefault();
            }
        }
    });
}
