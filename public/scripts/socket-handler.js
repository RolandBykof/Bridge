// Käsittelee kaikki socket.io-yhteydet asiakaspuolella

let socket;
const socketHandler = {
  // Yhteyden alustus
  initialize() {
    socket = io({
      transports: ['websocket', 'polling'],
      timeout: 10000
    });
    
    this.setupListeners();
    
    return socket;
  },
  
  // Peruslistenerit
  setupListeners() {
    socket.on('connect', () => {
      console.log('Socket.IO connected successfully with ID:', socket.id);
      
      // Hae aktiiviset pöydät kun yhteys on muodostettu
      socket.emit('getActiveTables');
    });
    
    socket.on('connect_error', (error) => {
      console.error('Socket.IO connection error:', error);
      this.showError('Unable to connect to game server. Please try again later.');
    });
    
    // Peruskuuntelijat virheilmoituksille ja chateille
    socket.on('error', ({ message }) => {
      this.showError(message);
    });
    
    // Muut kuuntelijat asetetaan vasta kun ne tarvitaan pelitiloissa
  },
  
  // Lobby-kuuntelijat
  setupLobbyListeners(callbacks) {
    socket.on('activeTablesList', callbacks.onActiveTablesList);
    socket.on('tableCreated', callbacks.onTableCreated);
    socket.on('selectPosition', callbacks.onSelectPosition);
    socket.on('playerJoined', callbacks.onPlayerJoined);
  },
  
  // Waiting-room kuuntelijat
  setupWaitingRoomListeners(callbacks) {
    socket.on('tableInfo', callbacks.onTableInfo);
    socket.on('playerJoined', callbacks.onPlayerJoined);
    socket.on('playerLeft', callbacks.onPlayerLeft);
    socket.on('gameStarted', callbacks.onGameStarted);
    socket.on('chatMessage', callbacks.onChatMessage);
    socket.on('tableRemoved', callbacks.onTableRemoved);
  },
  
  // Peli-kuuntelijat
  setupGameListeners(callbacks) {
    socket.on('yourCards', callbacks.onYourCards);
    socket.on('bidMade', callbacks.onBidMade);
    socket.on('biddingComplete', callbacks.onBiddingComplete);
    socket.on('playPhaseCards', callbacks.onPlayPhaseCards);
    socket.on('cardPlayed', callbacks.onCardPlayed);
    socket.on('nextPlayer', callbacks.onNextPlayer);
    socket.on('trickComplete', callbacks.onTrickComplete);
    socket.on('gameOver', callbacks.onGameOver);
    socket.on('chatMessage', callbacks.onChatMessage);
    socket.on('playerReplaced', callbacks.onPlayerReplaced);
  },
  
  // Poista kuuntelijat
  removeListeners(events) {
    for (const event of events) {
      socket.off(event);
    }
  },
  
  // Käyttöliittymäviestit
  showError(message) {
    // Tämä toteutetaan client-bridge.js:ssä
    if (typeof showUIError === 'function') {
      showUIError(message);
    } else {
      console.error('Error:', message);
      alert(message);
    }
  }
};