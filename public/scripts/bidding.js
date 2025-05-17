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
    
    // Muutetaan pohjoinen ihmiseksi, jos etelä-pohjoinen pari voitti tarjousvaiheen
    if (biddingState.declarer === 'south' || biddingState.declarer === 'north') {
        // Vaihda pohjoinen ihmiseksi
        gameState.players.north = {
            type: 'human',
            name: 'North (You)'
        };
        console.log('North is now human player because NS won the bidding');
    }
    
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
        
        // Ilmoita pohjoisen pelaajan muutoksesta, jos NS voitti tarjousvaiheen
        if (biddingState.declarer === 'south' || biddingState.declarer === 'north') {
            announceToScreenReader("North is now a human player. You can play both North and South cards.");
        }
        
        announceToScreenReader(`${getPositionName(gameState.currentPlayer)} leads.`);
        
        // Lisätty ilmoitus pohjoisen korttien näkymisestä
        if (biddingState.declarer === 'south' || biddingState.declarer === 'north') {
            setTimeout(() => {
                announceToScreenReader("North's cards are now visible.");
            }, 1500);
        }
        
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
    // Try to use GIB service if available
    try {
        if (typeof gibService !== 'undefined' && gibService.isAvailable()) {
            // In future: integrate with GIB API
            // Would use real GIB AI decisions if available
        }
        
        // Use enhanced bidding strategy
        const possibleBids = getPossibleBids(biddingState.highestBid);
        const hand = gameState.hands[gibPosition];
        let selectedBid = 'P'; // Default to pass
        
        // Calculate hand strength
        const hcp = calculateHCP(hand);
        const distribution = calculateDistribution(hand);
        const suitLengths = {
            spades: hand.spades.length,
            hearts: hand.hearts.length,
            diamonds: hand.diamonds.length,
            clubs: hand.clubs.length
        };
        
        // Get partnership information
        const partner = gibPosition === 'north' ? 'south' : 
                       gibPosition === 'south' ? 'north' :
                       gibPosition === 'east' ? 'west' : 'east';
        
        // Get partner's last bid if any
        let partnerBid = null;
        for (let i = biddingState.bidHistory.length - 1; i >= 0; i--) {
            if (biddingState.bidHistory[i].player === partner) {
                partnerBid = biddingState.bidHistory[i].bid;
                break;
            }
        }
        
        // OPENING BIDS
        if (biddingState.bidHistory.length === 0 || 
            biddingState.bidHistory.every(bid => bid.bid === 'P')) {
            
            // Strong hand (17+ points)
            if (hcp >= 17 && hcp <= 19 && distribution === 'balanced') {
                // 1NT with balanced 17-19 HCP
                selectedBid = possibleBids.includes('1N') ? '1N' : 'P';
            } 
            else if (hcp >= 20 && hcp <= 21 && distribution === 'balanced') {
                // 2NT with balanced 20-21 HCP
                selectedBid = possibleBids.includes('2N') ? '2N' : 'P';
            }
            else if (hcp >= 22) {
                // Strong hand - open 2C
                selectedBid = possibleBids.includes('2C') ? '2C' : 'P';
            }
            // Medium hand (12-16 points)
            else if (hcp >= 12 && hcp <= 16) {
                // Open with longest suit
                if (suitLengths.spades >= 5) {
                    selectedBid = possibleBids.includes('1S') ? '1S' : 'P';
                } else if (suitLengths.hearts >= 5) {
                    selectedBid = possibleBids.includes('1H') ? '1H' : 'P';
                } else if (suitLengths.diamonds >= 3 && suitLengths.diamonds >= suitLengths.clubs) {
                    selectedBid = possibleBids.includes('1D') ? '1D' : 'P';
                } else if (suitLengths.clubs >= 3) {
                    selectedBid = possibleBids.includes('1C') ? '1C' : 'P';
                }
                
                // Balanced 15-16 HCP
                if (hcp >= 15 && hcp <= 16 && distribution === 'balanced' && selectedBid === 'P') {
                    selectedBid = possibleBids.includes('1N') ? '1N' : 'P';
                }
            }
            // Weak hand with long suit (6-11 points, 6+ cards)
            else if (hcp >= 6 && hcp <= 11) {
                if (suitLengths.spades >= 6) {
                    selectedBid = possibleBids.includes('2S') ? '2S' : 'P';
                } else if (suitLengths.hearts >= 6) {
                    selectedBid = possibleBids.includes('2H') ? '2H' : 'P';
                } else if (suitLengths.diamonds >= 6) {
                    selectedBid = possibleBids.includes('2D') ? '2D' : 'P';
                }
            }
        }
        // RESPONSES TO PARTNER
        else if (partnerBid && partnerBid !== 'P' && partnerBid !== 'X' && partnerBid !== 'XX') {
            const partnerSuit = partnerBid.charAt(1);
            const partnerLevel = parseInt(partnerBid.charAt(0));
            
            // Response to 1NT opening
            if (partnerBid === '1N') {
                if (hcp >= 8 && hcp <= 9 && distribution === 'balanced') {
                    selectedBid = possibleBids.includes('2N') ? '2N' : 'P';
                } else if (hcp >= 10 && distribution === 'balanced') {
                    selectedBid = possibleBids.includes('3N') ? '3N' : 'P';
                } else if (hcp >= 6 && suitLengths.spades >= 5 && suitLengths.hearts >= 4) {
                    // Stayman with 4+ hearts and 5+ spades
                    selectedBid = possibleBids.includes('2C') ? '2C' : 'P';
                }
            }
            // Response to 1 of a suit
            else if (partnerLevel === 1) {
                // Support partner's suit with 3+ cards
                if ((partnerSuit === 'S' && suitLengths.spades >= 3) ||
                    (partnerSuit === 'H' && suitLengths.hearts >= 3) ||
                    (partnerSuit === 'D' && suitLengths.diamonds >= 3) ||
                    (partnerSuit === 'C' && suitLengths.clubs >= 3)) {
                    
                    // Strong support and points
                    if (hcp >= 13) {
                        const level = partnerSuit === 'S' || partnerSuit === 'H' ? 4 : 5;
                        const bidString = `${level}${partnerSuit}`;
                        selectedBid = possibleBids.includes(bidString) ? bidString : 'P';
                    }
                    // Moderate support and points
                    else if (hcp >= 10) {
                        const level = partnerSuit === 'S' || partnerSuit === 'H' ? 3 : 4;
                        const bidString = `${level}${partnerSuit}`;
                        selectedBid = possibleBids.includes(bidString) ? bidString : 'P';
                    }
                    // Minimum support
                    else if (hcp >= 6) {
                        const level = partnerSuit === 'S' || partnerSuit === 'H' ? 2 : 3;
                        const bidString = `${level}${partnerSuit}`;
                        selectedBid = possibleBids.includes(bidString) ? bidString : 'P';
                    }
                }
                // New suit with 5+ cards
                else if (hcp >= 6) {
                    if (suitLengths.spades >= 5 && partnerSuit !== 'S' && possibleBids.includes('1S')) {
                        selectedBid = '1S';
                    } else if (suitLengths.hearts >= 5 && partnerSuit !== 'H' && possibleBids.includes('1H')) {
                        selectedBid = '1H';
                    } else if (suitLengths.diamonds >= 5 && partnerSuit !== 'D') {
                        const level = partnerSuit === 'S' || partnerSuit === 'H' ? 2 : 1;
                        const bidString = `${level}D`;
                        selectedBid = possibleBids.includes(bidString) ? bidString : 'P';
                    } else if (suitLengths.clubs >= 5 && partnerSuit !== 'C') {
                        const level = partnerSuit === 'S' || partnerSuit === 'H' || partnerSuit === 'D' ? 2 : 1;
                        const bidString = `${level}C`;
                        selectedBid = possibleBids.includes(bidString) ? bidString : 'P';
                    }
                    // NT response with stopper in all unbid suits
                    else if (distribution === 'balanced') {
                        if (hcp >= 12 && hcp <= 14) {
                            selectedBid = possibleBids.includes('2N') ? '2N' : 'P';
                        } else if (hcp >= 6 && hcp <= 11) {
                            selectedBid = possibleBids.includes('1N') ? '1N' : 'P';
                        }
                    }
                }
            }
        }
        
        // If opponents have bid, consider double with 13+ points and short in their suit
        const lastOpponentBid = getLastOpponentBid(gibPosition);
        if (lastOpponentBid && hcp >= 13) {
            const opponentSuit = lastOpponentBid.charAt(1);
            
            if ((opponentSuit === 'S' && suitLengths.spades <= 1) ||
                (opponentSuit === 'H' && suitLengths.hearts <= 1) ||
                (opponentSuit === 'D' && suitLengths.diamonds <= 1) ||
                (opponentSuit === 'C' && suitLengths.clubs <= 1)) {
                
                if (possibleBids.includes('X')) {
                    selectedBid = 'X';
                }
            }
        }
        
        // Occasional preemptive bids with weak hands but long suits
        if (hcp <= 10 && selectedBid === 'P') {
            if (suitLengths.spades >= 7 && possibleBids.includes('3S')) {
                selectedBid = '3S';
            } else if (suitLengths.hearts >= 7 && possibleBids.includes('3H')) {
                selectedBid = '3H';
            } else if (suitLengths.diamonds >= 7 && possibleBids.includes('3D')) {
                selectedBid = '3D';
            } else if (suitLengths.clubs >= 7 && possibleBids.includes('3C')) {
                selectedBid = '3C';
            }
        }
        
        // Make the bid with a delay to seem more human
        setTimeout(() => {
            makeBid(gibPosition, selectedBid);
        }, 1000);
    } catch (error) {
        console.error('Error getting GIB bid:', error);
        // Fallback to simple pass
        setTimeout(() => {
            makeBid(gibPosition, 'P');
        }, 500);
    }
}

