'use strict';
// Robotti pelinviejänä ja ihminen sen lepääjänä: ihminen pelaa molemmat kädet
// (getEffectiveController), mutta puolustajien on silti saatava pelata omat
// korttinsa. Testi oikeaa palvelinta (server.js) vastaan minibridgessä, jossa
// pelinviejä ratkeaa pisteistä, joten pöytiä luodaan, kunnes itä (robotti)
// on pelinviejä ja länsi (ihminen) lepääjä.
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
    c.find = (event, match = () => true) => c.events.find(e => e.event === event && match(e.data));
    c.wait = (event, what = event, match, ms = 15000) => until(() => c.find(event, match), what, ms);
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

// Pöytä, jossa länsi ja etelä ovat ihmisiä ja itä ja pohjoinen robotteja.
// Palauttaa pöydän, jossa itä on pelinviejä, tai null.
async function tableWithRobotDeclarer() {
    const west = client();
    const south = client();
    west.socket.emit('createTable', { playerName: 'Lansi', position: 'west', gameMode: 'minibridge' });
    const code = (await west.wait('tableCreated', 'pöydän luonti')).data.tableCode;
    south.socket.emit('selectPosition', { tableCode: code, position: 'south', playerName: 'Etela' });
    await south.wait('tableInfo', 'etelän paikka');
    west.socket.emit('startGame', { tableCode: code });
    const started = (await west.wait('gameStarted', 'peli alkaa', undefined, 10000)).data;
    const mini = started.miniState;
    if (mini && mini.phase === 'contract' && mini.declarer === 'east' && mini.dummy === 'west') {
        return { code, west, south };
    }
    west.close();
    south.close();
    return null;
}

test('puolustaja saa pelata, kun robotti on pelinviejä ja ihminen sen lepääjä', async () => {
    let found = null;
    for (let i = 0; i < 60 && !found; i++) found = await tableWithRobotDeclarer();
    assert.ok(found, 'ei löytynyt jakoa, jossa itä on pelinviejä');
    const { code, west, south } = found;
    try {
        // Lepääjä (länsi) valitsee sopimuksen robottipelinviejän puolesta.
        west.socket.emit('chooseMiniContract', { tableCode: code, type: 'partscore', strain: 'N' });
        await south.wait('biddingComplete', 'pelivaihe alkaa');

        // Avauslähtö on pelinviejän vasemmalla puolella eli etelällä.
        const cards = (await south.wait('yourCards', 'etelän kortit')).data.cards;
        const suit = ['spades', 'hearts', 'diamonds', 'clubs'].find(s => cards[s] && cards[s].length);
        south.socket.emit('playCard', { tableCode: code, position: 'south', suit, card: cards[suit][0] });

        const played = await south.wait('cardPlayed', 'etelän kortti pelataan', d => d.position === 'south', 5000)
            .catch(() => null);
        const error = south.find('error');
        assert.strictEqual(error && error.data.message, undefined);
        assert.ok(played, 'etelän kortti ei mennyt pöytään');
    } finally {
        west.close();
        south.close();
    }
});
