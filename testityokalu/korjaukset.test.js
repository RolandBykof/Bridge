'use strict';
// Regressiotestit testityökalun löytämille palvelimen virheille (12.10.2026):
// pelinviejän valinta, paikkatunnisteiden vuoto, kahdennussääntö ja pöydästä
// poistuminen "kaikki passasivat" -tauon aikana.
const test = require('node:test');
const assert = require('node:assert');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
const { io } = require('socket.io-client');

const SERVER = path.join(__dirname, '..', 'server.js');

function freePort() {
    return new Promise((resolve, reject) => {
        const probe = net.createServer();
        probe.once('error', reject);
        probe.listen(0, () => {
            const { port } = probe.address();
            probe.close(() => resolve(port));
        });
    });
}

let serverProcess;
let url;
let serverLog = '';

test.before(async () => {
    const port = await freePort();
    url = `http://localhost:${port}`;
    // Testitila lyhentää odotukset; robotteja ei tarvita, kaikki paikat ovat ihmisiä
    serverProcess = spawn(process.execPath, [SERVER], {
        env: { ...process.env, PORT: String(port), TEST_MODE: '1', ROBOT_BIDDER: 'local' },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    serverProcess.stderr.on('data', (c) => { serverLog += String(c); });
    await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Palvelin ei käynnistynyt')), 15000);
        serverProcess.stdout.on('data', (chunk) => {
            serverLog += String(chunk);
            if (String(chunk).includes('running on port')) {
                clearTimeout(timer);
                resolve();
            }
        });
        serverProcess.once('exit', (code) => reject(new Error(`Palvelin pysähtyi: ${code}`)));
    });
});

test.after(() => {
    if (serverProcess) serverProcess.kill();
});

function client() {
    const socket = io(url, { transports: ['websocket'], forceNew: true, reconnection: false });
    const c = { socket, events: [] };
    socket.onAny((event, data) => c.events.push({ event, data }));
    c.find = (event, from = 0) => c.events.slice(from).find(e => e.event === event);
    c.wait = async (event, from = 0, ms = 10000) => {
        const start = Date.now();
        while (Date.now() - start < ms) {
            const e = c.find(event, from);
            if (e) return e;
            await new Promise(r => setTimeout(r, 10));
        }
        throw new Error(`Aikakatkaisu: ${event}`);
    };
    return c;
}

/** Neljän ihmisen pöytä; etelä luo ja jakaa ensimmäisen jaon. */
async function fullTable() {
    const seats = {};
    seats.south = client();
    seats.south.socket.emit('createTable', { playerName: 'S', position: 'south', gameMode: 'bridge' });
    const code = (await seats.south.wait('tableCreated')).data.tableCode;
    for (const pos of ['west', 'north', 'east']) {
        seats[pos] = client();
        seats[pos].socket.emit('selectPosition', { tableCode: code, position: pos, playerName: pos });
        await seats[pos].wait('tableInfo');
    }
    seats.south.socket.emit('startGame', { tableCode: code });
    for (const c of Object.values(seats)) await c.wait('gameStarted');
    return { code, seats, close: () => Object.values(seats).forEach(c => c.socket.close()) };
}

/** Tekee tarjouksen ja palauttaa joko bidMade/biddingComplete/allPassed-viestin tai virheen. */
async function bid(t, pos, b) {
    const c = t.seats[pos];
    const from = c.events.length;
    c.socket.emit('makeBid', { tableCode: t.code, position: pos, bid: b });
    const start = Date.now();
    while (Date.now() - start < 5000) {
        const e = c.events.slice(from).find(x => ['error', 'bidMade', 'biddingComplete', 'allPassed'].includes(x.event));
        if (e) return e;
        await new Promise(r => setTimeout(r, 10));
    }
    throw new Error(`Ei vastausta tarjoukseen ${pos} ${b}`);
}

