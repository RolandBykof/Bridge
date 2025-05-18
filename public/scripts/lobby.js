/**
 * BridgeCircle - Lobby Module
 * Handles the multiplayer lobby and table management
 */

// Initialize socket.io connection - with error handling
let socket;
try {
    socket = io({
        transports: ['websocket', 'polling'], // Use websocket primarily, then polling as fallback
        timeout: 10000 // Longer timeout
    });
    
    // Add connection event listeners with debugging
    socket.on('connect', () => {
        console.log('Socket.IO connected successfully with ID:', socket.id);
        socket.ready = true; // Mark socket as ready
        
        // Retry getting active tables when connected
        socket.emit('getActiveTables');
    });
    
    socket.on('connect_error', (error) => {
        console.error('Socket.IO connection error:', error);
        showConnectionError('Unable to connect to game server. Please try again later.');
    });
} catch (error) {
    console.error('Error initializing Socket.IO:', error);
    showConnectionError('Error initializing game connection. Please refresh the page.');
}

// Lobby state
const lobbyState = {
    currentView: 'lobby', // 'lobby', 'create', 'join', 'position', 'waiting', 'game'
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
let lobbyElements;

// Initialize lobby when DOM is loaded
document.addEventListener('DOMContentLoaded', initializeLobby);

/**
 * Initialize the lobby
 */
function initializeLobby() {
    console.log('Initializing lobby...');
    
    // Initialize DOM elements
    initializeElements();
    
    // Setup event listeners
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
    if (socket && socket.connected && socket.ready) {
        socket.emit('getActiveTables');
    } else {
        console.warn('Socket not connected yet, will try again when connected');
    }
    
    console.log('Lobby initialized');
}

/**
 * Initialize all DOM elements
 */
function initializeElements() {
    console.log('Initializing DOM elements...');
    
    lobbyElements = {
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
    
    // Check if all required elements exist
    validateElements();
}

/**
 * Validate all required elements exist
 */
function validateElements() {
    // Check main required buttons
    const requiredMainElements = [
        'createTableButton', 
        'joinTableButton', 
        'playSoloButton'
    ];
    
    let missingElements = [];
    
    requiredMainElements.forEach(elementName => {
        if (!lobbyElements[elementName]) {
            console.error(`Missing required element: ${elementName}`);
            missingElements.push(elementName);
        }
    });
    
    if (missingElements.length > 0) {
        showConnectionError(`Missing UI elements: ${missingElements.join(', ')}. Please refresh the page.`);
    }
}

/**
 * Setup socket event listeners
 */
function setupSocketListeners() {
    if (!socket) {
        console.error('Cannot setup socket listeners: socket is not initialized');
        return;
    }
    
    console.log('Setting up socket listeners...');
    
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
        if (typeof receiveYourCards === 'function') {
            receiveYourCards(position, cards);
        } else {
            console.warn('receiveYourCards function not available');
        }
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
        if (lobbyElements.tablesCount) {
            lobbyElements.tablesCount.textContent = tables.length;
        }
    });
    
    // Bidding specific events
    socket.on('bidMade', ({ position, bid, nextBidder, biddingState }) => {
        // Will be handled by game.js
        if (typeof handleMultiplayerBid === 'function') {
            handleMultiplayerBid(position, bid, nextBidder, biddingState);
        } else {
            console.warn('handleMultiplayerBid function not available');
        }
    });
    
    // Card played
    socket.on('cardPlayed', ({ position, suit, card, currentTrick }) => {
        // Will be handled by game.js
        if (typeof handleMultiplayerCardPlayed === 'function') {
            handleMultiplayerCardPlayed(position, suit, card, currentTrick);
        } else {
            console.warn('handleMultiplayerCardPlayed function not available');
        }
    });
    
    // Bidding complete, switching to play phase
    socket.on('biddingComplete', ({ contract, declarer, dummy, trumpSuit, currentPlayer, gameState }) => {
        // Will be handled by game.js
        if (typeof handleBiddingComplete === 'function') {
            handleBiddingComplete(contract, declarer, dummy, trumpSuit, currentPlayer, gameState);
        } else {
            console.warn('handleBiddingComplete function not available');
        }
    });
    
    // Play phase cards (including dummy)
    socket.on('playPhaseCards', ({ position, cards, dummyCards }) => {
        // Will be handled by game.js
        if (typeof updatePlayPhaseCards === 'function') {
            updatePlayPhaseCards(position, cards, dummyCards);
        } else {
            console.warn('updatePlayPhaseCards function not available');
        }
    });
    
    // Trick complete
    socket.on('trickComplete', ({ winner, trick, tricks, nextPlayer }) => {
        // Will be handled by game.js
        if (typeof handleTrickComplete === 'function') {
            handleTrickComplete(winner, trick, tricks, nextPlayer);
        } else {
            console.warn('handleTrickComplete function not available');
        }
    });
    
    // Game over
    socket.on('gameOver', ({ message, tricks, contract }) => {
        // Will be handled by game.js
        if (typeof handleGameOver === 'function') {
            handleGameOver(message, tricks, contract);
        } else {
            console.warn('handleGameOver function not available');
        }
    });
    
    // Table removed (due to inactivity)
    socket.on('tableRemoved', ({ message }) => {
        // If we're in waiting room or game, return to lobby
        if (lobbyState.currentView === 'waiting' || lobbyState.currentView === 'game') {
            switchToLobby();
            showError(message);
        }
    });
    
    console.log('Socket listeners setup complete');
}

