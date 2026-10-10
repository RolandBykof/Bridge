'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { SaveStore, TTL_MS } = require('./tallennus.js');

function tempDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'tallennus-'));
}

test('tallennus kirjoitetaan, luetaan ja poistetaan', () => {
    const dir = tempDir();
    let time = 1000;
    const store = new SaveStore({ dir, game: 'hertta', now: () => time });
    assert.strictEqual(store.load('4821'), null);
    const expiresAt = store.save('4821', { members: [], progress: { round: 2 } });
    assert.strictEqual(expiresAt, 1000 + TTL_MS);
    assert.ok(fs.existsSync(path.join(dir, 'hertta-4821.json')));
    const loaded = store.load('4821');
    assert.strictEqual(loaded.code, '4821');
    assert.strictEqual(loaded.game, 'hertta');
    assert.deepStrictEqual(loaded.progress, { round: 2 });
    assert.ok(store.exists('4821'));
    assert.deepStrictEqual(fs.readdirSync(dir), ['hertta-4821.json'], 'väliaikaistiedosto ei jää');

    store.remove('4821');
    assert.strictEqual(store.load('4821'), null);
    store.remove('4821');                       // puuttuvan poisto ei kaada
});

test('vanhentunut tallennus poistetaan', () => {
    const dir = tempDir();
    let time = 0;
    const store = new SaveStore({ dir, game: 'hertta', now: () => time });
    store.save('1234', {});
    store.save('5678', {});
    time = TTL_MS - 1;
    assert.ok(store.exists('1234'));
    time = TTL_MS;
    store.purgeExpired();
    assert.deepStrictEqual(fs.readdirSync(dir), []);
});

test('vain nelinumeroinen koodi kelpaa tiedostonimeen, ja rikkinäinen tiedosto ohitetaan', () => {
    const dir = tempDir();
    const store = new SaveStore({ dir, game: 'hertta' });
    assert.throws(() => store.save('../x', {}));
    assert.strictEqual(store.load('../../etc/passwd'), null);
    assert.strictEqual(store.load(''), null);

    fs.writeFileSync(path.join(dir, 'hertta-9999.json'), '{ rikki');
    const original = console.error;
    console.error = () => {};
    try {
        assert.strictEqual(store.load('9999'), null);
    } finally {
        console.error = original;
    }
    assert.ok(!fs.existsSync(path.join(dir, 'hertta-9999.json')));

    // Toisen pelin tallennus samassa hakemistossa ei sekoitu.
    new SaveStore({ dir, game: 'maija' }).save('1111', {});
    assert.strictEqual(store.load('1111'), null);
});
