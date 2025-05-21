/**
 * BridgeCircle - Palvelinkoodi
 * Yksinkertaistettu palvelinkoodi, jossa kaikki toiminnallisuus on yhdessä tiedostossa
 */

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs/promises');

// Alusta Express-sovellus ja palvelin
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Palvelimen tilat
const pöydät = new Map(); // Aktiiviset pöydät koodin mukaan
const pelaajat = new Map(); // Pelaajat WebSocket-ID:n mukaan

// Vakiot
const KORTTIMAAT = ["♠", "♥", "♦", "♣"];
const KORTTIARVOT = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
const MAX_IDLE_AIKA = 3600000; // 1 tunti millisekunteina

// Staattiset tiedostot
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Health check -endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    uptime: process.uptime(),
    timestamp: Date.now()
  });
});

// Taustaprosessit
setInterval(siivousProsessi, 300000); // Siivous 5 minuutin välein

// WebSocket-yhteyden käsittely
wss.on('connection', (ws) => {
  console.log('Uusi asiakas yhdistetty');
  let pelaajaTunnus = null;
  
  // Luo pelaajatunnus
  pelaajaTunnus = generateId();
  pelaajat.set(pelaajaTunnus, {
    ws,
    pöytä: null,
    nimi: null,
    paikka: null,
    yhdistetty: Date.now()
  });
  
  // Rekisteröi pelaajan ping-vastaaja
  startPingPong(ws);
  
  // Viestin käsittely
  ws.on('message', async (viesti) => {
    try {
      const data = JSON.parse(viesti);
      console.log('Vastaanotettu viesti:', data.type);
      
      switch (data.type) {
        case 'ping':
          // Vastaa pongilla
          lähetäViesti(ws, { type: 'pong' });
          break;
          
        case 'haeAktiivisetPöydät':
          // Lähetä lista aktiivisista pöydistä
          lähetäAktiivisetPöydät(ws);
          break;
          
        case 'luoPöytä':
          // Luo uusi pöytä
          luoPöytä(ws, pelaajaTunnus, data);
          break;
          
        case 'liityPöytään':
          // Liity olemassa olevaan pöytään
          liityPöytään(ws, pelaajaTunnus, data);
          break;
          
        case 'valitsePaikka':
          // Valitse paikka pöydässä
          valitsePaikka(ws, pelaajaTunnus, data);
          break;
          
        case 'haePöydänTiedot':
          // Hae tietyn pöydän tiedot
          haePöydänTiedot(ws, pelaajaTunnus, data);
          break;
          
        case 'poistaPöydästä':
          // Poista pelaaja pöydästä
          poistaPöydästä(ws, pelaajaTunnus);
          break;
          
        case 'aloitaPeli':
          // Aloita peli
          aloitaPeli(ws, pelaajaTunnus, data);
          break;
          
        case 'lähetäChatViesti':
          // Lähetä chat-viesti
          lähetäChatViesti(ws, pelaajaTunnus, data);
          break;
          
        case 'teeTarjous':
          // Tee tarjous
          teeTarjous(ws, pelaajaTunnus, data);
          break;
          
        case 'pelaaKortti':
          // Pelaa kortti
          pelaaKortti(ws, pelaajaTunnus, data);
          break;
          
        case 'aloitaUusiPeli':
          // Aloita uusi peli
          aloitaUusiPeli(ws, pelaajaTunnus, data);
          break;
          
        case 'luoYksinpeli':
          // Luo yksinpeli GIB-tekoälyä vastaan
          luoYksinpeli(ws, pelaajaTunnus, data);
          break;
          
        case 'resetoiYksinpeli':
          // Resetoi yksinpeli
          resetoiYksinpeli(ws, pelaajaTunnus, data);
          break;
      }
    } catch (error) {
      console.error('Virhe viestin käsittelyssä:', error);
      lähetäVirhe(ws, 'Virhe viestin käsittelyssä');
    }
  });
  
  // Yhteyden katkeamisen käsittely
  ws.on('close', () => {
    console.log('Asiakas katkaisee yhteyden');
    käsitteleYhteydenKatkeaminen(pelaajaTunnus);
  });
  
  // Yhteysvirheen käsittely
  ws.on('error', (error) => {
    console.error('WebSocket-virhe:', error);
    käsitteleYhteydenKatkeaminen(pelaajaTunnus);
  });
});

/**
 * Käsittele pelaajan yhteyden katkeaminen
 * @param {string} pelaajaTunnus - Pelaajan tunnus
 */
function käsitteleYhteydenKatkeaminen(pelaajaTunnus) {
  const pelaaja = pelaajat.get(pelaajaTunnus);
  if (!pelaaja) return;
  
  // Jos pelaaja oli jossain pöydässä, poista siitä
  if (pelaaja.pöytä) {
    const pöytä = pöydät.get(pelaaja.pöytä);
    if (pöytä) {
      // Jos peli on käynnissä, korvaa pelaaja GIB:llä
      if (pöytä.tila === 'pelaamassa') {
        korvaaPelaaja(pöytä, pelaaja.paikka);
      } else {
        // Muuten poista pelaaja pöydästä
        poistaPelaajaPoydasta(pelaaja, pöytä);
      }
    }
  }
  
  // Poista pelaaja
  pelaajat.delete(pelaajaTunnus);
}

/**
 * Luo uusi pöytä
 * @param {WebSocket} ws - WebSocket-yhteys
 * @param {string} pelaajaTunnus - Pelaajan tunnus
 * @param {Object} data - Pöydän luontiin liittyvä data
 */
function luoPöytä(ws, pelaajaTunnus, data) {
  const { pelaajanNimi, paikka } = data;
  
  if (!pelaajanNimi || !paikka) {
    lähetäVirhe(ws, 'Nimi tai paikka puuttuu');
    return;
  }
  
  const pelaaja = pelaajat.get(pelaajaTunnus);
  
  // Tarkista onko pelaaja jo jossain pöydässä
  if (pelaaja.pöytä) {
    lähetäVirhe(ws, 'Olet jo liittynyt pöytään');
    return;
  }
  
  // Luo pöytäkoodi
  const pöytäkoodi = luoPöytäkoodi();
  
  // Luo pöytäobjekti
  const pöytä = {
    koodi: pöytäkoodi,
    pelaajat: {
      north: null,
      east: null,
      south: null,
      west: null
    },
    tila: 'odottaa', // 'odottaa', 'pelaamassa', 'päättynyt'
    peliTila: null,
    tarjousTila: null,
    luotu: Date.now(),
    viimeisinAktiviteetti: Date.now(),
    luoja: pelaajaTunnus,
    onYksinpeli: false
  };
  
  // Aseta pelaaja pöytään
  pöytä.pelaajat[paikka] = {
    nimi: pelaajanNimi,
    tunnus: pelaajaTunnus,
    tyyppi: 'human'
  };
  
  // Tallenna pöytä ja päivitä pelaajan tiedot
  pöydät.set(pöytäkoodi, pöytä);
  pelaaja.pöytä = pöytäkoodi;
  pelaaja.nimi = pelaajanNimi;
  pelaaja.paikka = paikka;
  
  // Ilmoita onnistuneesta pöydän luomisesta
  lähetäViesti(ws, {
    type: 'pöytäLuotu',
    pöytäkoodi,
    pöytä: suodataPöytä(pöytä)
  });
  
  console.log(`Pöytä ${pöytäkoodi} luotu, pelaaja ${pelaajanNimi} (${paikka})`);
}

/**
 * Liity olemassa olevaan pöytään
 * @param {WebSocket} ws - WebSocket-yhteys
 * @param {string} pelaajaTunnus - Pelaajan tunnus
 * @param {Object} data - Pöytään liittymiseen liittyvä data
 */
function liityPöytään(ws, pelaajaTunnus, data) {
  const { pelaajanNimi, pöytäkoodi } = data;
  
  if (!pelaajanNimi || !pöytäkoodi) {
    lähetäVirhe(ws, 'Nimi tai pöytäkoodi puuttuu');
    return;
  }
  
  const pöytä = pöydät.get(pöytäkoodi);
  if (!pöytä) {
    lähetäVirhe(ws, 'Pöytää ei löydy');
    return;
  }
  
  if (pöytä.tila !== 'odottaa') {
    lähetäVirhe(ws, 'Peli on jo käynnissä');
    return;
  }
  
  const pelaaja = pelaajat.get(pelaajaTunnus);
  
  // Tarkista onko pelaaja jo jossain pöydässä
  if (pelaaja.pöytä) {
    lähetäVirhe(ws, 'Olet jo liittynyt pöytään');
    return;
  }
  
  // Hae vapaat paikat
  const vapaatPaikat = Object.entries(pöytä.pelaajat)
    .filter(([pos, pelaaja]) => pelaaja === null)
    .map(([pos]) => pos);
    
  if (vapaatPaikat.length === 0) {
    lähetäVirhe(ws, 'Pöytä on täynnä');
    return;
  }
  
  // Päivitä pelaajan tiedot
  pelaaja.nimi = pelaajanNimi;
  
  // Lähetä vapaat paikat
  lähetäViesti(ws, {
    type: 'valitsePaikka',
    pöytäkoodi,
    paikat: vapaatPaikat,
    nykyisetPelaajat: suodataPöydänPelaajat(pöytä.pelaajat)
  });
}