/**
 * Setup UI event listeners
 */
function setupEventListeners() {
    console.log('Setting up UI event listeners...');
    
    // Main lobby buttons
    if (lobbyElements.createTableButton) {
        lobbyElements.createTableButton.addEventListener('click', () => {
            console.log('Create table button clicked');
            switchView('create');
        });
    }
    
    if (lobbyElements.joinTableButton) {
        lobbyElements.joinTableButton.addEventListener('click', () => {
            console.log('Join table button clicked');
            switchView('join');
        });
    }
    
    if (lobbyElements.playSoloButton) {
        lobbyElements.playSoloButton.addEventListener('click', () => {
            console.log('Play solo button clicked');
            // Redirect to solo game (original game without multiplayer)
            window.location.href = '/solo.html';
        });
    }
    
    // Create table form
    if (lobbyElements.createCancelButton) {
        lobbyElements.createCancelButton.addEventListener('click', () => {
            console.log('Create cancel button clicked');
            switchView('lobby');
        });
    }
    
    if (lobbyElements.createSubmitButton) {
        lobbyElements.createSubmitButton.addEventListener('click', () => {
            console.log('Create submit button clicked');
            createTable();
        });
    }
    
    // Join table form
    if (lobbyElements.joinCancelButton) {
        lobbyElements.joinCancelButton.addEventListener('click', () => {
            console.log('Join cancel button clicked');
            switchView('lobby');
        });
    }
    
    if (lobbyElements.joinSubmitButton) {
        lobbyElements.joinSubmitButton.addEventListener('click', () => {
            console.log('Join submit button clicked');
            joinTable();
        });
    }
    
    // Position selection form
    if (lobbyElements.positionCancelButton) {
        lobbyElements.positionCancelButton.addEventListener('click', () => {
            console.log('Position cancel button clicked');
            switchView('lobby');
        });
    }
    
    // Position buttons in create form
    if (lobbyElements.positionButtons) {
        lobbyElements.positionButtons.forEach(button => {
            button.addEventListener('click', (e) => {
                console.log('Position button clicked:', e.target.dataset.position);
                
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
    }
    
    // Position selection buttons in join form
    if (lobbyElements.selectPositionButtons) {
        lobbyElements.selectPositionButtons.forEach(button => {
            button.addEventListener('click', (e) => {
                console.log('Select position button clicked:', e.target.dataset.position);
                selectPosition(e.target.dataset.position);
            });
        });
    }
    
    // Waiting room buttons
    if (lobbyElements.startGameButton) {
        lobbyElements.startGameButton.addEventListener('click', () => {
            console.log('Start game button clicked');
            startGame();
        });
    }
    
    if (lobbyElements.leaveTableButton) {
        lobbyElements.leaveTableButton.addEventListener('click', () => {
            console.log('Leave table button clicked');
            leaveTable();
        });
    }
    
    // Game leave button
    if (lobbyElements.leaveGameButton) {
        lobbyElements.leaveGameButton.addEventListener('click', () => {
            console.log('Leave game button clicked');
            leaveGame();
        });
    }
    
    // Chat functions
    if (lobbyElements.sendChatButton) {
        lobbyElements.sendChatButton.addEventListener('click', () => {
            console.log('Send chat button clicked');
            sendChatMessage();
        });
    }
    
    if (lobbyElements.chatInput) {
        lobbyElements.chatInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                console.log('Chat input enter pressed');
                sendChatMessage();
            }
        });
    }
    
    // Game chat functions
    if (lobbyElements.gameSendChatButton) {
        lobbyElements.gameSendChatButton.addEventListener('click', () => {
            console.log('Game send chat button clicked');
            sendGameChatMessage();
        });
    }
    
    if (lobbyElements.gameChatInput) {
        lobbyElements.gameChatInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                console.log('Game chat input enter pressed');
                sendGameChatMessage();
            }
        });
    }
    
    // Form inputs - store value in state on change
    if (lobbyElements.createNameInput) {
        lobbyElements.createNameInput.addEventListener('input', (e) => {
            lobbyState.playerName = e.target.value;
        });
    }
    
    if (lobbyElements.joinNameInput) {
        lobbyElements.joinNameInput.addEventListener('input', (e) => {
            lobbyState.playerName = e.target.value;
        });
    }
    
    if (lobbyElements.tableCodeInput) {
        lobbyElements.tableCodeInput.addEventListener('input', (e) => {
            lobbyState.joinTableCode = e.target.value;
        });
    }
    
    console.log('UI event listeners setup complete');
}

