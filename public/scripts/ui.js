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
    biddingArea: document.getElementById('bidding-area'), // New element
    biddingHistory: document.getElementById('bidding-history'), // New element
    biddingControls: document.getElementById('bidding-controls') // New element
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
                <!-- Pelaajatyypin vaihtopainikkeet poistettu -->
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
    
    let html = `<h3>${position === 'south' ? 'Your hand (South)' : getPositionName(position)} ${gameState.players[position].type === 'gib' ? '(GIB)' : ''}</h3>`;
    
    // Lisätty ehto pohjoisen korttien näyttämiseen
    const showCards = position === 'south' || 
                     (position === 'north' && 
                      gameState.gamePhase === 'play' && 
                      (gameState.declarer === 'south' || gameState.declarer === 'north'));
    
    if (!showCards && position === 'north') {
        // Pohjoisen kortit piilotetaan, kunnes ehtoja täyttyy
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
                
                if (isPlayable && gameState.gamePhase === 'play') {
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
    if (isPlayable && gameState.gamePhase === 'play') {
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
 * Create bidding UI elements if they don't exist
 * This function is kept for backward compatibility but is not used actively
 * since we've moved the elements to the HTML file
 */
function createBiddingElements() {
    console.log("This function is deprecated. Bidding elements should be in the HTML file.");
}

/**
 * Render bidding history
 */
function renderBiddingHistory() {
    if (!elements.biddingHistory) return;
    
    let html = '<h3>Tarjoushistoria</h3>';
    
    if (biddingState.bidHistory.length === 0) {
        html += '<p>Ei vielä tarjouksia.</p>';
    } else {
        // Create a table to display bidding history
        html += `
            <table class="bidding-table">
                <thead>
                    <tr>
                        <th>Länsi</th>
                        <th>Pohjoinen</th>
                        <th>Itä</th>
                        <th>Etelä</th>
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
    
    let html = '<h3>Sinun tarjouksesi</h3>';
    
    // Create buttons for each possible bid
    html += '<div class="bidding-buttons">';
    
    // Special bids first (Pass, Double, Redouble)
    for (const specialBid of ['P', 'X', 'XX']) {
        if (possibleBids.includes(specialBid)) {
            const bidText = specialBid === 'P' ? 'Pass' : 
                          specialBid === 'X' ? 'Kahdennus (X)' : 'Vastakahdennus (XX)';
            
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
    html += `<p><strong>Järjestelmä:</strong> ${biddingSystems[biddingState.selectedSystem].name}</p>`;
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
                    <p><strong>Järjestelmä:</strong> ${biddingSystems[biddingState.selectedSystem].name}</p>
                    <p><strong>${formatBidForDisplay(bid)}:</strong> ${meaning || 'Ei erityistä merkitystä'}</p>
                `;
            }
        });
        
        // Reset bid meaning on mouse leave
        button.addEventListener('mouseleave', () => {
            const meaningElement = document.querySelector('.bid-meanings');
            if (meaningElement) {
                meaningElement.innerHTML = `
                    <p><strong>Järjestelmä:</strong> ${biddingSystems[biddingState.selectedSystem].name}</p>
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
    
    // Keyboard functions
    document.addEventListener('keydown', (e) => {
        // Alt + H shows help
        if (e.altKey && e.key === 'h') {
            uiState.showHelp = !uiState.showHelp;
            toggleHelp();
            e.preventDefault();
        }
        
        // Alt + 1-4 toggles player type - ei tarvita enää
        // Tämä osa poistettu koska emme halua pelaajatyypin vaihtoa
    });
}