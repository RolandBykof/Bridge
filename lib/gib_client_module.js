/**
 * GIB (Ginsberg Intelligent Player) Client Module - KORJATTU VERSIO
 * Käyttää purkka.js:n toimivaa parsing-logiikkaa
 */

const axios = require('axios');

const GIB_BASE_URL = 'http://gibrest.bridgebase.com';
const REQUEST_TIMEOUT = 20000; // Nostettu 20 sekuntiin

class GIBClient {
  constructor() {
    // Ei tarvita xml2js-parseria, käytetään regex-parsing:ia
  }

  /**
   * Get bid meanings/explanations  
   * @param {string} auctionString - Auction sequence (e.g., "P-P-P-1s")
   * @param {string} tableType - Table type (default: 'g')
   * @return {Promise<Object>} Bid meanings
   */
  async getBidMeanings(auctionString, tableType = 'g') {
    try {
      const response = await axios.get(`${GIB_BASE_URL}/u_bm/u_bm.php`, {
        params: { 
          t: tableType, 
          s: auctionString 
        },
        timeout: REQUEST_TIMEOUT,
        headers: {
          'User-Agent': 'BridgeCircle/2.0.0'
        }
      });
      
      // Yksinkertainen parsing bid meanings:ille
      return this.parseBidMeanings(response.data);
    } catch (error) {
      console.error('GIB bid meanings error:', error.message);
      throw new Error(`Failed to get bid meanings: ${error.message}`);
    }
  }

  /**
   * Deal cards using GIB dealer
   * @param {string} constraints - Deal constraints (optional)
   * @param {number} numDeals - Number of deals (default: 1)
   * @return {Promise<Object>} Deal result
   */
  async dealCards(constraints = '', numDeals = 1) {
    try {
      const response = await axios.get(`${GIB_BASE_URL}/u_dealer/u_dealer.php`, {
        params: { 
          reuse: 'y', 
          n: numDeals.toString(), 
          c: constraints,
          cb: ''
        },
        timeout: REQUEST_TIMEOUT,
        headers: {
          'User-Agent': 'BridgeCircle/2.0.0'
        }
      });
      
      return this.parseDealResult(response.data);
    } catch (error) {
      console.error('GIB dealer error:', error.message);
      throw new Error(`Failed to deal cards: ${error.message}`);
    }
  }

  /**
   * Get robot move (bid or play) - KORJATTU PARSING
   * @param {Object} gameState - Current game state
   * @return {Promise<Object>} Robot move
   */
  async getRobotMove(gameState) {
    try {
      const params = this.buildRobotParams(gameState);
      
      console.log(`Calling GIB robot API with params:`, {
        ...params,
        // Piilotetaan kädet logista
        s: params.s ? `${params.s.length} chars` : 'empty',
        w: params.w ? `${params.w.length} chars` : 'empty', 
        n: params.n ? `${params.n.length} chars` : 'empty',
        e: params.e ? `${params.e.length} chars` : 'empty'
      });
      
      const response = await axios.get(`${GIB_BASE_URL}/u_bm/robot.php`, {
        params,
        timeout: REQUEST_TIMEOUT,
        headers: {
          'User-Agent': 'BridgeCircle/2.0.0'
        }
      });
      
      console.log(`GIB response received:`, response.data);
      
      // KORJATTU: Käytetään purkka.js:n toimivaa parsing-logiikkaa
      return this.parseRobotResult(response.data, gameState);
    } catch (error) {
      console.error('GIB robot error:', error.message);
      throw new Error(`Failed to get robot move: ${error.message}`);
    }
  }

  /**
   * Build parameters for robot API call
   * @param {Object} gameState - Game state from server
   * @return {Object} GIB API parameters
   */
  buildRobotParams(gameState) {
    const params = {
      sc: 'tp', // Scoring type
      pov: this.convertPosition(gameState.position), // Point of view
      d: this.convertPosition(gameState.dealer || 'south'), // Dealer
      v: gameState.vulnerable || '-' // Vulnerability
    };

    // Add hands if available
    if (gameState.hands) {
      if (gameState.hands.south) params.s = this.formatHand(gameState.hands.south);
      if (gameState.hands.west) params.w = this.formatHand(gameState.hands.west);
      if (gameState.hands.north) params.n = this.formatHand(gameState.hands.north);
      if (gameState.hands.east) params.e = this.formatHand(gameState.hands.east);
    }

    // Add auction/bidding history
    if (gameState.biddingHistory) {
      params.h = this.formatAuction(gameState.biddingHistory);
    }

    // Add played cards if in play phase
    if (gameState.playedCards) {
      params.p = this.formatPlayedCards(gameState.playedCards);
    }

    return params;
  }

