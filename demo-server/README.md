# Lammio Readerin DAISY Online -demopalvelin

Pieni DAISY Online -palvelin Applen App Store -tarkastusta varten. Tarkastaja
kirjautuu sillä sovelluksen DAISY Online -osaan demotunnuksella, joten
Luetuksen tai Celian tunnuksia ei tarvita.

Palvelin toteuttaa vain ne DAISY Online v1 -operaatiot, joita Lammio Reader
käyttää. Se ei tarvitse tietokantaa eikä npm-paketteja, pelkän Node.js:n
(versio 18 tai uudempi).

Kansion tiedostot:

- `server.js`: koko palvelin
- `package.json`: käynnistyskomento Azurea varten
- `books/`: demokirjat (lisäät itse, ks. alla)


## 1. Kirjojen lisääminen

Jokainen kirja on oma alikansionsa kansiossa `books/`. Kansion nimestä tulee
kirjan tunniste, ja nimessä saa olla vain kirjaimia a–z, numeroita,
väliviiva ja alaviiva (ei ääkkösiä eikä välilyöntejä).

```
books/
  kirja-1/
    ncc.html
    *.smil
    *.mp3
  kirja-2/
    ncc.html
    ...
```

- DAISY 2.02 -kirja: kansiossa on oltava `ncc.html`. Nimi, tekijä ja kieli
  luetaan automaattisesti ncc.html:n metatiedoista.
- EPUB: kansioon yksi `.epub`-tiedosto.
- Jos haluat muuttaa nimeä tai muita tietoja, lisää kansioon `book.json`:

  ```json
  { "title": "Kirjan nimi", "creator": "Tekijä", "language": "fi" }
  ```

Paikallisen kirjaston näytekirjan voi laittaa ZIP-tiedostona suoraan
`books`-kansioon (ei alikansioon), esim. `books/sample-book.zip`. Se ei
näy DAISY Online -hyllyssä, mutta on ladattavissa osoitteesta
`https://<sovelluksen-nimi>.azurewebsites.net/books/sample-book.zip`.

Kaksi tai kolme lyhyttä kirjaa riittää. Käytä vain kirjoja, joihin sinulla on
jako-oikeus (esim. itse tehty tai tekijänoikeudeltaan vapaa), koska palvelin
on julkisesti internetissä.

Palvelin lukee kirjat käynnistyessään. Uusien kirjojen jälkeen palvelin on
käynnistettävä uudelleen.


## 2. Kokeilu omalla koneella

PowerShellissä tässä kansiossa:

```powershell
node server.js
```

Avaa selaimessa `http://localhost:8080/`. Sivu kertoo kirjojen määrän ja
palvelun osoitteen. Konsoliin tulostuu luettelo löydetyistä kirjoista ja
lokirivi jokaisesta sovelluksen kutsusta.

Puhelin ei pääse koneen localhostiin, joten sovelluksella testataan vasta
Azuressa.


## 3. Käyttöönotto Azure App Serviceen

Sama tapa kuin muissakin Node.js-palvelimissa:

1. Luo Web App: Runtime stack **Node 20 LTS**, käyttöjärjestelmä **Linux**.
   - Ilmainen F1 riittää. Palvelin nukahtaa noin 20 minuutin
     käyttämättömyyden jälkeen, ja herääminen kestää muutaman sekunnin.
     Sovellus odottaa vastausta 30 sekuntia, joten se ei haittaa.
   - Jos haluat varmuuden, käytä B1-tasoa ja kytke päälle
     **Always On**.
2. Tunnukset ovat `server.js`:ssä tiivisteenä (`CREDENTIALS_SALT` ja
   `CREDENTIALS_HASH`), ks. `kayttoohje.txt` kohta 2. Valinnaiset asetukset
   kohdassa Settings > Environment variables > App settings:

   | Nimi | Oletus | Merkitys |
   |---|---|---|
   | `INITIAL_LOANS` | `1` | Montako kirjaa on alussa valmiiksi lainassa |
   | `LOAN_DAYS` | `30` | Lainan pituus päivinä |
   | `STATE_RESET_HOURS` | `12` | Lainat palautuvat alkutilaan, kun palvelinta ei ole käytetty näin moneen tuntiin |
   | `SESSION_IDLE_MINUTES` | `120` | Istunnon vanhenemisaika |
   | `PUBLIC_BASE_URL` | päätellään | Esim. `https://lammio-demo.azurewebsites.net`, jos kirjojen osoitteet tulevat väärin |

