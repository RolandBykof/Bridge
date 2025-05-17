/**
 * BridgeCircle - Lobby Module
 * Handles the multiplayer lobby and table management
 */

// Initialize socket.io connection
const socket = io();

// Lobby state
const lobbyState = {
    currentView: 'lobby', // 'lobby', 'create', 'join', 'waiting', 'game'
    playerName: '',
    tableCode: '',
    selectedPosition: null,
    joinTableCode: '',
    tableData: null,
    playersOnline: 0,
    activeTables: 0,
    currentTable: null
};

// DOM elements
const lobbyElements = {
    // Views
    lobbyView: document.getElementById('lobby-view'),
    waitingRoomView: document.getElementById('waiting-room-view'),
    gameView: document.getElementById('game-view'),
    
    // Lobby elements
    createTableForm: document.getElementById('create-table-form'),
    joinTableForm: document.getElementById('join-table-form'),
    positionSelectionForm: document.getElementById('position-selection-form'),
    
    // Buttons
    createTableButton: document.getElementById('create-table-button'),
    joinTableButton: document.getElementById('join-table-button'),
    playSoloButton: document.getElementById('play-solo-button'),
    createSubmitButton: document.getElementById('create-submit-button'),
    createCancelButton: document.getElementById('create-cancel-button'),
    joinSubmitButton: document.getElementById('join-submit-button'),
    joinCancelButton: document.getElementById('join-cancel-button'),
    positionCancelButton: document.getElementById('position-cancel-button'),
    startGameButton: document.getElementById('start-game-button'),
    leaveTableButton: document.getElementById('leave-table-button'),
    leaveGameButton: document.getElementById('leave-game-button'),
    
    // Form inputs
    createNameInput: document.getElementById('create-name-input'),
    joinNameInput: document.getElementById('join-name-input'),
    tableCodeInput: document.getElementById('table-code-input'),
    
    // Position buttons (will be populated)
    positionButtons: document.querySelectorAll('.position-button'),
    selectPositionButtons: document.querySelectorAll('.select-position-button'),
    
    // Stats
    playersCount: document.getElementById('players-count'),
    tablesCount: document.getElementById('tables-count'),
    
    // Waiting room elements
    waitingTableCode: document.getElementById('waiting-table-code'),
    shareTableCode: document.getElementById('share-table-code'),
    waitingNorth: document.getElementById('waiting-north'),
    waitingEast: document.getElementById('waiting-east'),
    waitingSouth: document.getElementById('waiting-south'),
    waitingWest: document.getElementById('waiting-west'),
    
    // Chat elements
    chatMessages: document.getElementById('chat-messages'),
    chatInput: document.getElementById('chat-input'),
    sendChatButton: document.getElementById('send-chat-button'),
    
    // Game view elements
    gameTableCode: document.getElementById('game-table-code'),
    gameChatMessages: document.getElementById('game-chat-messages'),
    gameChatInput: document.getElementById('game-chat-input'),
    gameSendChatButton: document.getElementById('game-send-chat-button'),
    
    // ARIA live regions
    lobbyAnnouncer: document.getElementById('lobby-announcer'),
    waitingAnnouncer: document.getElementById('waiting-announcer')
};

// Initialize lobby when DOM is loaded
document.addEventListener('DOMContentLoaded', initializeLobby);

/**
 * Initialize the lobby
 */
function initializeLobby() {
    setupSocketListeners();
    setupEventListeners();
    
    // Check local storage for saved name
    const savedName = localStorage.getItem('bridgePlayerName');
    if (savedName) {
        lobbyState.playerName = savedName;
        lobbyElements.createNameInput.value = savedName;
        lobbyElements.joinNameInput.value = savedName;
    }
    
    // Get active tables info
    socket.emit('getActiveTables');
    
    console.log('Lobby initialized');
}

/**
 * Setup socket event listeners
 */
