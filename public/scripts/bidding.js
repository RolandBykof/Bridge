/**
 * BridgeCircle - Bidding Module
 * Handles bidding logic and bidding state
 */

// Bidding systems
const biddingSystems = {
    natural: {
        name: "Natural Bidding",
        description: "Simple natural bidding system for beginners",
        // Basic bid meanings for natural system
        meanings: {
            "1C": "12-21 HCP, 3+ clubs",
            "1D": "12-21 HCP, 3+ diamonds",
            "1H": "12-21 HCP, 5+ hearts",
            "1S": "12-21 HCP, 5+ spades",
            "1N": "15-17 HCP, balanced distribution",
            "2C": "22+ HCP or 8.5+ playing tricks",
            "2D": "5-11 HCP, 6+ diamonds",
            "2H": "5-11 HCP, 6+ hearts",
            "2S": "5-11 HCP, 6+ spades",
            "2N": "20-21 HCP, balanced distribution",
            "3C": "Preemptive, 7+ clubs",
            "3D": "Preemptive, 7+ diamonds",
            "3H": "Preemptive, 7+ hearts",
            "3S": "Preemptive, 7+ spades",
            "3N": "Gambling 3NT, solid minor suit",
            "P": "Less than 6 HCP or no suitable bid"
        }
    },
    sayc: {
        name: "Standard American Yellow Card",
        description: "Common bidding system in North America",
        // Would include detailed SAYC system meanings here
    }
};

// Bidding state
const biddingState = {
    currentBidder: null,        // Who is currently bidding
    bidHistory: [],             // History of bids
    currentBiddingRound: 1,     // Current bidding round
    consecutivePasses: 0,       // Count of consecutive passes
    biddingComplete: false,     // Whether bidding is complete
    highestBid: null,           // Current highest bid
    contract: null,             // Final contract
    declarer: null,             // Declarer
    dummy: null,                // Dummy
    trumpSuit: null,            // Trump suit
    selectedSystem: 'natural',  // Default bidding system
    dealer: 'south'             // Default dealer
};

// Valid suit order (lowest to highest)
const suitOrder = ['C', 'D', 'H', 'S', 'N'];

// Valid level values
const validLevels = ['1', '2', '3', '4', '5', '6', '7'];

// Special bids
const specialBids = ['P', 'X', 'XX'];

/**
 * Initialize bidding phase
 */
function initializeBidding(dealer = 'south') {
    // Reset bidding state
    biddingState.currentBidder = dealer;
    biddingState.bidHistory = [];
    biddingState.currentBiddingRound = 1;
    biddingState.consecutivePasses = 0;
    biddingState.biddingComplete = false;
    biddingState.highestBid = null;
    biddingState.contract = null;
    biddingState.declarer = null;
    biddingState.dummy = null;
    biddingState.trumpSuit = null;
    biddingState.dealer = dealer;
    
    updateStatus(`Bidding starts. ${getPositionName(dealer)} to bid first.`);
    
    // If current bidder is GIB, get GIB bid
    if (gameState.players[biddingState.currentBidder].type === 'gib') {
        setTimeout(() => {
            getGIBBid(biddingState.currentBidder);
        }, 1000);
    } else {
        announceToScreenReader(`${getPositionName(biddingState.currentBidder)} to bid`);
    }
    
    // Update UI
    renderBiddingUI();
}

/**
 * Make a bid
 */
