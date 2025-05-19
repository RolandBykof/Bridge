/**
 * BridgeCircle - Client Bridge Module
 * Handles the client-side communication with the server
 */

// Global state
const clientState = {
  currentView: 'lobby', // 'lobby', 'create', 'join', 'waiting', 'game'
  playerName: '',
  tableCode: '',
  selectedPosition: null,
  gameState: null,
  biddingState: null
};

// DOM elements cache
const elements = {};

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', initializeClient);

/**
 * Initialize the client
 */
function initializeClient() {
  console.log('Initializing BridgeCircle client...');
  
  // Initialize socket handler
  const socket = socketHandler.initialize();
  
  // Cache DOM elements
  cacheElements();
  
  // Setup UI event listeners
  setupEventListeners();
  
  // Check for URL parameters (e.g., table code)
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.has('code')) {
    clientState.tableCode = urlParams.get('code');
    
    // If we're on the waiting room page, join that room
    if (window.location.pathname.includes('waitingroom.html')) {
      setupWaitingRoom();
    }
  }
  
  // Restore player name from localStorage
  const savedName = localStorage.getItem('bridgePlayerName');
  if (savedName) {
    clientState.playerName = savedName;
    updateNameFields(savedName);
  }
  
  console.log('Client initialized');
}

/**
 * Cache DOM elements for better performance
 */
function cacheElements() {
  // Common elements
  elements.errorContainer = document.getElementById('error-container');
  
  // Lobby elements
  elements.createTableButton = document.getElementById('create-table-button');
  elements.joinTableButton = document.getElementById('join-table-button');
  elements.playSoloButton = document.getElementById('play-solo-button');
  
  // Create table form
  elements.createTableForm = document.getElementById('create-table-form');
  elements.createNameInput = document.getElementById('create-name-input');
  elements.createSubmitButton = document.getElementById('create-submit-button');
  elements.positionButtons = document.querySelectorAll('.position-button');
  
  // Join table form
  elements.joinTableForm = document.getElementById('join-table-form');
  elements.joinNameInput = document.getElementById('join-name-input');
  elements.tableCodeInput = document.getElementById('table-code-input');
  elements.joinSubmitButton = document.getElementById('join-submit-button');
  
  // Position selection
  elements.positionSelection = document.getElementById('position-selection');
  elements.positionsContainer = document.getElementById('positions-container');
  
  // Waiting room elements
  elements.waitingRoomView = document.getElementById('waiting-room-view');
  elements.waitingTableCode = document.getElementById('waiting-table-code');
  elements.shareTableCode = document.getElementById('share-table-code');
  elements.waitingPositions = {
    north: document.getElementById('waiting-north'),
    east: document.getElementById('waiting-east'),
    south: document.getElementById('waiting-south'),
    west: document.getElementById('waiting-west')
  };
  elements.startGameButton = document.getElementById('start-game-button');
  elements.leaveTableButton = document.getElementById('leave-table-button');
  
  // Chat elements
  elements.chatMessages = document.getElementById('chat-messages');
  elements.chatInput = document.getElementById('chat-input');
  elements.sendChatButton = document.getElementById('send-chat-button');
  
  // Game view elements
  elements.gameView = document.getElementById('game-view');
  elements.gameTableCode = document.getElementById('game-table-code');
  elements.bidControls = document.getElementById('bidding-controls');
  elements.bidHistory = document.getElementById('bidding-history');
  
  console.log('DOM elements cached');
}

/**
 * Setup event listeners for UI
 */