/**
 * Valitse paikka pöydässä
 * @param {WebSocket} ws - WebSocket-yhteys
 * @param {string} pelaajaTunnus - Pelaajan tunnus
 * @param {Object} data - Paikan valintaan liittyvä data
 */
function valitsePaikka(ws, pelaajaTunnus, data) {
  const { pöytäkoodi, paikka, pelaajanNimi } = data;
  
  if (!pöytäkoodi || !paikka || !pelaajanNimi) {
    lähetäVirhe(ws, 'Puutteelliset tiedot');
    return;
  }
  
  const pöytä = pöydät.get(pöytäkoodi);
  if (!pöytä) {
    lähetäVirhe(ws, 'Pöytää ei löydy');
    return;
  }
  
  if (pöytä.pelaajat[paikka]) {
    lähetäVirhe(ws, 'Paikka on jo varattu');
    return;
  }
  
  const pelaaja = pelaajat.get(pelaajaTunnus);
  
  // Aseta pelaaja pöytään
  pöytä.pelaajat[paikka] = {
    nimi: pelaajanNimi,
    tunnus: pelaajaTunnus,
    tyyppi: 'human'
  };
  
  // Päivitä pelaajan tiedot
  pelaaja.pöytä = pöytäkoodi;
  pelaaja.paikka = paikka;
  
  // Ilmoita kaikille pöydän pelaajille
  lähetäPöydänPelaajille(pöytä, {
    type: 'pelaajaLiittyi',
    paikka,
    pelaajanNimi,
    pöytä: suodataPöytä(pöytä)
  });
  
  console.log(`Pelaaja ${pelaajanNimi} liittyi pöytään ${pöytäkoodi} paikalle ${paikka}`);
}

/**
 * Hae pöydän tiedot
 * @param {WebSocket} ws - WebSocket-yhteys
 * @param {string} pelaajaTunnus - Pelaajan tunnus
 * @param {Object} data - Pöydän tietojen hakuun liittyvä data
 */
function haePöydänTiedot(ws, pelaajaTunnus, data) {
  const { pöytäkoodi } = data;
  
  if (!pöytäkoodi) {
    lähetäVirhe(ws, 'Pöytäkoodi puuttuu');
    return;
  }
  
  const pöytä = pöydät.get(pöytäkoodi);
  if (!pöytä) {
    lähetäVirhe(ws, 'Pöytää ei löydy');
    return;
  }
  
  lähetäViesti(ws, {
    type: 'pöydänTiedot',
    pöytä: suodataPöytä(pöytä)
  });
}

/**
 * Poista pelaaja pöydästä
 * @param {WebSocket} ws - WebSocket-yhteys
 * @param {string} pelaajaTunnus - Pelaajan tunnus
 */
function poistaPöydästä(ws, pelaajaTunnus) {
  const pelaaja = pelaajat.get(pelaajaTunnus);
  if (!pelaaja || !pelaaja.pöytä) {
    lähetäVirhe(ws, 'Et ole liittynyt mihinkään pöytään');
    return;
  }
  
  const pöytä = pöydät.get(pelaaja.pöytä);
  if (!pöytä) {
    // Pöytää ei löydy, puhdista pelaajan tiedot
    pelaaja.pöytä = null;
    pelaaja.paikka = null;
    return;
  }
  
  poistaPelaajaPoydasta(pelaaja, pöytä);
}

/**
 * Poista pelaaja pöydästä (apufunktio)
 * @param {Object} pelaaja - Pelaajan tiedot
 * @param {Object} pöytä - Pöytäobjekti
 */
function poistaPelaajaPoydasta(pelaaja, pöytä) {
  const paikka = pelaaja.paikka;
  
  // Jos peli on käynnissä, korvaa pelaaja GIB:llä
  if (pöytä.tila === 'pelaamassa') {
    korvaaPelaaja(pöytä, paikka);
  } else {
    // Muuten poista pelaaja pöydästä
    pöytä.pelaajat[paikka] = null;
    
    // Ilmoita muille pelaajille
    lähetäPöydänPelaajille(pöytä, {
      type: 'pelaajaPoistui',
      paikka,
      pöytä: suodataPöytä(pöytä)
    });
  }
  
  // Puhdista pelaajan tiedot
  pelaaja.pöytä = null;
  pelaaja.paikka = null;
  
  // Jos pöytä on tyhjä, poista se
  const aktiivisetPelaajat = Object.values(pöytä.pelaajat).filter(p => p !== null);
  if (aktiivisetPelaajat.length === 0) {
    pöydät.delete(pöytä.koodi);
    console.log(`Pöytä ${pöytä.koodi} poistettu (tyhjä)`);
  }
}

/**
 * Korvaa pelaaja GIB-tekoälyllä
 * @param {Object} pöytä - Pöytäobjekti
 * @param {string} paikka - Korvattavan pelaajan paikka
 */
function korvaaPelaaja(pöytä, paikka) {
  const vanhanimi = pöytä.pelaajat[paikka] ? pöytä.pelaajat[paikka].nimi : null;
  
  // Korvaa pelaaja GIB:llä
  pöytä.pelaajat[paikka] = {
    nimi: `GIB ${paikka}`,
    tunnus: null,
    tyyppi: 'gib'
  };
  
  // Ilmoita muille pelaajille
  lähetäPöydänPelaajille(pöytä, {
    type: 'pelaajiaVaihdettu',
    paikka,
    vanhanimi,
    pöytä: suodataPöytä(pöytä)
  });
  
  // Jos korvattu pelaaja oli vuorossa, GIB:n vuoro
  if (pöytä.peliTila && pöytä.peliTila.nykyinenPelaaja === paikka) {
    setTimeout(() => {
      teeGIBsiirto(pöytä, paikka);
    }, 1500);
  } else if (pöytä.tarjousTila && pöytä.tarjousTila.nykyinenTarjoaja === paikka) {
    setTimeout(() => {
      teeGIBtarjous(pöytä, paikka);
    }, 1500);
  }
}

/**
 * Aloita peli
 * @param {WebSocket} ws - WebSocket-yhteys
 * @param {string} pelaajaTunnus - Pelaajan tunnus
 * @param {Object} data - Pelin aloitukseen liittyvä data
 */
function aloitaPeli(ws, pelaajaTunnus, data) {
  const { pöytäkoodi } = data;
  
  if (!pöytäkoodi) {
    lähetäVirhe(ws, 'Pöytäkoodi puuttuu');
    return;
  }
  
  const pöytä = pöydät.get(pöytäkoodi);
  if (!pöytä) {
    lähetäVirhe(ws, 'Pöytää ei löydy');
    return;
  }
  
  const pelaaja = pelaajat.get(pelaajaTunnus);
  
  // Tarkista onko oikeus aloittaa peli
  if (!pelaaja || pelaaja.pöytä !== pöytäkoodi) {
    lähetäVirhe(ws, 'Sinulla ei ole oikeutta aloittaa peliä');
    return;
  }
  
  pöytä.tila = 'pelaamassa';
  pöytä.viimeisinAktiviteetti = Date.now();
  
  // Korvaa puuttuvat pelaajat GIB-tekoälyllä
  for (const paikka of ['north', 'east', 'south', 'west']) {
    if (!pöytä.pelaajat[paikka]) {
      pöytä.pelaajat[paikka] = {
        nimi: `GIB ${paikka}`,
        tunnus: null,
        tyyppi: 'gib'
      };
    }
  }
  
  try {
    // Jaa kortit
    pöytä.peliTila = luoPeliTila(pöytä);
    pöytä.tarjousTila = luoTarjousTila(pöytä);
    
    // Lähetä pelin tila kaikille pelaajille
    lähetäPöydänPelaajille(pöytä, {
      type: 'peliAlkoi',
      peliTila: suodataPeliTila(pöytä.peliTila, null),
      tarjousTila: pöytä.tarjousTila,
      pelaajat: suodataPöydänPelaajat(pöytä.pelaajat)
    });
    
    // Lähetä kunkin pelaajan omat kortit yksityisesti
    for (const [paikka, pelaajaTiedot] of Object.entries(pöytä.pelaajat)) {
      if (pelaajaTiedot.tyyppi === 'human' && pelaajaTiedot.tunnus) {
        const pelaaja = pelaajat.get(pelaajaTiedot.tunnus);
        if (pelaaja && pelaaja.ws) {
          lähetäViesti(pelaaja.ws, {
            type: 'omatKortit',
            asema: paikka,
            kortit: pöytä.peliTila.kädet[paikka]
          });
        }
      }
    }
    
    console.log(`Peli aloitettu pöydässä ${pöytäkoodi}`);
    
    // Jos ensimmäinen tarjoaja on GIB, käsittele GIB:n vuoro
    if (pöytä.pelaajat[pöytä.tarjousTila.nykyinenTarjoaja].tyyppi === 'gib') {
      setTimeout(() => {
        teeGIBtarjous(pöytä, pöytä.tarjousTila.nykyinenTarjoaja);
      }, 1500);
    }
  } catch (error) {
    console.error('Virhe pelin aloittamisessa:', error);
    lähetäVirhe(ws, 'Virhe pelin aloittamisessa');
    pöytä.tila = 'odottaa';
  }
}

