'use strict';
// Ihminen pelinviejänä ja ihminen lepääjänä: lepääjä saa pelinviejän käden
// (vain katseltavaksi) avauslähdön jälkeen, mutta ei ennen sitä, eivätkä
// puolustajat saa sitä koskaan (revealDeclarerHandToDummyIfNeeded).
// Testi oikeaa palvelinta (server.js) vastaan minibridgessä, jossa pelinviejä
// ratkeaa pisteistä, joten pöytiä luodaan, kunnes pohjois-etelä pelaa.
const test = require('node:test');
const assert = require('node:assert');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
const { io: connect } = require('socket.io-client');

const SERVER = path.join(__dirname, '..', 'server.js');
const SUITS = ['spades', 'hearts', 'diamonds', 'clubs'];

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
    c.indexOf = (event) => c.events.findIndex(e => e.event === event);
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

const nextSeat = { north: 'east', east: 'south', south: 'west', west: 'north' };

// Pöytä, jossa pohjoinen, etelä ja itä ovat ihmisiä ja länsi robotti.
// Palauttaa pöydän, jossa pelinviejä ja lepääjä ovat pohjois-etelää, tai null.
async function tableWithHumanDeclarer() {
    const seats = { north: client(), south: client(), east: client() };
    const all = () => Object.values(seats);
    seats.north.socket.emit('createTable', { playerName: 'Pohjoinen', position: 'north', gameMode: 'minibridge' });
    const code = (await seats.north.wait('tableCreated', 'pöydän luonti')).data.tableCode;
    seats.south.socket.emit('selectPosition', { tableCode: code, position: 'south', playerName: 'Etela' });
    await seats.south.wait('tableInfo', 'etelän paikka');
    seats.east.socket.emit('selectPosition', { tableCode: code, position: 'east', playerName: 'Ita' });
    await seats.east.wait('tableInfo', 'idän paikka');
    seats.north.socket.emit('startGame', { tableCode: code });
    const started = (await seats.north.wait('gameStarted', 'peli alkaa', undefined, 10000)).data;
    const mini = started.miniState;
    if (mini && mini.phase === 'contract' && (mini.declarer === 'north' || mini.declarer === 'south')) {
        return { code, seats, declarer: mini.declarer, dummy: mini.dummy, close: () => all().forEach(c => c.close()) };
    }
    all().forEach(c => c.close());
    return null;
}

test('ihmislepääjä näkee ihmispelinviejän käden avauslähdön jälkeen, puolustaja ei', async () => {
    let found = null;
    for (let i = 0; i < 60 && !found; i++) found = await tableWithHumanDeclarer();
    assert.ok(found, 'ei löytynyt jakoa, jossa pohjois-etelä pelaa');
    const { code, seats, declarer, dummy, close } = found;
    try {
        const declarerCards = (await seats[declarer].wait('yourCards', 'pelinviejän kortit')).data.cards;

        seats[declarer].socket.emit('chooseMiniContract', { tableCode: code, type: 'partscore', strain: 'N' });
        await seats[dummy].wait('biddingComplete', 'pelivaihe alkaa');

        // Avauslähtö on pelinviejän vasemmalla puolella. Idän (ihminen)
        // vuorolla pelataan itse, lännen (robotti) lähtö tulee itsestään.
        const leader = nextSeat[declarer];
        if (leader === 'east') {
            const cards = (await seats.east.wait('yourCards', 'idän kortit')).data.cards;
            const suit = SUITS.find(s => cards[s] && cards[s].length);
            seats.east.socket.emit('playCard', { tableCode: code, position: 'east', suit, card: cards[suit][0] });
        }

        const revealed = (await seats[dummy].wait('declarerHandRevealed', 'pelinviejän käsi lepääjälle')).data;
        assert.strictEqual(revealed.declarerPosition, declarer);
        assert.strictEqual(revealed.forDummy, true);
        // Pelinviejä ei ole vielä pelannut, joten käsi on kokonainen.
        for (const suit of SUITS) {
            assert.deepStrictEqual(revealed.declarerCards[suit] || [], declarerCards[suit] || [], suit);
        }

        // Käsi tulee vasta avauslähdön jälkeen.
        const leadIndex = seats[dummy].indexOf('cardPlayed');
        assert.ok(leadIndex >= 0, 'lepääjä ei saanut avauslähtöä');
        assert.ok(leadIndex < seats[dummy].indexOf('declarerHandRevealed'),
            'pelinviejän käsi tuli ennen avauslähtöä');

        // Puolustaja ja pelinviejä eivät saa viestiä.
        await new Promise(r => setTimeout(r, 300));
        assert.strictEqual(seats.east.find('declarerHandRevealed'), undefined, 'puolustaja sai pelinviejän käden');
        assert.strictEqual(seats[declarer].find('declarerHandRevealed'), undefined, 'pelinviejä sai oman kätensä viestinä');
        assert.strictEqual(seats[dummy].events.filter(e => e.event === 'declarerHandRevealed').length, 1,
            'lepääjä sai käden useammin kuin kerran');
    } finally {
        close();
    }
});
