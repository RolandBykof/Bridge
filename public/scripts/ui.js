/**
 * BridgeCircle - UI Module - Modified for Client-Server Architecture
 * Handles UI rendering and user input processing
 */

// Default to non-multiplayer mode until client-bridge overrides
window.isMultiplayerMode = false;

// DOM references - keep the existing DOM references for UI functions
const elements = {
  statusBar: document.getElementById('status-bar'),
  statusAnnouncer: document.getElementById('status-announcer'),
  cardAnnouncer: document.getElementById('card-announcer'),
  cardFocusTarget: document.getElementById('card-focus-target'),
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
  fullscreenButton: document.getElementById('fullscreen-button'),
  biddingArea: document.getElementById('bidding-area'),
  biddingHistory: document.getElementById('bidding-history'),
  biddingControls: document.getElementById('bidding-controls')
};

// UI state - keep the existing UI state
const uiState = {
  showHelp: false,
  lastAnnouncement: '',
  bidLevel: null, // For bidding shortcuts
};

// Keyboard shortcuts - keep the existing keyboard shortcuts
const keyboardShortcuts = [
  // ... original keyboard shortcuts here
];

// Bidding level keys and suit keys - keep existing
const bidLevelKeys = ['1', '2', '3', '4', '5', '6', '7'];
const bidSuitKeys = {
  's': 'S', // Spades
  'h': 'H', // Hearts
  'd': 'D', // Diamonds
  'c': 'C', // Clubs
  'n': 'N'  // No Trump
};

/**
 * Renders the hand
 * @param {string} position - The position (north, east, south, west)
 * @param {object} hand - The hand with cards organized by suit
 * @param {boolean} isPlayable - Whether cards are playable
 */
function renderHand(position, hand, isPlayable = false) {
  // Get the element for this hand
  const element = position === 'north' ? elements.northHand :
                  position === 'south' ? elements.southHand :
                  position === 'east' ? elements.eastHand :
                  elements.westHand;
  
  if (!element || !hand) return;
  
  const gameState = window.isMultiplayerMode ? clientState.gameState : gameState;
  const isCurrentPlayer = gameState.currentPlayer === position;
  const isNSTeamWon = gameState.declarer === 'south' || gameState.declarer === 'north';
  
  // Check if this is a hand played by a human
  const isPlayableByHuman = position === 'south' || 
                         (position === 'north' && isNSTeamWon && 
                          gameState.players && gameState.players[position].type === 'human');
  
  let html = `<h3>${position === 'south' ? 'Your Hand (South)' : getPositionName(position)} 
              ${gameState.players && gameState.players[position].type === 'gib' ? '(GIB)' : ''}</h3>`;
  
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
  
  // Add listeners for playable cards in multiplayer mode
  if (gameState.gamePhase === 'play' && isPlayableByHuman) {
    element.querySelectorAll('.card-button').forEach(button => {
      button.addEventListener('click', (e) => {
        const suit = e.target.dataset.suit;
        const card = e.target.dataset.card;
        
        if (window.isMultiplayerMode) {
          // In multiplayer, send to server
          socket.emit('playCard', {
            tableCode: clientState.tableCode,
            position: position,
            suit: suit,
            card: card
          });
        } else {
          // In solo mode, use original playCard
          playCard(suit, card);
        }
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
  
  const state = window.isMultiplayerMode ? clientState : {};
  const bidState = window.isMultiplayerMode ? state.biddingState : biddingState;
  
  // Render bidding controls if it's the user's turn (our position in multiplayer or south in solo)
  if ((window.isMultiplayerMode && bidState.currentBidder === state.myPosition) || 
      (!window.isMultiplayerMode && bidState.currentBidder === 'south')) {
    renderBiddingControls();
  } else {
    // Hide controls if it's not the user's turn
    if (elements.biddingControls) {
      elements.biddingControls.innerHTML = `
        <h3>Your Bid</h3>
        <p>Waiting for ${getPositionName(bidState.currentBidder)} to bid...</p>
      `;
    }
  }
}

/**
 * Render bidding history
 */
function renderBiddingHistory() {
  if (!elements.biddingHistory) return;
  
  const bidState = window.isMultiplayerMode ? clientState.biddingState : biddingState;
  if (!bidState) return;
  
  let html = '<h3>Bidding History</h3>';
  
  if (!bidState.bidHistory || bidState.bidHistory.length === 0) {
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
    let dealer = bidState.dealer;
    
    // Add empty cells for positions before the dealer
    const positions = ['west', 'north', 'east', 'south'];
    const dealerIndex = positions.indexOf(dealer);
    
    for (let i = 0; i < dealerIndex; i++) {
      currentRound.push(null);
    }
    
    // Add all bids to rounds
    for (const bid of bidState.bidHistory) {
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
 * Render bidding controls for the user
 */
function renderBiddingControls() {
  if (!elements.biddingControls) return;
  
  // Get proper state depending on mode
  const bidState = window.isMultiplayerMode ? clientState.biddingState : biddingState;
  if (!bidState) return;
  
  // Get possible bids
  const possibleBids = getPossibleBids(bidState.highestBid);
  
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
  const bidSystems = window.isMultiplayerMode ? {} : biddingSystems;
  html += '<div class="bid-meanings">';
  html += `<p><strong>System:</strong> ${bidSystems[bidState.selectedSystem]?.name || 'Natural'}</p>`;
  html += '</div>';
  
  elements.biddingControls.innerHTML = html;
  
  // Add event listeners to bid buttons
  document.querySelectorAll('.bid-button').forEach(button => {
    button.addEventListener('click', (e) => {
      const bid = e.target.dataset.bid;
      
      if (window.isMultiplayerMode) {
        // In multiplayer, send bid to server
        socket.emit('makeBid', {
          tableCode: clientState.tableCode,
          position: clientState.myPosition,
          bid: bid
        });
      } else {
        // In solo mode, use original makeBid
        makeBid('south', bid);
      }
    });
    
    // Show bid meaning on hover - if in solo mode
    if (!window.isMultiplayerMode) {
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
    }
  });
}

// The rest of the UI.js file stays mostly the same, with modifications to:
// 1. Check if in multiplayer mode and use clientState instead of gameState/biddingState
// 2. Send actions to server in multiplayer mode instead of calling local functions

/**
 * Announce message to screen reader
 * @param {string} message - The message to announce
 * @param {boolean} isCardPlay - Whether this is a card play announcement
 */
function announceToScreenReader(message, isCardPlay = false) {
  uiState.lastAnnouncement = message; // Store for repetition
  
  if (isCardPlay) {
    // Use card announcer for card plays
    elements.cardAnnouncer.textContent = '';
    setTimeout(() => {
      elements.cardAnnouncer.textContent = message;
    }, 50);
  } else {
    // Use regular announcer for other announcements
    elements.statusAnnouncer.textContent = '';
    setTimeout(() => {
      elements.statusAnnouncer.textContent = message;
    }, 50);
  }
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
 * Get suit symbol
 */
function getSuitSymbol(suit) {
  const symbols = { 
    spades: '♠', 
    hearts: '♥', 
    diamonds: '♦', 
    clubs: '♣' 
  };
  return symbols[suit] || suit;
}

// Export the rendering functions for use in multiplayer mode
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    renderHand,
    renderBiddingUI,
    renderBiddingHistory,
    renderBiddingControls,
    announceToScreenReader
  };
}