/**
 * Lähetä chat-viesti
 * @param {WebSocket} ws - WebSocket-yhteys
 * @param {string} pelaajaTunnus - Pelaajan tunnus
 * @param {Object} data - Chat-viestiin liittyvä data
 */
function lähetäChatViesti(ws, pelaajaTunnus, data) {
  const { pöytäkoodi, viesti } = data;
  
  if (!pöytäkoodi || !viesti) {
    return;
  }
  
  const pöytä = pöydät.get(pöytäkoodi);
  if (!pöytä) {
    return;
  }
  
  const pelaaja = pelaajat.get(pelaajaTunnus);
  if (!pelaaja || !pelaaja.paikka) {
    return;
  }
  
  // Lähetä chat-viesti kaikille pöydässä
  lähetäPöydänPelaajille(pöytä, {
    type: 'chatViesti',
    lähettäjä: pelaaja.nimi,
    paikka: pelaaja.paikka,
    viesti,
    aikaleima: Date.now()
  });
}

/**
 * Tee tarjous
 * @param {WebSocket} ws - WebSocket-yhteys
 * @param {string} pelaajaTunnus - Pelaajan tunnus
 * @param {Object} data - Tarjoukseen liittyvä data
 */
function teeTarjous(ws, pelaajaTunnus, data) {
  const { pöytäkoodi, asema, tarjous } = data;
  
  if (!pöytäkoodi || !asema || !tarjous) {
    lähetäVirhe(ws, 'Puutteelliset tarjoustiedot');
    return;
  }
  
  const pöytä = pöydät.get(pöytäkoodi);
  if (!pöytä) {
    lähetäVirhe(ws, 'Pöytää ei löydy');
    return;
  }
  
  if (pöytä.tila !== 'pelaamassa') {
    lähetäVirhe(ws, 'Peli ei ole käynnissä');
    return;
  }
  
  if (!pöytä.tarjousTila || pöytä.tarjousTila.tarjousVaiheValmis) {
    lähetäVirhe(ws, 'Tarjousvaihe on jo päättynyt');
    return;
  }
  
  // Tarkista että pelaaja on vuorossa
  if (pöytä.tarjousTila.nykyinenTarjoaja !== asema) {
    lähetäVirhe(ws, 'Ei ole sinun vuorosi tarjota');
    return;
  }
  
  // Tarkista että tämä pelaaja hallitsee tätä paikkaa
  const pelaaja = pelaajat.get(pelaajaTunnus);
  if (!pelaaja || pelaaja.paikka !== asema) {
    lähetäVirhe(ws, 'Et voi tarjota tästä paikasta');
    return;
  }
  
  // Tarkista tarjouksen validius
  if (!onkoTarjousValidi(tarjous, pöytä.tarjousTila.korkeinTarjous)) {
    lähetäVirhe(ws, 'Epäkelpo tarjous');
    return;
  }
  
  // Käsittele tarjous
  käsitteleTarjous(pöytä, asema, tarjous);
}

/**
 * Käsittele tarjous
 * @param {Object} pöytä - Pöytäobjekti
 * @param {string} asema - Tarjoajan paikka
 * @param {string} tarjous - Tehty tarjous
 */
function käsitteleTarjous(pöytä, asema, tarjous) {
  pöytä.viimeisinAktiviteetti = Date.now();
  
  // Lisää tarjous historiaan
  const tarjousInfo = {
    pelaaja: asema,
    tarjous: tarjous,
    kierros: pöytä.tarjousTila.nykyinenKierros
  };
  
  pöytä.tarjousTila.tarjousHistoria.push(tarjousInfo);
  
  // Päivitä peräkkäiset passit
  if (tarjous === 'P') {
    pöytä.tarjousTila.peräkkäisetPassit++;
  } else {
    pöytä.tarjousTila.peräkkäisetPassit = 0;
    
    // Päivitä korkein tarjous jos ei pass, double tai redouble
    if (!['P', 'X', 'XX'].includes(tarjous)) {
      pöytä.tarjousTila.korkeinTarjous = tarjous;
    }
  }
  
  // Tarkista onko tarjousvaihe päättynyt
  if (onkoTarjousvaihePäättynyt(pöytä.tarjousTila)) {
    viimeisteleTarjousvaihe(pöytä);
  } else {
    // Siirry seuraavaan tarjoajaan
    siirräSeuraavaanTarjoajaan(pöytä.tarjousTila);
    
    // Ilmoita kaikille pelaajille tarjouksesta ja uudesta vuorosta
    lähetäPöydänPelaajille(pöytä, {
      type: 'tarjousTehty',
      asema,
      tarjous,
      seuraavaTarjoaja: pöytä.tarjousTila.nykyinenTarjoaja,
      tarjousTila: pöytä.tarjousTila
    });
    
    // Jos seuraava tarjoaja on GIB, tee GIB:n tarjous
    if (pöytä.pelaajat[pöytä.tarjousTila.nykyinenTarjoaja].tyyppi === 'gib') {
      setTimeout(() => {
        teeGIBtarjous(pöytä, pöytä.tarjousTila.nykyinenTarjoaja);
      }, 1500);
    }
  }
}

/**
 * Tarkista onko tarjousvaihe päättynyt
 * @param {Object} tarjousTila - Tarjousvaiheen tila
 * @return {boolean} Onko tarjousvaihe päättynyt
 */
function onkoTarjousvaihePäättynyt(tarjousTila) {
  const tarjoukset = tarjousTila.tarjousHistoria;
  
  // Jos neljä passia alussa
  if (tarjoukset.length >= 4 && 
      tarjoukset[0].tarjous === 'P' && 
      tarjoukset[1].tarjous === 'P' && 
      tarjoukset[2].tarjous === 'P' && 
      tarjoukset[3].tarjous === 'P') {
    return true;
  }
  
  // Jos kolme passia sen jälkeen kun joku on tarjonnut
  if (tarjousTila.peräkkäisetPassit === 3 && tarjoukset.length >= 4) {
    // Tarkista että on ainakin yksi tarjous joka ei ole passi
    const onEiPassi = tarjoukset.some(t => t.tarjous !== 'P');
    return onEiPassi;
  }
  
  return false;
}

/**
 * Siirry seuraavaan tarjoajaan
 * @param {Object} tarjousTila - Tarjousvaiheen tila
 */
function siirräSeuraavaanTarjoajaan(tarjousTila) {
  const paikat = ['north', 'east', 'south', 'west'];
  const nykyinenIndeksi = paikat.indexOf(tarjousTila.nykyinenTarjoaja);
  tarjousTila.nykyinenTarjoaja = paikat[(nykyinenIndeksi + 1) % 4];
}

/**
 * Viimeistele tarjousvaihe
 * @param {Object} pöytä - Pöytäobjekti
 */