function setupEventListeners() {
  // Main lobby buttons
  if (elements.createTableButton) {
    elements.createTableButton.addEventListener('click', () => {
      if (elements.createTableForm) {
        elements.createTableForm.style.display = 'block';
      } else {
        window.location.href = '/createtable.html';
      }
    });
  }
  
  if (elements.joinTableButton) {
    elements.joinTableButton.addEventListener('click', () => {
      if (elements.joinTableForm) {
        elements.joinTableForm.style.display = 'block';
      } else {
        window.location.href = '/jointable.html';
      }
    });
  }
  
  if (elements.playSoloButton) {
    elements.playSoloButton.addEventListener('click', () => {
      window.location.href = '/solo.html';
    });
  }
  
  // Create table form
  if (elements.createTableForm) {
    elements.createTableForm.addEventListener('submit', (e) => {
      e.preventDefault();
      createTable();
    });
  }
  
  // Join table form
  if (elements.joinTableForm) {
    elements.joinTableForm.addEventListener('submit', (e) => {
      e.preventDefault();
      joinTable();
    });
  }
  
  // Position buttons
  if (elements.positionButtons) {
    elements.positionButtons.forEach(button => {
      button.addEventListener('click', (e) => {
        // Remove selected class from all buttons
        elements.positionButtons.forEach(btn => {
          btn.classList.remove('selected');
        });
        
        // Add selected class to clicked button
        e.target.classList.add('selected');
        
        // Save selected position
        clientState.selectedPosition = e.target.dataset.position;
      });
    });
  }
  
  // Start game button
  if (elements.startGameButton) {
    elements.startGameButton.addEventListener('click', startGame);
  }
  
  // Leave table button
  if (elements.leaveTableButton) {
    elements.leaveTableButton.addEventListener('click', leaveTable);
  }
  
  // Chat functionality
  if (elements.sendChatButton && elements.chatInput) {
    elements.sendChatButton.addEventListener('click', sendChatMessage);
    elements.chatInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        sendChatMessage();
      }
    });
  }
  
  console.log('Event listeners set up');
}

/**
 * Create a new table
 */
function createTable() {
  const playerName = elements.createNameInput ? elements.createNameInput.value.trim() : clientState.playerName;
  
  if (!playerName) {
    showUIError('Please enter your name');
    return;
  }
  
  if (!clientState.selectedPosition) {
    showUIError('Please select a position');
    return;
  }
  
  // Save name for future use
  clientState.playerName = playerName;
  localStorage.setItem('bridgePlayerName', playerName);
  
  // Set up callbacks for socket events
  socketHandler.setupLobbyListeners({
    onTableCreated: handleTableCreated,
    onActiveTablesList: handleActiveTablesList,
    onSelectPosition: handleSelectPosition,
    onPlayerJoined: handlePlayerJoined
  });
  
  // Send create request to server
  socket.emit('createTable', {
    playerName: playerName,
    position: clientState.selectedPosition
  });
}

/**
 * Join an existing table
 */
function joinTable() {
  const playerName = elements.joinNameInput ? elements.joinNameInput.value.trim() : clientState.playerName;
  const tableCode = elements.tableCodeInput ? elements.tableCodeInput.value.trim() : clientState.tableCode;
  
  if (!playerName) {
    showUIError('Please enter your name');
    return;
  }
  
  if (!tableCode) {
    showUIError('Please enter a table code');
    return;
  }
  
  // Save name for future use
  clientState.playerName = playerName;
  localStorage.setItem('bridgePlayerName', playerName);
  
  // Set up callbacks for socket events
  socketHandler.setupLobbyListeners({
    onSelectPosition: handleSelectPosition,
    onPlayerJoined: handlePlayerJoined
  });
  
  // Send join request to server
  socket.emit('joinTable', {
    playerName: playerName,
    tableCode: tableCode.toUpperCase()
  });
}

/**
 * Select a position in a table
 */
function selectPosition(position) {
  // Send position selection to server
  socket.emit('selectPosition', {
    tableCode: clientState.tableCode,
    position: position,
    playerName: clientState.playerName
  });
}

/**
 * Start the game
 */
function startGame() {
  socket.emit('startGame', {
    tableCode: clientState.tableCode
  });
}

/**
 * Leave the current table
 */
function leaveTable() {
  socket.emit('leaveTable');
  
  // Redirect to home page
  window.location.href = '/';
}

/**
 * Send a chat message
 */
function sendChatMessage() {
  if (!elements.chatInput) return;
  
  const message = elements.chatInput.value.trim();
  if (!message) return;
  
  socket.emit('sendChatMessage', {
    tableCode: clientState.tableCode,
    message: message
  });
  
  // Clear input
  elements.chatInput.value = '';
}

/**
 * Show error message to user
 */