function makeBid(player, bid) {
    // Check if it's player's turn
    if (player !== biddingState.currentBidder) {
        console.error(`Not ${player}'s turn to bid`);
        return false;
    }
    
    // Check if bid is valid
    if (!isValidBid(bid, biddingState.highestBid)) {
        console.error(`Invalid bid: ${bid}`);
        return false;
    }
    
    // Process the bid
    const bidInfo = {
        player: player,
        bid: bid,
        round: biddingState.currentBiddingRound
    };
    
    // Add bid to history
    biddingState.bidHistory.push(bidInfo);
    
    // Announce bid to screen reader
    announceBid(player, bid);
    
    // Update consecutive passes count
    if (bid === 'P') {
        biddingState.consecutivePasses++;
    } else {
        biddingState.consecutivePasses = 0;
        
        // Update highest bid if not pass, double, or redouble
        if (!specialBids.includes(bid)) {
            biddingState.highestBid = bid;
        }
    }
    
    // Check if bidding is complete
    if (checkBiddingComplete()) {
        finalizeBidding();
        return true;
    }
    
    // Move to next bidder
    moveToNextBidder();
    
    // If next bidder is GIB, get GIB bid
    if (gameState.players[biddingState.currentBidder].type === 'gib') {
        setTimeout(() => {
            getGIBBid(biddingState.currentBidder);
        }, 1000);
    } else {
        announceToScreenReader(`${getPositionName(biddingState.currentBidder)} to bid`);
    }
    
    // Update UI
    renderBiddingUI();
    
    return true;
}

/**
 * Announce bid to screen reader
 */
function announceBid(player, bid) {
    let announcement;
    
    if (bid === 'P') {
        announcement = `${getPositionName(player)} passes`;
    } else if (bid === 'X') {
        announcement = `${getPositionName(player)} doubles`;
    } else if (bid === 'XX') {
        announcement = `${getPositionName(player)} redoubles`;
    } else {
        const level = bid.charAt(0);
        const suit = bid.charAt(1);
        let suitName;
        
        switch(suit) {
            case 'C': suitName = 'clubs'; break;
            case 'D': suitName = 'diamonds'; break;
            case 'H': suitName = 'hearts'; break;
            case 'S': suitName = 'spades'; break;
            case 'N': suitName = 'no trump'; break;
            default: suitName = suit;
        }
        
        announcement = `${getPositionName(player)} bids ${level} ${suitName}`;
    }
    
    announceToScreenReader(announcement);
}

/**
 * Move to next bidder
 */
function moveToNextBidder() {
    const positions = ['north', 'east', 'south', 'west'];
    const currentIndex = positions.indexOf(biddingState.currentBidder);
    biddingState.currentBidder = positions[(currentIndex + 1) % 4];
}

/**
 * Check if bidding is complete
 */
function checkBiddingComplete() {
    // Bidding ends when there are 3 consecutive passes after a non-pass bid
    // Or when there are 4 passes at the beginning
    const bids = biddingState.bidHistory;
    
    if (bids.length >= 4 && 
        bids[0].bid === 'P' && 
        bids[1].bid === 'P' && 
        bids[2].bid === 'P' && 
        bids[3].bid === 'P') {
        return true;
    }
    
    // Check for 3 passes after a bid
    if (biddingState.consecutivePasses === 3 && bids.length >= 4) {
        return true;
    }
    
    return false;
}

/**
 * Finalize bidding
 */
function finalizeBidding() {
    biddingState.biddingComplete = true;
    
    // If all passed, no contract
    if (biddingState.bidHistory.length === 4 && 
        biddingState.bidHistory.every(bid => bid.bid === 'P')) {
        
        updateStatus("All players passed. Deal again.");
        announceToScreenReader("All players passed. Deal again.");
        
        // Reset game
        gameState.gamePhase = 'setup';
        renderUI();
        return;
    }
    
    // Determine final contract
    determineContract();
    
    // Determine declarer and dummy
    determineDeclarerAndDummy();
    
    // Set trump suit
    if (biddingState.contract.charAt(1) === 'N') {
        biddingState.trumpSuit = null; // No trump
    } else {
        switch(biddingState.contract.charAt(1)) {
            case 'C': biddingState.trumpSuit = 'clubs'; break;
            case 'D': biddingState.trumpSuit = 'diamonds'; break;
            case 'H': biddingState.trumpSuit = 'hearts'; break;
            case 'S': biddingState.trumpSuit = 'spades'; break;
        }
    }
    
    // Transition to play phase
    switchToPlayPhase();
}

/**
 * Determine final contract
 */
