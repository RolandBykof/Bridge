'use strict';
// Palvelimen testit oikeilla Socket.IO-yhteyksillä: pöytä, robotit ja koko peli.
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { Server } = require('socket.io');
const { io: connect } = require('socket.io-client');
const hertta = require('./socket.js');
const { legalCards } = require('../public/hertta/js/saannot.js');

async function startServer() {
    const server = http.createServer();
    const io = new Server(server);
    const handle = hertta.attach(io, { robotDelayMs: 1 });
    await new Promise(resolve => server.listen(0, resolve));
    return {
        url: `http://localhost:${server.address().port}/hertta`,
        async close() {
            handle.close();
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
    for (let i = 0; i < 20000; i++) {
        const g = c.state.game;
        if (g.phase === 'over') return g;
        const before = c.state;
        if (g.allowedActions.includes('pass')) {
            c.socket.emit('pass', { cardIds: g.hand.slice(0, 3).map(id) });
        } else if (g.allowedActions.includes('play')) {
            const lead = g.trick.length ? g.trick[0].card.suit : null;
            const legal = legalCards(g.hand, { lead, firstTrick: g.tricksPlayed === 0, heartsBroken: g.heartsBroken });
            c.socket.emit('play', { cardId: id(legal[0]) });
        } else if (g.allowedActions.includes('next-round')) {
            c.socket.emit('next-round');
        } else {
            await new Promise(r => setTimeout(r, 2));
            continue;
        }
        await until(() => c.state !== before, 'siirto');
    }
    throw new Error('peli ei päättynyt');
}

test('ihminen ja kolme robottia pelaavat pelin loppuun', async () => {
    const srv = await startServer();
    try {
        const alice = await createTable(srv.url, 'Alice');
        for (let i = 0; i < 3; i++) alice.socket.emit('add-robot');
        await until(() => alice.state.members.length === 4, 'robotit');
        alice.socket.emit('start-game');
        await until(() => alice.state.game, 'peli alkoi');
        const start = alice.events.find(e => e.type === 'start');
        assert.strictEqual(start.passDirection, 'left');
        const g = await playHumanToEnd(alice);
        assert.strictEqual(g.phase, 'over');
        assert.ok(g.winnerIds.length >= 1);
        assert.ok(g.players.some(p => p.score >= 100));
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
        alice.socket.close();
    } finally {
        await srv.close();
    }
});