function setupSocketListeners() {
    // Table created successfully
    socket.on('tableCreated', ({ tableCode, table }) => {
        lobbyState.tableCode = tableCode;
        lobbyState.currentTable = table;
        
        // Save player name for future use
        localStorage.setItem('bridgePlayerName', lobbyState.playerName);
        
        // Switch to waiting room view
        switchToWaitingRoom();
        
        // Announce to screen reader
        announceToLobby(`Table ${tableCode} created. You are playing as ${lobbyState.selectedPosition}.`);
    });
    
    // Available positions for joining
    socket.on('selectPosition', ({ tableCode, positions, currentPlayers }) => {
        lobbyState.joinTableCode = tableCode;
        
        // Update position selection UI
        updatePositionSelection(positions, currentPlayers);
        
        // Switch to position selection view
        switchView('position');
        
        // Announce to screen reader
        announceToLobby(`Select your position at table ${tableCode}. Available positions: ${positions.join(', ')}.`);
    });
    
    // Player joined the table
    socket.on('playerJoined', ({ position, playerName, table }) => {
        lobbyState.currentTable = table;
        
        // If we're in waiting room, update it
        if (lobbyState.currentView === 'waiting') {
            updateWaitingRoom();
            
            // Announce to waiting room
            announceToWaiting(`${playerName} joined as ${position}.`);
        }
    });
    
    // Player left the table
    socket.on('playerLeft', ({ position, table }) => {
        lobbyState.currentTable = table;
        
        // If we're in waiting room, update it
        if (lobbyState.currentView === 'waiting') {
            updateWaitingRoom();
            
            // Announce to waiting room
            announceToWaiting(`Player at ${position} left the table.`);
        }
    });
    
    // Player replaced by GIB
    socket.on('playerReplaced', ({ position, table }) => {
        lobbyState.currentTable = table;
        
        // If we're in game, update player info
        if (lobbyState.currentView === 'game') {
            // Update will be handled by game.js
            
            // Announce to screen reader
            announceToScreenReader(`Player at ${position} was replaced by GIB.`);
        }
    });
    
    // Game started
    socket.on('gameStarted', ({ gameState, biddingState, players }) => {
        // Switch to game view
        switchToGameView();
        
        // Initialize game with the received data
        initializeMultiplayerGame(gameState, biddingState, players);
        
        // Announce to screen reader
        announceToScreenReader('Game started. Bidding phase begins.');
    });
    
    // Your cards
    socket.on('yourCards', ({ position, cards }) => {
        // Will be handled by game.js
        receiveYourCards(position, cards);
    });
    
    // Error from server
    socket.on('error', ({ message }) => {
        showError(message);
    });
    
    // Chat message
    socket.on('chatMessage', ({ sender, position, message, timestamp }) => {
        // Add message to appropriate chat area
        if (lobbyState.currentView === 'waiting') {
            addChatMessage(lobbyElements.chatMessages, sender, position, message);
        } else if (lobbyState.currentView === 'game') {
            addChatMessage(lobbyElements.gameChatMessages, sender, position, message);
        }
    });
    
    // Active tables list
    socket.on('activeTablesList', ({ tables }) => {
        lobbyState.activeTables = tables.length;
        lobbyElements.tablesCount.textContent = tables.length;
    });
    
    // Bidding specific events
    socket.on('bidMade', ({ position, bid, nextBidder, biddingState }) => {
        // Will be handled by game.js
        handleMultiplayerBid(position, bid, nextBidder, biddingState);
    });
    
    // Card played
    socket.on('cardPlayed', ({ position, suit, card, currentTrick }) => {
        // Will be handled by game.js
        handleMultiplayerCardPlayed(position, suit, card, currentTrick);
    });
    
    // Bidding complete, switching to play phase
    socket.on('biddingComplete', ({ contract, declarer, dummy, trumpSuit, currentPlayer, gameState }) => {
        // Will be handled by game.js
        handleBiddingComplete(contract, declarer, dummy, trumpSuit, currentPlayer, gameState);
    });
    
    // Play phase cards (including dummy)
    socket.on('playPhaseCards', ({ position, cards, dummyCards }) => {
        // Will be handled by game.js
        updatePlayPhaseCards(position, cards, dummyCards);
    });
    
    // Trick complete
    socket.on('trickComplete', ({ winner, trick, tricks, nextPlayer }) => {
        // Will be handled by game.js
        handleTrickComplete(winner, trick, tricks, nextPlayer);
    });
    
    // Game over
    socket.on('gameOver', ({ message, tricks, contract }) => {
        // Will be handled by game.js
        handleGameOver(message, tricks, contract);
    });
    
    // Table removed (due to inactivity)
    socket.on('tableRemoved', ({ message }) => {
        // If we're in waiting room or game, return to lobby
        if (lobbyState.currentView === 'waiting' || lobbyState.currentView === 'game') {
            switchToLobby();
            showError(message);
        }
    });
}