function determineContract() {
    // Find highest bid
    let highestBid = null;
    let doubled = false;
    let redoubled = false;
    
    for (const bidInfo of biddingState.bidHistory) {
        if (!specialBids.includes(bidInfo.bid)) {
            highestBid = bidInfo.bid;
        } else if (bidInfo.bid === 'X' && highestBid) {
            doubled = true;
            redoubled = false;
        } else if (bidInfo.bid === 'XX' && doubled) {
            redoubled = true;
            doubled = false;
        }
    }
    
    if (!highestBid) {
        return null; // All passed
    }
    
    // Format contract
    let contract = highestBid;
    if (doubled) contract += 'X';
    if (redoubled) contract += 'XX';
    
    biddingState.contract = contract;
    
    return contract;
}

/**
 * Determine declarer and dummy
 */
function determineDeclarerAndDummy() {
    // Find the suit of the final contract
    const contractSuit = biddingState.contract.charAt(1);
    
    // Find the partnership who first bid this suit
    const pairs = {
        'north-south': ['north', 'south'],
        'east-west': ['east', 'west']
    };
    
    let declarerPair = null;
    let firstPlayer = null;
    
    for (const bidInfo of biddingState.bidHistory) {
        if (bidInfo.bid.charAt(1) === contractSuit && !specialBids.includes(bidInfo.bid)) {
            const player = bidInfo.player;
            
            // Determine which pair this player belongs to
            for (const [pair, players] of Object.entries(pairs)) {
                if (players.includes(player)) {
                    declarerPair = pair;
                    
                    // Check if this player was the first in the partnership to bid this suit
                    if (!firstPlayer || players.indexOf(firstPlayer) === -1) {
                        firstPlayer = player;
                    }
                    break;
                }
            }
            
            if (declarerPair && firstPlayer) {
                break;
            }
        }
    }
    
    // Set declarer and dummy
    if (declarerPair && firstPlayer) {
        biddingState.declarer = firstPlayer;
        const dummyIndex = (pairs[declarerPair].indexOf(firstPlayer) + 1) % 2;
        biddingState.dummy = pairs[declarerPair][dummyIndex];
    } else {
        // Fallback
        biddingState.declarer = 'south';
        biddingState.dummy = 'north';
    }
}

/**
 * Switch to play phase
 */
function switchToPlayPhase() {
    // Transfer bidding state to game state
    gameState.contract = biddingState.contract;
    gameState.trumpSuit = biddingState.trumpSuit;
    gameState.declarer = biddingState.declarer;
    gameState.dummy = biddingState.dummy;
    
    // Update game phase
    gameState.gamePhase = 'play';
    
    // Set first player (player to left of declarer)
    const positions = ['north', 'east', 'south', 'west'];
    const declarerIndex = positions.indexOf(biddingState.declarer);
    gameState.currentPlayer = positions[(declarerIndex + 1) % 4];
    gameState.leadPlayer = gameState.currentPlayer;
    
    // Announce result
    const contractMessage = `Final contract: ${formatContract(biddingState.contract)} by ${getPositionName(biddingState.declarer)}`;
    updateStatus(contractMessage);
    
    // Delay the announcement to ensure the screen reader has time
    setTimeout(() => {
        announceToScreenReader(contractMessage);
        announceToScreenReader(`${getPositionName(gameState.currentPlayer)} leads.`);
        
        // If first player is GIB, get GIB move
        if (gameState.players[gameState.currentPlayer].type === 'gib') {
            setTimeout(() => {
                getGIBMove(gameState.currentPlayer);
            }, 1500);
        }
    }, 1000);
    
    // Update UI
    renderUI();
}

/**
 * Format contract for display
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
    
    // Add doubled/redoubled if applicable
    if (contract.includes('XX')) {
        result += ' XX';
    } else if (contract.includes('X')) {
        result += ' X';
    }
    
    return result;
}

/**
 * Check if a bid is valid
 */