  /**
   * Convert position from server format to GIB format
   * @param {string} position - Position (north, south, east, west)
   * @return {string} GIB position (N, S, E, W)
   */
  convertPosition(position) {
    const mapping = {
      'north': 'N',
      'south': 'S', 
      'east': 'E',
      'west': 'W'
    };
    return mapping[position] || 'N';
  }

  /**
   * Format hand for GIB API
   * @param {Object} hand - Hand object with suits
   * @return {string} GIB hand format (e.g., "akq86.ak3.4.ak63")
   */
  formatHand(hand) {
    if (!hand) return '';
    
    const suits = ['spades', 'hearts', 'diamonds', 'clubs'];
    const gibHand = suits.map(suit => {
      const cards = hand[suit] || [];
      return cards.join('').toLowerCase().replace(/10/g, 't');
    }).join('.');
    
    return gibHand;
  }

  /**
   * Format auction for GIB API
   * @param {Array} biddingHistory - Bidding history
   * @return {string} GIB auction format (e.g., "p-p-1s-2n-p-p-p")
   */
  formatAuction(biddingHistory) {
    if (!biddingHistory || biddingHistory.length === 0) return '';
    
    return biddingHistory.map(bid => {
      const b = bid.bid || bid;
      if (b === 'P') return 'p';
      if (b === 'X') return 'x';
      if (b === 'XX') return 'xx';
      return b.toLowerCase();
    }).join('-');
  }

  /**
   * Format played cards for GIB API
   * @param {Array} playedCards - Played cards
   * @return {string} GIB play format
   */
  formatPlayedCards(playedCards) {
    // Yksinkertainen toteutus - voisi olla monimutkaisempi
    if (!playedCards || playedCards.length === 0) return '';
    
    // Muunna pelatut kortit GIB-formaattiin
    return playedCards.map(card => {
      const suit = this.convertSuitToGIB(card.suit);
      const value = card.card.replace('10', 't').toLowerCase();
      return `${suit}${value}`;
    }).join(',');
  }

  /**
   * Convert suit to GIB format
   * @param {string} suit - Suit name
   * @return {string} GIB suit format
   */
  convertSuitToGIB(suit) {
    const mapping = {
      'spades': 's',
      'hearts': 'h', 
      'diamonds': 'd',
      'clubs': 'c'
    };
    return mapping[suit] || suit.charAt(0).toLowerCase();
  }

  /**
   * Parse deal result from GIB
   * @param {string} xmlData - GIB XML response
   * @return {Object} Formatted deal
   */
  parseDealResult(xmlData) {
    try {
      // Yksinkertainen regex-parsing deal:ille
      const hands = {
        north: this.parseGIBHand(''),
        south: this.parseGIBHand(''),
        east: this.parseGIBHand(''),
        west: this.parseGIBHand('')
      };

      // Etsitään kädet XML:stä regex:llä
      const northMatch = xmlData.match(/<north[^>]*>([^<]+)<\/north>/i);
      const southMatch = xmlData.match(/<south[^>]*>([^<]+)<\/south>/i);
      const eastMatch = xmlData.match(/<east[^>]*>([^<]+)<\/east>/i);
      const westMatch = xmlData.match(/<west[^>]*>([^<]+)<\/west>/i);

      if (northMatch) hands.north = this.parseGIBHand(northMatch[1]);
      if (southMatch) hands.south = this.parseGIBHand(southMatch[1]);
      if (eastMatch) hands.east = this.parseGIBHand(eastMatch[1]);
      if (westMatch) hands.west = this.parseGIBHand(westMatch[1]);

      return { hands };
    } catch (error) {
      console.error('Error parsing deal result:', error);
      throw new Error('Failed to parse deal result');
    }
  }

  /**
   * Parse GIB hand format to server format
   * @param {string} gibHand - GIB hand (e.g., "akq86.ak3.4.ak63")
   * @return {Object} Server hand format
   */
  parseGIBHand(gibHand) {
    if (!gibHand || typeof gibHand !== 'string') {
      return {
        spades: [],
        hearts: [],
        diamonds: [],
        clubs: []
      };
    }

    const suits = gibHand.split('.');
    const suitNames = ['spades', 'hearts', 'diamonds', 'clubs'];
    
    const hand = {
      spades: [],
      hearts: [],
      diamonds: [],
      clubs: []
    };

    suits.forEach((suitCards, index) => {
      if (index < suitNames.length && suitCards) {
        const cards = suitCards.toUpperCase()
          .replace(/T/g, '10')
          .split('')
          .map(card => card === '1' ? '10' : card)
          .filter(card => card && card !== '0');
        
        // Sort cards in descending order
        const values = ['A', 'K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4', '3', '2'];
        cards.sort((a, b) => values.indexOf(a) - values.indexOf(b));
        
        hand[suitNames[index]] = cards;
      }
    });

    return hand;
  }

