/**
 * BridgeCircle - Shared JavaScript Functions
 * Contains all shared functionality for the bridge application
 */

// Socket.io connection
let socket = null;
let socketEventListenersSetup = false;

// Common functions and helper methods

/**
 * Connect to Socket.io server
 */

function connectToServer() {
    // Jos socket on jo olemassa ja yhdistetty, palauta se
    if (socket && socket.connected && !socket.disconnected) {
        console.log('Socket already connected, reusing existing connection');
        return socket;
    }
    
    // Jos socket on olemassa mutta ei yhdistetty, puhdista se
    if (socket) {
        console.log('Cleaning up existing socket...');
        cleanupSocket();
    }
    
    console.log('Creating new socket connection...');
    
    // Luo uusi socket-yhteys
    socket = io({
        transports: ['websocket', 'polling'],
        timeout: 10000,
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionAttempts: 5,
        maxReconnectionAttempts: 5
    });
    
    // Aseta event listenerit vain kerran
    if (!socketEventListenersSetup) {
        setupBasicSocketListeners();
        socketEventListenersSetup = true;
    }
    
    return socket;
}

/**
 * Puhdista socket ja sen event listenerit
 */
function cleanupSocket() {
    if (socket) {
        socket.removeAllListeners();
        if (socket.connected) {
            socket.disconnect();
        }
        socket = null;
        socketEventListenersSetup = false;
    }
}

/**
 * Aseta perus socket event listenerit (vain kerran)
 */
function setupBasicSocketListeners() {
    if (!socket) return;
    
socket.on('connect', () => {
    console.log('Socket.IO connected successfully, ID:', socket.id);
    updateConnectionStatus('connected');
});
    
socket.on('connect_error', (error) => {
    console.error('Socket.IO connection error:', error);
    updateConnectionStatus('connecting');
    
    if (error.message && error.message.includes('websocket')) {
        console.log('Switching to polling transport...');
        socket.io.opts.transports = ['polling'];
    }
    
    if (!error.message || !error.message.includes('websocket')) {
        showError('Failed to connect to server. Please try again later.');
    }
});

    socket.on('disconnect', (reason) => {
        console.log('Disconnected from server, reason:', reason);
        updateConnectionStatus('disconnected');
        
        // Automaattinen reconnect tietyissä tilanteissa
        if (reason === 'io server disconnect') {
            console.log('Server disconnected, attempting manual reconnect...');
            setTimeout(() => {
                if (socket && !socket.connected) {
                    socket.connect();
                }
            }, 1000);
        }
    });
    
    socket.on('reconnect', (attemptNumber) => {
        console.log('Reconnected after', attemptNumber, 'attempts');
        updateConnectionStatus('connected');
    });
    
    socket.on('reconnecting', (attemptNumber) => {
        console.log('Reconnecting, attempt:', attemptNumber);
        updateConnectionStatus('connecting');
    });
    
    socket.on('error', (data) => {
        console.error('Socket error:', data);
        const message = data && data.message ? data.message : 'Socket error occurred';
        showError(message);
    });
    
    // Table creation event
    socket.on('tableCreated', (data) => {
        console.log('Table created:', data);
        if (data && data.tableCode) {
            // Siirrä waitingroom:iin
            window.location.href = `/waitingroom.html?code=${data.tableCode}`;
        }
    });
}

/**
 * Päivitä connection status UI:ssä
 */
function updateConnectionStatus(status) {
    const statusElement = document.querySelector('.connection-status') || 
                         document.getElementById('connection-status');
    
    if (statusElement) {
        statusElement.className = `connection-status status-${status}`;
        statusElement.textContent = status === 'connected' ? 'Connected' : 
                                   status === 'disconnected' ? 'Disconnected' : 
                                   status === 'connecting' ? 'Connecting...' :
                                   'Unknown';
    }
    
    // Päivitä myös mahdollinen status bar
    const statusBar = document.getElementById('connection-status-bar');
    if (statusBar) {
        statusBar.className = `connection-status-bar ${status}`;
        statusBar.setAttribute('aria-label', `Connection status: ${status}`);
    }
}

/**
 * Get active tables
 */