/**
 * Get the last opponent's bid
 */
function getLastOpponentBid(currentPlayer) {
    // Determine opponents
    const opponents = currentPlayer === 'north' || currentPlayer === 'south' 
                    ? ['east', 'west'] 
                    : ['north', 'south'];
    
    // Find last opponent's bid
    for (let i = biddingState.bidHistory.length - 1; i >= 0; i--) {
        if (opponents.includes(biddingState.bidHistory[i].player) && 
            !['P', 'X', 'XX'].includes(biddingState.bidHistory[i].bid)) {
            return biddingState.bidHistory[i].bid;
        }
    }
    
    return null;
}

/**
 * Calculate hand distribution type
 */
function calculateDistribution(hand) {
    const suitLengths = [
        hand.spades.length,
        hand.hearts.length,
        hand.diamonds.length,
        hand.clubs.length
    ].sort((a, b) => a - b);
    
    // Check for balanced distribution (4-3-3-3, 4-4-3-2, or 5-3-3-2)
    if ((suitLengths[0] >= 2 && suitLengths[0] <= 3) && 
        (suitLengths[1] === 3) && 
        (suitLengths[2] === 3 || suitLengths[2] === 4) && 
        (suitLengths[3] <= 5)) {
        return 'balanced';
    }
    
    // Check for semi-balanced (5-4-2-2, 6-3-2-2, etc.)
    if (suitLengths[0] === 2 && suitLengths[1] === 2) {
        return 'semi-balanced';
    }
    
    // Check for unbalanced
    if (suitLengths[0] <= 1 || suitLengths[3] >= 6) {
        return 'unbalanced';
    }
    
    // Default
    return 'moderate';
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
 * This will be implemented in ui.js
 */
function renderBiddingUI() {
    // This will be implemented in ui.js
}