/**
 * GIB (Ginsberg Intelligent Player) Client Module
 * Provides interface to Bridge Base Online's GIB AI system
 */

const axios = require('axios');
const xml2js = require('xml2js');

const GIB_BASE_URL = 'http://gibrest.bridgebase.com';
const REQUEST_TIMEOUT = 10000;

class GIBClient {
  constructor() {
    this.parser = new xml2js.Parser();
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
        timeout: REQUEST_TIMEOUT
      });
      
      const result = await this.parser.parseStringPromise(response.data);
      return result;
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
        timeout: REQUEST_TIMEOUT
      });
      
      const result = await this.parser.parseStringPromise(response.data);
      return this.parseDealResult(result);
    } catch (error) {
      console.error('GIB dealer error:', error.message);
      throw new Error(`Failed to deal cards: ${error.message}`);
    }
  }

  /**
   * Get robot move (bid or play)
   * @param {Object} gameState - Current game state
   * @return {Promise<Object>} Robot move
   */
  async getRobotMove(gameState) {
    try {
      const params = this.buildRobotParams(gameState);
      
      const response = await axios.get(`${GIB_BASE_URL}/u_bm/robot.php`, {
        params,
        timeout: REQUEST_TIMEOUT
      });
      
      const result = await this.parser.parseStringPromise(response.data);
      return this.parseRobotResult(result, gameState);
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
      d: this.convertPosition(gameState.dealer || 'N'), // Dealer
      v: gameState.vulnerable || '-' // Vulnerability
    };

    // Add hands if available
    if (gameState.hands) {
      params.s = this.formatHand(gameState.hands.south);
      params.w = this.formatHand(gameState.hands.west);
      params.n = this.formatHand(gameState.hands.north);
      params.e = this.formatHand(gameState.hands.east);
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
    // Simplified - would need more complex formatting for actual play
    return '';
  }

  /**
   * Parse deal result from GIB
   * @param {Object} xmlResult - Parsed XML result
   * @return {Object} Formatted deal
   */
  parseDealResult(xmlResult) {
    try {
      // Extract deal data from GIB XML response
      const deal = xmlResult.deal || xmlResult;
      
      // Convert GIB format back to server format
      const hands = {
        north: this.parseGIBHand(deal.north || ''),
        south: this.parseGIBHand(deal.south || ''),
        east: this.parseGIBHand(deal.east || ''),
        west: this.parseGIBHand(deal.west || '')
      };

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
   * Parse robot result from GIB
   * @param {Object} xmlResult - Parsed XML result
   * @param {Object} gameState - Original game state
   * @return {Object} Robot move
   */
  parseRobotResult(xmlResult, gameState) {
    try {
      // Extract move from GIB response
      const result = xmlResult.result || xmlResult;
      
      if (gameState.gamePhase === 'bidding') {
        return this.parseRobotBid(result);
      } else if (gameState.gamePhase === 'play') {
        return this.parseRobotPlay(result);
      }
      
      throw new Error('Unknown game phase');
    } catch (error) {
      console.error('Error parsing robot result:', error);
      throw new Error('Failed to parse robot result');
    }
  }

  /**
   * Parse robot bid from GIB result
   * @param {Object} result - GIB result
   * @return {Object} Bid move
   */
  parseRobotBid(result) {
    const bid = result.bid || result.call || 'P';
    
    // Convert GIB bid format to server format
    let convertedBid = bid.toUpperCase();
    if (convertedBid === 'PASS') convertedBid = 'P';
    if (convertedBid === 'DBL') convertedBid = 'X';
    if (convertedBid === 'RDBL') convertedBid = 'XX';
    
    return {
      type: 'bid',
      bid: convertedBid,
      explanation: result.explanation || ''
    };
  }

  /**
   * Parse robot card play from GIB result
   * @param {Object} result - GIB result
   * @return {Object} Card play move
   */
  parseRobotPlay(result) {
    const card = result.card || result.play;
    
    if (!card) {
      throw new Error('No card in robot result');
    }

    // Parse card format (e.g., "S7" = 7 of spades)
    const suitChar = card.charAt(0).toUpperCase();
    const cardValue = card.slice(1).toUpperCase().replace('T', '10');
    
    const suitMapping = {
      'S': 'spades',
      'H': 'hearts', 
      'D': 'diamonds',
      'C': 'clubs'
    };

    return {
      type: 'play',
      suit: suitMapping[suitChar],
      card: cardValue
    };
  }
}

module.exports = new GIBClient();