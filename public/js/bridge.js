/**
 * BridgeCircle - Shared JavaScript Functions
 * Contains all shared functionality for the bridge application
 */

// Socket.io connection
let socket = null;

// Common functions and helper methods

/**
 * Connect to Socket.io server
 */
function connectToServer() {
    if (socket) {
        // If connection already exists, do nothing
        return socket;
    }
    
    socket = io({
        transports: ['websocket', 'polling'],
        timeout: 10000
    });
    
    // Basic listeners
    socket.on('connect', () => {
        console.log('Socket.IO connected successfully, ID:', socket.id);
        announce("Connected to server.");
    });
    
    socket.on('connect_error', (error) => {
        console.error('Socket.IO connection error:', error);
        showError('Failed to connect to server. Please try again later.');
    });
    
    socket.on('disconnect', () => {
        console.log('Connection to server lost.');
        announce("Connection to server lost.");
    });
    
    socket.on('error', (data) => {
        showError(data.message);
    });
    
    // Table events
    socket.on('tableCreated', (data) => {
        window.location.href = `/waitingroom.html?code=${data.tableCode}`;
    });
    
    // Get active tables if we're on home page
    if (window.location.pathname === '/' || window.location.pathname === '/index.html') {
        getTables();
    }
    
    return socket;
}

/**
 * Get active tables
 */
function getTables() {
    if (!socket) return;
    
    socket.emit('getActiveTables');
    
    socket.on('activeTablesList', (data) => {
        // Update table count in UI
        if (document.getElementById('tables-count')) {
            document.getElementById('tables-count').textContent = data.tables.length;
        }
        
        // Update player count if possible
        if (document.getElementById('players-count')) {
            let playerCount = 0;
            for (const table of data.tables) {
                playerCount += table.players;
            }
            document.getElementById('players-count').textContent = playerCount;
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
        document.body.insertBefore(errorArea, document.body.firstChild);
    }
    
    errorArea.textContent = message;
    errorArea.style.display = 'block';
    
    // Hide after duration
    setTimeout(() => {
        errorArea.style.display = 'none';
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