/**
 * Show connection error
 */
function showConnectionError(message) {
    const errorDiv = document.createElement('div');
    errorDiv.className = 'error-message';
    errorDiv.innerHTML = `<strong>Connection Error:</strong> ${message}`;
    
    // Add to top of page
    document.body.insertBefore(errorDiv, document.body.firstChild);
    
    // Display reconnect button
    const reconnectBtn = document.createElement('button');
    reconnectBtn.className = 'button';
    reconnectBtn.textContent = 'Refresh Page';
    reconnectBtn.addEventListener('click', () => {
        window.location.reload();
    });
    
    errorDiv.appendChild(reconnectBtn);
    
    // Try to announce to screen reader if available
    if (document.getElementById('lobby-announcer')) {
        document.getElementById('lobby-announcer').textContent = message;
    }
}

/**
 * Switch between different views
 * @param {string} view - The view to switch to ('lobby', 'create', 'join', 'position', 'waiting', 'game')
 */
function switchView(view) {
    console.log('Switching view to:', view);
    
    // Update current view in state
    lobbyState.currentView = view;
    
    // Hide all forms first
    if (lobbyElements.createTableForm) {
        lobbyElements.createTableForm.style.display = 'none';
    }
    
    if (lobbyElements.joinTableForm) {
        lobbyElements.joinTableForm.style.display = 'none';
    }
    
    if (lobbyElements.positionSelectionForm) {
        lobbyElements.positionSelectionForm.style.display = 'none';
    }
    
    // Show appropriate view
    switch (view) {
        case 'lobby':
            // Just hide all forms, main lobby is already visible
            break;
        case 'create':
            if (lobbyElements.createTableForm) {
                lobbyElements.createTableForm.style.display = 'block';
                
                if (lobbyElements.createNameInput) {
                    lobbyElements.createNameInput.focus();
                }
            }
            break;
        case 'join':
            if (lobbyElements.joinTableForm) {
                lobbyElements.joinTableForm.style.display = 'block';
                
                if (lobbyElements.joinNameInput) {
                    lobbyElements.joinNameInput.focus();
                }
            }
            break;
        case 'position':
            if (lobbyElements.positionSelectionForm) {
                lobbyElements.positionSelectionForm.style.display = 'block';
                // Focus will be set on an available position button
            }
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
    console.log('Creating table...');
    
    // Validate inputs
    if (!lobbyState.playerName) {
        showError('Please enter your name');
        return;
    }
    
    if (!lobbyState.selectedPosition) {
        showError('Please select a position');
        return;
    }
    
    // Check if socket is connected
    if (!socket || !socket.connected) {
        showConnectionError('Not connected to server. Please refresh the page.');
        return;
    }
    
    // Send request to server
    socket.emit('createTable', {
        playerName: lobbyState.playerName,
        position: lobbyState.selectedPosition
    });
    
    console.log('Create table request sent');
}

/**
 * Join an existing table
 */
function joinTable() {
    console.log('Joining table...');
    
    // Validate inputs
    if (!lobbyState.playerName) {
        showError('Please enter your name');
        return;
    }
    
    if (!lobbyState.joinTableCode) {
        showError('Please enter a table code');
        return;
    }
    
    // Check if socket is connected
    if (!socket || !socket.connected) {
        showConnectionError('Not connected to server. Please refresh the page.');
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
    
    console.log('Join table request sent');
}

/**
 * Select a position in an existing table
 */
function selectPosition(position) {
    console.log('Selecting position:', position);
    
    // Validate
    if (!position) {
        showError('Invalid position');
        return;
    }
    
    // Check if socket is connected
    if (!socket || !socket.connected) {
        showConnectionError('Not connected to server. Please refresh the page.');
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
    
    console.log('Select position request sent');
}

/**
 * Start the game with currently present players
 */
function startGame() {
    console.log('Starting game...');
    
    // Check if socket is connected
    if (!socket || !socket.connected) {
        showConnectionError('Not connected to server. Please refresh the page.');
        return;
    }
    
    // Send request to server
    socket.emit('startGame', {
        tableCode: lobbyState.tableCode
    });
    
    console.log('Start game request sent');
}

/**
 * Leave the current table
 */
function leaveTable() {
    console.log('Leaving table...');
    
    // Check if socket is connected
    if (!socket || !socket.connected) {
        // Just go back to lobby if not connected
        switchToLobby();
        return;
    }
    
    // Send request to server
    socket.emit('leaveTable');
    
    // Return to lobby
    switchToLobby();
    
    console.log('Leave table request sent');
}

/**
 * Leave the current game
 */
function leaveGame() {
    console.log('Leaving game...');
    
    // Confirm
    if (confirm('Are you sure you want to leave the game? You will be replaced by GIB AI.')) {
        // Check if socket is connected
        if (!socket || !socket.connected) {
            // Just go back to lobby if not connected
            switchToLobby();
            return;
        }
        
        // Send request to server
        socket.emit('leaveTable');
        
        // Return to lobby
        switchToLobby();
        
        console.log('Leave game request sent');
    }
}

/**
 * Send a chat message in waiting room
 */
function sendChatMessage() {
    if (!lobbyElements.chatInput) return;
    
    const message = lobbyElements.chatInput.value.trim();
    
    if (message) {
        // Check if socket is connected
        if (!socket || !socket.connected) {
            showError('Not connected to chat server');
            return;
        }
        
        // Send to server
        socket.emit('sendChatMessage', {
            tableCode: lobbyState.tableCode,
            message: message
        });
        
        // Clear input
        lobbyElements.chatInput.value = '';
        
        // Focus back on input
        lobbyElements.chatInput.focus();
        
        console.log('Chat message sent');
    }
}

/**
 * Send a chat message in game
 */
function sendGameChatMessage() {
    if (!lobbyElements.gameChatInput) return;
    
    const message = lobbyElements.gameChatInput.value.trim();
    
    if (message) {
        // Check if socket is connected
        if (!socket || !socket.connected) {
            showError('Not connected to chat server');
            return;
        }
        
        // Send to server
        socket.emit('sendChatMessage', {
            tableCode: lobbyState.tableCode,
            message: message
        });
        
        // Clear input
        lobbyElements.gameChatInput.value = '';
        
        // Focus back on input
        lobbyElements.gameChatInput.focus();
        
        console.log('Game chat message sent');
    }
}

/**
 * Add a chat message to the specified container
 */
function addChatMessage(container, sender, position, message) {
    if (!container) return;
    
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
        if (typeof announceToScreenReader === 'function') {
            announceToScreenReader(`New message from ${sender}: ${message}`);
        } else {
            // Fallback if announceToScreenReader not available
            if (lobbyState.currentView === 'waiting' && lobbyElements.waitingAnnouncer) {
                announceToWaiting(`New message from ${sender}: ${message}`);
            }
        }
    }
}

/**
 * Switch to the waiting room view
 */
function switchToWaitingRoom() {
    console.log('Switching to waiting room');
    
    // Hide lobby view
    if (lobbyElements.lobbyView) {
        lobbyElements.lobbyView.style.display = 'none';
    }
    
    // Show waiting room view
    if (lobbyElements.waitingRoomView) {
        lobbyElements.waitingRoomView.style.display = 'block';
    }
    
    // Hide game view
    if (lobbyElements.gameView) {
        lobbyElements.gameView.style.display = 'none';
    }
    
    // Update waiting room info
    updateWaitingRoom();
    
    // Clear chat
    if (lobbyElements.chatMessages) {
        lobbyElements.chatMessages.innerHTML = '';
    }
    
    // Focus chat input
    if (lobbyElements.chatInput) {
        lobbyElements.chatInput.focus();
    }
}

/**
 * Update the waiting room display
 */
function updateWaitingRoom() {
    if (!lobbyState.currentTable) return;
    
    console.log('Updating waiting room');
    
    // Update table code display
    if (lobbyElements.waitingTableCode) {
        lobbyElements.waitingTableCode.textContent = lobbyState.tableCode;
    }
    
    if (lobbyElements.shareTableCode) {
        lobbyElements.shareTableCode.textContent = lobbyState.tableCode;
    }
    
    // Update player positions
    const positions = ['north', 'east', 'south', 'west'];
    
    positions.forEach(pos => {
        const elementName = `waiting${pos.charAt(0).toUpperCase() + pos.slice(1)}`;
        const element = lobbyElements[elementName];
        
        if (!element) {
            console.warn(`Missing element: ${elementName}`);
            return;
        }
        
        const player = lobbyState.currentTable.players[pos];
        
        if (player) {
            element.classList.add('occupied');
            
            // Check if this is the current player
            if (socket && player.id === socket.id) {
                element.classList.add('you');
                
                const playerNameElement = element.querySelector('.player-name');
                if (playerNameElement) {
                    playerNameElement.textContent = `${player.name} (You)`;
                }
            } else {
                element.classList.remove('you');
                
                const playerNameElement = element.querySelector('.player-name');
                if (playerNameElement) {
                    playerNameElement.textContent = player.name;
                }
            }
        } else {
            element.classList.remove('occupied', 'you');
            
            const playerNameElement = element.querySelector('.player-name');
            if (playerNameElement) {
                playerNameElement.textContent = 'Waiting...';
            }
        }
    });
    
    // Enable start button if there's at least one player
    if (lobbyElements.startGameButton) {
        const playerCount = Object.values(lobbyState.currentTable.players).filter(p => p !== null).length;
        lobbyElements.startGameButton.disabled = playerCount === 0;
    }
}

/**
 * Switch to game view
 */
function switchToGameView() {
    console.log('Switching to game view');
    
    // Hide lobby view
    if (lobbyElements.lobbyView) {
        lobbyElements.lobbyView.style.display = 'none';
    }
    
    // Hide waiting room view
    if (lobbyElements.waitingRoomView) {
        lobbyElements.waitingRoomView.style.display = 'none';
    }
    
    // Show game view
    if (lobbyElements.gameView) {
        lobbyElements.gameView.style.display = 'block';
    }
    
    // Set table code in game view
    if (lobbyElements.gameTableCode) {
        lobbyElements.gameTableCode.textContent = lobbyState.tableCode;
    }
    
    // Clear game chat
    if (lobbyElements.gameChatMessages) {
        lobbyElements.gameChatMessages.innerHTML = '';
    }
}

/**
 * Switch back to the lobby
 */
function switchToLobby() {
    console.log('Switching back to lobby');
    
    // Show lobby view
    if (lobbyElements.lobbyView) {
        lobbyElements.lobbyView.style.display = 'block';
    }
    
    // Hide waiting room view
    if (lobbyElements.waitingRoomView) {
        lobbyElements.waitingRoomView.style.display = 'none';
    }
    
    // Hide game view
    if (lobbyElements.gameView) {
        lobbyElements.gameView.style.display = 'none';
    }
    
    // Reset state
    lobbyState.currentView = 'lobby';
    lobbyState.tableCode = '';
    lobbyState.selectedPosition = null;
    lobbyState.currentTable = null;
    
    // Get active tables info again
    if (socket && socket.connected && socket.ready) {
        socket.emit('getActiveTables');
    }
}

/**
 * Update position selection UI
 */
function updatePositionSelection(availablePositions, currentPlayers) {
    console.log('Updating position selection with positions:', availablePositions);
    
    const positionElement = document.getElementById('position-table-code');
    if (positionElement) {
        positionElement.textContent = lobbyState.joinTableCode;
    }
    
    // Update each position info
    const positions = ['north', 'east', 'south', 'west'];
    
    positions.forEach(pos => {
        const positionInfo = document.getElementById(`position-${pos}`);
        if (!positionInfo) {
            console.warn(`Missing position element: position-${pos}`);
            return;
        }
        
        const playerNameElement = positionInfo.querySelector('.player-name');
        const selectButton = positionInfo.querySelector('.select-position-button');
        
        if (!playerNameElement || !selectButton) {
            console.warn(`Missing child elements for position: ${pos}`);
            return;
        }
        
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
    console.error('Error:', message);
    
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
        if (lobbyElements.lobbyView) {
            const firstSection = lobbyElements.lobbyView.querySelector('.section');
            if (firstSection) {
                lobbyElements.lobbyView.insertBefore(errorElement, firstSection);
            } else {
                lobbyElements.lobbyView.appendChild(errorElement);
            }
        }
    } else if (lobbyState.currentView === 'waiting') {
        // Add to waiting room view, before the first section
        if (lobbyElements.waitingRoomView) {
            const firstSection = lobbyElements.waitingRoomView.querySelector('.section');
            if (firstSection) {
                lobbyElements.waitingRoomView.insertBefore(errorElement, firstSection);
            } else {
                lobbyElements.waitingRoomView.appendChild(errorElement);
            }
        }
    } else if (lobbyState.currentView === 'game') {
        // Use the status bar in game view
        if (typeof updateStatus === 'function') {
            updateStatus(message);
        }
    }
    
    // Announce to screen reader
    if (lobbyState.currentView === 'waiting') {
        announceToWaiting(message);
    } else if (lobbyState.currentView === 'game') {
        if (typeof announceToScreenReader === 'function') {
            announceToScreenReader(message);
        }
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
    if (lobbyElements.lobbyAnnouncer) {
        lobbyElements.lobbyAnnouncer.textContent = '';
        setTimeout(() => {
            lobbyElements.lobbyAnnouncer.textContent = message;
        }, 50);
    }
}

/**
 * Announce message to waiting room screen reader
 */
function announceToWaiting(message) {
    if (lobbyElements.waitingAnnouncer) {
        lobbyElements.waitingAnnouncer.textContent = '';
        setTimeout(() => {
            lobbyElements.waitingAnnouncer.textContent = message;
        }, 50);
    }
}

// Expose methods for debugging
window.debugLobby = {
    getState: () => lobbyState,
    getElements: () => lobbyElements,
    switchView: switchView,
    createTable: createTable,
    joinTable: joinTable
};

// These functions would be implemented in the game.js file
// They're included here as stubs to prevent errors

/**
 * Initialize multiplayer game
 * This would be implemented in game.js
 */
function initializeMultiplayerGame(gameState, biddingState, players) {
    console.log('initializeMultiplayerGame called - This function should be in game.js');
    
    // Set multiplayer mode
    window.isMultiplayerGame = true;
    
    // Update game state with received data
    // (This would be implemented in game.js)
}

/**
 * Announce to screen reader (stub)
 */
function announceToScreenReader(message, isCardPlay) {
    console.log('announceToScreenReader called - This function should be in ui.js');
    console.log('Message:', message, 'isCardPlay:', isCardPlay);
}

/**
 * Update status (stub)
 */
function updateStatus(message) {
    console.log('updateStatus called - This function should be in game.js');
    console.log('Message:', message);
}