function showUIError(message, duration = 5000) {
  console.error('Error:', message);
  
  // Create error element if it doesn't exist
  if (!elements.errorContainer) {
    elements.errorContainer = document.createElement('div');
    elements.errorContainer.id = 'error-container';
    elements.errorContainer.className = 'error-message';
    document.body.insertBefore(elements.errorContainer, document.body.firstChild);
  }
  
  elements.errorContainer.textContent = message;
  elements.errorContainer.style.display = 'block';
  
  // Hide after duration
  setTimeout(() => {
    if (elements.errorContainer) {
      elements.errorContainer.style.display = 'none';
    }
  }, duration);
}

/**
 * Update all name input fields with the saved name
 */
function updateNameFields(name) {
  if (elements.createNameInput) elements.createNameInput.value = name;
  if (elements.joinNameInput) elements.joinNameInput.value = name;
}

/**
 * Set up waiting room
 */
function setupWaitingRoom() {
  // Get table info first
  socket.emit('getTableInfo', { tableCode: clientState.tableCode });
  
  // Setup waiting room socket listeners
  socketHandler.setupWaitingRoomListeners({
    onTableInfo: handleTableInfo,
    onPlayerJoined: handlePlayerJoined,
    onPlayerLeft: handlePlayerLeft,
    onGameStarted: handleGameStarted,
    onChatMessage: handleChatMessage,
    onTableRemoved: handleTableRemoved
  });
  
  // Display the table code
  if (elements.waitingTableCode) {
    elements.waitingTableCode.textContent = clientState.tableCode;
  }
  
  if (elements.shareTableCode) {
    elements.shareTableCode.textContent = clientState.tableCode;
  }
}

/**
 * Set up game screen
 */
function setupGameScreen() {
  // Setup game socket listeners
  socketHandler.setupGameListeners({
    onYourCards: handleYourCards,
    onBidMade: handleBidMade,
    onBiddingComplete: handleBiddingComplete,
    onPlayPhaseCards: handlePlayPhaseCards,
    onCardPlayed: handleCardPlayed,
    onNextPlayer: handleNextPlayer,
    onTrickComplete: handleTrickComplete, 
    onGameOver: handleGameOver,
    onChatMessage: handleChatMessage,
    onPlayerReplaced: handlePlayerReplaced
  });
  
// Display the table code
  if (elements.gameTableCode) {
    elements.gameTableCode.textContent = clientState.tableCode;
  }
  
  // Set up UI for the game phase
  updateGameUI();
}

/**
 * Socket event handlers
 */

// Handle table created event
function handleTableCreated(data) {
  clientState.tableCode = data.tableCode;
  
  // Redirect to waiting room
  window.location.href = `/waitingroom.html?code=${data.tableCode}`;
}

// Handle active tables list
function handleActiveTablesList(data) {
  // Update active tables count in the UI if needed
  if (elements.tablesCount) {
    elements.tablesCount.textContent = data.tables.length;
  }
}

// Handle select position response
function handleSelectPosition(data) {
  clientState.tableCode = data.tableCode;
  
  // If we're on the join page with position selection UI
  if (elements.positionSelection) {
    elements.positionSelection.style.display = 'block';
    if (elements.joinTableForm) {
      elements.joinTableForm.style.display = 'none';
    }
    
    if (elements.positionsContainer) {
      // Clear existing positions
      elements.positionsContainer.innerHTML = '';
      
      // Create position buttons
      data.positions.forEach(position => {
        const div = document.createElement('div');
        div.className = 'position-info';
        div.innerHTML = `
          <h3>${position.charAt(0).toUpperCase() + position.slice(1)}</h3>
          <p class="player-name">Available</p>
          <button class="select-position-button" data-position="${position}">Select</button>
        `;
        elements.positionsContainer.appendChild(div);
        
        // Add event listener to button
        const button = div.querySelector('.select-position-button');
        if (button) {
          button.addEventListener('click', () => selectPosition(position));
        }
      });
    }
  } else {
    // We're not on the join page, redirect to waiting room
    window.location.href = `/waitingroom.html?code=${data.tableCode}`;
  }
}

// Handle player joined event
function handlePlayerJoined(data) {
  // If we're in waiting room, update the UI
  if (elements.waitingPositions) {
    updateWaitingRoomPositions(data.table);
  }
  
  // Add chat message about new player
  if (elements.chatMessages) {
    addChatSystemMessage(`${data.playerName} joined as ${data.position}.`);
  }
}