/**
 * Setup UI event listeners
 */
function setupEventListeners() {
    // Main lobby buttons
    lobbyElements.createTableButton.addEventListener('click', () => {
        switchView('create');
    });
    
    lobbyElements.joinTableButton.addEventListener('click', () => {
        switchView('join');
    });
    
    lobbyElements.playSoloButton.addEventListener('click', () => {
        // Redirect to solo game (original game without multiplayer)
        window.location.href = '/solo.html';
    });
    
    // Create table form
    lobbyElements.createCancelButton.addEventListener('click', () => {
        switchView('lobby');
    });
    
    lobbyElements.createSubmitButton.addEventListener('click', createTable);
    
    // Join table form
    lobbyElements.joinCancelButton.addEventListener('click', () => {
        switchView('lobby');
    });
    
    lobbyElements.joinSubmitButton.addEventListener('click', joinTable);
    
    // Position selection form
    lobbyElements.positionCancelButton.addEventListener('click', () => {
        switchView('lobby');
    });
    
    // Position buttons in create form
    lobbyElements.positionButtons.forEach(button => {
        button.addEventListener('click', (e) => {
            // Remove selected class from all buttons
            lobbyElements.positionButtons.forEach(btn => {
                btn.classList.remove('selected');
            });
            
            // Add selected class to clicked button
            e.target.classList.add('selected');
            
            // Update selected position
            lobbyState.selectedPosition = e.target.dataset.position;
        });
    });
    
    // Position selection buttons in join form
    lobbyElements.selectPositionButtons.forEach(button => {
        button.addEventListener('click', (e) => {
            selectPosition(e.target.dataset.position);
        });
    });
    
    // Waiting room buttons
    lobbyElements.startGameButton.addEventListener('click', startGame);
    lobbyElements.leaveTableButton.addEventListener('click', leaveTable);
    
    // Game leave button
    lobbyElements.leaveGameButton.addEventListener('click', leaveGame);
    
    // Chat functions
    lobbyElements.sendChatButton.addEventListener('click', sendChatMessage);
    lobbyElements.chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            sendChatMessage();
        }
    });
    
    // Game chat functions
    lobbyElements.gameSendChatButton.addEventListener('click', sendGameChatMessage);
    lobbyElements.gameChatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            sendGameChatMessage();
        }
    });
    
    // Form inputs - store value in state on change
    lobbyElements.createNameInput.addEventListener('input', (e) => {
        lobbyState.playerName = e.target.value;
    });
    
    lobbyElements.joinNameInput.addEventListener('input', (e) => {
        lobbyState.playerName = e.target.value;
    });
    
    lobbyElements.tableCodeInput.addEventListener('input', (e) => {
        lobbyState.joinTableCode = e.target.value;
    });
}

/**
 * Switch between different views
 * @param {string} view - The view to switch to ('lobby', 'create', 'join', 'position', 'waiting', 'game')
 */
function switchView(view) {
    // Update current view in state
    lobbyState.currentView = view;
    
    // Hide all forms first
    lobbyElements.createTableForm.style.display = 'none';
    lobbyElements.joinTableForm.style.display = 'none';
    lobbyElements.positionSelectionForm.style.display = 'none';
    
    // Show appropriate view
    switch (view) {
        case 'lobby':
            // Just hide all forms, main lobby is already visible
            break;
        case 'create':
            lobbyElements.createTableForm.style.display = 'block';
            lobbyElements.createNameInput.focus();
            break;
        case 'join':
            lobbyElements.joinTableForm.style.display = 'block';
            lobbyElements.joinNameInput.focus();
            break;
        case 'position':
            lobbyElements.positionSelectionForm.style.display = 'block';
            // Focus will be set on an available position button
            break;
        case 'waiting':
            switchToWaitingRoom();
            break;
        case 'game':
            switchToGameView();
            break;
    }
}