3. Vie koko kansio `tools/demo-server` kirjoineen Web Appiin samalla tavalla
   kuin aiemmin, esim. VS Coden Azure App Service -laajennuksella (Deploy to
   Web App) tai zip-tiedostona. Varmista, että `books`-kansio menee mukaan.
   Azure käynnistää palvelimen komennolla `npm start` ja antaa portin
   `PORT`-muuttujassa.
4. Pidä instanssien määrä yhdessä (Scale out = 1). Istunnot ja lainat ovat
   palvelimen muistissa.
5. Tarkista selaimella `https://<sovelluksen-nimi>.azurewebsites.net/`.
   Sivulla pitäisi näkyä kirjojen määrä ja palvelun osoite.
   Lokit: Monitoring > Log stream.


## 4. Testaus Lammio Readerilla

1. Kirjasto > DAISY Online > Lisää palvelu.
2. Palvelu: **Uusi palvelu…**
3. Nimi: esim. `Demo`.
4. Osoite: `https://<sovelluksen-nimi>.azurewebsites.net/daisyonline/service/`
5. Käyttäjätunnus ja salasana kuten App settingsissä, sitten Testaa yhteys
   ja Tallenna.
6. Avaa palvelu. Hyllyssä on kaksi osiota: **Lainatut** ja **Saatavilla**.

Kokeile ainakin: kirjan avaaminen (striimaus), lataus laitteelle, palautus ja
uudelleenlainaus.


## 5. Miten lainaus ja palautus toimivat

Palvelin toimii kuten tavallinen kirjasto, eikä mikään kirja katoa:

- **Alkutila:** ensimmäinen kirja (aakkosjärjestyksessä) on valmiiksi
  **Lainatut**-osiossa, muut ovat **Saatavilla**. Tarkastaja voi siis kokeilla
  palautusta heti.
- **Lainaus:** kun saatavilla oleva kirja avataan tai ladataan, sovellus
  lainaa sen, ja kirja siirtyy Lainatut-osioon.
- **Palautus:** palautettu kirja poistuu Lainatut-osiosta, ja sen ladattu
  kopio poistetaan puhelimesta. Kirja palaa Saatavilla-osioon, ja sen voi
  lainata uudelleen.
- **Nollaus:** lainat palautuvat alkutilaan, kun palvelinta ei ole käytetty
  12 tuntiin (`STATE_RESET_HOURS`) tai kun palvelin käynnistyy uudelleen.
  Jokainen uusi tarkastus alkaa siis samasta tilanteesta.

Kaikki demotunnuksen käyttäjät jakavat saman hyllyn. Jos kaksi tarkastajaa
käyttää palvelua samaan aikaan, toisen palautus näkyy myös toiselle. Applen
tarkastuksessa tällä ei ole käytännössä merkitystä.


## 6. Ohje Applen tarkastajalle

Laita tämä App Store Connectiin kohtaan App Review Information > Notes ja
tunnukset kohtaan Sign-in information. Täydennä osoite ja tunnukset.

```
DAISY Online demo service

The app connects to DAISY Online library services, which are only available
to registered print-disabled users. For review, we provide a demo service
with sample books.

1. On the library screen, tap "DAISY Online" in the bottom bar.
2. Tap "Add service".
3. In the Service picker choose "New service…".
4. Service name: Demo
   Service address: https://<app-name>.azurewebsites.net/daisyonline/service/
   Username: <username>
   Password: <password>
5. Tap "Save", then open "Demo" in the list.

The bookshelf has two sections: "On loan" and "Available". One book is
already on loan. Opening an available book borrows it and starts playback
(streaming). A borrowed book can also be downloaded to the device, and
returned with the "Return loan" action (with VoiceOver: swipe up or down on the
book and double-tap). A returned book moves back to "Available" and can be
borrowed again. The demo shelf resets automatically after 12 hours of
inactivity.
```


## 7. Tietoturva

- Palvelin ei tallenna mitään levylle eikä kerää käyttäjätietoja. Lokiin
  menee vain operaation nimi ja aikaleima, ei tunnuksia.
- Tunnukset eivät ole koodissa eivätkä repossa selväkielisinä, vain
  tiivisteenä.
- Kirjatiedostot ovat ladattavissa ilman kirjautumista, jos tietää niiden
  osoitteen. Siksi palvelimelle laitetaan vain vapaasti jaettavia kirjoja.
