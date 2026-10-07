'use strict';
// Palvelimen testit oikeilla Socket.IO-yhteyksillä: pöytä, robotit ja koko peli.
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { Server } = require('socket.io');
const { io: connect } = require('socket.io-client');
const ristiseiska = require('./socket.js');
const maija = require('../maija/socket.js');
const { isPlayable } = require('../public/ristiseiska/js/saannot.js');

async function startServer() {
    const server = http.createServer();
    const io = new Server(server);
    const handle = ristiseiska.attach(io, { robotDelayMs: 2 });
    const maijaHandle = maija.attach(io, { robotDelayMs: 2 });
    await new Promise(resolve => server.listen(0, resolve));
    const base = `http://localhost:${server.address().port}`;
    return {
        url: `${base}/ristiseiska`,
        maijaUrl: `${base}/maija`,
        async close() {
            handle.close();
            maijaHandle.close();
            io.close();
            await new Promise(resolve => server.close(resolve));
        }
    };
}

function client(url) {
    const socket = connect(url, { transports: ['websocket'], forceNew: true });
    const c = { socket, state: null, events: [], errors: [], joined: null, joinError: null };
    socket.on('state', s => { c.state = s; });
    socket.on('game-event', e => c.events.push(e));
    socket.on('action-error', e => c.errors.push(e.text));
    socket.on('joined', d => { c.joined = d; });
    socket.on('join-error', e => { c.joinError = e.text; });
    return c;
}

async function until(check, what, ms = 5000) {
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

test('pöydässä enintään 8 pelaajaa, ja ristiseiskan pöydät ovat erillään Maijasta', async () => {
    const srv = await startServer();
    try {
        const kalle = await createTable(srv.url, 'Kalle');
        for (let i = 0; i < 8; i++) kalle.socket.emit('add-robot');
        await until(() => kalle.errors.length === 1, 'täynnä-virhe');
        assert.match(kalle.errors[0], /täynnä, 8\/8/);
        assert.strictEqual(kalle.state.table.seatedCount, 8);

        const maijaClient = client(srv.maijaUrl);
        maijaClient.socket.emit('join-table', { code: kalle.state.table.code, name: 'Liisa' });
        await until(() => maijaClient.joinError || maijaClient.state, 'maijan liittyminen');
        // Sama koodi voi olla Maijassa sattumalta, mutta ristiseiskan pöytä ei näy siellä.
        if (maijaClient.state) assert.ok(!maijaClient.state.members.some(m => m.name === 'Kalle'));
        [kalle, maijaClient].forEach(c => c.socket.close());
    } finally {
        await srv.close();
    }
});

// Ihminen pelaa yksinkertaisesti: lyö ensimmäisen sopivan, muuten pyytää;
// antaa ensimmäisen korttinsa; lopettaa lisävuoron.
async function playHumanToEnd(c) {
    for (let i = 0; i < 5000; i++) {
        const g = c.state.game;
        if (g.phase === 'over') return g;
        const before = c.state;
        if (g.allowedActions.includes('give')) {
            c.socket.emit('give', { cardId: id(g.hand[0]) });
        } else if (g.allowedActions.includes('play')) {
            const playable = g.hand.find(card => isPlayable(g.table, card));
            if (playable) c.socket.emit('play', { cardId: id(playable) });
            else c.socket.emit(g.bonus ? 'end-turn' : 'ask');
        } else {
            await new Promise(r => setTimeout(r, 3));
            continue;
        }
        await until(() => c.state !== before, 'siirto');
    }
    throw new Error('peli ei päättynyt');
}

test('ihminen ja viisi robottia pelaavat pelin loppuun', async () => {
    const srv = await startServer();
    try {
        const kalle = await createTable(srv.url, 'Kalle');
        for (let i = 0; i < 5; i++) kalle.socket.emit('add-robot');
        await until(() => kalle.state.members.length === 6, 'robotit');
        kalle.socket.emit('start-game');
        await until(() => kalle.state.game, 'peli alkoi');
        const start = kalle.events.find(e => e.type === 'start');
        assert.ok(start.sevenHolderName && start.starterName);
        const g = await playHumanToEnd(kalle);
        assert.strictEqual(g.phase, 'over');
        assert.ok(g.loserId);
        assert.strictEqual(g.finishOrder.length, 6);
        assert.ok(kalle.events.some(e => e.type === 'over'));
        assert.ok(kalle.events.filter(e => e.type === 'play').length > 20, 'robotit lyövät');
        assert.deepStrictEqual(kalle.errors, [], 'ei hylättyjä siirtoja');
        // Muiden väliset annetut kortit eivät näy.
        const myId = kalle.state.you.id;
        for (const e of kalle.events.filter(e => e.type === 'give')) {
            if (e.giverId !== myId && e.receiverId !== myId) assert.strictEqual(e.card, null);
        }
        kalle.socket.close();
    } finally {
        await srv.close();
    }
});

test('väärät siirrot palauttavat suomenkielisen virheen', async () => {
    const srv = await startServer();
    try {
        const kalle = await createTable(srv.url, 'Kalle');
        kalle.socket.emit('add-robot');
        await until(() => kalle.state.members.length === 2, 'robotti');
        kalle.socket.emit('start-game');
        await until(() => kalle.state.game, 'peli alkoi');
        kalle.socket.emit('play', {});
        await until(() => kalle.errors.length >= 1, 'virhe');
        assert.match(kalle.errors[0], /Valitse ensin kortti/);
        kalle.socket.close();
    } finally {
        await srv.close();
    }
});