/**
 * Create a new table
 */
function createTable() {
    // Validate inputs
    if (!lobbyState.playerName) {
        showError('Please enter your name');
        return;
    }
    
    if (!lobbyState.selectedPosition) {
        showError('Please select a position');
        return;
    }
    
    // Send request to server
    socket.emit('createTable', {
        playerName: lobbyState.playerName,
        position: lobbyState.selectedPosition
    });
}

/**
 * Join an existing table
 */
function joinTable() {
    // Validate inputs
    if (!lobbyState.playerName) {
        showError('Please enter your name');
        return;
    }
    
    if (!lobbyState.joinTableCode) {
        showError('Please enter a table code');
        return;
    }
    
    // Clean up table code (remove spaces, make uppercase)
    const cleanCode = lobbyState.joinTableCode.trim().toUpperCase();
    lobbyState.joinTableCode = cleanCode;
    
    // Send request to server
    socket.emit('joinTable', {
        playerName: lobbyState.playerName,
        tableCode: cleanCode
    });
}

/**
 * Select a position in an existing table
 */
function selectPosition(position) {
    // Validate
    if (!position) {
        showError('Invalid position');
        return;
    }
    
    // Set selected position
    lobbyState.selectedPosition = position;
    
    // Send request to server
    socket.emit('selectPosition', {
        tableCode: lobbyState.joinTableCode,
        position: position,
        playerName: lobbyState.playerName
    });
    
    // Save name for future use
    localStorage.setItem('bridgePlayerName', lobbyState.playerName);
}

/**
 * Start the game with currently present players
 */
function startGame() {
    // Send request to server
    socket.emit('startGame', {
        tableCode: lobbyState.tableCode
    });
}

/**
 * Leave the current table
 */
function leaveTable() {
    // Send request to server
    socket.emit('leaveTable');
    
    // Return to lobby
    switchToLobby();
}

/**
 * Leave the current game
 */
function leaveGame() {
    // Confirm
    if (confirm('Are you sure you want to leave the game? You will be replaced by GIB AI.')) {
        // Send request to server
        socket.emit('leaveTable');
        
        // Return to lobby
        switchToLobby();
    }
}

/**
 * Send a chat message in waiting room
 */
function sendChatMessage() {
    const message = lobbyElements.chatInput.value.trim();
    
    if (message) {
        // Send to server
        socket.emit('sendChatMessage', {
            tableCode: lobbyState.tableCode,
            message: message
        });
        
        // Clear input
        lobbyElements.chatInput.value = '';
        
        // Focus back on input
        lobbyElements.chatInput.focus();
    }
}

/**
 * Send a chat message in game
 */
function sendGameChatMessage() {
    const message = lobbyElements.gameChatInput.value.trim();
    
    if (message) {
        // Send to server
        socket.emit('sendChatMessage', {
            tableCode: lobbyState.tableCode,
            message: message
        });
        
        // Clear input
        lobbyElements.gameChatInput.value = '';
        
        // Focus back on input
        lobbyElements.gameChatInput.focus();
    }
}

/**
 * Add a chat message to the specified container
 */
function addChatMessage(container, sender, position, message) {
    const messageElement = document.createElement('div');
    messageElement.className = 'chat-message';
    
    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    messageElement.innerHTML = `
        <span class="chat-sender">${sender} (${position}):</span>
        <span class="chat-time">[${timestamp}]</span>
        <div class="chat-text">${message}</div>
    `;
    
    container.appendChild(messageElement);
    
    // Scroll to bottom
    container.scrollTop = container.scrollHeight;
    
    // Announce to screen reader if in appropriate view
    if ((container === lobbyElements.chatMessages && lobbyState.currentView === 'waiting') ||
        (container === lobbyElements.gameChatMessages && lobbyState.currentView === 'game')) {
        announceToScreenReader(`New message from ${sender}: ${message}`);
    }
}

