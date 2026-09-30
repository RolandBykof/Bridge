'use strict';
// Palvelimen testit oikeilla Socket.IO-yhteyksillä: pöydät, luojan oikeudet,
// robotit ja jakovuoro.
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { Server } = require('socket.io');
const { io: connect } = require('socket.io-client');
const maija = require('./socket.js');

async function startServer() {
    const server = http.createServer();
    const io = new Server(server);
    const handle = maija.attach(io, { robotDelayMs: 5 });
    await new Promise(resolve => server.listen(0, resolve));
    const url = `http://localhost:${server.address().port}/maija`;
    return {
        url,
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
    const c = { socket, state: null, events: [], errors: [], joined: null, joinError: null };
    socket.on('state', s => { c.state = s; });
    socket.on('game-event', e => c.events.push(e));
    socket.on('action-error', e => c.errors.push(e.text));
    socket.on('joined', d => { c.joined = d; });
    socket.on('join-error', e => { c.joinError = e.text; });
    return c;
}

async function until(check, what, ms = 3000) {
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

async function joinTable(url, code, name) {
    const c = client(url);
    c.socket.emit('join-table', { code, name });
    await until(() => c.state || c.joinError, 'liittyminen');
    return c;
}

test('pöydän luonti, liittyminen koodilla ja erilliset pöydät', async () => {
    const srv = await startServer();
    try {
        const kalle = await createTable(srv.url, 'Kalle');
        assert.match(kalle.state.table.code, /^\d{4}$/);
        assert.ok(kalle.state.you.isCreator);

        const liisa = await joinTable(srv.url, kalle.state.table.code, 'Liisa');
        assert.strictEqual(liisa.state.table.code, kalle.state.table.code);
        assert.strictEqual(liisa.state.you.isCreator, false);

        const tupla = await joinTable(srv.url, kalle.state.table.code, 'kalle');
        assert.match(tupla.joinError, /jo käytössä/);

        const huti = await joinTable(srv.url, '0000', 'Matti');
        assert.match(huti.joinError, /ei löydy/);

        const anna = await createTable(srv.url, 'Anna');
        assert.notStrictEqual(anna.state.table.code, kalle.state.table.code);
        assert.strictEqual(anna.state.members.length, 1, 'toisen pöydän jäsenet eivät näy');

        [kalle, liisa, tupla, huti, anna].forEach(c => c.socket.close());
    } finally {
        await srv.close();
    }
});

test('vain pöydän luoja voi lisätä robotteja ja aloittaa pelin', async () => {
    const srv = await startServer();
    try {
        const kalle = await createTable(srv.url, 'Kalle');
        const liisa = await joinTable(srv.url, kalle.state.table.code, 'Liisa');
        liisa.socket.emit('add-robot');
        liisa.socket.emit('start-game');
        await until(() => liisa.errors.length === 2, 'virheet');
        assert.match(liisa.errors[0], /Vain pöydän luoja/);
        assert.match(liisa.errors[1], /Vain pöydän luoja/);
        assert.strictEqual(kalle.state.game, null);
        [kalle, liisa].forEach(c => c.socket.close());
    } finally {
        await srv.close();
    }
});

test('robotteja enintään niin, että pöydässä on 5 pelaajaa', async () => {
    const srv = await startServer();
    try {
        const kalle = await createTable(srv.url, 'Kalle');
        const liisa = await joinTable(srv.url, kalle.state.table.code, 'Liisa');
        for (let i = 0; i < 4; i++) kalle.socket.emit('add-robot');
        await until(() => kalle.errors.length === 1, 'täynnä-virhe');
        assert.match(kalle.errors[0], /täynnä, 5\/5/);
        assert.strictEqual(kalle.state.members.filter(m => m.type === 'robot').length, 3);
        assert.strictEqual(kalle.state.table.seatedCount, 5);

        const robot = kalle.state.members.find(m => m.type === 'robot');
        kalle.socket.emit('remove-robot', { id: robot.id });
        await until(() => kalle.state.members.length === 4, 'robotin poisto');
        assert.ok(kalle.events.some(e => e.type === 'robot-removed' && e.name === robot.name));
        [kalle, liisa].forEach(c => c.socket.close());
    } finally {
        await srv.close();
    }
});

test('yksin ei voi aloittaa, mutta yksi ihminen ja robotti riittää', async () => {
    const srv = await startServer();
    try {
        const kalle = await createTable(srv.url, 'Kalle');
        kalle.socket.emit('start-game');
        await until(() => kalle.errors.length === 1, 'aloitusvirhe');
        assert.match(kalle.errors[0], /vähintään 2/);
        kalle.socket.emit('add-robot');
        await until(() => kalle.state.members.length === 2, 'robotti');
        kalle.socket.emit('start-game');
        await until(() => kalle.state.game, 'peli alkoi');
        kalle.socket.close();
    } finally {
        await srv.close();
    }
});

// Ihminen pelaa yksinkertaisesti: lyö ensimmäisen kortin, kaataa kaikilla korteilla.
async function playHumanToEnd(c) {
    for (let i = 0; i < 5000; i++) {
        const g = c.state.game;
        if (g.phase === 'over') return g;
        if (g.allowedActions.includes('attack')) {
            const card = g.hand[0];
            const before = c.state;
            c.socket.emit('attack', { cardIds: [`${card.suit}-${card.rank}`] });
            await until(() => c.state !== before, 'lyönti');
        } else if (g.allowedActions.includes('defend')) {
            const before = c.state;
            c.socket.emit('defend', { cardIds: g.hand.map(x => `${x.suit}-${x.rank}`) });
            await until(() => c.state !== before, 'kaato');
        } else {
            await new Promise(r => setTimeout(r, 5));
        }
    }
    throw new Error('peli ei päättynyt');
}

test('ihminen ja neljä robottia pelaavat pelin loppuun', async () => {
    const srv = await startServer();
    try {
        const kalle = await createTable(srv.url, 'Kalle');
        for (let i = 0; i < 4; i++) kalle.socket.emit('add-robot');
        await until(() => kalle.state.members.length === 5, 'robotit');
        kalle.socket.emit('start-game');
        await until(() => kalle.state.game, 'peli alkoi');
        const g = await playHumanToEnd(kalle);
        assert.strictEqual(g.phase, 'over');
        assert.ok(g.maijaId);
        assert.ok(kalle.events.some(e => e.type === 'over'));
        assert.ok(kalle.events.filter(e => e.type === 'attack').length > 3, 'robotit lyövät');
        kalle.socket.close();
    } finally {
        await srv.close();
    }
});

test('jakaja kiertää istumajärjestyksessä ja jakajaa seuraava aloittaa', async () => {
    const srv = await startServer();
    try {
        const kalle = await createTable(srv.url, 'Kalle');
        const liisa = await joinTable(srv.url, kalle.state.table.code, 'Liisa');
        kalle.socket.emit('add-robot');
        await until(() => kalle.state.members.length === 3, 'robotti');
        const seats = kalle.state.members.map(m => m.id);

        const dealers = [];
        for (let round = 0; round < 4; round++) {
            const epochBefore = kalle.events.filter(e => e.type === 'start').length;
            kalle.socket.emit('start-game');
            await until(() => kalle.events.filter(e => e.type === 'start').length > epochBefore, 'aloitus');
            const start = kalle.events.filter(e => e.type === 'start').pop();
            dealers.push(start.dealerId);
            const dealerSeat = seats.indexOf(start.dealerId);
            assert.strictEqual(start.starterId, seats[(dealerSeat + 1) % 3], 'jakajaa seuraava aloittaa');
            kalle.socket.emit('abort-game');
            await until(() => kalle.state.game === null, 'keskeytys');
        }
        for (let i = 1; i < dealers.length; i++) {
            assert.strictEqual(seats.indexOf(dealers[i]), (seats.indexOf(dealers[i - 1]) + 1) % 3);
        }
        [kalle, liisa].forEach(c => c.socket.close());
    } finally {
        await srv.close();
    }
});

test('uudelleenliittyminen tokenilla palauttaa saman paikan ja luojan oikeudet', async () => {
    const srv = await startServer();
    try {
        const kalle = await createTable(srv.url, 'Kalle');
        const { code, token } = kalle.joined;
        const id = kalle.state.you.id;
        kalle.socket.close();
        await new Promise(r => setTimeout(r, 50));
        const back = client(srv.url);
        back.socket.emit('join-table', { code, token });
        await until(() => back.state, 'paluu');
        assert.strictEqual(back.state.you.id, id);
        assert.ok(back.state.you.isCreator);
        back.socket.close();
    } finally {
        await srv.close();
    }
});