function viimeisteleTarjousvaihe(pöytä) {
  pöytä.tarjousTila.tarjousVaiheValmis = true;
  
  // Jos kaikki passasivat, ei sopimusta
  if (pöytä.tarjousTila.tarjousHistoria.length === 4 && 
      pöytä.tarjousTila.tarjousHistoria.every(tarjous => tarjous.tarjous === 'P')) {
    
    // Resetoi peli
    pöytä.peliTila.pelivaihe = 'setup';
    
    // Ilmoita pelaajille
    lähetäPöydänPelaajille(pöytä, {
      type: 'kaikkiPassasivat',
      viesti: "Kaikki pelaajat passasivat. Jaa uudelleen."
    });
    
    pöytä.tila = 'odottaa';
    return;
  }
  
  // Määritä lopullinen sopimus
  määritäSopimus(pöytä);
  
  // Määritä pelinviejä ja lepääjä
  määritäPelinviejäJaLepääjä(pöytä);
  
  // Aseta valttimaa
  if (pöytä.tarjousTila.sopimus.charAt(1) === 'N') {
    pöytä.tarjousTila.valttimaa = null; // Ei valttia
  } else {
    switch(pöytä.tarjousTila.sopimus.charAt(1)) {
      case 'C': pöytä.tarjousTila.valttimaa = 'clubs'; break;
      case 'D': pöytä.tarjousTila.valttimaa = 'diamonds'; break;
      case 'H': pöytä.tarjousTila.valttimaa = 'hearts'; break;
      case 'S': pöytä.tarjousTila.valttimaa = 'spades'; break;
    }
  }
  
  // Siirry pelivaiheeseen
  siirryPelivaiheeseen(pöytä);
}

/**
 * Määritä lopullinen sopimus
 * @param {Object} pöytä - Pöytäobjekti
 */
function määritäSopimus(pöytä) {
  // Etsi korkein tarjous
  let korkeinTarjous = null;
  let kahdennettu = false;
  let vastaKahdennettu = false;
  
  for (const tarjousInfo of pöytä.tarjousTila.tarjousHistoria) {
    if (!['P', 'X', 'XX'].includes(tarjousInfo.tarjous)) {
      korkeinTarjous = tarjousInfo.tarjous;
    } else if (tarjousInfo.tarjous === 'X' && korkeinTarjous) {
      kahdennettu = true;
      vastaKahdennettu = false;
    } else if (tarjousInfo.tarjous === 'XX' && kahdennettu) {
      vastaKahdennettu = true;
      kahdennettu = false;
    }
  }
  
  if (!korkeinTarjous) {
    return null; // Kaikki passasivat
  }
  
  // Muodosta sopimus
  let sopimus = korkeinTarjous;
  if (kahdennettu) sopimus += 'X';
  if (vastaKahdennettu) sopimus += 'XX';
  
  pöytä.tarjousTila.sopimus = sopimus;
  
  return sopimus;
}

/**
 * Määritä pelinviejä ja lepääjä
 * @param {Object} pöytä - Pöytäobjekti
 */
function määritäPelinviejäJaLepääjä(pöytä) {
  const sopimusMaa = pöytä.tarjousTila.sopimus.charAt(1);
  
  // Etsi partnershippi joka ensimmäisenä tarjosi tätä maata
  const parit = {
    'north-south': ['north', 'south'],
    'east-west': ['east', 'west']
  };
  
  let pelinviejänPari = null;
  let ensimmäinenPelaaja = null;
  
  for (const tarjousInfo of pöytä.tarjousTila.tarjousHistoria) {
    if (tarjousInfo.tarjous.charAt(1) === sopimusMaa && !['P', 'X', 'XX'].includes(tarjousInfo.tarjous)) {
      const pelaaja = tarjousInfo.pelaaja;
      
      // Määritä mihin pariin tämä pelaaja kuuluu
      for (const [pari, pelaajat] of Object.entries(parit)) {
        if (pelaajat.includes(pelaaja)) {
          pelinviejänPari = pari;
          
          // Tarkista oliko tämä pelaaja parin ensimmäinen tätä maata tarjoava
          if (!ensimmäinenPelaaja || !pelaajat.includes(ensimmäinenPelaaja)) {
            ensimmäinenPelaaja = pelaaja;
          }
          break;
        }
      }
      
      if (pelinviejänPari && ensimmäinenPelaaja) {
        break;
      }
    }
  }
  
  // Aseta pelinviejä ja lepääjä
  if (pelinviejänPari && ensimmäinenPelaaja) {
    pöytä.tarjousTila.pelinviejä = ensimmäinenPelaaja;
    const lepääjänIndeksi = (parit[pelinviejänPari].indexOf(ensimmäinenPelaaja) + 1) % 2;
    pöytä.tarjousTila.lepääjä = parit[pelinviejänPari][lepääjänIndeksi];
  } else {
    // Fallback
    pöytä.tarjousTila.pelinviejä = 'south';
    pöytä.tarjousTila.lepääjä = 'north';
  }
}

/**
 * Siirry pelivaiheeseen
 * @param {Object} pöytä - Pöytäobjekti
 */
function siirryPelivaiheeseen(pöytä) {
  // Siirrä tarjouksen tila pelitilaan
  pöytä.peliTila.sopimus = pöytä.tarjousTila.sopimus;
  pöytä.peliTila.valttimaa = pöytä.tarjousTila.valttimaa;
  pöytä.peliTila.pelinviejä = pöytä.tarjousTila.pelinviejä;
  pöytä.peliTila.lepääjä = pöytä.tarjousTila.lepääjä;
  
  // Päivitä pelivaihe
  pöytä.peliTila.pelivaihe = 'play';
  
  // Aseta ensimmäinen pelaaja (pelinviejän vasemmalla puolella)
  const paikat = ['north', 'east', 'south', 'west'];
  const pelinviejänIndeksi = paikat.indexOf(pöytä.tarjousTila.pelinviejä);
  pöytä.peliTila.nykyinenPelaaja = paikat[(pelinviejänIndeksi + 1) % 4];
  pöytä.peliTila.johtajaPeraalaaja = pöytä.peliTila.nykyinenPelaaja;
  
  // Ilmoita pelaajille
  lähetäPöydänPelaajille(pöytä, {
    type: 'tarjousvaiheValmis',
    sopimus: pöytä.peliTila.sopimus,
    pelinviejä: pöytä.peliTila.pelinviejä,
    lepääjä: pöytä.peliTila.lepääjä,
    valttimaa: pöytä.peliTila.valttimaa,
    nykyinenPelaaja: pöytä.peliTila.nykyinenPelaaja,
    peliTila: suodataPeliTila(pöytä.peliTila, null)
  });
  
  // Lähetä pelaajille heidän omat korttinsa
  for (const [paikka, pelaajaTiedot] of Object.entries(pöytä.pelaajat)) {
    if (pelaajaTiedot.tyyppi === 'human' && pelaajaTiedot.tunnus) {
      const pelaaja = pelaajat.get(pelaajaTiedot.tunnus);
      if (pelaaja && pelaaja.ws) {
        lähetäViesti(pelaaja.ws, {
          type: 'pelivaiheenKortit',
          asema: paikka,
          kortit: pöytä.peliTila.kädet[paikka],
          // Lähetä lepääjän kortit pelinviejälle
          lepääjänKortit: paikka === pöytä.peliTila.pelinviejä ? 
                            pöytä.peliTila.kädet[pöytä.peliTila.lepääjä] : null
        });
      }
    }
  }
  
  // Jos ensimmäinen pelaaja on GIB, tee GIB:n siirto
  if (pöytä.pelaajat[pöytä.peliTila.nykyinenPelaaja].tyyppi === 'gib') {
    setTimeout(() => {
      teeGIBsiirto(pöytä, pöytä.peliTila.nykyinenPelaaja);
    }, 1500);
  }
}

/**
 * Tee GIB-tekoälyn tarjous
 * @param {Object} pöytä - Pöytäobjekti
 * @param {string} asema - GIB:n paikka
 */
function teeGIBtarjous(pöytä, asema) {
  // Yksinkertainen logiikka GIB-tarjoukselle
  
  // Hae validit tarjoukset
  const mahdollisetTarjoukset = haeMahdollisetTarjoukset(pöytä.tarjousTila.korkeinTarjous);
  
  // Käytä strategiaa tarjouksen valintaan
  const tarjous = laskeTarjous(pöytä, asema, mahdollisetTarjoukset);
  
  // Tee valittu tarjous
  käsitteleTarjous(pöytä, asema, tarjous);
}

/**
 * Laske GIB-tekoälyn tarjous
 * @param {Object} pöytä - Pöytäobjekti
 * @param {string} asema - GIB:n paikka
 * @param {Array<string>} mahdollisetTarjoukset - Mahdolliset tarjoukset
 * @return {string} Valittu tarjous
 */