  /**
   * Parse robot result from GIB - KORJATTU VERSIO käyttäen purkka.js:n logiikkaa
   * @param {string} xmlData - GIB XML response
   * @param {Object} gameState - Original game state
   * @return {Object} Robot move
   */
  parseRobotResult(xmlData, gameState) {
    try {
      console.log('Parsing GIB robot result...');
      
      if (gameState.gamePhase === 'bidding') {
        return this.parseRobotBid(xmlData);
      } else if (gameState.gamePhase === 'play') {
        return this.parseRobotPlay(xmlData);
      }
      
      throw new Error('Unknown game phase');
    } catch (error) {
      console.error('Error parsing robot result:', error);
      throw new Error('Failed to parse robot result');
    }
  }

  /**
   * Parse robot bid from GIB result - KORJATTU käyttäen purkka.js:n logiikkaa
   * @param {string} xmlData - GIB XML response
   * @return {Object} Bid move
   */
  parseRobotBid(xmlData) {
    console.log('Parsing GIB bid response...');
    console.log('🔍 GIB XML Response:', xmlData);
    
    if (!xmlData) {
      throw new Error('No XML data to parse');
    }

    // FORMAATTI 1: Monitasoinen <sc_bm><r bid="..."/></sc_bm>
    const bidMatch = xmlData.match(/<r[^>]*bid="([^"]+)"/);
    
    if (bidMatch && bidMatch[1]) {
      let gibBid = bidMatch[1].toUpperCase();
      console.log(`🔍 Found <r bid="${gibBid}"> format`);
      
      // Convert GIB bid format to bridge format
      if (gibBid === 'PASS') gibBid = 'P';
      if (gibBid === 'DBL') gibBid = 'X';  
      if (gibBid === 'RDBL') gibBid = 'XX';
      
      // Validate bid format
      const validBidPattern = /^([1-7][CDHSN]|P|X|XX)$/;
      if (validBidPattern.test(gibBid)) {
        console.log(`✅ GIB bid parsed (r-format): ${gibBid}`);
        return {
          type: 'bid',
          bid: gibBid,
          explanation: this.extractExplanation(xmlData)
        };
      } else {
        console.log(`❌ Invalid GIB bid format: "${gibBid}"`);
      }
    }
    