// Handle player left event
function handlePlayerLeft(data) {
  // If we're in waiting room, update the UI
  if (elements.waitingPositions) {
    updateWaitingRoomPositions(data.table);
  }
  
  // Add chat message about player leaving
  if (elements.chatMessages) {
    addChatSystemMessage(`Player left from ${data.position}.`);
  }
}

// Handle table info response
function handleTableInfo(data) {
  // Update waiting room UI with table info
  if (elements.waitingPositions) {
    updateWaitingRoomPositions(data.table);
  }
}

// Handle game started event
function handleGameStarted(data) {
  clientState.gameState = data.gameState;
  clientState.biddingState = data.biddingState;
  
  // Redirect to game page
  window.location.href = `/game.html?code=${clientState.tableCode}`;
}

// Handle your cards event
function handleYourCards(data) {
  // Store cards in game state
  if (!clientState.gameState) {
    clientState.gameState = {};
  }
  
  if (!clientState.gameState.hands) {
    clientState.gameState.hands = {};
  }
  
  clientState.gameState.hands[data.position] = data.cards;
  clientState.myPosition = data.position;
  
  // Update the UI to show cards
  renderHand(data.position, data.cards);
}

// Handle bid made event
function handleBidMade(data) {
  // Update bidding state
  if (!clientState.biddingState) {
    clientState.biddingState = {};
  }
  
  if (!clientState.biddingState.bidHistory) {
    clientState.biddingState.bidHistory = [];
  }
  
  clientState.biddingState.bidHistory.push({
    player: data.position,
    bid: data.bid
  });
  
  clientState.biddingState.currentBidder = data.nextBidder;
  
  // Update bidding UI
  renderBiddingHistory();
  
  // If it's your turn, show bidding controls
  if (data.nextBidder === clientState.myPosition) {
    enableBiddingControls();
  } else {
    disableBiddingControls();
  }
  
  // Announce bid to screen reader
  const bidText = data.bid === 'P' ? 'passes' : 
                 data.bid === 'X' ? 'doubles' : 
                 data.bid === 'XX' ? 'redoubles' : `bids ${data.bid}`;
  announceToScreenReader(`${getPositionName(data.position)} ${bidText}.`);
}

// Handle bidding complete event
function handleBiddingComplete(data) {
  // Update game state with contract info
  clientState.gameState.contract = data.contract;
  clientState.gameState.declarer = data.declarer;
  clientState.gameState.dummy = data.dummy;
  clientState.gameState.trumpSuit = data.trumpSuit;
  clientState.gameState.currentPlayer = data.currentPlayer;
  clientState.gameState.gamePhase = 'play';
  
  // Update bidding state
  if (clientState.biddingState) {
    clientState.biddingState.biddingComplete = true;
  }
  
  // Update UI for play phase
  hideBiddingUI();
  renderPlayUI();
  
  // Announce contract to screen reader
  const contractMessage = `Final contract: ${formatContract(data.contract)} by ${getPositionName(data.declarer)}. ${getPositionName(data.currentPlayer)} leads.`;
  announceToScreenReader(contractMessage);
}

// Handle play phase cards event
function handlePlayPhaseCards(data) {
  // Update known cards
  if (!clientState.gameState.hands) {
    clientState.gameState.hands = {};
  }
  
  clientState.gameState.hands[data.position] = data.cards;
  
  // If dummy cards are provided, store them
  if (data.dummyCards) {
    clientState.gameState.hands[clientState.gameState.dummy] = data.dummyCards;
  }
  
  // Update UI to show cards
  renderHand(data.position, data.cards);
  
  if (data.dummyCards) {
    renderHand(clientState.gameState.dummy, data.dummyCards);
    announceToScreenReader(`Dummy's cards are now visible.`);
  }
}

