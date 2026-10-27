'use strict';
// Palvelimen testit oikeilla Socket.IO-yhteyksillä: pöytä, robotit, koko peli ja tallennus.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');
const { io: connect } = require('socket.io-client');
const kasino = require('./socket.js');
const { bestCapture } = require('../public/kasino/js/saannot.js');

function tempDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'kasino-tallennus-'));
}

async function startServer({ saveDir = tempDir() } = {}) {
    const server = http.createServer();
    const io = new Server(server);
    const handle = kasino.attach(io, { robotDelayMs: 1, saveDir });
    await new Promise(resolve => server.listen(0, resolve));
    return {
        url: `http://localhost:${server.address().port}/kasino`,
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

// Ihminen pelaa yksinkertaisesti: ottaa ensimmäisellä kortilla, jolla saa jotain,
// muuten lyö ensimmäisen kortin. Aloittaa seuraavan jaon pöydän luojana.
async function playHuman(c, done) {
    for (let i = 0; i < 20000; i++) {
        const g = c.state.game;
        if (done(g)) return g;
        const moves = g.moves;
        if (g.allowedActions.includes('lay')) {
            const taker = g.table.length ? g.hand.find(card => bestCapture(card, g.table)) : null;
            if (taker) c.socket.emit('take', { cardId: id(taker) });
            else c.socket.emit('lay', { cardId: id(g.hand[0]) });
            await until(() => c.state.game.moves !== moves, 'siirto');
        } else if (g.allowedActions.includes('next-round')) {
            c.socket.emit('next-round');
            await until(() => c.state.game.moves !== moves, 'uusi jako');
        } else {
            await new Promise(r => setTimeout(r, 2));
        }
    }
    throw new Error('peli ei päättynyt');
}

test('pöydässä 2–4 pelaajaa, ja virheet ovat suomeksi', async () => {
    const srv = await startServer();
    try {
        const liisa = await createTable(srv.url, 'Liisa');
        liisa.socket.emit('start-game');
        await until(() => liisa.errors.length === 1, 'liian vähän pelaajia');
        assert.match(liisa.errors[0], /vähintään 2 pelaajaa/);
        for (let i = 0; i < 4; i++) liisa.socket.emit('add-robot');
        await until(() => liisa.errors.length === 2, 'täynnä-virhe');
        assert.match(liisa.errors[1], /täynnä, 4\/4/);

        const mikko = client(srv.url);
        mikko.socket.emit('join-table', { code: '0000', name: 'Mikko' });
        await until(() => mikko.joinError, 'puuttuva pöytä');
        assert.match(mikko.joinError, /ei löydy/);
        [liisa, mikko].forEach(c => c.socket.close());
    } finally {
        await srv.close();
    }
});

test('koko peli robotteja vastaan 16 pisteeseen', async () => {
    const srv = await startServer();
    try {
        const liisa = await createTable(srv.url, 'Liisa');
        liisa.socket.emit('add-robot');
        liisa.socket.emit('add-robot');
        await until(() => liisa.state.table.seatedCount === 3, 'robotit');
        liisa.socket.emit('start-game');
        await until(() => liisa.state.game, 'pelin alku');
        const start = liisa.events.find(e => e.type === 'start');
        assert.strictEqual(start.table.length, 4);
        assert.strictEqual(liisa.state.game.hand.length, 4);

        const g = await playHuman(liisa, game => game.phase === 'over');
        assert.ok(g.players.some(p => p.score >= 16));
        assert.ok(liisa.events.some(e => e.type === 'over'));
        assert.ok(liisa.events.some(e => e.type === 'take'));
        // Uusien korttien tapahtumassa näkyy vain oma käsi.
        const deal = liisa.events.find(e => e.type === 'deal');
        assert.ok(deal && !('hands' in deal));
        assert.strictEqual(liisa.errors.length, 0, liisa.errors.join(' | '));
        liisa.socket.close();
    } finally {
        await srv.close();
    }
});

test('vain pöydän luoja aloittaa seuraavan jaon', async () => {
    const srv = await startServer();
    try {
        const liisa = await createTable(srv.url, 'Liisa');
        const mikko = client(srv.url);
        mikko.socket.emit('join-table', { code: liisa.state.table.code, name: 'Mikko' });
        await until(() => mikko.state, 'liittyminen');
        liisa.socket.emit('start-game');
        await until(() => liisa.state.game && mikko.state.game, 'pelin alku');

        const both = [liisa, mikko];
        while (!both.some(c => c.state.game.phase !== 'play')) {
            const actor = both.find(c => c.state.game.allowedActions.includes('lay'));
            if (!actor) { await new Promise(r => setTimeout(r, 2)); continue; }
            const moves = actor.state.game.moves;
            actor.socket.emit('lay', { cardId: id(actor.state.game.hand[0]) });
            await until(() => actor.state.game.moves !== moves, 'lyönti');
        }
        await until(() => mikko.state.game.phase === 'round-over', 'jaon loppu');
        assert.ok(!mikko.state.game.allowedActions.includes('next-round'));
        assert.ok(liisa.state.game.allowedActions.includes('next-round'));
        mikko.socket.emit('next-round');
        await until(() => mikko.errors.length === 1, 'virhe');
        assert.match(mikko.errors[0], /Vain pöydän luoja/);
        both.forEach(c => c.socket.close());
    } finally {
        await srv.close();
    }
});

test('kahden pelaajan pöytä tallentuu ja jatkuu', async () => {
    const saveDir = tempDir();
    let srv = await startServer({ saveDir });
    let code;
    try {
        const liisa = await createTable(srv.url, 'Liisa');
        code = liisa.state.table.code;
        liisa.socket.emit('add-robot');
        liisa.socket.emit('set-save', { enabled: true });
        await until(() => liisa.state.table.save.enabled && liisa.state.table.seatedCount === 2, 'tallennus päälle');
        liisa.socket.emit('start-game');
        await until(() => liisa.state.game, 'pelin alku');
        await playHuman(liisa, g => g.phase !== 'play');
        assert.ok(fs.existsSync(path.join(saveDir, `kasino-${code}.json`)));
        liisa.socket.close();
    } finally {
        await srv.close();
    }

    srv = await startServer({ saveDir });
    try {
        const liisa = client(srv.url);
        liisa.socket.emit('join-table', { code, name: 'Liisa' });
        const choose = await until(() => liisa.choose, 'pelaajan valinta');
        assert.strictEqual(choose.players.length, 2);
        const me = choose.players.find(p => !p.robot);
        liisa.socket.emit('join-table', { code, name: 'Liisa', claimId: me.id });
        await until(() => liisa.state && liisa.state.table.resuming, 'palaaminen');
        liisa.socket.emit('resume-game');
        await until(() => liisa.state.game, 'jatkettu peli');
        assert.strictEqual(liisa.state.game.round, 2);
        assert.ok(liisa.events.some(e => e.type === 'resumed'));
        liisa.socket.close();
    } finally {
        await srv.close();
    }
});