function laskeTarjous(pöytä, asema, mahdollisetTarjoukset) {
  // Hae tiedot pelaajan kädestä
  const käsi = pöytä.peliTila.kädet[asema];
  
  // Yksinkertainen GIB-logiikka
  // Pass on oletusarvo
  let tarjous = 'P';
  
  // 15+ pistettä -> 1NT
  if (laskePisteet(käsi) >= 15 && laskePisteet(käsi) <= 17) {
    tarjous = mahdollisetTarjoukset.includes('1N') ? '1N' : 'P';
  }
  // 12+ pistettä -> 1 pisin maa
  else if (laskePisteet(käsi) >= 12) {
    const maat = ['spades', 'hearts', 'diamonds', 'clubs'];
    const pisinMaa = maat.reduce((pisin, maa) => 
      käsi[maa].length > käsi[pisin].length ? maa : pisin, maat[0]);
    
    if (pisinMaa === 'spades' && käsi[pisinMaa].length >= 5) {
      tarjous = mahdollisetTarjoukset.includes('1S') ? '1S' : 'P';
    } else if (pisinMaa === 'hearts' && käsi[pisinMaa].length >= 5) {
      tarjous = mahdollisetTarjoukset.includes('1H') ? '1H' : 'P';
    } else if (pisinMaa === 'diamonds') {
      tarjous = mahdollisetTarjoukset.includes('1D') ? '1D' : 'P';
    } else if (pisinMaa === 'clubs') {
      tarjous = mahdollisetTarjoukset.includes('1C') ? '1C' : 'P';
    }
  }
  
  // Varmista että tarjous on mahdollinen
  return mahdollisetTarjoukset.includes(tarjous) ? tarjous : 'P';
}

/**
 * Hae mahdolliset tarjoukset
 * @param {string|null} korkeinTarjous - Korkein tarjous tähän asti
 * @return {Array<string>} Mahdolliset tarjoukset
 */
function haeMahdollisetTarjoukset(korkeinTarjous) {
  const mahdollisetTarjoukset = ['P']; // Pass on aina mahdollinen
  
  // Double/redouble-logiikka
  if (korkeinTarjous) {
    mahdollisetTarjoukset.push('X');
  }
  
  // Luo normaalit tarjoukset
  const tasot = ['1', '2', '3', '4', '5', '6', '7'];
  const maat = ['C', 'D', 'H', 'S', 'N'];
  
  if (!korkeinTarjous) {
    // Jos ei ole aiempia tarjouksia, kaikki tarjoukset 1C-7N ovat mahdollisia
    for (const taso of tasot) {
      for (const maa of maat) {
        mahdollisetTarjoukset.push(`${taso}${maa}`);
      }
    }
  } else {
    // Luo kaikki korkeinta tarjousta korkeammat tarjoukset
    const korkeinTaso = parseInt(korkeinTarjous.charAt(0));
    const korkeinMaa = korkeinTarjous.charAt(1);
    const korkeinMaaIndeksi = maat.indexOf(korkeinMaa);
    
    for (let taso = korkeinTaso; taso <= 7; taso++) {
      for (let maaIndeksi = 0; maaIndeksi < maat.length; maaIndeksi++) {
        if (taso === korkeinTaso && maaIndeksi <= korkeinMaaIndeksi) continue;
        mahdollisetTarjoukset.push(`${taso}${maat[maaIndeksi]}`);
      }
    }
  }
  
  return mahdollisetTarjoukset;
}

/**
 * Tarkista onko tarjous validi
 * @param {string} tarjous - Tarkastettava tarjous
 * @param {string|null} korkeinTarjous - Korkein tarjous tähän asti
 * @return {boolean} Onko tarjous validi
 */
function onkoTarjousValidi(tarjous, korkeinTarjous) {
  // Pass on aina validi
  if (tarjous === 'P') return true;
  
  // Double ja Redouble
  if (tarjous === 'X' || tarjous === 'XX') return true;
  
  // Tavallinen tarjous - täytyy olla korkeampi kuin nykyinen korkein
  if (!korkeinTarjous) return true; // Ensimmäinen tarjous on aina validi
  
  const tarjousTaso = parseInt(tarjous.charAt(0));
  const tarjousMaa = tarjous.charAt(1);
  const korkeinTaso = parseInt(korkeinTarjous.charAt(0));
  const korkeinMaa = korkeinTarjous.charAt(1);
  
  const maat = ['C', 'D', 'H', 'S', 'N'];
  const tarjousMaaIndeksi = maat.indexOf(tarjousMaa);
  const korkeinMaaIndeksi = maat.indexOf(korkeinMaa);
  
  if (tarjousTaso > korkeinTaso) return true;
  if (tarjousTaso === korkeinTaso && tarjousMaaIndeksi > korkeinMaaIndeksi) return true;
  
  return false;
}

/**
 * Pelaa kortti
 * @param {WebSocket} ws - WebSocket-yhteys
 * @param {string} pelaajaTunnus - Pelaajan tunnus
 * @param {Object} data - Kortin pelaamiseen liittyvä data
 */
function pelaaKortti(ws, pelaajaTunnus, data) {
  const { pöytäkoodi, asema, maa, kortti } = data;
  
  if (!pöytäkoodi || !asema || !maa || !kortti) {
    lähetäVirhe(ws, 'Puutteelliset tiedot kortin pelaamiseen');
    return;
  }
  
  const pöytä = pöydät.get(pöytäkoodi);
  if (!pöytä) {
    lähetäVirhe(ws, 'Pöytää ei löydy');
    return;
  }
  
  if (pöytä.tila !== 'pelaamassa') {
    lähetäVirhe(ws, 'Peli ei ole käynnissä');
    return;
  }
  
  if (!pöytä.tarjousTila.tarjousVaiheValmis) {
    lähetäVirhe(ws, 'Tarjousvaihe on vielä kesken');
    return;
  }
  
  // Tarkista että pelaaja on vuorossa
  if (pöytä.peliTila.nykyinenPelaaja !== asema) {
    lähetäVirhe(ws, 'Ei ole sinun vuorosi pelata');
    return;
  }
  
  // Tarkista että tämä pelaaja hallitsee tätä paikkaa tai pelaaja on lepääjä
  const onLepääjä = asema === pöytä.peliTila.lepääjä;
  const onKontrolleri = onLepääjä ? 
                    (pöytä.pelaajat[pöytä.peliTila.pelinviejä].tunnus === pelaajaTunnus) : 
                    (pöytä.pelaajat[asema].tunnus === pelaajaTunnus);
  
  if (!onKontrolleri) {
    lähetäVirhe(ws, 'Et voi pelata tästä paikasta');
    return;
  }
  
  // Tarkista että kortti on pelaajan kädessä
  const käsi = pöytä.peliTila.kädet[asema];
  if (!käsi[maa] || !käsi[maa].includes(kortti)) {
    lähetäVirhe(ws, 'Sinulla ei ole tätä korttia');
    return;
  }
  
  // Tarkista väriin tunnustaminen
  if (pöytä.peliTila.nykyinenTikki.length > 0) {
    const johtavaMaa = pöytä.peliTila.nykyinenTikki[0].maa;
    if (maa !== johtavaMaa && käsi[johtavaMaa] && käsi[johtavaMaa].length > 0) {
      lähetäVirhe(ws, 'Sinun täytyy tunnustaa väriä');
      return;
    }
  }
  
  // Käsittele kortin pelaaminen
  käsitteleKortinPelaaminen(pöytä, asema, maa, kortti);
}

/**
 * Käsittele kortin pelaaminen
 * @param {Object} pöytä - Pöytäobjekti
 * @param {string} asema - Pelaajan paikka
 * @param {string} maa - Kortin maa
 * @param {string} kortti - Kortin arvo
 */
function käsitteleKortinPelaaminen(pöytä, asema, maa, kortti) {
  pöytä.viimeisinAktiviteetti = Date.now();
  
  // Lisää kortti tikkiin ja pelattuihin kortteihin
  const pelattuKortti = { pelaaja: asema, maa, kortti };
  pöytä.peliTila.nykyinenTikki.push(pelattuKortti);
  pöytä.peliTila.pelatutKortit.push(pelattuKortti);
  
  // Poista kortti pelaajan kädestä
  pöytä.peliTila.kädet[asema][maa] = 
    pöytä.peliTila.kädet[asema][maa].filter(k => k !== kortti);
  
  // Ilmoita kaikille pelaajille
  lähetäPöydänPelaajille(pöytä, {
    type: 'korttiPelattu',
    asema,
    maa,
    kortti,
    nykyinenTikki: pöytä.peliTila.nykyinenTikki
  });
  
  // Tarkista onko tikki täynnä (4 korttia)
  if (pöytä.peliTila.nykyinenTikki.length === 4) {
    setTimeout(() => {
      käsitteleTikki(pöytä);
    }, 1000);
  } else {
    // Siirry seuraavaan pelaajaan
    pöytä.peliTila.nykyinenPelaaja = haeSeuraaavaPelaaja(pöytä.peliTila.nykyinenPelaaja);
    
    // Ilmoita seuraavasta vuorosta
    lähetäPöydänPelaajille(pöytä, {
      type: 'seuraavaPelaaja',
      nykyinenPelaaja: pöytä.peliTila.nykyinenPelaaja
    });
    
    // Jos seuraava pelaaja on GIB, tee GIB:n siirto
    if (pöytä.pelaajat[pöytä.peliTila.nykyinenPelaaja].tyyppi === 'gib') {
      setTimeout(() => {
        teeGIBsiirto(pöytä, pöytä.peliTila.nykyinenPelaaja);
      }, 1500);
    }
  }
}

