/**
 * BridgeCircle - Main Application
 * Sovelluksen päämoduuli ja alustus
 */

// Kun DOM on valmis, alusta sovellus
document.addEventListener('DOMContentLoaded', initializeApp);

/**
 * Alustaa sovelluksen
 */
async function initializeApp() {
    console.log('BridgeCircle-sovellus käynnistetään...');
    
    // Yritä alustaa GIB-palvelu
    try {
        await gibService.initialize();
        if (gibService.isAvailable()) {
            console.log('GIB-palvelu on käytettävissä.');
        } else {
            console.log('GIB-palvelua ei voitu alustaa, käytetään simuloitua peliä.');
        }
    } catch (error) {
        console.error('Virhe GIB-palvelun alustuksessa:', error);
    }
    
    // Aseta tapahtumakuuntelijat käyttöliittymän elementeille
    setupEventListeners();
    
    // Renderöi käyttöliittymä
    renderUI();
    
    // Käsittele mahdolliset CORS-ongelmat
    handleCORSIssues();
    
    console.log('BridgeCircle-sovellus alustettu.');
}

/**
 * Käsittelee mahdolliset CORS-ongelmat
 */
function handleCORSIssues() {
    // Tämä on yksinkertainen tarkistus, joka voidaan laajentaa tarvittaessa
    const warningMessage = 'GIB-palvelun käyttö suoraan selaimesta saattaa kohdata CORS-rajoituksia. ' +
                          'Jos GIB-ominaisuudet eivät toimi, harkitse välityspalvelimen käyttöä.';
    
    if (gibService.apiBaseUrl.startsWith('http:') && window.location.protocol === 'https:') {
        console.warn(warningMessage);
        console.warn('Mixed content: GIB-palvelu käyttää HTTP:tä mutta sovellus on HTTPS:n päällä.');
    }
}

/**
 * Käsittelee virheet käyttäjäystävällisellä tavalla
 */
function handleError(error, context) {
    console.error(`Virhe (${context}):`, error);
    
    let message = 'Tapahtui virhe. Ole hyvä ja yritä uudelleen.';
    
    // Määritä käyttäjäystävällisempi virheviesti kontekstin mukaan
    if (context === 'gib-deal') {
        message = 'Korttien hakeminen GIB-palvelusta epäonnistui. Käytetään satunnaisia kortteja.';
    } else if (context === 'gib-move') {
        message = 'GIB-siirron hakeminen epäonnistui. Käytetään simuloitua siirtoa.';
    }
    
    // Näytä virheviesti käyttäjälle
    updateStatus(message);
    announceToScreenReader(message);
}

/**
 * Monitoroi sovelluksen suorituskykyä (voidaan laajentaa tarvittaessa)
 */
function monitorPerformance() {
    // Tässä voidaan toteuttaa suorituskyvyn monitorointia
    // Esimerkiksi ajanoton mittauksia API-kutsuille
}

/**
 * Utility-funktio asynkronisiin toimintoihin
 */
async function asyncTryCatch(asyncFn, errorContext) {
    try {
        return await asyncFn();
    } catch (error) {
        handleError(error, errorContext);
        return null;
    }
}
