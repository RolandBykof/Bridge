/**
 * Helper function: Format hand for GIB API
 * @param {Object} hand - Hand object with suits
 * @return {string} GIB hand format (e.g., "akq86.ak3.4.ak63")
 */
function formatHandForGIB(hand) {
  const suits = ['spades', 'hearts', 'diamonds', 'clubs'];
  return suits.map(suit => {
    const cards = hand[suit] || [];
    return cards.join('').toLowerCase().replace(/10/g, 't');
  }).join('.');
}

/**
 * Enhanced GIB bid making with direct API call and corrected parsing
 * @param {Object} table - Table object
 * @param {string} position - GIB position
 */
async function makeAdvancedGIBBid(table, position) {
  try {
    console.log(`Getting GIB bid for ${position}...`);
    
    // Import axios for direct HTTP call
    const axios = require('axios');
    
    // Build parameters for GIB API
    const params = {
      sc: 'tp',                    // Scoring type (total points)
      pov: position.charAt(0).toUpperCase(), // Point of view (N, E, S, W)
      d: 'S',                      // Dealer (simplified to South for now)
      v: '-',                      // Vulnerability (none for now)
      
      // Bidding history
      h: table.biddingState.bidHistory.length > 0 ? 
         table.biddingState.bidHistory.map(b => b.bid.toLowerCase()).join('-') : 
         'p',
      
      // All hands (GIB needs complete information for smart bidding)
      s: formatHandForGIB(table.gameState.hands.south),
      w: formatHandForGIB(table.gameState.hands.west), 
      n: formatHandForGIB(table.gameState.hands.north),
      e: formatHandForGIB(table.gameState.hands.east)
    };
    
    console.log(`Calling GIB directly with params for ${position}:`, {
      ...params,
      // Hide hands in log for brevity, but show they exist
      s: params.s ? `${params.s.length} chars` : 'empty',
      w: params.w ? `${params.w.length} chars` : 'empty',
      n: params.n ? `${params.n.length} chars` : 'empty',
      e: params.e ? `${params.e.length} chars` : 'empty'
    });
    
    // Make direct HTTP call to GIB API
    const response = await axios.get('http://gibrest.bridgebase.com/u_bm/robot.php', {
      params,
      timeout: 20000,  // 20 seconds timeout
      headers: {
        'User-Agent': 'BridgeCircle/2.0.0'
      }
    });
    
    console.log(`GIB response received for ${position}:`, response.data);
    
    // CORRECTED: Parse GIB XML response
    if (response.data) {
      // PRIMARY: GIB returns actual bid in <r> element's bid attribute
      const bidMatch = response.data.match(/<r[^>]*bid="([^"]+)"/);
      
      if (bidMatch && bidMatch[1]) {
        let gibBid = bidMatch[1].toUpperCase();
        
        // Convert GIB bid format to bridge format
        if (gibBid === 'PASS') gibBid = 'P';
        if (gibBid === 'DBL') gibBid = 'X';  
        if (gibBid === 'RDBL') gibBid = 'XX';
        
        // Validate bid format
        const validBidPattern = /^([1-7][CDHSN]|P|X|XX)$/;
        if (validBidPattern.test(gibBid)) {
          console.log(`✅ GIB ${position} bids: ${gibBid}`);
          processBid(table, position, gibBid);
          return;
        } else {
          console.log(`❌ Invalid GIB bid format: "${gibBid}"`);
        }
      } else {
        console.log(`❌ GIB returned no bid recommendation for ${position}`);
      }
      
      // FALLBACK: Try old c="..." parsing as backup
      const fallbackMatch = response.data.match(/c="([^"]+)"/);
      if (fallbackMatch && fallbackMatch[1] && fallbackMatch[1] !== '?' && fallbackMatch[1] !== 'n') {
        let gibBid = fallbackMatch[1].toUpperCase();
        if (gibBid === 'PASS') gibBid = 'P';
        if (gibBid === 'DBL') gibBid = 'X';
        if (gibBid === 'RDBL') gibBid = 'XX';
        
        const validBidPattern = /^([1-7][CDHSN]|P|X|XX)$/;
        if (validBidPattern.test(gibBid)) {
          console.log(`✅ GIB ${position} bids (fallback): ${gibBid}`);
          processBid(table, position, gibBid);
          return;
        }
      }
      
      // ALTERNATIVE: Try alternative parsing - sometimes GIB uses different format
      const alternativeMatch = response.data.match(/<bid[^>]*>([^<]+)<\/bid>/);
      if (alternativeMatch && alternativeMatch[1]) {
        let gibBid = alternativeMatch[1].toUpperCase();
        if (gibBid === 'PASS') gibBid = 'P';
        if (gibBid === 'DBL') gibBid = 'X';
        if (gibBid === 'RDBL') gibBid = 'XX';
        
        const validBidPattern = /^([1-7][CDHSN]|P|X|XX)$/;
        if (validBidPattern.test(gibBid)) {
          console.log(`✅ GIB ${position} bids (alternative): ${gibBid}`);
          processBid(table, position, gibBid);
          return;
        }
      }
    }
    
    console.log(`❌ GIB parsing failed for ${position}, using local AI fallback`);
    
  } catch (error) {
    console.error(`❌ GIB API error for ${position}:`, {
      message: error.message,
      code: error.code,
      timeout: error.code === 'ECONNABORTED'
    });
    
    if (error.code === 'ECONNABORTED') {
      console.log(`⏱️  GIB timeout for ${position} - API too slow`);
    }
  }
  
  // Fallback: Use local AI
  try {
    const possibleBids = getPossibleBids(table.biddingState.highestBid);
    const calculatedBid = calculateAdvancedBid(table, position, possibleBids);
    
    console.log(`🤖 Local AI ${position} bids: ${calculatedBid}`);
    processBid(table, position, calculatedBid);
    
  } catch (fallbackError) {
    console.error(`❌ Local AI also failed for ${position}:`, fallbackError.message);
    
    // Emergency fallback: Pass
    console.log(`🆘 Emergency fallback: ${position} passes`);
    processBid(table, position, 'P');
  }
}