function getTables() {
    if (!socket || !socket.connected) {
        console.warn('No socket connection available for getTables');
        return;
    }
    
    socket.emit('getActiveTables');
    
    // Käytä once() välttääksesi kumulatiivisia listenereitä
    socket.once('activeTablesList', (data) => {
        if (!data || !data.tables) {
            console.warn('Invalid tables data received:', data);
            return;
        }
        
        // Update table count in UI
        const tablesCountElement = document.getElementById('tables-count');
        if (tablesCountElement) {
            tablesCountElement.textContent = data.tables.length;
        }
        
        // Update player count if possible
        const playersCountElement = document.getElementById('players-count');
        if (playersCountElement) {
            let playerCount = 0;
            for (const table of data.tables) {
                playerCount += table.players || 0;
            }
            playersCountElement.textContent = playerCount;
        }
    });
}

/**
 * Show error message to user
 * @param {string} message - Error message to display
 * @param {number} duration - Duration to show error in milliseconds
 */
function showError(message, duration = 5000) {
    console.error('Error:', message);
    
    // Get or create error element if it doesn't exist
    let errorArea = document.getElementById('error-area');
    if (!errorArea) {
        errorArea = document.createElement('div');
        errorArea.id = 'error-area';
        errorArea.className = 'error-message';
        errorArea.style.cssText = 'padding: 10px; margin: 10px 0; background: #ffebee; color: #c62828; border: 1px solid #ef5350; border-radius: 4px;';
        
        // Insert at top of container or body
        const container = document.querySelector('.container') || document.body;
        container.insertBefore(errorArea, container.firstChild);
    }
    
    errorArea.textContent = message;
    errorArea.style.display = 'block';
    
    // Auto-hide after duration
    setTimeout(() => {
        if (errorArea) {
            errorArea.style.display = 'none';
        }
    }, duration);
}

/**
 * Announce message to screen reader
 * @param {string} message - Message to announce
 * @param {boolean} urgent - Whether announcement is urgent (use assertive role)
 */
function announce(message, urgent = false) {
    // Find appropriate announcement area
    const announcementArea = urgent ? 
        document.getElementById('card-announcement') : 
        document.getElementById('announcement-area');
    
    if (announcementArea) {
        // Display message and save it for possible replay
        announcementArea._lastMessage = message;
        
        // Clear first then add to ensure screen reader reads it
        announcementArea.textContent = '';
        setTimeout(() => {
            announcementArea.textContent = message;
        }, 50);
    }
}

/**
 * Repeat last screen reader announcement
 */
function repeatLastAnnouncement() {
    const announcementArea = document.getElementById('announcement-area');
    if (announcementArea && announcementArea._lastMessage) {
        // Clear and refill to make screen reader read again
        announcementArea.textContent = '';
        setTimeout(() => {
            announcementArea.textContent = announcementArea._lastMessage;
        }, 50);
    }
}

/**
 * Read hand cards to screen reader
 */
function readCards() {
    if (!window.gameState || !window.gameState.hands || !window.myPosition) return;
    
    const hand = window.gameState.hands[window.myPosition];
    if (!hand) return;
    
    let cardList = [];
    
    // Create list of cards by suit
    for (const [suit, cards] of Object.entries(hand)) {
        if (cards.length > 0) {
            cardList.push(`${suitName(suit)}: ${cards.join(', ')}`);
        }
    }
    
    // Announce hand content
    const cardText = `Your cards: ${cardList.join('. ')}`;
    announce(cardText);
}

/**
 * Click button at given selector and index
 * @param {string} selector - CSS selector for buttons
 * @param {number} index - Index of button to click
 */
function clickButton(selector, index) {
    const buttons = document.querySelectorAll(selector);
    if (buttons.length > index) {
        buttons[index].click();
        setTimeout(() => buttons[index].focus(), 100);
    }
}

/**
 * Format suit name
 * @param {string} suit - Suit identifier (spades, hearts, diamonds, clubs)
 * @return {string} Suit name
 */
function suitName(suit) {
    const names = {
        spades: 'spades',
        hearts: 'hearts',
        diamonds: 'diamonds',
        clubs: 'clubs'
    };
    return names[suit] || suit;
}

/**
 * Format suit symbol
 * @param {string} suit - Suit identifier (spades, hearts, diamonds, clubs)
 * @return {string} Unicode suit symbol
 */
function suitSymbol(suit) {
    const symbols = { 
        spades: '♠', 
        hearts: '♥', 
        diamonds: '♦', 
        clubs: '♣' 
    };
    return symbols[suit] || suit;
}

/**
 * Format position name
 * @param {string} position - Position identifier (north, east, south, west)
 * @return {string} Position name
 */
function positionName(position) {
    switch(position) {
        case 'north': return 'North';
        case 'east': return 'East';
        case 'south': return 'South';
        case 'west': return 'West';
        default: return position;
    }
}

