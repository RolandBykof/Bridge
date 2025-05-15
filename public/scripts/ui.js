/**
 * BridgeCircle - UI Module
 * Käsittelee käyttöliittymän renderöinnin ja käyttäjän syötteiden käsittelyn
 */

// DOM-viitteet
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

// UI-tila
const uiState = {
    showHelp: false
};

/**
 * Renderöi käyttöliittymän
 */
function renderUI() {
    renderPlayerControls();
    renderHands();
    renderStatusBar();
    renderPlayedCards();
    toggleHelp();
}

/**
 * Renderöi pelaajien hallintaosa
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
                        aria-label="Vaihda ${getPositionName(position)} ${player.type === 'human' ? 'GIB-tekoälyksi' : 'ihmiseksi'}"
                    >
                        ${player.type === 'human' ? 'Vaihda GIB' : 'Vaihda ihminen'}
                    </button>
                ` : ''}
            </div>
        `;
        
        elements.playerControls.appendChild(playerDiv);
    });
    
    // Lisää kuuntelijat
    document.querySelectorAll('.player-type-toggle').forEach(button => {
        button.addEventListener('click', (e) => {
            const position = e.target.dataset.position;
            togglePlayerType(position);
        });
    });
}

/**
 * Renderöi kädet
 */
function renderHands() {
    // Renderöi pohjoinen
    renderHand('north', elements.northHand);
    
    // Renderöi etelä
    renderHand('south', elements.southHand, true);
    
    // Päivitä itä ja länsi (vain korttien määrät)
    elements.eastHand.innerHTML = `
        <h3>Itä ${gameState.players.east.type === 'gib' ? '(GIB)' : ''}</h3>
        <p>Kortteja: ${
            Object.values(gameState.hands.east).reduce((sum, cards) => sum + cards.length, 0) || '?'
        }</p>
    `;
    
    elements.westHand.innerHTML = `
        <h3>Länsi ${gameState.players.west.type === 'gib' ? '(GIB)' : ''}</h3>
        <p>Kortteja: ${
            Object.values(gameState.hands.west).reduce((sum, cards) => sum + cards.length, 0) || '?'
        }</p>
    `;
}

/**
 * Renderöi yksi käsi
 */
function renderHand(position, element, isPlayable = false) {
    const hand = gameState.hands[position];
    const isCurrentPlayer = position === gameState.currentPlayer;
    
    let html = `<h3>${position === 'south' ? 'Sinun kätesi (Etelä)' : getPositionName(position)} ${gameState.players[position].type === 'gib' ? '(GIB)' : ''}</h3>`;
    
    // Lisää kortit maan mukaan
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
            // Lisää kortit
            cards.forEach(card => {
                const cardClass = `card-${suit}`;
                
                if (isPlayable) {
                    // Pelattavat kortit nappuloina
                    html += `
                        <button 
                            class="card-button ${cardClass}"
                            data-suit="${suit}"
                            data-card="${card}"
                            ${!isCurrentPlayer || gameState.gamePhase !== 'play' ? 'disabled' : ''}
                            aria-label="Pelaa ${getSuitName(suit)} ${card}"
                        >
                            ${card}
                        </button>
                    `;
                } else {
                    // Muut kortit tekstinä
                    html += `
                        <span class="card-display ${cardClass}" aria-label="${getSuitName(suit)} ${card}">
                            ${card}
                        </span>
                    `;
                }
            });
        } else {
            html += `<span class="text-gray-400">(tyhjä)</span>`;
        }
        
        html += `
                </div>
            </div>
        `;
    });
    
    element.innerHTML = html;
    
    // Lisää kuuntelijat pelattaville korteille
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
 * Päivitä tilaviesti
 */
function renderStatusBar() {
    elements.statusBar.textContent = gameState.statusMessage;
}

/**
 * Renderöi pelatut kortit
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
        elements.playedCardsContainer.innerHTML = '<p class="text-gray-500">Ei vielä pelattuja kortteja.</p>';
    }
}

/**
 * Näytä/piilota ohjeosio
 */
function toggleHelp() {
    elements.helpSection.style.display = uiState.showHelp ? 'block' : 'none';
    elements.toggleHelpButton.textContent = uiState.showHelp ? 'Piilota ohje' : 'Näytä ohje';
    elements.toggleHelpButton.setAttribute('aria-expanded', uiState.showHelp);
}

/**
 * Ilmoittaa viestin ruudunlukijalle
 */
function announceToScreenReader(message) {
    elements.statusAnnouncer.textContent = '';
    setTimeout(() => {
        elements.statusAnnouncer.textContent = message;
    }, 50);
}

/**
 * Aseta kuuntelijat käyttöliittymän elementeille
 */
function setupEventListeners() {
    // Ohjepainikkeet
    elements.toggleHelpButton.addEventListener('click', () => {
        uiState.showHelp = !uiState.showHelp;
        toggleHelp();
    });
    
    elements.closeHelpButton.addEventListener('click', () => {
        uiState.showHelp = false;
        toggleHelp();
    });
    
    // Pelitoiminnot
    elements.dealButton.addEventListener('click', dealNewCards);
    elements.startGameButton.addEventListener('click', startGame);
    
    // Näppäimistötoiminnot
    document.addEventListener('keydown', (e) => {
        // Alt + H näyttää ohjeet
        if (e.altKey && e.key === 'h') {
            uiState.showHelp = !uiState.showHelp;
            toggleHelp();
            e.preventDefault();
        }
        
        // Alt + 1-4 vaihtaa pelaajatyypin
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