function isValidBid(bid, currentHighestBid) {
    // Pass is always valid
    if (bid === 'P') return true;
    
    // Double is valid if the last non-pass bid was made by the opponents and wasn't doubled
    if (bid === 'X') {
        // Find last non-pass bid
        let lastBid = null;
        let lastBidder = null;
        
        for (let i = biddingState.bidHistory.length - 1; i >= 0; i--) {
            if (biddingState.bidHistory[i].bid !== 'P' && biddingState.bidHistory[i].bid !== 'X' && biddingState.bidHistory[i].bid !== 'XX') {
                lastBid = biddingState.bidHistory[i].bid;
                lastBidder = biddingState.bidHistory[i].player;
                break;
            }
        }
        
        if (!lastBid) return false; // Nothing to double
        
        // Check if lastBidder is opponent
        const currentPartner = biddingState.currentBidder === 'north' ? 'south' : 
                              biddingState.currentBidder === 'south' ? 'north' :
                              biddingState.currentBidder === 'east' ? 'west' : 'east';
        
        if (lastBidder === currentPartner || lastBidder === biddingState.currentBidder) {
            return false; // Can't double partner or self
        }
        
        // Check if already doubled
        for (let i = biddingState.bidHistory.length - 1; i >= 0; i--) {
            if (biddingState.bidHistory[i].bid === 'P') continue;
            if (biddingState.bidHistory[i].bid === 'X') return false; // Already doubled
            break;
        }
        
        return true;
    }
    
    // Redouble is valid if the last non-pass bid was doubled by the opponents
    if (bid === 'XX') {
        // Find if the last non-pass bid was 'X'
        let lastNonPassIndex = -1;
        
        for (let i = biddingState.bidHistory.length - 1; i >= 0; i--) {
            if (biddingState.bidHistory[i].bid !== 'P') {
                lastNonPassIndex = i;
                break;
            }
        }
        
        if (lastNonPassIndex === -1 || biddingState.bidHistory[lastNonPassIndex].bid !== 'X') {
            return false; // Last bid wasn't double
        }
        
        // Check if double was made by opponent
        const doubler = biddingState.bidHistory[lastNonPassIndex].player;
        const currentPartner = biddingState.currentBidder === 'north' ? 'south' : 
                              biddingState.currentBidder === 'south' ? 'north' :
                              biddingState.currentBidder === 'east' ? 'west' : 'east';
        
        if (doubler === currentPartner || doubler === biddingState.currentBidder) {
            return false; // Can't redouble partner's or own double
        }
        
        return true;
    }
    
    // Regular bid - must be higher than current highest bid
    if (!currentHighestBid) return true; // First bid is always valid
    
    const bidLevel = parseInt(bid.charAt(0));
    const bidSuit = bid.charAt(1);
    const highestLevel = parseInt(currentHighestBid.charAt(0));
    const highestSuit = currentHighestBid.charAt(1);
    
    if (bidLevel > highestLevel) return true;
    if (bidLevel === highestLevel && suitOrder.indexOf(bidSuit) > suitOrder.indexOf(highestSuit)) return true;
    
    return false;
}

/**
 * Get bid meaning based on selected system
 */
function getBidMeaning(bid, history, system = biddingState.selectedSystem) {
    const bidSystem = biddingSystems[system];
    
    if (!bidSystem) return "Unknown system";
    if (!bidSystem.meanings || !bidSystem.meanings[bid]) return "";
    
    return bidSystem.meanings[bid];
}

/**
 * Get all possible bids given the current state
 */
