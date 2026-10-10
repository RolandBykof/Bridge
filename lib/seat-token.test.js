'use strict';
// Bridgen salainen paikkatunniste oikeaa palvelinta (server.js) vastaan: paikan
// saa takaisin tunnisteella, mutta yhteydessä olevan pelaajan paikkaa ei voi
// ottaa pelkällä nimellä. Nimellä palaaminen katkenneelle paikalle on
// testattu tiedostossa lib/practice/server.test.js.
const test = require('node:test');
const assert = require('node:assert');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
const { io: connect } = require('socket.io-client');

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

test.before(async () => {
    const port = await freePort();
    url = `http://localhost:${port}`;
    serverProcess = spawn(process.execPath, [SERVER], {
        env: { ...process.env, PORT: String(port) },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Palvelin ei käynnistynyt')), 15000);
        serverProcess.stdout.on('data', (chunk) => {
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
    const socket = connect(url, { transports: ['websocket'], forceNew: true });
    const c = { socket, events: [] };
    socket.onAny((event, data) => c.events.push({ event, data }));
    c.find = (event) => c.events.find(e => e.event === event);
    c.wait = (event, what = event, ms = 15000) => until(() => c.find(event), what, ms);
    c.close = () => socket.close();
    return c;
}

async function until(check, what, ms = 15000) {
    const start = Date.now();
    while (Date.now() - start < ms) {
        const value = check();
        if (value) return value;
        await new Promise(r => setTimeout(r, 20));
    }
    throw new Error(`Aikakatkaisu: ${what}`);
}

const pause = ms => new Promise(r => setTimeout(r, ms));

test('paikan saa takaisin tunnisteella, mutta ei pelkällä nimellä yhteydessä olevalta', async () => {
    const owner = client();
    const clients = [owner];
    try {
        owner.socket.emit('createTable', { playerName: 'Ville', position: 'south', gameMode: 'bridge' });
        const created = (await owner.wait('tableCreated', 'pöydän luonti')).data;
        const code = created.tableCode;
        const token = created.seatToken;
        assert.match(token, /^[0-9a-f-]{36}$/);
        assert.ok(!JSON.stringify(created.table).includes(token), 'tunniste ei näy pöydän tiedoissa');

        owner.socket.emit('startGame', { tableCode: code });
        await owner.wait('gameStarted', 'peli alkaa');

        // Sama nimi ilman tunnistetta, kun Ville on yhteydessä: paikkaa ei saa.
        const impostor = client();
        clients.push(impostor);
        impostor.socket.emit('getTableInfo', { tableCode: code, playerName: 'Ville' });
        const info = (await impostor.wait('tableInfo', 'pöydän tiedot')).data;
        assert.strictEqual(info.playerPosition, null);
        assert.strictEqual(info.seatToken, undefined);
        await pause(200);
        assert.strictEqual(impostor.find('gameReconnect'), undefined);
        assert.strictEqual(impostor.find('yourCards'), undefined);

        // Tunnisteella (esim. sivun päivitys) paikka siirtyy uudelle yhteydelle heti.
        const refreshed = client();
        clients.push(refreshed);
        refreshed.socket.emit('getTableInfo', { tableCode: code, playerName: 'Ville', seatToken: token });
        const reconnect = (await refreshed.wait('gameReconnect', 'paluu tunnisteella')).data;
        assert.strictEqual(reconnect.playerPosition, 'south');
        assert.strictEqual(reconnect.seatToken, token);
        await refreshed.wait('yourCards', 'oma käsi');

        // Vanhan yhteyden katkeaminen ei merkitse paikkaa katkenneeksi, joten
        // nimellä ei edelleenkään pääse paikalle.
        owner.close();
        await pause(300);
        const second = client();
        clients.push(second);
        second.socket.emit('getTableInfo', { tableCode: code, playerName: 'Ville' });
        const again = (await second.wait('tableInfo', 'pöydän tiedot')).data;
        assert.strictEqual(again.playerPosition, null);
        assert.strictEqual(refreshed.find('playerDisconnected'), undefined);
    } finally {
        clients.forEach(c => c.close());
    }
});

test('varattua paikkaa ei voi valita samalla nimellä odotushuoneessa', async () => {
    const owner = client();
    const other = client();
    try {
        owner.socket.emit('createTable', { playerName: 'Anna', position: 'north', gameMode: 'bridge' });
        const code = (await owner.wait('tableCreated', 'pöydän luonti')).data.tableCode;
        other.socket.emit('selectPosition', { tableCode: code, position: 'north', playerName: 'Anna' });
        const error = (await other.wait('error', 'virhe')).data;
        assert.strictEqual(error.message, 'Position is already taken');

        other.socket.emit('selectPosition', { tableCode: code, position: 'east', playerName: 'Pekka' });
        const info = (await other.wait('tableInfo', 'paikka')).data;
        assert.strictEqual(info.playerPosition, 'east');
        assert.match(info.seatToken, /^[0-9a-f-]{36}$/);
    } finally {
        owner.close();
        other.close();
    }
});