/**
 * Tee GIB-tekoälyn siirto
 * @param {Object} pöytä - Pöytäobjekti
 * @param {string} asema - GIB:n paikka
 */
function teeGIBsiirto(pöytä, asema) {
  // Valitse pelattava kortti
  const käsi = pöytä.peliTila.kädet[asema];
  let pelattavatKortit = [];
  
  // Jos tämä on ensimmäinen kortti tikkiin, käytä johtamisstrategiaa
  if (pöytä.peliTila.nykyinenTikki.length === 0) {
    // Yksinkertaisuuden vuoksi, pelaa satunnainen kortti
    for (const maa of ['spades', 'hearts', 'diamonds', 'clubs']) {
      for (const kortti of käsi[maa] || []) {
        pelattavatKortit.push({ maa, kortti });
      }
    }
  } else {
    // Muuten tunnusta väriin jos mahdollista
    const johtavaMaa = pöytä.peliTila.nykyinenTikki[0].maa;
    
    if (käsi[johtavaMaa] && käsi[johtavaMaa].length > 0) {
      // Pitää tunnustaa väriin
      for (const kortti of käsi[johtavaMaa]) {
        pelattavatKortit.push({ maa: johtavaMaa, kortti });
      }
    } else {
      // Voi pelata minkä tahansa kortin
      for (const maa of ['spades', 'hearts', 'diamonds', 'clubs']) {
        for (const kortti of käsi[maa] || []) {
          pelattavatKortit.push({ maa, kortti });
        }
      }
    }
  }
  
  if (pelattavatKortit.length === 0) {
    console.error(`GIB-pelaajalla ${asema} ei ole laillisia kortteja pelattavaksi!`);
    return;
  }
  
  // Valitse satunnainen kortti
  const valittuKorttiIndeksi = Math.floor(Math.random() * pelattavatKortit.length);
  const valittuKortti = pelattavatKortit[valittuKorttiIndeksi];
  
  // Pelaa valittu kortti
  käsitteleKortinPelaaminen(pöytä, asema, valittuKortti.maa, valittuKortti.kortti);
}

/**
 * Hae seuraava pelaaja
 * @param {string} nykyinenPelaaja - Nykyinen pelaaja
 * @return {string} Seuraava pelaaja
 */
function haeSeuraaavaPelaaja(nykyinenPelaaja) {
  const paikat = ['north', 'east', 'south', 'west'];
  const nykyinenIndeksi = paikat.indexOf(nykyinenPelaaja);
  return paikat[(nykyinenIndeksi + 1) % 4];
}

/**
 * Käsittele täysi tikki
 * @param {Object} pöytä - Pöytäobjekti
 */
function käsitteleTikki(pöytä) {
  // Määritä tikin voittaja
  const voittaja = määritäTikinVoittaja(pöytä);
  
  // Päivitä tikit
  if (voittaja === 'north' || voittaja === 'south') {
    pöytä.peliTila.tikit.ns += 1;
  } else {
    pöytä.peliTila.tikit.ew += 1;
  }
  
  pöytä.peliTila.kokonaisTikit += 1;
  
  // Tyhjennä nykyinen tikki
  const valmisTikki = [...pöytä.peliTila.nykyinenTikki];
  pöytä.peliTila.nykyinenTikki = [];
  
  // Aseta voittaja seuraavaksi johtajaksi
  pöytä.peliTila.johtajaPelaaja = voittaja;
  pöytä.peliTila.nykyinenPelaaja = voittaja;
  
  // Tarkista onko peli päättynyt (13 tikkiä pelattu)
  if (pöytä.peliTila.kokonaisTikit >= 13) {
    // Peli päättyy
    päätäPeli(pöytä);
    return;
  }
  
  // Ilmoita tikin voittajasta
  lähetäPöydänPelaajille(pöytä, {
    type: 'tikkiValmis',
    voittaja,
    tikki: valmisTikki,
    tikit: pöytä.peliTila.tikit,
    seuraavaPelaaja: voittaja
  });
  
  // Jos seuraava pelaaja on GIB, tee GIB:n siirto
  if (pöytä.pelaajat[pöytä.peliTila.nykyinenPelaaja].tyyppi === 'gib') {
    setTimeout(() => {
      teeGIBsiirto(pöytä, pöytä.peliTila.nykyinenPelaaja);
    }, 1500);
  }
}

/**
 * Määritä tikin voittaja
 * @param {Object} pöytä - Pöytäobjekti
 * @return {string} Voittajan paikka
 */
function määritäTikinVoittaja(pöytä) {
  const arvot = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
  const johtavaMaa = pöytä.peliTila.nykyinenTikki[0].maa;
  const valttimaa = pöytä.peliTila.valttimaa;
  
  let korkeinKortti = pöytä.peliTila.nykyinenTikki[0];
  let voittajaPelaaja = pöytä.peliTila.nykyinenTikki[0].pelaaja;
  
  for (let i = 1; i < pöytä.peliTila.nykyinenTikki.length; i++) {
    const nykyinenKortti = pöytä.peliTila.nykyinenTikki[i];
    
    // Tarkista onko tämä kortti valtti kun korkein ei ole
    if (valttimaa && nykyinenKortti.maa === valttimaa && korkeinKortti.maa !== valttimaa) {
      korkeinKortti = nykyinenKortti;
      voittajaPelaaja = nykyinenKortti.pelaaja;
    }
    // Tarkista ovatko molemmat kortit valtteja
    else if (valttimaa && nykyinenKortti.maa === valttimaa && korkeinKortti.maa === valttimaa) {
      if (arvot.indexOf(nykyinenKortti.kortti) > arvot.indexOf(korkeinKortti.kortti)) {
        korkeinKortti = nykyinenKortti;
        voittajaPelaaja = nykyinenKortti.pelaaja;
      }
    }
    // Tarkista onko nykyinen kortti johtavaa maata ja korkein myös
    else if (nykyinenKortti.maa === johtavaMaa && korkeinKortti.maa === johtavaMaa) {
      if (arvot.indexOf(nykyinenKortti.kortti) > arvot.indexOf(korkeinKortti.kortti)) {
        korkeinKortti = nykyinenKortti;
        voittajaPelaaja = nykyinenKortti.pelaaja;
      }
    }
    // Jos nykyinen kortti on johtavaa maata mutta korkein ei (eikä valtti)
    else if (nykyinenKortti.maa === johtavaMaa && korkeinKortti.maa !== johtavaMaa && 
            (!valttimaa || korkeinKortti.maa !== valttimaa)) {
      korkeinKortti = nykyinenKortti;
      voittajaPelaaja = nykyinenKortti.pelaaja;
    }
  }
  
  return voittajaPelaaja;
}

/**
 * Päätä peli
 * @param {Object} pöytä - Pöytäobjekti
 */
