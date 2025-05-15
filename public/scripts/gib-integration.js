/**
 * BridgeCircle - GIB Integration Module - Päivitetty välityspalvelinta varten
 * Käsittelee yhteyden GIB-tekoälyyn välityspalvelimen kautta
 */

// GIB-palvelun asetukset
const gibService = {
    // Käytä omaa palvelinta välityspalvelimena GIB:lle
    apiBaseUrl: window.location.origin,
    
    // Palvelun tila
    _isAvailable: false,
    _isInitialized: false,
    
    /**
     * Alustaa GIB-palvelun
     */
    async initialize() {
        try {
            // Yritä tehdä testikutsu GIBin saatavuuden tarkistamiseksi
            const response = await fetch(`${this.apiBaseUrl}/api/gib/deal`);
            
            // Testaa saatiinko onnistunut vastaus
            this._isAvailable = response.ok;
            
            // Jos saatavuuden tarkistus epäonnistui, loki virheestä
            if (!this._isAvailable) {
                console.warn('GIB-palvelua ei ole saatavilla. Käytetään simuloitua peliä.');
            }
            
            this._isInitialized = true;
            return this._isAvailable;
        } catch (error) {
            console.error('Virhe GIB-palvelun alustuksessa:', error);
            this._isAvailable = false;
            this._isInitialized = true;
            return false;
        }
    },
    
    /**
     * Tarkistaa onko GIB-palvelu käytettävissä
     */
    isAvailable() {
        return this._isAvailable;
    },
    
    /**
     * Hakee jaon GIB-palvelusta
     */
    async getDeal() {
        try {
            // Alusta palvelu jos sitä ei ole vielä tehty
            if (!this._isInitialized) {
                await this.initialize();
            }
            
            // Tarkista onko palvelu käytettävissä
            if (!this._isAvailable) {
                return null;
            }
            
            // Tee kutsu GIB-palveluun välityspalvelimen kautta
            const response = await fetch(`${this.apiBaseUrl}/api/gib/deal`);
            
            // Käsittele vastaus
            if (!response.ok) {
                throw new Error(`HTTP-virhe: ${response.status}`);
            }
            
            const text = await response.text();
            const parser = new DOMParser();
            const xml = parser.parseFromString(text, "text/xml");
            
            // Tarkista virheet
            const errorAttr = xml.documentElement.getAttribute('err');
            if (errorAttr && errorAttr !== '0') {
                throw new Error(`GIB API virhe: ${errorAttr}`);
            }
            
            // Hae jaon tiedot
            const dealElement = xml.getElementsByTagName('sc_deal')[0];
            if (!dealElement) {
                throw new Error('Kortteja ei saatu');
            }
            
            // Hae kädet
            const north = dealElement.getAttribute('north');
            const east = dealElement.getAttribute('east');
            const south = dealElement.getAttribute('south');
            const west = dealElement.getAttribute('west');
            
            // Palauta kädet
            return { north, east, south, west };
        } catch (error) {
            console.error('Virhe haettaessa jakoa GIB-palvelusta:', error);
            return null;
        }
    },
    
    /**
     * Hakee GIB:n ehdottaman siirron
     */
    async getGIBMove(params) {
        try {
            // Alusta palvelu jos sitä ei ole vielä tehty
            if (!this._isInitialized) {
                await this.initialize();
            }
            
            // Tarkista onko palvelu käytettävissä
            if (!this._isAvailable) {
                return null;
            }
            
            // Muodosta URL ja parametrit
            const url = new URL(`${this.apiBaseUrl}/api/gib/robot`);
            
            // Lisää parametrit
            url.searchParams.append('sc', 'tp');
            url.searchParams.append('pov', params.pov);
            url.searchParams.append('d', params.d);
            url.searchParams.append('v', '-');
            url.searchParams.append('s', params.s);
            url.searchParams.append('w', params.w);
            url.searchParams.append('n', params.n);
            url.searchParams.append('e', params.e);
            url.searchParams.append('h', params.h);
            
            // Tee kutsu GIB-palveluun välityspalvelimen kautta
            const response = await fetch(url.toString());
            
            // Käsittele vastaus
            if (!response.ok) {
                throw new Error(`HTTP-virhe: ${response.status}`);
            }
            
            const text = await response.text();
            const parser = new DOMParser();
            const xml = parser.parseFromString(text, "text/xml");
            
            // Tarkista virheet
            const errorAttr = xml.documentElement.getAttribute('err');
            if (errorAttr && errorAttr !== '0') {
                throw new Error(`GIB API virhe: ${errorAttr}`);
            }
            
            // Hae siirron tiedot
            const rElement = xml.getElementsByTagName('r')[0];
            if (!rElement) {
                throw new Error('Ehdotusta ei saatu');
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
            console.error('Virhe haettaessa GIB-siirtoa:', error);
            return null;
        }
    },
    
    /**
     * Hakee tarjousten merkitykset
     */
    async getBidMeanings(bidSequence) {
        try {
            // Alusta palvelu jos sitä ei ole vielä tehty
            if (!this._isInitialized) {
                await this.initialize();
            }
            
            // Tarkista onko palvelu käytettävissä
            if (!this._isAvailable) {
                return null;
            }
            
            // Muodosta URL ja parametrit
            const url = new URL(`${this.apiBaseUrl}/api/gib/bid-meanings`);
            
            // Lisää parametrit
            url.searchParams.append('t', 'g');
            url.searchParams.append('s', bidSequence);
            
            // Tee kutsu GIB-palveluun välityspalvelimen kautta
            const response = await fetch(url.toString());
            
            // Käsittele vastaus
            if (!response.ok) {
                throw new Error(`HTTP-virhe: ${response.status}`);
            }
            
            const text = await response.text();
            const parser = new DOMParser();
            const xml = parser.parseFromString(text, "text/xml");
            
            // Tarkista virheet
            const errorAttr = xml.documentElement.getAttribute('err');
            if (errorAttr && errorAttr !== '0') {
                throw new Error(`GIB API virhe: ${errorAttr}`);
            }
            
            // Hae tarjousten merkitykset
            const results = [];
            const rElements = xml.getElementsByTagName('r');
            
            for (let i = 0; i < rElements.length; i++) {
                const bid = rElements[i].getAttribute('b');
                const meaning = rElements[i].getAttribute('m');
                results.push({ bid, meaning });
            }
            
            return results;
        } catch (error) {
            console.error('Virhe haettaessa tarjousten merkityksiä:', error);
            return [];
        }
    },
    
    /**
     * Muuntaa käden GIB API -formaattiin
     */
    formatHandForGIB(hand) {
        // Muuta käsi muodosta { spades: ["A", "K"], hearts: [...] } muotoon "SAKHxxDxxCxx"
        return `S${hand.spades.join('')}H${hand.hearts.join('')}D${hand.diamonds.join('')}C${hand.clubs.join('')}`;
    },
    
    /**
     * Jäsentää GIB-käden sovelluksen käyttämään formaattiin
     */
    parseGIBHand(gibHand) {
        const result = {
            spades: [],
            hearts: [],
            diamonds: [],
            clubs: []
        };
        
        try {
            // Etsi eri maiden kortit säännöllisillä lausekkeilla
            const spadesMatch = gibHand.match(/S([A-Za-z0-9]+)/);
            const heartsMatch = gibHand.match(/H([A-Za-z0-9]+)/);
            const diamondsMatch = gibHand.match(/D([A-Za-z0-9]+)/);
            const clubsMatch = gibHand.match(/C([A-Za-z0-9]+)/);
            
            // Lisää kortit löydettyihin maihin
            if (spadesMatch) result.spades = Array.from(spadesMatch[1].toUpperCase());
            if (heartsMatch) result.hearts = Array.from(heartsMatch[1].toUpperCase());
            if (diamondsMatch) result.diamonds = Array.from(diamondsMatch[1].toUpperCase());
            if (clubsMatch) result.clubs = Array.from(clubsMatch[1].toUpperCase());
        } catch (error) {
            console.error('Virhe GIB-käden jäsentämisessä:', error);
        }
        
        return result;
    }
};
