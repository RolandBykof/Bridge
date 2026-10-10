'use strict';
// Palvelimen testit oikeilla Socket.IO-yhteyksillä: pöytä, robotit ja koko peli.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');
const { io: connect } = require('socket.io-client');
const hertta = require('./socket.js');
const { Tables } = require('../korttipelit/poydat.js');
const { legalCards, GAME_END_SCORE } = require('../public/hertta/js/saannot.js');

function tempDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'hertta-tallennus-'));
}

async function startServer({ saveDir = tempDir() } = {}) {
    const server = http.createServer();
    const io = new Server(server);
    const handle = hertta.attach(io, { robotDelayMs: 1, saveDir });
    await new Promise(resolve => server.listen(0, resolve));
    return {
        url: `http://localhost:${server.address().port}/hertta`,
        handle,
        async close() {
            handle.close();
            io.close();
            await new Promise(resolve => server.close(resolve));
        }
    };
}

function client(url) {
    const socket = connect(url, { transports: ['websocket'], forceNew: true });
    const c = { socket, state: null, events: [], errors: [], joined: null, joinError: null, choose: null };
    socket.on('state', s => { c.state = s; });
    socket.on('choose-player', d => { c.choose = d; });
    socket.on('game-event', e => c.events.push(e));
    socket.on('action-error', e => c.errors.push(e.text));
    socket.on('joined', d => { c.joined = d; });
    socket.on('join-error', e => { c.joinError = e.text; });
    return c;
}

async function until(check, what, ms = 10000) {
    const start = Date.now();
    while (Date.now() - start < ms) {
        const value = check();
        if (value) return value;
        await new Promise(r => setTimeout(r, 5));
    }
    throw new Error(`Aikakatkaisu: ${what}`);
}

async function createTable(url, name) {
    const c = client(url);
    c.socket.emit('create-table', { name });
    await until(() => c.state, 'pöydän luonti');
    return c;
}

const id = c => `${c.suit}-${c.rank}`;

test('pöydässä tasan 4 pelaajaa, ja virheet ovat englanniksi', async () => {
    const srv = await startServer();
    try {
        const alice = await createTable(srv.url, 'Alice');
        alice.socket.emit('start-game');
        await until(() => alice.errors.length === 1, 'liian vähän pelaajia');
        assert.match(alice.errors[0], /needs 4 players/);
        for (let i = 0; i < 4; i++) alice.socket.emit('add-robot');
        await until(() => alice.errors.length === 2, 'täynnä-virhe');
        assert.match(alice.errors[1], /full, 4\/4/);
        assert.ok(alice.state.members.some(m => m.name === 'Robot 1'));

        const bob = client(srv.url);
        bob.socket.emit('join-table', { code: '0000', name: 'Bob' });
        await until(() => bob.joinError, 'puuttuva pöytä');
        assert.match(bob.joinError, /was not found/);
        [alice, bob].forEach(c => c.socket.close());
    } finally {
        await srv.close();
    }
});

// Ihminen pelaa yksinkertaisesti: antaa kolme ensimmäistä korttiaan, lyö
// ensimmäisen sallitun kortin ja aloittaa seuraavan kierroksen.
async function playHumanToEnd(c) {
    return playHuman(c, g => g.phase === 'over');
}

async function playHuman(c, done) {
    // Odotetaan, että juuri oma siirto näkyy tilassa. Pelkkä tilan muuttuminen ei
    // riitä: robotin aiempi siirto voi tuoda välissä tilan, jossa on yhä oma vuoro.
    const me = () => c.state.game.players.find(p => p.id === c.state.you.id);
    for (let i = 0; i < 20000; i++) {
        const g = c.state.game;
        if (done(g)) return g;
        const round = g.round;
        if (g.allowedActions.includes('pass')) {
            c.socket.emit('pass', { cardIds: g.hand.slice(0, 3).map(id) });
            await until(() => c.state.game.round !== round || me().passed, 'vaihto');
        } else if (g.allowedActions.includes('play')) {
            const lead = g.trick.length ? g.trick[0].card.suit : null;
            const legal = legalCards(g.hand, { lead, firstTrick: g.tricksPlayed === 0, heartsBroken: g.heartsBroken });
            const count = g.hand.length;
            c.socket.emit('play', { cardId: id(legal[0]) });
            await until(() => c.state.game.round !== round || c.state.game.hand.length < count, 'kortti');
        } else if (g.allowedActions.includes('next-round')) {
            c.socket.emit('next-round');
            await until(() => c.state.game.round !== round, 'uusi kierros');
        } else {
            await new Promise(r => setTimeout(r, 2));
        }
    }
    throw new Error('peli ei päättynyt');
}