// Handle card played event
function handleCardPlayed(data) {
  // Update game state
  if (!clientState.gameState.currentTrick) {
    clientState.gameState.currentTrick = [];
  }
  
  clientState.gameState.currentTrick = data.currentTrick;
  
  // Remove card from player's hand in UI
  if (clientState.gameState.hands[data.position]) {
    const cards = clientState.gameState.hands[data.position][data.suit];
    if (cards) {
      const index = cards.indexOf(data.card);
      if (index > -1) {
        cards.splice(index, 1);
      }
    }
  }
  
  // Update UI
  renderPlayedCard(data.position, data.suit, data.card);
  renderHand(data.position, clientState.gameState.hands[data.position]);
  
  // Announce card play
  announceToScreenReader(`${getPositionName(data.position)} played ${getSuitName(data.suit)} ${data.card}`, true);
}

// Handle next player event
function handleNextPlayer(data) {
  // Update current player
  clientState.gameState.currentPlayer = data.currentPlayer;
  
  // Update UI to highlight current player
  updateCurrentPlayer(data.currentPlayer);
  
  // If it's your turn or you control dummy, enable card playing
  const isYourTurn = data.currentPlayer === clientState.myPosition;
  const isDummy = data.currentPlayer === clientState.gameState.dummy;
  const youAreController = clientState.myPosition === clientState.gameState.declarer && isDummy;
  
  if (isYourTurn || youAreController) {
    enableCardPlaying();
  } else {
    disableCardPlaying();
  }
}

// Handle trick complete event
function handleTrickComplete(data) {
  // Update game state
  clientState.gameState.currentTrick = [];
  clientState.gameState.tricks = data.tricks;
  clientState.gameState.currentPlayer = data.nextPlayer;
  
  // Update UI
  renderCenterArea();
  
  // Announce winner
  announceToScreenReader(`${getPositionName(data.winner)} won the trick!`);
  
  // Update current player
  updateCurrentPlayer(data.nextPlayer);
  
  // If it's your turn, enable card playing
  const isYourTurn = data.nextPlayer === clientState.myPosition;
  const isDummy = data.nextPlayer === clientState.gameState.dummy;
  const youAreController = clientState.myPosition === clientState.gameState.declarer && isDummy;
  
  if (isYourTurn || youAreController) {
    enableCardPlaying();
  } else {
    disableCardPlaying();
  }
}

// Handle game over event
function handleGameOver(data) {
  // Update game state
  clientState.gameState.gamePhase = 'end';
  clientState.gameState.tricks = data.tricks;
  
  // Update UI
  renderGameOver(data.message);
  
  // Announce result
  announceToScreenReader(data.message);
}

// Handle chat message event
function handleChatMessage(data) {
  if (elements.chatMessages) {
    addChatMessage(data.sender, data.position, data.message);
  }
}

// Handle player replaced event
function handlePlayerReplaced(data) {
  // Update player data
  clientState.gameState.players = data.table.players;
  
  // Update UI
  updatePlayersDisplay();
  
  // Add chat message
  addChatSystemMessage(`Player at ${data.position} was replaced by GIB.`);
}

// Handle table removed event
function handleTableRemoved(data) {
  // Redirect to home page
  window.location.href = '/';
  
  // Show message
  alert(data.message);
}

/**
 * UI update helpers
 */

// Add chat message to display
function addChatMessage(sender, position, message) {
  if (!elements.chatMessages) return;
  
  const messageElement = document.createElement('div');
  messageElement.className = 'chat-message';
  
  const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  
  messageElement.innerHTML = `
    <span class="chat-sender">${sender} (${position}):</span>
    <span class="chat-time">[${timestamp}]</span>
    <div class="chat-text">${message}</div>
  `;
  
  elements.chatMessages.appendChild(messageElement);
  
  // Scroll to bottom
  elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
}

// Add system message to chat
function addChatSystemMessage(message) {
  if (!elements.chatMessages) return;
  
  const messageElement = document.createElement('div');
  messageElement.className = 'chat-message system-message';
  
  const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  
  messageElement.innerHTML = `
    <span class="chat-time">[${timestamp}]</span>
    <div class="chat-text">${message}</div>
  `;
  
  elements.chatMessages.appendChild(messageElement);
  
  // Scroll to bottom
  elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
}