/**
 * Switch to the waiting room view
 */
function switchToWaitingRoom() {
    // Hide lobby view
    lobbyElements.lobbyView.style.display = 'none';
    
    // Show waiting room view
    lobbyElements.waitingRoomView.style.display = 'block';
    
    // Hide game view
    lobbyElements.gameView.style.display = 'none';
    
    // Update waiting room info
    updateWaitingRoom();
    
    // Clear chat
    lobbyElements.chatMessages.innerHTML = '';
    
    // Focus chat input
    lobbyElements.chatInput.focus();
}

/**
 * Update the waiting room display
 */
function updateWaitingRoom() {
    if (!lobbyState.currentTable) return;
    
    // Update table code display
    lobbyElements.waitingTableCode.textContent = lobbyState.tableCode;
    lobbyElements.shareTableCode.textContent = lobbyState.tableCode;
    
    // Update player positions
    const positions = ['north', 'east', 'south', 'west'];
    
    positions.forEach(pos => {
        const element = lobbyElements[`waiting${pos.charAt(0).toUpperCase() + pos.slice(1)}`];
        const player = lobbyState.currentTable.players[pos];
        
        if (player) {
            element.classList.add('occupied');
            
            // Check if this is the current player
            if (player.id === socket.id) {
                element.classList.add('you');
                element.querySelector('.player-name').textContent = `${player.name} (You)`;
            } else {
                element.classList.remove('you');
                element.querySelector('.player-name').textContent = player.name;
            }
        } else {
            element.classList.remove('occupied', 'you');
            element.querySelector('.player-name').textContent = 'Waiting...';
        }
    });
    
    // Enable start button if there's at least one player
    const playerCount = Object.values(lobbyState.currentTable.players).filter(p => p !== null).length;
    lobbyElements.startGameButton.disabled = playerCount === 0;
}

/**
 * Switch to game view
 */
function switchToGameView() {
    // Hide lobby view
    lobbyElements.lobbyView.style.display = 'none';
    
    // Hide waiting room view
    lobbyElements.waitingRoomView.style.display = 'none';
    
    // Show game view
    lobbyElements.gameView.style.display = 'block';
    
    // Set table code in game view
    lobbyElements.gameTableCode.textContent = lobbyState.tableCode;
    
    // Clear game chat
    lobbyElements.gameChatMessages.innerHTML = '';
}

/**
 * Switch back to the lobby
 */
function switchToLobby() {
    // Show lobby view
    lobbyElements.lobbyView.style.display = 'block';
    
    // Hide waiting room view
    lobbyElements.waitingRoomView.style.display = 'none';
    
    // Hide game view
    lobbyElements.gameView.style.display = 'none';
    
    // Reset state
    lobbyState.currentView = 'lobby';
    lobbyState.tableCode = '';
    lobbyState.selectedPosition = null;
    lobbyState.currentTable = null;
    
    // Get active tables info again
    socket.emit('getActiveTables');
}

/**
 * Update position selection UI
 */
function updatePositionSelection(availablePositions, currentPlayers) {
    const positionElement = document.getElementById('position-table-code');
    positionElement.textContent = lobbyState.joinTableCode;
    
    // Update each position info
    const positions = ['north', 'east', 'south', 'west'];
    
    positions.forEach(pos => {
        const positionInfo = document.getElementById(`position-${pos}`);
        const playerNameElement = positionInfo.querySelector('.player-name');
        const selectButton = positionInfo.querySelector('.select-position-button');
        
        if (currentPlayers && currentPlayers[pos]) {
            // Position is occupied
            playerNameElement.textContent = currentPlayers[pos].name;
            selectButton.disabled = true;
            selectButton.style.display = 'none';
        } else if (availablePositions.includes(pos)) {
            // Position is available
            playerNameElement.textContent = 'Available';
            selectButton.disabled = false;
            selectButton.style.display = 'block';
        } else {
            // Position is not available (shouldn't happen but just in case)
            playerNameElement.textContent = 'Not available';
            selectButton.disabled = true;
            selectButton.style.display = 'none';
        }
    });
    
    // Focus first available position button
    if (availablePositions.length > 0) {
        const firstAvailable = document.querySelector(`#position-${availablePositions[0]} .select-position-button`);
        if (firstAvailable) {
            firstAvailable.focus();
        }
    }
}