test('ihminen ja kolme robottia pelaavat pelin loppuun', async () => {
    const srv = await startServer();
    let alice = null;
    try {
        alice = await createTable(srv.url, 'Alice');
        for (let i = 0; i < 3; i++) alice.socket.emit('add-robot');
        await until(() => alice.state.members.length === 4, 'robotit');
        alice.socket.emit('start-game');
        await until(() => alice.state.game, 'peli alkoi');
        const start = alice.events.find(e => e.type === 'start');
        assert.strictEqual(start.passDirection, 'left');
        const g = await playHumanToEnd(alice);
        assert.strictEqual(g.phase, 'over');
        assert.ok(g.winnerIds.length >= 1);
        assert.ok(g.players.some(p => p.score >= GAME_END_SCORE));
        assert.ok(alice.events.some(e => e.type === 'over'));
        assert.deepStrictEqual(alice.errors, [], 'ei hylättyjä siirtoja');
        // Muiden vaihtamat kortit eivät näy.
        const myId = alice.state.you.id;
        for (const e of alice.events.filter(e => e.type === 'passed' && e.playerId !== myId)) {
            assert.strictEqual(e.cards, null);
        }
        for (const e of alice.events.filter(e => e.type === 'exchange')) {
            assert.ok(e.transfers.every(t => t.fromId === myId || t.toId === myId));
        }
        assert.ok(alice.events.some(e => e.type === 'last-trick'), 'viimeinen tikki automaattisesti');
    } finally {
        // Suljetaan myös epäonnistuessa, muuten testiajo jää odottamaan yhteyttä.
        if (alice) alice.socket.close();
        await srv.close();
    }
});

test('tallennuskoodia ei anneta uudelle pöydälle', () => {
    const values = [0, 0.5];
    const tables = new Tables({
        rng: () => values.shift(), createGame: () => null, isReserved: code => code === '1000',
        minPlayers: 4, maxPlayers: 4
    });
    assert.strictEqual(tables.create().code, '5500');
});

test('tallennettu pöytä herää palvelimen uudelleenkäynnistyksen jälkeen', async () => {
    const saveDir = tempDir();
    let srv = await startServer({ saveDir });
    const clients = [];
    const track = c => { clients.push(c); return c; };
    try {
        const alice = track(await createTable(srv.url, 'Alice'));
        const code = alice.state.table.code;
        for (let i = 0; i < 3; i++) alice.socket.emit('add-robot');
        await until(() => alice.state.members.length === 4, 'robotit');
        alice.socket.emit('set-save', { enabled: true });
        await until(() => alice.state.table.save.enabled, 'tallennus päälle');
        assert.ok(alice.events.some(e => e.type === 'save-changed' && e.enabled));
        alice.socket.emit('start-game');
        await until(() => alice.state.game, 'peli alkoi');
        assert.ok(alice.state.table.save.expiresAt, 'tallennettu aloituksessa');

        const g = await playHuman(alice, game => game.phase === 'round-over');
        const scores = g.players.map(p => p.score);
        assert.strictEqual(srv.handle.store.load(code).progress.round, 2);
        const token = alice.joined.token;
        alice.socket.close();
        await srv.close();

        // Uusi palvelin samalla tallennushakemistolla: muistissa ei ole pöytiä.
        srv = await startServer({ saveDir });
        const stranger = track(client(srv.url));
        stranger.socket.emit('join-table', { code, name: 'Alice' });
        await until(() => stranger.choose, 'pelaajan valinta');
        assert.strictEqual(stranger.choose.round, 2);
        assert.deepStrictEqual(stranger.choose.players.map(p => p.score), scores);
        const aliceEntry = stranger.choose.players.find(p => p.name === 'Alice');
        assert.ok(!aliceEntry.connected);

        // Sama selain palaa tunnisteella suoraan omalle paikalleen.
        const back = track(client(srv.url));
        back.socket.emit('join-table', { code, token });
        await until(() => back.state, 'paluu tunnisteella');
        assert.strictEqual(back.state.you.name, 'Alice');
        assert.strictEqual(back.state.table.resuming.round, 2);
        assert.ok(back.state.you.isCreator);

        // Varattua pelaajaa ei voi valita.
        stranger.choose = null;
        stranger.socket.emit('join-table', { code, name: 'Alice', claimId: aliceEntry.id });
        await until(() => stranger.choose, 'uusi valinta');
        assert.ok(stranger.choose.taken);
        assert.ok(!stranger.state);

        back.socket.emit('resume-game');
        await until(() => back.state.game, 'peli jatkuu');
        assert.strictEqual(back.state.game.round, 2);
        assert.deepStrictEqual(back.state.game.players.map(p => p.score), scores);
        assert.ok(back.events.some(e => e.type === 'resumed'));
        assert.strictEqual(back.state.table.resuming, null);
        assert.deepStrictEqual(back.errors, []);

        // Tallennuksen poisto poistaa tiedoston.
        back.socket.emit('set-save', { enabled: false });
        await until(() => !back.state.table.save.enabled, 'tallennus pois');
        assert.strictEqual(srv.handle.store.load(code), null);
    } finally {
        clients.forEach(c => c.socket.close());
        await srv.close();
    }
});