// Update waiting room positions display
function updateWaitingRoomPositions(table) {
  if (!elements.waitingPositions) return;
  
  const positions = ['north', 'east', 'south', 'west'];
  
  for (const pos of positions) {
    const element = elements.waitingPositions[pos];
    if (!element) continue;
    
    const player = table.players[pos];
    
    if (player) {
      element.classList.add('occupied');
      
      // Check if this is the current player
      if (player.id === socket.id) {
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
  }
  
  // Enable/disable start button based on player count
  if (elements.startGameButton) {
    const playerCount = Object.values(table.players).filter(p => p !== null).length;
    elements.startGameButton.disabled = playerCount === 0;
  }
}

// Helper functions for position names and formatting
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

function formatContract(contract) {
  if (!contract) return "No contract";
  
  const level = contract.charAt(0);
  const suit = contract.charAt(1);
  let suitSymbol;
  
  switch(suit) {
    case 'C': suitSymbol = '♣'; break;
    case 'D': suitSymbol = '♦'; break;
    case 'H': suitSymbol = '♥'; break;
    case 'S': suitSymbol = '♠'; break;
    case 'N': suitSymbol = 'NT'; break;
    default: suitSymbol = suit;
  }
  
  let result = `${level}${suitSymbol}`;
  
  // Add doubled/redoubled if applicable
  if (contract.includes('XX')) {
    result += ' XX';
  } else if (contract.includes('X')) {
    result += ' X';
  }
  
  return result;
}

// The rest of the UI update functions like renderHand, renderBiddingHistory,
// updateGameUI, etc. would use the original UI.js implementations with slight
// modifications to work with the new clientState instead of direct gameState

/**
 * Initialize solo game
 * Creates a special solo table with GIB players
 */
function initializeSoloGame() {
  console.log('Initializing solo game...');
  
  // Get player name from localStorage or use default
  const playerName = localStorage.getItem('bridgePlayerName') || 'Player';
  clientState.playerName = playerName;
  clientState.myPosition = 'south'; // In solo mode, player is always south
  
  // Set up socket listeners for solo mode
  socketHandler.setupGameListeners({
    onYourCards: handleYourCards,
    onBidMade: handleBidMade,
    onBiddingComplete: handleBiddingComplete,
    onPlayPhaseCards: handlePlayPhaseCards,
    onCardPlayed: handleCardPlayed,
    onNextPlayer: handleNextPlayer,
    onTrickComplete: handleTrickComplete,
    onGameOver: handleGameOver
  });
  
  // Create a solo game - this will be a special request to the server
  socket.emit('createSoloGame', {
    playerName: playerName
  });
  
  console.log('Solo game initialization request sent');
}

/**
 * Deal a new solo game
 * Resets the current game and deals new cards
 */
function dealNewSoloGame() {
  // Check if we're in a solo game
  if (!window.isSoloMode) {
    console.error('dealNewSoloGame called but not in solo mode');
    return;
  }
  
  // If we have a table code, send a reset request
  if (clientState.tableCode) {
    socket.emit('resetSoloGame', {
      tableCode: clientState.tableCode
    });
  } else {
    // Otherwise create a new solo game
    initializeSoloGame();
  }
}

// Update UI function for solo mode
function updateGameUI() {
  if (window.isSoloMode) {
    // Update player controls to show all players as GIB except south
    if (elements.playerControls) {
      let html = '';
      
      const positions = ['north', 'east', 'south', 'west'];
      positions.forEach(pos => {
        const isCurrentPlayer = clientState.gameState && clientState.gameState.currentPlayer === pos;
        const playerName = pos === 'south' ? clientState.playerName : `GIB (${pos})`;
        const playerType = pos === 'south' ? 'human' : 'gib';
        
        html += `
          <div class="player-badge ${isCurrentPlayer ? 'current' : ''}">
            <div>${getPositionName(pos)}</div>
            <div>${playerName}</div>
            <div>${playerType}</div>
          </div>
        `;
      });
      
      elements.playerControls.innerHTML = html;
    }
    
    // Update status bar
    if (elements.statusBar) {
      if (clientState.gameState) {
        if (clientState.gameState.gamePhase === 'bidding') {
          elements.statusBar.textContent = 'Bidding phase';
        } else if (clientState.gameState.gamePhase === 'play') {
          elements.statusBar.textContent = `Playing: ${formatContract(clientState.gameState.contract)}`;
        } else {
          elements.statusBar.textContent = 'Solo game with GIB';
        }
      } else {
        elements.statusBar.textContent = 'Solo game with GIB';
      }
    }
  }
}