/**
 * Show an error message
 */
function showError(message) {
    // Create error element
    const errorElement = document.createElement('div');
    errorElement.className = 'error-message';
    errorElement.textContent = message;
    
    // Add to appropriate view
    if (lobbyState.currentView === 'lobby' || 
        lobbyState.currentView === 'create' || 
        lobbyState.currentView === 'join' || 
        lobbyState.currentView === 'position') {
        // Add to lobby view, before the first section
        const firstSection = lobbyElements.lobbyView.querySelector('.section');
        lobbyElements.lobbyView.insertBefore(errorElement, firstSection);
    } else if (lobbyState.currentView === 'waiting') {
        // Add to waiting room view, before the first section
        const firstSection = lobbyElements.waitingRoomView.querySelector('.section');
        lobbyElements.waitingRoomView.insertBefore(errorElement, firstSection);
    } else if (lobbyState.currentView === 'game') {
        // Use the status bar in game view
        updateStatus(message);
    }
    
    // Announce to screen reader
    if (lobbyState.currentView === 'waiting') {
        announceToWaiting(message);
    } else if (lobbyState.currentView === 'game') {
        announceToScreenReader(message);
    } else {
        announceToLobby(message);
    }
    
    // Remove after 5 seconds
    setTimeout(() => {
        if (errorElement.parentNode) {
            errorElement.parentNode.removeChild(errorElement);
        }
    }, 5000);
}

/**
 * Announce message to lobby screen reader
 */
function announceToLobby(message) {
    lobbyElements.lobbyAnnouncer.textContent = '';
    setTimeout(() => {
        lobbyElements.lobbyAnnouncer.textContent = message;
    }, 50);
}

/**
 * Announce message to waiting room screen reader
 */
function announceToWaiting(message) {
    lobbyElements.waitingAnnouncer.textContent = '';
    setTimeout(() => {
        lobbyElements.waitingAnnouncer.textContent = message;
    }, 50);
}

// These functions would be implemented in the game.js file
// They're included here for reference of how multiplayer game events are handled

/**
 * Initialize multiplayer game
 * This would be implemented in game.js
 */
function initializeMultiplayerGame(gameState, biddingState, players) {
    // Set multiplayer mode
    window.isMultiplayerGame = true;
    
    // Update game state with received data
    // (This would be implemented in game.js)
}

/**
 * Receive your cards in multiplayer game
 * This would be implemented in game.js
 */
function receiveYourCards(position, cards) {
    // Update your hand in the game state
    // (This would be implemented in game.js)
}

/**
 * Handle multiplayer bid
 * This would be implemented in game.js
 */
function handleMultiplayerBid(position, bid, nextBidder, biddingState) {
    // Update bidding state and UI
    // (This would be implemented in game.js)
}

/**
 * Handle multiplayer card played
 * This would be implemented in game.js
 */
function handleMultiplayerCardPlayed(position, suit, card, currentTrick) {
    // Update game state and UI
    // (This would be implemented in game.js)
}

/**
 * Handle bidding complete in multiplayer game
 * This would be implemented in game.js
 */
function handleBiddingComplete(contract, declarer, dummy, trumpSuit, currentPlayer, gameState) {
    // Update game state and UI for play phase
    // (This would be implemented in game.js)
}

/**
 * Update play phase cards in multiplayer game
 * This would be implemented in game.js
 */
function updatePlayPhaseCards(position, cards, dummyCards) {
    // Update hand and dummy cards
    // (This would be implemented in game.js)
}

/**
 * Handle trick complete in multiplayer game
 * This would be implemented in game.js
 */
function handleTrickComplete(winner, trick, tricks, nextPlayer) {
    // Update trick info and prepare for next trick
    // (This would be implemented in game.js)
}

/**
 * Handle game over in multiplayer game
 * This would be implemented in game.js
 */
function handleGameOver(message, tricks, contract) {
    // Show game result and update UI
    // (This would be implemented in game.js)
}