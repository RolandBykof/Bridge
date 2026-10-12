# Bridgen testityökalu

Pelaa jakoja automaattisesti 0–3 robotilla ja tarkistaa jokaisen jaon.
Suunnitelma: `testityökalusuunnitelma.html` projektin juuressa.

## Komentorivi

```
npm run simuloi -- --robotit 0-3 --jakoja 100
```

Käynnistää oman palvelimen testitilassa vapaaseen porttiin, pelaa jaot ja
kirjoittaa tuloksen kansioon `testityokalu/tulokset/` (ei versionhallinnassa).
Palauttaa virhekoodin 1, jos virheitä löytyi. Kaikki valitsimet:
`npm run simuloi -- --apua`.

Hyödyllisiä valitsimia:

- `--pelimuoto minibridge` tai `--pelimuoto harjoitus`
- `--tyyli kahdentaja` (myös `satunnainen`, `passaaja`, `kiipeaja`, `keskeyttaja`)
- `--paikat south,west` kiinnittää ihmisten paikat
- `--siemen 123` toistaa saman ajon pelaajien valinnat
- `--gib` käyttää robottien tarjouksiin GIB-palvelua (aja vain pienillä määrillä)

## Testisivu selaimessa

```
$env:TEST_MODE='1'; $env:ROBOT_BIDDER='local'; $env:PORT='3456'; node server.js
```

Avaa sitten `http://localhost:3456/testityokalu/`. Sivu vastaa vain
testitilassa, tuotannossa osoite antaa 404.

## Testitila palvelimessa

- `TEST_MODE=1`: odotukset lyhenevät (robotin miettimisaika, tikin tauko,
  uusi jako), testisivu avautuu ja palvelin lähettää jaon päätyttyä kaikki
  kädet viestinä `testDealRecord`. Ilman muuttujaa mikään ei muutu.
- `ROBOT_BIDDER=local`: robotit tarjoavat palvelimen omalla varatarjoajalla
  eivätkä kutsu GIB:iä. Toimii vain testitilassa.
- `TEST_DELAYS=normal`: testitila normaaleilla odotuksilla.

## Löydökset

- **Virhe** kaataa ajon (virhekoodi 1).
- **Tunnettu** on palvelimen tiedossa oleva ongelma, joka ei kaada ajoa
  (`--tunnetut-virheiksi` muuttaa tämän). Tällä hetkellä tunnettuja
  ongelmia ei ole.

Ensimmäisissä ajoissa (12.10.2026) löytyneet palvelimen virheet, kaikki
korjattu samana päivänä. Regressiotestit: `korjaukset.test.js`.

1. **Väärä pelinviejä.** Jos vastapuoli oli tarjonnut sopimuksen maata
   ensin, pelinviejäksi tuli vastapuolen pelaaja
   (`determineDeclarerAndDummy`).
2. **Paikkatunnisteet vuotivat.** `gameState.players` lähti kaikille
   suodattamatta kaikkien pelaajien salaisine `token`-arvoineen
   (`filterGameState`).
3. **Laiton kahdennus jumitti jaon.** Palvelin hyväksyi kahdennuksen ja
   vastakahdennuksen milloin tahansa (`isBidValid`); kahdennus ilman
   tarjousta ja kolme passia kaatoi tarjousvaiheen. Nyt kahdennus on
   sallittu vain vastustajan tarjouksen ja vastakahdennus vain vastustajan
   kahdennuksen jälkeen, myös robotin tarjouksissa ja pelinäkymän
   painikkeissa.
4. **Poistuminen passatun jaon jälkeen.** Jos pelaaja poistui pöydästä
   "kaikki passasivat" -tauon aikana, uuden jaon aloitus kaatui
   (`beginDeal`: tyhjä paikka).

## Havainnot

- **Palvelin voi olla sekunteja varattuna (12.10.2026).** Kolmen robotin
  pöydässä palvelin vastasi laittomaan korttiin vasta 4,8 sekunnin päästä,
  koska robotin korttilaskenta varasi sen. Sillä aikaa kaikki palvelimen
  pöydät odottavat. Ei sääntövirhe, mutta voi näkyä pelaajille viiveenä.
  Työkalu odottaa vastausta 15 sekuntia ja tallentaa laittomien yritysten
  vastausajan (`responseMs`) tulostiedostoon.
- Keskeytetyn jaon aikana lähetetty siirto voi saapua palvelimelle vasta
  uuden jaon alettua. Palvelin hylkää sen oikein, eikä työkalu kirjaa sitä
  virheeksi.

## Rajoitukset

Simulaatio ohittaa käyttöliittymän: painikkeet ja ruudunlukijailmoitukset
jäävät testin ulkopuolelle. Käyttöliittymän virheet (kuten aiempi puuttuva
neljäs passi) löytyvät edelleen vain selaintestillä.