function päätäPeli(pöytä) {
  pöytä.peliTila.pelivaihe = 'end';
  
  // Laske tulos sopimuksen perusteella
  let tulosViesti = '';
  
  if (pöytä.peliTila.sopimus) {
    const taso = parseInt(pöytä.peliTila.sopimus.charAt(0));
    const tarvitutTikit = taso + 6; // Sopimustaso + 6
    
    // Määritä tehtiinkö sopimus
    const pelinviejänPuoli = pöytä.peliTila.pelinviejä === 'north' || pöytä.peliTila.pelinviejä === 'south' ? 'ns' : 'ew';
    const tehdytTikit = pöytä.peliTila.tikit[pelinviejänPuoli];
    
    if (tehdytTikit >= tarvitutTikit) {
      // Sopimus tehty
      tulosViesti = `Sopimus ${formatoiSopimus(pöytä.peliTila.sopimus)} tehty! ${paikanNimi(pöytä.peliTila.pelinviejä)}-${paikanNimi(pöytä.peliTila.lepääjä)} sai ${tehdytTikit} tikkiä.`;
    } else {
      // Sopimus pieti
      tulosViesti = `Sopimus ${formatoiSopimus(pöytä.peliTila.sopimus)} pietiin ${tarvitutTikit - tehdytTikit} tikillä. ${paikanNimi(pöytä.peliTila.pelinviejä)}-${paikanNimi(pöytä.peliTila.lepääjä)} sai ${tehdytTikit} tikkiä.`;
    }
  } else {
    // Ei sopimusta - raportoi vain tikit
    if (pöytä.peliTila.tikit.ns > pöytä.peliTila.tikit.ew) {
      tulosViesti = `Peli päättyi! Pohjoinen-Etelä voitti ${pöytä.peliTila.tikit.ns} tikkiä vs. ${pöytä.peliTila.tikit.ew}.`;
    } else if (pöytä.peliTila.tikit.ew > pöytä.peliTila.tikit.ns) {
      tulosViesti = `Peli päättyi! Itä-Länsi voitti ${pöytä.peliTila.tikit.ew} tikkiä vs. ${pöytä.peliTila.tikit.ns}.`;
    } else {
      tulosViesti = `Peli päättyi! Tasapeli, molemmat joukkueet saivat ${pöytä.peliTila.tikit.ns} tikkiä.`;
    }
  }
  
  // Ilmoita pelaajille pelin päättymisestä
  lähetäPöydänPelaajille(pöytä, {
    type: 'peliLoppui',
    viesti: tulosViesti,
    tikit: pöytä.peliTila.tikit,
    sopimus: pöytä.peliTila.sopimus
  });
  
  // Resetoi pöytä uutta peliä varten
  pöytä.tila = 'odottaa';
  pöytä.peliTila = null;
  pöytä.tarjousTila = null;
}

/**
 * Aloita uusi peli
 * @param {WebSocket} ws - WebSocket-yhteys
 * @param {string} pelaajaTunnus - Pelaajan tunnus
 * @param {Object} data - Pelin aloitukseen liittyvä data
 */
function aloitaUusiPeli(ws, pelaajaTunnus, data) {
  const { pöytäkoodi } = data;
  
  if (!pöytäkoodi) {
    lähetäVirhe(ws, 'Pöytäkoodi puuttuu');
    return;
  }
  
  const pöytä = pöydät.get(pöytäkoodi);
  if (!pöytä) {
    lähetäVirhe(ws, 'Pöytää ei löydy');
    return;
  }
  
  const pelaaja = pelaajat.get(pelaajaTunnus);
  
  // Tarkista onko oikeus aloittaa peli
  if (!pelaaja || pelaaja.pöytä !== pöytäkoodi) {
    lähetäVirhe(ws, 'Sinulla ei ole oikeutta aloittaa peliä');
    return;
  }
  
  // Aloita peli
  aloitaPeli(ws, pelaajaTunnus, data);
}

/**
 * Luo yksinpeli GIB-tekoälyä vastaan
 * @param {WebSocket} ws - WebSocket-yhteys
 * @param {string} pelaajaTunnus - Pelaajan tunnus
 * @param {Object} data - Yksinpelin luontiin liittyvä data
 */
function luoYksinpeli(ws, pelaajaTunnus, data) {
  const { pelaajanNimi } = data;
  
  if (!pelaajanNimi) {
    lähetäVirhe(ws, 'Pelaajan nimi puuttuu');
    return;
  }
  
  const pelaaja = pelaajat.get(pelaajaTunnus);
  
  // Tarkista onko pelaaja jo jossain pöydässä
  if (pelaaja.pöytä) {
    lähetäVirhe(ws, 'Olet jo liittynyt pöytään');
    return;
  }
  
  // Luo pöytäkoodi
  const pöytäkoodi = luoPöytäkoodi();
  
  // Luo pöytäobjekti
  const pöytä = {
    koodi: pöytäkoodi,
    pelaajat: {
      north: { nimi: 'GIB North', tunnus: null, tyyppi: 'gib' },
      east: { nimi: 'GIB East', tunnus: null, tyyppi: 'gib' },
      south: { nimi: pelaajanNimi, tunnus: pelaajaTunnus, tyyppi: 'human' },
      west: { nimi: 'GIB West', tunnus: null, tyyppi: 'gib' }
    },
    tila: 'odottaa',
    peliTila: null,
    tarjousTila: null,
    luotu: Date.now(),
    viimeisinAktiviteetti: Date.now(),
    luoja: pelaajaTunnus,
    onYksinpeli: true
  };
  
  // Tallenna pöytä ja päivitä pelaajan tiedot
  pöydät.set(pöytäkoodi, pöytä);
  pelaaja.pöytä = pöytäkoodi;
  pelaaja.nimi = pelaajanNimi;
  pelaaja.paikka = 'south';
  
  // Ilmoita onnistuneesta yksinpelin luomisesta
  lähetäViesti(ws, {
    type: 'yksinpeliLuotu',
    pöytäkoodi
  });
  
  // Aloita peli heti
  aloitaPeli(ws, pelaajaTunnus, { pöytäkoodi });
  
  console.log(`Yksinpeli ${pöytäkoodi} luotu, pelaaja ${pelaajanNimi}`);
}

/**
 * Resetoi yksinpeli
 * @param {WebSocket} ws - WebSocket-yhteys
 * @param {string} pelaajaTunnus - Pelaajan tunnus
 * @param {Object} data - Yksinpelin resetointiin liittyvä data
 */
function resetoiYksinpeli(ws, pelaajaTunnus, data) {
  const { pöytäkoodi } = data;
  
  if (!pöytäkoodi) {
    lähetäVirhe(ws, 'Pöytäkoodi puuttuu');
    return;
  }
  
  const pöytä = pöydät.get(pöytäkoodi);
  if (!pöytä) {
    lähetäVirhe(ws, 'Pöytää ei löydy');
    return;
  }
  
  if (!pöytä.onYksinpeli) {
    lähetäVirhe(ws, 'Tämä ei ole yksinpeli');
    return;
  }
  
  const pelaaja = pelaajat.get(pelaajaTunnus);
  
  // Tarkista onko oikeus resetoida peli
  if (!pelaaja || pelaaja.pöytä !== pöytäkoodi) {
    lähetäVirhe(ws, 'Sinulla ei ole oikeutta resetoida peliä');
    return;
  }
  
  // Resetoi pöytä
  pöytä.tila = 'odottaa';
  pöytä.peliTila = null;
  pöytä.tarjousTila = null;
  pöytä.viimeisinAktiviteetti = Date.now();
  
  // Aloita peli uudelleen
  aloitaPeli(ws, pelaajaTunnus, { pöytäkoodi });
}

/**
 * Lähetä aktiiviset pöydät pelaajalle
 * @param {WebSocket} ws - WebSocket-yhteys
 */
function lähetäAktiivisetPöydät(ws) {
  const aktiivisetPöydätInfo = Array.from(pöydät.entries())
    .filter(([_, pöytä]) => pöytä.tila === 'odottaa' && !pöytä.onYksinpeli)
    .map(([koodi, pöytä]) => {
      const pelaajaMäärä = Object.values(pöytä.pelaajat).filter(p => p !== null).length;
      return {
        koodi,
        pelaajat: pelaajaMäärä,
        luotu: pöytä.luotu
      };
    });
  
  lähetäViesti(ws, { 
    type: 'aktiivisetPöydät', 
    pöydät: aktiivisetPöydätInfo 
  });
}

/**
 * Laske käden pisteet (HCP)
 * @param {Object} käsi - Käsiobjekti
 * @return {number} Pisteet
 */
function laskePisteet(käsi) {
  const pistearvot = {
    'A': 4, 'K': 3, 'Q': 2, 'J': 1
  };
  
  let yhteensä = 0;
  
  for (const maa of ['spades', 'hearts', 'diamonds', 'clubs']) {
    for (const kortti of käsi[maa] || []) {
      if (pistearvot[kortti]) {
        yhteensä += pistearvot[kortti];
      }
    }
  }
  
  return yhteensä;
}

/**
 * Lähetä viesti WebSocket-yhteyden kautta
 * @param {WebSocket} ws - WebSocket-yhteys
 * @param {Object} viesti - Lähetettävä viesti
 */
function lähetäViesti(ws, viesti) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(viesti));
  }
}

/**
 * Lähetä viesti kaikille pöydän pelaajille
 * @param {Object} pöytä - Pöytäobjekti
 * @param {Object} viesti - Lähetettävä viesti
 */
