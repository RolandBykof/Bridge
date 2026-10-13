'use strict';
// Bridgen kibitsointi oikeaa palvelinta (server.js) vastaan, ks. kibitsointi.html.
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
    // Testitila ja paikallinen tarjoaja: robotit toimivat nopeasti ilman GIB-verkkokutsuja.
    serverProcess = spawn(process.execPath, [SERVER], {
        env: { ...process.env, PORT: String(port), TEST_MODE: '1', ROBOT_BIDDER: 'local' },
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
    c.waitError = (message, ms = 15000) =>
        until(() => c.events.find(e => e.event === 'error' && e.data.message === message), `virhe: ${message}`, ms);
    c.clear = () => { c.events.length = 0; };
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

function assertFullDeal(hands) {
    for (const pos of ['north', 'east', 'south', 'west']) {
        const count = Object.values(hands[pos]).reduce((n, cards) => n + cards.length, 0);
        assert.strictEqual(count, 13, `${pos}: 13 korttia`);
    }
}

test('pöydän luoja kibitserinä: neljä robottia, luojan oikeudet ja kaikki kädet', async () => {
    const creator = client();
    const clients = [creator];
    try {
        creator.socket.emit('createTable', { playerName: 'Katsoja', position: 'kibitzer', gameMode: 'bridge' });
        const created = (await creator.wait('tableCreated', 'pöydän luonti')).data;
        const code = created.tableCode;
        assert.strictEqual(created.playerPosition, 'kibitzer');
        assert.strictEqual(created.amCreator, true);
        assert.strictEqual(created.table.allowKibitzing, true);
        assert.deepStrictEqual(created.table.kibitzers, ['Katsoja']);
        assert.deepStrictEqual(Object.values(created.table.players), [null, null, null, null]);

        // Kibitsointia ei voi ottaa pois, kun luoja on kibitser.
        creator.socket.emit('setAllowKibitzing', { tableCode: code, enabled: false });
        await creator.waitError('Kibitzing is always allowed when the table creator is a kibitzer');

        creator.socket.emit('startGame', { tableCode: code });
        const started = (await creator.wait('gameStarted', 'peli alkaa')).data;
        assert.deepStrictEqual(started.autoFilledWithRobot, ['north', 'east', 'south', 'west']);
        const hands = (await creator.wait('kibitzerHands', 'kaikki kädet')).data.hands;
        assertFullDeal(hands);
        assert.strictEqual(creator.find('yourCards'), undefined);

        // Toinen kibitser liittyy kesken pelin, mutta ei saa luojan oikeuksia.
        const other = client();
        clients.push(other);
        other.socket.emit('getTableInfo', { tableCode: code, playerName: 'Toinen' });
        const info = (await other.wait('tableInfo', 'pöydän tiedot')).data;
        assert.strictEqual(info.table.state, 'playing');
        assert.strictEqual(info.table.allowKibitzing, true);
        other.socket.emit('selectPosition', { tableCode: code, position: 'kibitzer', playerName: 'Toinen' });
        const reconnect = (await other.wait('gameReconnect', 'kibitserin pelinäkymä')).data;
        assert.strictEqual(reconnect.playerPosition, 'kibitzer');
        assert.strictEqual(reconnect.amCreator, false);
        assert.strictEqual(reconnect.gameState.hands, undefined);
        // Robotit ovat voineet jo pelata kortteja, joten tarkistetaan vain, että kaikki neljä kättä tulevat.
        const otherHands = (await other.wait('kibitzerHands', 'kaikki kädet')).data.hands;
        assert.deepStrictEqual(Object.keys(otherHands).sort(), ['east', 'north', 'south', 'west']);
        await creator.wait('kibitzerJoined', 'ilmoitus uudesta kibitseristä');

        // Ilmansuuntaan ei voi liittyä kesken pelin.
        other.socket.emit('selectPosition', { tableCode: code, position: 'north', playerName: 'Toinen' });
        await other.waitError('Leave the table first to take a seat');

        other.socket.emit('requestNextDeal', { tableCode: code });
        await other.waitError('Only the player who created the table can start the next deal');
        other.socket.emit('startDoubleDummyReview', { tableCode: code });
        await other.waitError('Only the table creator can control the double dummy review');
        other.socket.emit('setAutoNextDeal', { tableCode: code, enabled: true });
        await other.waitError('Kibitzers cannot change this setting');

        // Luoja voi aloittaa seuraavan jaon, ja kibitserit saavat uudet kädet.
        creator.clear();
        other.clear();
        creator.socket.emit('requestNextDeal', { tableCode: code });
        await creator.wait('newDealStarted', 'seuraava jako');
        assertFullDeal((await creator.wait('kibitzerHands', 'uudet kädet')).data.hands);
        assertFullDeal((await other.wait('kibitzerHands', 'uudet kädet toiselle')).data.hands);
    } finally {
        clients.forEach(c => c.close());
    }
});

test('istuva luoja sallii kibitsoinnin, kibitser ei voi pelata ja poistuu, kun rasti otetaan pois', async () => {
    const creator = client();
    const kib = client();
    const clients = [creator, kib];
    try {
        creator.socket.emit('createTable', { playerName: 'Anna', position: 'south', gameMode: 'bridge' });
        const created = (await creator.wait('tableCreated', 'pöydän luonti')).data;
        const code = created.tableCode;
        assert.strictEqual(created.table.allowKibitzing, false);

        kib.socket.emit('selectPosition', { tableCode: code, position: 'kibitzer', playerName: 'Kibi' });
        await kib.waitError('Kibitzing is not allowed at this table');

        // Vain luoja voi muuttaa asetusta.
        kib.socket.emit('setAllowKibitzing', { tableCode: code, enabled: true });
        await kib.waitError('Only the table creator can change kibitzing');

        creator.socket.emit('setAllowKibitzing', { tableCode: code, enabled: true });
        assert.strictEqual((await creator.wait('allowKibitzingChanged', 'asetus muuttui')).data.enabled, true);

        kib.clear();
        kib.socket.emit('selectPosition', { tableCode: code, position: 'kibitzer', playerName: 'Kibi' });
        const info = (await kib.wait('tableInfo', 'kibitser odotushuoneessa')).data;
        assert.strictEqual(info.playerPosition, 'kibitzer');
        assert.match(info.seatToken, /^[0-9a-f-]{36}$/);
        assert.ok(!JSON.stringify(info.table).includes(info.seatToken), 'tunniste ei näy pöydän tiedoissa');
        assert.deepStrictEqual(info.table.kibitzers, ['Kibi']);
        assert.deepStrictEqual(Object.values(info.table.players).filter(Boolean).length, 1);

        // Kibitser ei voi aloittaa peliä.
        kib.socket.emit('startGame', { tableCode: code });
        await kib.waitError('Only the player who created the table can start the game');

        creator.socket.emit('startGame', { tableCode: code });
        await creator.wait('yourCards', 'oma käsi');
        assertFullDeal((await kib.wait('kibitzerHands', 'kaikki kädet')).data.hands);
        await pause(200);
        assert.strictEqual(creator.find('kibitzerHands'), undefined, 'pelaaja ei saa kaikkia käsiä');

        // Jakaja on South, joten ensimmäinen tarjousvuoro on luojalla.
        kib.socket.emit('makeBid', { tableCode: code, position: 'south', bid: 'P' });
        await kib.waitError('You cannot bid from this position');

        // Chat: kibitserin viesti merkitään kibitserin viestiksi.
        kib.socket.emit('sendChatMessage', { tableCode: code, message: 'Hei' });
        const chat = (await creator.wait('chatMessage', 'chat')).data;
        assert.strictEqual(chat.position, 'kibitzer');
        assert.strictEqual(chat.sender, 'Kibi');

        // Rasti pois kesken jaon: kibitser poistetaan heti.
        creator.socket.emit('setAllowKibitzing', { tableCode: code, enabled: false });
        await kib.wait('kibitzingDisabled', 'kibitser poistettu');
        kib.clear();
        creator.socket.emit('makeBid', { tableCode: code, position: 'south', bid: 'P' });
        await creator.wait('bidMade', 'tarjous');
        await pause(300);
        assert.strictEqual(kib.find('bidMade'), undefined, 'poistettu kibitser ei saa enää pelin viestejä');

        kib.socket.emit('selectPosition', { tableCode: code, position: 'kibitzer', playerName: 'Kibi' });
        await kib.waitError('Kibitzing is not allowed at this table');
    } finally {
        clients.forEach(c => c.close());
    }
});

test('kibitser palaa tunnisteella sivun päivityksen jälkeen', async () => {
    const creator = client();
    const clients = [creator];
    try {
        creator.socket.emit('createTable', { playerName: 'Luoja', position: 'north', gameMode: 'bridge', allowKibitzing: true });
        const code = (await creator.wait('tableCreated', 'pöydän luonti')).data.tableCode;

        const kib = client();
        clients.push(kib);
        kib.socket.emit('selectPosition', { tableCode: code, position: 'kibitzer', playerName: 'Kibi' });
        const token = (await kib.wait('tableInfo', 'kibitser')).data.seatToken;

        creator.socket.emit('startGame', { tableCode: code });
        await kib.wait('kibitzerHands', 'kädet');

        kib.close();
        await pause(300);
        const refreshed = client();
        clients.push(refreshed);
        refreshed.socket.emit('getTableInfo', { tableCode: code, playerName: 'Kibi', seatToken: token });
        const reconnect = (await refreshed.wait('gameReconnect', 'paluu')).data;
        assert.strictEqual(reconnect.playerPosition, 'kibitzer');
        assert.strictEqual(reconnect.seatToken, token);
        await refreshed.wait('kibitzerHands', 'kädet uudelleen');
        assert.deepStrictEqual(reconnect.table.kibitzers, ['Kibi']);
    } finally {
        clients.forEach(c => c.close());
    }
});

test('kibitser-luojan pöytä poistuu, kun luoja lähtee; harjoituksessa luoja ei voi olla kibitser', async () => {
    const creator = client();
    const visitor = client();
    try {
        creator.socket.emit('createTable', { playerName: 'Yksin', position: 'kibitzer', gameMode: 'bridge' });
        const code = (await creator.wait('tableCreated', 'pöydän luonti')).data.tableCode;

        creator.socket.emit('leaveTable');
        await pause(200);
        visitor.socket.emit('getTableInfo', { tableCode: code, playerName: 'Vieras' });
        await visitor.waitError('Table not found');

        creator.socket.emit('createTable', { playerName: 'Yksin', position: 'kibitzer', gameMode: 'declarerPractice', practiceType: 'mixed' });
        await creator.waitError('The table creator cannot be a kibitzer in declarer practice');

        creator.socket.emit('createTable', { playerName: 'Yksin', position: 'center', gameMode: 'bridge' });
        await creator.waitError('Invalid position');
    } finally {
        creator.close();
        visitor.close();
    }
});