/**
 * Format bid for display
 * @param {string} bid - Bid identifier (1C, 1H, P, X, XX, etc.)
 * @return {string} Formatted bid for display
 */
function formatBid(bid) {
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
 * Format contract for display
 * @param {string} contract - Contract identifier (1C, 1HX, 3NXX, etc.)
 * @return {string} Formatted contract for display
 */
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
    
    // Add doubling info
    if (contract.includes('XX')) {
        result += ' XX';
    } else if (contract.includes('X')) {
        result += ' X';
    }
    
    return result;
}

// AJAX helper functions

/**
 * Fetch data from server
 * @param {string} url - URL to fetch
 * @param {Object} params - GET parameters
 * @return {Promise<Object>} Promise resolving to data
 */
async function fetchData(url, params = {}) {
    const queryParams = new URLSearchParams(params).toString();
    const fullUrl = queryParams ? `${url}?${queryParams}` : url;
    
    try {
        const response = await fetch(fullUrl);
        
        if (!response.ok) {
            throw new Error(`Server responded with error: ${response.status}`);
        }
        
        return await response.json();
    } catch (error) {
        console.error('Error fetching data:', error);
        throw error;
    }
}

/**
 * Send data to server
 * @param {string} url - URL to send to
 * @param {Object} data - Data to send
 * @param {string} method - HTTP method (POST, PUT, etc.)
 * @return {Promise<Object>} Promise resolving to data
 */
async function sendData(url, data, method = 'POST') {
    try {
        const response = await fetch(url, {
            method,
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(data),
        });
        
        if (!response.ok) {
            throw new Error(`Server responded with error: ${response.status}`);
        }
        
        return await response.json();
    } catch (error) {
        console.error('Error sending data:', error);
        throw error;
    }
}

/**
 * Create new table - FIXED VERSION
 */
function createTable() {
    const nameInput = document.getElementById('name-input');
    const tableNameInput = document.getElementById('table-name-input');

    const playerName = nameInput ? nameInput.value.trim() : '';
    const tableName = tableNameInput ? tableNameInput.value.trim() : '';
    const position = window.selectedPosition || 'south';

    if (!playerName) {
        showError('Please enter your name.');
        // Jos on showErrorWithAnnouncement funktio, käytä sitä
        if (typeof showErrorWithAnnouncement === 'function') {
            showErrorWithAnnouncement('Please enter your name.');
        }
        return;
    }

    // Yhdistetään palvelimeen
    connectToServer();

    if (!socket) {
        showError('Failed to connect to server. Please try again.');
        return;
    }

    // Tallennetaan tiedot localStorageen seuraavaa sivua varten
    localStorage.setItem('playerName', playerName);
    localStorage.setItem('position', position);

    // Näytetään tilaviestinä että pöytää ollaan luomassa
    const statusElement = document.getElementById('creation-status');
    if (statusElement) {
        statusElement.style.display = 'block';
        statusElement.textContent = 'Creating table...';
    }

    // Määritä yksittäiskäyttöiset event handlerit
    const handleTableCreated = (data) => {
        console.log('Table created successfully:', data);
        if (statusElement) {
            statusElement.textContent = 'Table created! Redirecting...';
        }
        
        if (data && data.tableCode) {
            window.location.href = `waitingroom.html?code=${data.tableCode}`;
        } else {
            showError('Invalid response from server.');
        }
        
        // Cleanup
        socket.off('error', handleError);
    };

    const handleError = (data) => {
        console.error('Error creating table:', data);
        const message = data && data.message ? data.message : 'Unknown error occurred';
        showError('Error creating table: ' + message);
        
        if (statusElement) {
            statusElement.style.display = 'none';
        }
        
        // Cleanup
        socket.off('tableCreated', handleTableCreated);
    };

    // Aseta event handlerit
    socket.once('tableCreated', handleTableCreated);
    socket.once('error', handleError);

    // Lähetä pöydän luontipyyntö palvelimelle
    try {
        socket.emit('createTable', {
            playerName: playerName,
            position: position,
            tableName: tableName || null
        });
    } catch (error) {
        console.error('Error sending createTable:', error);
        showError('Failed to send request to server.');
        
        // Cleanup handlerit jos lähetys epäonnistuu
        socket.off('tableCreated', handleTableCreated);
        socket.off('error', handleError);
        
        if (statusElement) {
            statusElement.style.display = 'none';
        }
    }
}

// Cleanup function for page unload
window.addEventListener('beforeunload', () => {
    if (socket) {
        cleanupSocket();
    }
});