function lähetäPöydänPelaajille(pöytä, viesti) {
  for (const pelaajaTiedot of Object.values(pöytä.pelaajat)) {
    if (pelaajaTiedot && pelaajaTiedot.tunnus) {
      const pelaaja = pelaajat.get(pelaajaTiedot.tunnus);
      if (pelaaja && pelaaja.ws) {
        lähetäViesti(pelaaja.ws, viesti);
      }
    }
  }
}

/**
 * Lähetä virheilmoitus WebSocket-yhteyden kautta
 * @param {WebSocket} ws - WebSocket-yhteys
 * @param {string} viesti - Virheilmoitus
 */
function lähetäVirhe(ws, viesti) {
  lähetäViesti(ws, { type: 'error', viesti });
}

/**
 * Luo uusi pöytäkoodi
 * @return {string} Pöytäkoodi
 */
function luoPöytäkoodi() {
  // Luo 4-numeroinen pöytäkoodi
  let koodi;
  do {
    koodi = Math.floor(1000 + Math.random() * 9000).toString();
  } while (pöydät.has(koodi));
  
  return koodi;
}

/**
 * Luo uusi pelitila
 * @param {Object} pöytä - Pöytäobjekti
 * @return {Object} Pelitilaobjekti
 */
function luoPeliTila(pöytä) {
  // Jaa kortit
  const kortit = jaaKortit();
  
  return {
    pelaajat: pöytä.pelaajat,
    nykyinenPelaaja: 'south', // Tarjousvaiheessa south aloittaa
    pelivaihe: 'bidding',
    kädet: kortit,
    pelatutKortit: [],
    nykyinenTikki: [],
    sopimus: null,
    valttimaa: null,
    pelinviejä: null,
    lepääjä: null,
    tikit: { ns: 0, ew: 0 },
    kokonaisTikit: 0,
    johtajaPelaaja: 'south'
  };
}

/**
 * Luo uusi tarjoustila
 * @param {Object} pöytä - Pöytäobjekti
 * @return {Object} Tarjoustilaobjekti
 */
function luoTarjousTila(pöytä) {
  return {
    nykyinenTarjoaja: 'south',
    tarjousHistoria: [],
    nykyinenKierros: 1,
    peräkkäisetPassit: 0,
    tarjousVaiheValmis: false,
    korkeinTarjous: null,
    sopimus: null,
    pelinviejä: null,
    lepääjä: null,
    valttimaa: null,
    jakaja: 'south'
  };
}

/**
 * Jaa kortit
 * @return {Object} Käsiobjekti
 */
function jaaKortit() {
  // Luo pakka
  const pakka = [];
  const maat = ['spades', 'hearts', 'diamonds', 'clubs'];
  const arvot = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
  
  for (const maa of maat) {
    for (const arvo of arvot) {
      pakka.push({ maa, arvo });
    }
  }
  
  // Sekoita pakka
  for (let i = pakka.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pakka[i], pakka[j]] = [pakka[j], pakka[i]];
  }
  
  // Jaa kortit
  const kädet = {
    north: { spades: [], hearts: [], diamonds: [], clubs: [] },
    east: { spades: [], hearts: [], diamonds: [], clubs: [] },
    south: { spades: [], hearts: [], diamonds: [], clubs: [] },
    west: { spades: [], hearts: [], diamonds: [], clubs: [] }
  };
  
  const paikat = ['north', 'east', 'south', 'west'];
  for (let i = 0; i < pakka.length; i++) {
    const paikka = paikat[Math.floor(i / 13)];
    const kortti = pakka[i];
    kädet[paikka][kortti.maa].push(kortti.arvo);
  }
  
  // Järjestä kortit
  for (const paikka of paikat) {
    for (const maa of maat) {
      kädet[paikka][maa].sort((a, b) => arvot.indexOf(b) - arvot.indexOf(a));
    }
  }
  
  return kädet;
}

/**
 * Generoi uniikki ID
 * @return {string} Uniikki ID
 */
function generateId() {
  return Math.random().toString(36).substring(2, 15) + 
         Math.random().toString(36).substring(2, 15);
}

/**
 * Suodata pöytä asiakkaalle sopivaksi
 * @param {Object} pöytä - Pöytäobjekti
 * @return {Object} Suodatettu pöytäobjekti
 */
function suodataPöytä(pöytä) {
  return {
    koodi: pöytä.koodi,
    pelaajat: suodataPöydänPelaajat(pöytä.pelaajat),
    tila: pöytä.tila,
    luotu: pöytä.luotu
  };
}

/**
 * Suodata pöydän pelaajat asiakkaalle sopivaksi
 * @param {Object} pelaajat - Pelaajat
 * @return {Object} Suodatetut pelaajat
 */
function suodataPöydänPelaajat(pelaajat) {
  const suodatetutPelaajat = {};
  
  for (const [paikka, pelaaja] of Object.entries(pelaajat)) {
    if (pelaaja) {
      suodatetutPelaajat[paikka] = {
        nimi: pelaaja.nimi,
        tyyppi: pelaaja.tyyppi
      };
    } else {
      suodatetutPelaajat[paikka] = null;
    }
  }
  
  return suodatetutPelaajat;
}

/**
 * Suodata pelitila asiakkaalle sopivaksi
 * @param {Object} peliTila - Pelitila
 * @param {string|null} paikka - Pelaajan paikka
 * @return {Object} Suodatettu pelitila
 */
function suodataPeliTila(peliTila, paikka) {
  // Jos pelitilaa ei ole tai paikka on null/undefined, palautetaan yleinen versio
  if (!peliTila) return null;
  
  // Kopioi perustiedot
  const suodatettuTila = { ...peliTila };
  
  // Poista kätitiedot (lähetetään erikseen)
  delete suodatettuTila.kädet;
  
  return suodatettuTila;
}

/**
 * Aloita ping-pong-yhteys WebSocket-yhteyden kanssa
 * @param {WebSocket} ws - WebSocket-yhteys
 */
function startPingPong(ws) {
  ws._pingInterval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      lähetäViesti(ws, { type: 'ping' });
    } else {
      clearInterval(ws._pingInterval);
    }
  }, 30000);
}

/**
 * Siivoa vanhat pöydät
 */
function siivousProsessi() {
  const nyt = Date.now();
  
  for (const [koodi, pöytä] of pöydät.entries()) {
    if (nyt - pöytä.viimeisinAktiviteetti > MAX_IDLE_AIKA) {
      // Ilmoita kaikille pöydän pelaajille
      lähetäPöydänPelaajille(pöytä, {
        type: 'pöytäPoistettu',
        viesti: 'Pöytä suljettu passiivisuuden vuoksi'
      });
      
      // Siivoa pöytä
      for (const pelaajaTiedot of Object.values(pöytä.pelaajat)) {
        if (pelaajaTiedot && pelaajaTiedot.tunnus) {
          const pelaaja = pelaajat.get(pelaajaTiedot.tunnus);
          if (pelaaja) {
            pelaaja.pöytä = null;
            pelaaja.paikka = null;
          }
        }
      }
      
      pöydät.delete(koodi);
      console.log(`Pöytä ${koodi} poistettu passiivisuuden vuoksi`);
    }
  }
}

/**
 * Paikan nimen formatointi
 * @param {string} paikka - Paikan tunniste (north, east, south, west)
 * @return {string} Paikan nimi
 */
function paikanNimi(paikka) {
  switch(paikka) {
    case 'north': return 'Pohjoinen';
    case 'east': return 'Itä';
    case 'south': return 'Etelä';
    case 'west': return 'Länsi';
    default: return paikka;
  }
}

/**
 * Formatoi sopimus
 * @param {string} sopimus - Sopimus
 * @return {string} Formatoitu sopimus
 */
function formatoiSopimus(sopimus) {
  if (!sopimus) return "Ei sopimusta";
  
  const taso = sopimus.charAt(0);
  const maa = sopimus.charAt(1);
  let maasSymboli;
  
  switch(maa) {
    case 'C': maasSymboli = '♣'; break;
    case 'D': maasSymboli = '♦'; break;
    case 'H': maasSymboli = '♥'; break;
    case 'S': maasSymboli = '♠'; break;
    case 'N': maasSymboli = 'NT'; break;
    default: maasSymboli = maa;
  }
  
  let tulos = `${taso}${maasSymboli}`;
  
  // Lisää kahdennus/vastakahdennus
  if (sopimus.includes('XX')) {
    tulos += ' XX';
  } else if (sopimus.includes('X')) {
    tulos += ' X';
  }
  
  return tulos;
}

// Käynnistä palvelin
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Palvelin käynnissä portissa ${PORT}`);
});