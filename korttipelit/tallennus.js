'use strict';
// Pöytien tallennus levylle (tallennus.html). Yksi JSON-tiedosto pöytää kohti:
// <hakemisto>/<peli>-<koodi>.json. Tallennus vanhenee TTL_MS:n kuluttua
// viimeisimmästä kirjoituksesta, minkä jälkeen se käsitellään kuin sitä ei olisi.
//
//   const store = new SaveStore({ dir, game: 'hertta' });
//   store.save('4821', { ... });  store.load('4821');  store.remove('4821');
//
// Kirjoitus on synkroninen: tiedostot ovat pieniä ja niitä kirjoitetaan vain
// kerran jaossa, joten tapahtumien järjestys pysyy yksinkertaisena.

const fs = require('fs');
const path = require('path');

const TTL_MS = 5 * 24 * 60 * 60 * 1000;     // 5 vuorokautta
const VERSION = 1;
const CODE_PATTERN = /^\d{4}$/;              // vain pöytäkoodi päätyy tiedostonimeen

const DEFAULT_DIR = path.join(__dirname, '..', 'data', 'saved-tables');

class SaveStore {
    constructor({ dir = process.env.SAVE_DIR || DEFAULT_DIR, game, now = Date.now, ttlMs = TTL_MS }) {
        this.dir = dir;
        this.game = game;
        this.now = now;
        this.ttlMs = ttlMs;
    }

    file(code) {
        if (!CODE_PATTERN.test(String(code))) return null;
        return path.join(this.dir, `${this.game}-${code}.json`);
    }

    // Palauttaa vanhenemisajan (ms). Kirjoitetaan ensin väliaikaiseen tiedostoon ja
    // nimetään se sitten, jottei kaatuminen kesken kirjoituksen jätä rikkinäistä tiedostoa.
    save(code, data) {
        const file = this.file(code);
        if (!file) throw new Error(`Virheellinen pöytäkoodi: ${code}`);
        const savedAt = this.now();
        const expiresAt = savedAt + this.ttlMs;
        const content = { version: VERSION, game: this.game, code: String(code), savedAt, expiresAt, ...data };
        fs.mkdirSync(this.dir, { recursive: true });
        const temp = `${file}.${process.pid}.tmp`;
        fs.writeFileSync(temp, JSON.stringify(content));
        fs.renameSync(temp, file);
        return expiresAt;
    }

    // Tallennus tai null. Vanhentunut tai rikkinäinen tiedosto poistetaan.
    load(code) {
        const file = this.file(code);
        if (!file) return null;
        let content;
        try {
            content = JSON.parse(fs.readFileSync(file, 'utf8'));
        } catch (err) {
            if (err.code === 'ENOENT') return null;
            console.error(`Tallennus ${file} ei kelpaa: ${err.message}`);
            this.remove(code);
            return null;
        }
        if (!content || content.version !== VERSION || content.game !== this.game
            || content.code !== String(code) || !(content.expiresAt > this.now())) {
            this.remove(code);
            return null;
        }
        return content;
    }

    exists(code) {
        return this.load(code) !== null;
    }

    remove(code) {
        const file = this.file(code);
        if (!file) return;
        try {
            fs.unlinkSync(file);
        } catch (err) {
            if (err.code !== 'ENOENT') console.error(`Tallennusta ${file} ei voitu poistaa: ${err.message}`);
        }
    }

    // Poistaa vanhentuneet tallennukset. Kutsutaan ajastetusti.
    purgeExpired() {
        let names;
        try {
            names = fs.readdirSync(this.dir);
        } catch (err) {
            return;                 // hakemistoa ei vielä ole
        }
        const prefix = `${this.game}-`;
        for (const name of names) {
            const match = name.startsWith(prefix) && name.slice(prefix.length).match(/^(\d{4})\.json$/);
            if (match) this.load(match[1]);
        }
    }
}

module.exports = { SaveStore, TTL_MS, DEFAULT_DIR };