test('pelinviejä on sopimuspuolen pelaaja, joka nimesi maan ensin', async () => {
    const t = await fullTable();
    try {
        // Etelä nimeää ruudun ensin, mutta sopimus on idän ja lännen ruutu
        for (const [pos, b] of [['south', '1D'], ['west', 'P'], ['north', 'P'], ['east', '2D'], ['south', 'P'], ['west', '3D'], ['north', 'P'], ['east', 'P']]) {
            const r = await bid(t, pos, b);
            assert.notStrictEqual(r.event, 'error', `${pos} ${b}: ${r.data && r.data.message}`);
        }
        const r = await bid(t, 'south', 'P');
        assert.strictEqual(r.event, 'biddingComplete');
        assert.strictEqual(r.data.contract, '3D');
        assert.strictEqual(r.data.declarer, 'east');
        assert.strictEqual(r.data.dummy, 'west');
        assert.strictEqual(r.data.currentPlayer, 'south');
    } finally {
        t.close();
    }
});

test('pelaajat eivät saa toistensa paikkatunnisteita', async () => {
    const t = await fullTable();
    try {
        for (const [pos, c] of Object.entries(t.seats)) {
            const own = (c.find('tableInfo') || c.find('tableCreated')).data.seatToken;
            const others = Object.entries(t.seats).filter(([p]) => p !== pos)
                .map(([, o]) => (o.find('tableInfo') || o.find('tableCreated')).data.seatToken);
            const text = JSON.stringify(c.events);
            assert.ok(text.includes(own), 'oma tunniste on tallessa');
            for (const token of others) assert.ok(!text.includes(token), `${pos} sai toisen pelaajan tunnisteen`);
            const players = c.find('gameStarted').data.gameState.players;
            for (const p of Object.values(players)) assert.deepStrictEqual(Object.keys(p).sort(), ['name', 'type']);
        }
    } finally {
        t.close();
    }
});

test('kahdennus ja vastakahdennus vain sääntöjen mukaan', async () => {
    const t = await fullTable();
    try {
        let r = await bid(t, 'south', 'X');
        assert.strictEqual(r.event, 'error', 'kahdennus ilman tarjousta');
        r = await bid(t, 'south', 'XX');
        assert.strictEqual(r.event, 'error', 'vastakahdennus ilman kahdennusta');
        assert.strictEqual((await bid(t, 'south', '1H')).event, 'bidMade');
        assert.strictEqual((await bid(t, 'west', 'P')).event, 'bidMade');
        r = await bid(t, 'north', 'X');
        assert.strictEqual(r.event, 'error', 'oman puolen tarjouksen kahdennus');
        assert.strictEqual((await bid(t, 'north', 'P')).event, 'bidMade');
        r = await bid(t, 'east', 'X');
        assert.strictEqual(r.event, 'bidMade', 'vastustajan tarjouksen kahdennus passien jälkeen');
        r = await bid(t, 'south', 'X');
        assert.strictEqual(r.event, 'error', 'kahdennetun kahdennus');
        r = await bid(t, 'south', 'XX');
        assert.strictEqual(r.event, 'bidMade', 'vastakahdennus');
        for (const pos of ['west', 'north']) assert.strictEqual((await bid(t, pos, 'P')).event, 'bidMade');
        r = await bid(t, 'east', 'P');
        assert.strictEqual(r.event, 'biddingComplete');
        assert.strictEqual(r.data.contract, '1HXX');
        assert.strictEqual(r.data.declarer, 'south');
    } finally {
        t.close();
    }
});

test('pöydästä poistuminen passatun jaon jälkeen ei kaada uuden jaon aloitusta', async () => {
    const t = await fullTable();
    try {
        for (const pos of ['south', 'west', 'north']) assert.strictEqual((await bid(t, pos, 'P')).event, 'bidMade');
        // Länsi poistuu ennen neljättä passia, jolloin paikka on tyhjä, kun
        // palvelin aloittaa automaattisesti uuden jaon
        t.seats.west.socket.emit('leaveTable');
        await t.seats.south.wait('playerLeft');
        const r = await bid(t, 'east', 'P');
        assert.strictEqual(r.event, 'allPassed');
        const next = await t.seats.south.wait('newDealStarted');
        assert.strictEqual(next.data.dealNumber, 2);
        await new Promise(r => setTimeout(r, 200));
        assert.strictEqual(t.seats.south.find('dealError'), undefined, 'dealError');
        assert.ok(t.seats.south.find('yourCards', t.seats.south.events.indexOf(next)), 'etelä sai uudet kortit');
        assert.ok(!/Error starting next deal/.test(serverLog), serverLog);
    } finally {
        t.close();
    }
});