test('tallennetun pelin pelaajan voi valita listasta, ja luoja voi luopua tallennuksesta', async () => {
    const saveDir = tempDir();
    let srv = await startServer({ saveDir });
    const clients = [];
    const track = c => { clients.push(c); return c; };
    try {
        const alice = track(await createTable(srv.url, 'Alice'));
        const code = alice.state.table.code;
        const bob = track(client(srv.url));
        bob.socket.emit('join-table', { code, name: 'Bob' });
        await until(() => bob.state, 'Bob liittyi');
        for (let i = 0; i < 2; i++) alice.socket.emit('add-robot');
        await until(() => alice.state.members.length === 4, 'robotit');
        alice.socket.emit('set-save', { enabled: true });
        alice.socket.emit('start-game');
        await until(() => alice.state.game && alice.state.table.save.expiresAt, 'peli tallennettu');
        alice.socket.close();
        bob.socket.close();
        await srv.close();

        srv = await startServer({ saveDir });
        // Bob toisella laitteella: ei tunnistetta, valitsee itsensä listasta.
        const bob2 = track(client(srv.url));
        bob2.socket.emit('join-table', { code, name: 'bob' });
        await until(() => bob2.choose, 'valinta');
        const bobEntry = bob2.choose.players.find(p => p.name === 'Bob');
        bob2.socket.emit('join-table', { code, name: 'bob', claimId: bobEntry.id });
        await until(() => bob2.state, 'Bob palasi');
        assert.strictEqual(bob2.state.you.name, 'Bob');
        assert.ok(!bob2.state.you.isCreator, 'alkuperäinen luoja säilyy');

        bob2.socket.emit('resume-game');
        await until(() => bob2.errors.length === 1, 'vain luoja voi jatkaa');
        assert.match(bob2.errors[0], /Only the table creator can continue the saved game/);

        // Katsoja ei pääse pelaajaksi.
        const carol = track(client(srv.url));
        carol.socket.emit('join-table', { code, name: 'Carol', spectator: true });
        await until(() => carol.state, 'katsoja');
        assert.ok(carol.state.members.find(m => m.name === 'Carol').spectator);

        bob2.socket.emit('abort-game');
        await until(() => bob2.errors.length === 2, 'vain luoja voi luopua');

        const alice2 = track(client(srv.url));
        alice2.socket.emit('join-table', { code, token: alice.joined.token });
        await until(() => alice2.state, 'Alice palasi');
        assert.ok(alice2.state.you.isCreator);
        bob2.socket.close();
        await until(() => alice2.state.members.find(m => m.name === 'Bob' && !m.connected), 'Bob lähti');
        alice2.socket.emit('resume-game');
        await until(() => alice2.errors.length === 1, 'odotetaan Bobia');
        assert.match(alice2.errors[0], /waiting for Bob/);
        alice2.socket.emit('abort-game');
        await until(() => !alice2.state.table.resuming, 'tallennuksesta luovuttu');
        assert.ok(alice2.events.some(e => e.type === 'aborted' && e.discarded));
        assert.strictEqual(srv.handle.store.load(code), null);
    } finally {
        clients.forEach(c => c.socket.close());
        await srv.close();
    }
});

test('seuraavan jaon aloittaa vain pöydän luoja', async () => {
    const srv = await startServer();
    const clients = [];
    try {
        const alice = await createTable(srv.url, 'Alice');
        clients.push(alice);
        const code = alice.state.table.code;
        const bob = client(srv.url);
        clients.push(bob);
        bob.socket.emit('join-table', { code, name: 'Bob' });
        await until(() => bob.state, 'Bob liittyi');
        for (let i = 0; i < 2; i++) alice.socket.emit('add-robot');
        await until(() => alice.state.members.length === 4, 'robotit');
        alice.socket.emit('start-game');
        await until(() => alice.state.game && bob.state.game, 'peli alkoi');

        const roundOver = g => g.phase === 'round-over';
        await Promise.all([playHuman(alice, roundOver), playHuman(bob, roundOver)]);
        assert.ok(alice.state.game.allowedActions.includes('next-round'));
        assert.ok(!bob.state.game.allowedActions.includes('next-round'));

        bob.socket.emit('next-round');
        await until(() => bob.errors.length === 1, 'Bob ei voi aloittaa');
        assert.match(bob.errors[0], /Only the table creator can start the next round/);
        assert.strictEqual(bob.state.game.round, 1);

        alice.socket.emit('next-round');
        await until(() => bob.state.game.round === 2, 'toinen jako');
    } finally {
        clients.forEach(c => c.socket.close());
        await srv.close();
    }
});