    // FORMAATTI 2: Yksi rivi <sc_bm ... c="..."/>
    const cMatch = xmlData.match(/c="([^"]+)"/);
    if (cMatch && cMatch[1]) {
      const cValue = cMatch[1];
      console.log(`🔍 Found c="${cValue}" format`);
      
      // Jos GIB palauttaa "?" tai "n", tulkitaan pass:ina
      if (cValue === '?' || cValue === 'n') {
        console.log(`✅ GIB bid parsed (c-uncertain): P (reason: c="${cValue}")`);
        return {
          type: 'bid',
          bid: 'P',
          explanation: `GIB uncertain (c="${cValue}") - defaulting to pass`
        };
      }
      
      // Jos on oikea bid c:ssä
      let gibBid = cValue.toUpperCase();
      if (gibBid === 'PASS') gibBid = 'P';
      if (gibBid === 'DBL') gibBid = 'X';
      if (gibBid === 'RDBL') gibBid = 'XX';
      
      const validBidPattern = /^([1-7][CDHSN]|P|X|XX)$/;
      if (validBidPattern.test(gibBid)) {
        console.log(`✅ GIB bid parsed (c-format): ${gibBid}`);
        return {
          type: 'bid',
          bid: gibBid,
          explanation: `GIB bid from c attribute`
        };
      } else {
        console.log(`🔍 c="${cValue}" is not a valid bid, treating as pass`);
        return {
          type: 'bid',
          bid: 'P', 
          explanation: `GIB returned non-bid value (c="${cValue}") - defaulting to pass`
        };
      }
    }
    
    // ALTERNATIVE: Try alternative parsing
    const alternativeMatch = xmlData.match(/<bid[^>]*>([^<]+)<\/bid>/);
    if (alternativeMatch && alternativeMatch[1]) {
      let gibBid = alternativeMatch[1].toUpperCase();
      console.log(`🔍 Found <bid>${gibBid}</bid> format`);
      
      if (gibBid === 'PASS') gibBid = 'P';
      if (gibBid === 'DBL') gibBid = 'X';
      if (gibBid === 'RDBL') gibBid = 'XX';
      
      const validBidPattern = /^([1-7][CDHSN]|P|X|XX)$/;
      if (validBidPattern.test(gibBid)) {
        console.log(`✅ GIB bid parsed (alternative): ${gibBid}`);
        return {
          type: 'bid',
          bid: gibBid,
          explanation: this.extractExplanation(xmlData)
        };
      }
    }
    
    // Jos mikään ei toimi, default pass
    console.log(`⚠️  No valid bid found in GIB response, defaulting to pass`);
    return {
      type: 'bid',
      bid: 'P',
      explanation: 'No parseable bid from GIB - defaulting to pass'
    };
  }

  /**
   * Extract bid explanation from XML
   * @param {string} xmlData - XML response
   * @return {string} Explanation
   */
  extractExplanation(xmlData) {
    const explanationMatch = xmlData.match(/<explanation[^>]*>([^<]+)<\/explanation>/i) ||
                           xmlData.match(/explanation="([^"]+)"/i) ||
                           xmlData.match(/e="([^"]+)"/i);
    
    return explanationMatch ? explanationMatch[1] : '';
  }

  /**
   * Parse robot card play from GIB result - KORJATTU
   * @param {string} xmlData - GIB XML response
   * @return {Object} Card play move
   */
  parseRobotPlay(xmlData) {
    console.log('Parsing GIB card play response...');
    
    if (!xmlData) {
      throw new Error('No XML data to parse');
    }

    // Etsitään kortti eri tavoilla
    let cardMatch = null;
    
    // Tapa 1: <r> elementtin card-attribuutti
    cardMatch = xmlData.match(/<r[^>]*card="([^"]+)"/i);
    
    // Tapa 2: <card> elementti
    if (!cardMatch) {
      cardMatch = xmlData.match(/<card[^>]*>([^<]+)<\/card>/i);
    }
    
    // Tapa 3: <play> elementti
    if (!cardMatch) {
      cardMatch = xmlData.match(/<play[^>]*>([^<]+)<\/play>/i);
    }
    
    // Tapa 4: c="..." attribuutti
    if (!cardMatch) {
      cardMatch = xmlData.match(/c="([^"]+)"/i);
    }
    
    if (!cardMatch || !cardMatch[1]) {
      console.log(`❌ No card found in GIB response`);
      throw new Error('No card in robot result');
    }

    const cardString = cardMatch[1].trim();
    console.log(`GIB card string: "${cardString}"`);
    
    // Parse card format (e.g., "S7" = 7 of spades, "HK" = King of hearts)
    if (cardString.length < 2) {
      throw new Error(`Invalid card format: "${cardString}"`);
    }
    
    const suitChar = cardString.charAt(0).toUpperCase();
    let cardValue = cardString.slice(1).toUpperCase().replace('T', '10');
    
    // Jos kortin arvo on tyhjä, ota viimeinen merkki
    if (!cardValue && cardString.length >= 2) {
      cardValue = cardString.charAt(cardString.length - 1).toUpperCase().replace('T', '10');
    }
    
    const suitMapping = {
      'S': 'spades',
      'H': 'hearts', 
      'D': 'diamonds',
      'C': 'clubs'
    };

    const suit = suitMapping[suitChar];
    if (!suit) {
      throw new Error(`Unknown suit: "${suitChar}"`);
    }
    
    if (!cardValue) {
      throw new Error(`No card value found in: "${cardString}"`);
    }

    console.log(`✅ GIB card parsed: ${suit} ${cardValue}`);
    
    return {
      type: 'play',
      suit: suit,
      card: cardValue
    };
  }

  /**
   * Parse bid meanings response
   * @param {string} xmlData - XML response
   * @return {Object} Bid meanings
   */
  parseBidMeanings(xmlData) {
    // Yksinkertainen parsing bid meanings:ille
    const meanings = {
      bids: [],
      explanations: {}
    };
    
    // Etsitään bid-elementtejä
    const bidMatches = xmlData.matchAll(/<bid[^>]*>([^<]+)<\/bid>/gi);
    for (const match of bidMatches) {
      meanings.bids.push(match[1]);
    }
    
    // Etsitään selityksiä
    const explanationMatches = xmlData.matchAll(/<explanation[^>]*>([^<]+)<\/explanation>/gi);
    let i = 0;
    for (const match of explanationMatches) {
      if (meanings.bids[i]) {
        meanings.explanations[meanings.bids[i]] = match[1];
      }
      i++;
    }
    
    return meanings;
  }
}

module.exports = new GIBClient();