function getPossibleBids(currentHighestBid) {
    // Pass, Double, and Redouble are special cases
    const possibleBids = ['P'];
    
    // Check if double is possible
    let canDouble = false;
    let canRedouble = false;
    
    if (biddingState.bidHistory.length > 0) {
        // Find last non-pass bid
        let lastBid = null;
        let lastBidder = null;
        
        for (let i = biddingState.bidHistory.length - 1; i >= 0; i--) {
            if (biddingState.bidHistory[i].bid !== 'P') {
                lastBid = biddingState.bidHistory[i].bid;
                lastBidder = biddingState.bidHistory[i].player;
                break;
            }
        }
        
        if (lastBid && lastBid !== 'X' && lastBid !== 'XX') {
            // Check if lastBidder is opponent
            const currentPartner = biddingState.currentBidder === 'north' ? 'south' : 
                                  biddingState.currentBidder === 'south' ? 'north' :
                                  biddingState.currentBidder === 'east' ? 'west' : 'east';
            
            if (lastBidder !== currentPartner && lastBidder !== biddingState.currentBidder) {
                canDouble = true;
            }
        } else if (lastBid === 'X') {
            // Check if double was by opponent for redouble
            const doubler = lastBidder;
            const currentPartner = biddingState.currentBidder === 'north' ? 'south' : 
                                  biddingState.currentBidder === 'south' ? 'north' :
                                  biddingState.currentBidder === 'east' ? 'west' : 'east';
            
            if (doubler !== currentPartner && doubler !== biddingState.currentBidder) {
                canRedouble = true;
            }
        }
    }
    
    if (canDouble) possibleBids.push('X');
    if (canRedouble) possibleBids.push('XX');
    
    // Generate regular bids
    if (!currentHighestBid) {
        // If no bids yet, all bids from 1C to 7N are possible
        for (const level of validLevels) {
            for (const suit of suitOrder) {
                possibleBids.push(`${level}${suit}`);
            }
        }
    } else {
        // Generate all bids higher than the current highest
        const highestLevel = parseInt(currentHighestBid.charAt(0));
        const highestSuit = currentHighestBid.charAt(1);
        const highestSuitIndex = suitOrder.indexOf(highestSuit);
        
        // Add all bids that are higher
        for (let level = highestLevel; level <= 7; level++) {
            for (let suitIndex = 0; suitIndex < suitOrder.length; suitIndex++) {
                if (level === highestLevel && suitIndex <= highestSuitIndex) continue;
                possibleBids.push(`${level}${suitOrder[suitIndex]}`);
            }
        }
    }
    
    return possibleBids;
}

/**
 * Get GIB bid
 */
async function getGIBBid(gibPosition) {
    // Placeholder for GIB bidding integration
    // In a full implementation, this would query the GIB API
    
    // For now, use a simple bidding strategy
    let selectedBid = 'P'; // Default to pass
    
    try {
        // Check if GIB service is available
        if (typeof gibService !== 'undefined' && gibService.isAvailable()) {
            // In future: integrate with GIB bidding API
            // const bidResponse = await gibService.getGIBBid(parameters);
            // if (bidResponse && bidResponse.bid) {
            //    selectedBid = bidResponse.bid;
            // }
        }
        
        // Until GIB bidding is implemented, use a simple strategy
        const possibleBids = getPossibleBids(biddingState.highestBid);
        
        // Very basic bidding strategy
        const hand = gameState.hands[gibPosition];
        const hcp = calculateHCP(hand);
        
        if (hcp >= 12) {
            // Opening strength, bid lowest available suit or NT
            if (possibleBids.includes('1S') && hand.spades.length >= 5) {
                selectedBid = '1S';
            } else if (possibleBids.includes('1H') && hand.hearts.length >= 5) {
                selectedBid = '1H';
            } else if (possibleBids.includes('1D') && hand.diamonds.length >= 3) {
                selectedBid = '1D';
            } else if (possibleBids.includes('1C') && hand.clubs.length >= 3) {
                selectedBid = '1C';
            } else if (possibleBids.includes('1N') && hcp >= 15 && hcp <= 17) {
                selectedBid = '1N';
            }
        }
        
        // Make the bid
        setTimeout(() => {
            makeBid(gibPosition, selectedBid);
        }, 500);
    } catch (error) {
        console.error('Error getting GIB bid:', error);
        // Fallback to simple pass
        setTimeout(() => {
            makeBid(gibPosition, 'P');
        }, 500);
    }
}

/**
 * Calculate High Card Points for a hand
 */
function calculateHCP(hand) {
    const pointValues = {
        'A': 4, 'K': 3, 'Q': 2, 'J': 1
    };
    
    let total = 0;
    
    for (const suit of ['spades', 'hearts', 'diamonds', 'clubs']) {
        for (const card of hand[suit]) {
            if (pointValues[card]) {
                total += pointValues[card];
            }
        }
    }
    
    return total;
}

/**
 * Render the bidding UI
 * This function will be called from the UI module
 */
function renderBiddingUI() {
    // This will be implemented in ui.js
}
