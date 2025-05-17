/**
 * BridgeCircle - GIB Integration Module - Updated for proxy server
 * Handles connection to GIB AI through a proxy server
 */

// GIB service settings
const gibService = {
    // Use own server as proxy for GIB
    apiBaseUrl: window.location.origin,
    
    // Service state
    _isAvailable: false,
    _isInitialized: false,
    
    /**
     * Initialize GIB service
     */
    async initialize() {
        try {
            // Try to make a test call to check GIB availability
            const response = await fetch(`${this.apiBaseUrl}/api/gib/deal`);
            
            // Test if we got a successful response
            this._isAvailable = response.ok;
            
            // If availability check failed, log error
            if (!this._isAvailable) {
                console.warn('GIB service is not available. Using simulated game.');
            }
            
            this._isInitialized = true;
            return this._isAvailable;
        } catch (error) {
            console.error('Error initializing GIB service:', error);
            this._isAvailable = false;
            this._isInitialized = true;
            return false;
        }
    },
    
    /**
     * Check if GIB service is available
     */
    isAvailable() {
        return this._isAvailable;
    },
    
    /**
     * Get deal from GIB service
     */
    async getDeal() {
        try {
            // Initialize service if not done yet
            if (!this._isInitialized) {
                await this.initialize();
            }
            
            // Check if service is available
            if (!this._isAvailable) {
                return null;
            }
            
            // Make call to GIB service through proxy server
            const response = await fetch(`${this.apiBaseUrl}/api/gib/deal`);
            
            // Handle response
            if (!response.ok) {
                throw new Error(`HTTP error: ${response.status}`);
            }
            
            const text = await response.text();
            const parser = new DOMParser();
            const xml = parser.parseFromString(text, "text/xml");
            
            // Check for errors
            const errorAttr = xml.documentElement.getAttribute('err');
            if (errorAttr && errorAttr !== '0') {
                throw new Error(`GIB API error: ${errorAttr}`);
            }
            
            // Get deal information
            const dealElement = xml.getElementsByTagName('sc_deal')[0];
            if (!dealElement) {
                throw new Error('No cards received');
            }
            
            // Get hands
            const north = dealElement.getAttribute('north');
            const east = dealElement.getAttribute('east');
            const south = dealElement.getAttribute('south');
            const west = dealElement.getAttribute('west');
            
            // Return hands
            return { north, east, south, west };
        } catch (error) {
            console.error('Error fetching deal from GIB service:', error);
            return null;
        }
    },
    
    /**
     * Get GIB's suggested move
     */
    async getGIBMove(params) {
        try {
            // Initialize service if not done yet
            if (!this._isInitialized) {
                await this.initialize();
            }
            
            // Check if service is available
            if (!this._isAvailable) {
                return null;
            }
            
            // Form URL and parameters
            const url = new URL(`${this.apiBaseUrl}/api/gib/robot`);
            
            // Add parameters
            url.searchParams.append('sc', 'tp');
            url.searchParams.append('pov', params.pov);
            url.searchParams.append('d', params.d);
            url.searchParams.append('v', '-');
            url.searchParams.append('s', params.s);
            url.searchParams.append('w', params.w);
            url.searchParams.append('n', params.n);
            url.searchParams.append('e', params.e);
            url.searchParams.append('h', params.h);
            
            // Make call to GIB service through proxy server
            const response = await fetch(url.toString());
            
            // Handle response
            if (!response.ok) {
                throw new Error(`HTTP error: ${response.status}`);
            }
            
            const text = await response.text();
            const parser = new DOMParser();
            const xml = parser.parseFromString(text, "text/xml");
            
            // Check for errors
            const errorAttr = xml.documentElement.getAttribute('err');
            if (errorAttr && errorAttr !== '0') {
                throw new Error(`GIB API error: ${errorAttr}`);
            }
            
            // Get move information
            const rElement = xml.getElementsByTagName('r')[0];
            if (!rElement) {
                throw new Error('No suggestion received');
            }
            
            const type = rElement.getAttribute('type');
            let move = null;
            
            if (type === 'play') {
                move = {
                    type: 'play',
                    card: rElement.getAttribute('card')
                };
            } else if (type === 'bid') {
                move = {
                    type: 'bid',
                    bid: rElement.getAttribute('bid')
                };
            }
            
            return move;
        } catch (error) {
            console.error('Error fetching GIB move:', error);
            return null;
        }
    },
    
    /**
     * Get bid meanings
     */
    async getBidMeanings(bidSequence) {
        try {
            // Initialize service if not done yet
            if (!this._isInitialized) {
                await this.initialize();
            }
            
            // Check if service is available
            if (!this._isAvailable) {
                return null;
            }
            
            // Form URL and parameters
            const url = new URL(`${this.apiBaseUrl}/api/gib/bid-meanings`);
            
            // Add parameters
            url.searchParams.append('t', 'g');
            url.searchParams.append('s', bidSequence);
            
            // Make call to GIB service through proxy server
            const response = await fetch(url.toString());
            
            // Handle response
            if (!response.ok) {
                throw new Error(`HTTP error: ${response.status}`);
            }
            
            const text = await response.text();
            const parser = new DOMParser();
            const xml = parser.parseFromString(text, "text/xml");
            
            // Check for errors
            const errorAttr = xml.documentElement.getAttribute('err');
            if (errorAttr && errorAttr !== '0') {
                throw new Error(`GIB API error: ${errorAttr}`);
            }
            
            // Get bid meanings
            const results = [];
            const rElements = xml.getElementsByTagName('r');
            
            for (let i = 0; i < rElements.length; i++) {
                const bid = rElements[i].getAttribute('b');
                const meaning = rElements[i].getAttribute('m');
                results.push({ bid, meaning });
            }
            
            return results;
        } catch (error) {
            console.error('Error fetching bid meanings:', error);
            return [];
        }
    },
    
    /**
     * Format hand for GIB API
     */
    formatHandForGIB(hand) {
        // Convert hand from { spades: ["A", "K"], hearts: [...] } format to "SAKHxxDxxCxx"
        return `S${hand.spades.join('')}H${hand.hearts.join('')}D${hand.diamonds.join('')}C${hand.clubs.join('')}`;
    },
    
    /**
     * Parse GIB hand to application format - IMPROVED VERSION
     * Correctly handles GIB hand format like "SAKQJHT982DA43C76"
     */
    parseGIBHand(gibHand) {
        const result = {
            spades: [],
            hearts: [],
            diamonds: [],
            clubs: []
        };
        
        if (!gibHand || typeof gibHand !== 'string') {
            console.warn('Invalid GIB hand format:', gibHand);
            return result;
        }
        
        try {
            // Valid bridge card values
            const validCardValues = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2'];
            
            // Extract cards for each suit
            let currentSuit = null;
            
            // Loop through the string character by character
            for (let i = 0; i < gibHand.length; i++) {
                const char = gibHand.charAt(i).toUpperCase();
                
                // Check if this is a suit marker
                if (char === 'S') {
                    currentSuit = 'spades';
                } else if (char === 'H') {
                    currentSuit = 'hearts';
                } else if (char === 'D') {
                    currentSuit = 'diamonds';
                } else if (char === 'C') {
                    currentSuit = 'clubs';
                } else if (currentSuit && validCardValues.includes(char)) {
                    // This is a card value, add it to the current suit
                    result[currentSuit].push(char);
                } else {
                    console.warn(`Unknown character in GIB hand: ${char}`);
                }
            }
            
            // Debug log the parsed hand
            console.log('Parsed GIB hand:', gibHand, 'into:', result);
        } catch (error) {
            console.error('Error parsing GIB hand:', error);
        }
        
        return result;
    },

    /**
     * Parse bid from GIB format
     */
    parseGIBBid(gibBid) {
        // Convert GIB bid format (like "1S", "2N", "P") to internal format
        // This is a placeholder and should be expanded with actual conversion logic
        return {
            value: gibBid.charAt(0),
            suit: gibBid.charAt(1)
        };
    },
    
    /**
     * Format bid for GIB API
     */
    formatBidForGIB(bid) {
        // Convert internal bid format to GIB format
        // This is a placeholder and should be expanded with actual conversion logic
        return `${bid.value}${bid.suit}`;
    }
};
