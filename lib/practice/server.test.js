'use strict';
// Pelinvientiharjoitus oikeaa palvelinta (server.js) vastaan Socket.IO-yhteyksillä:
// pöydän luonti, jaon aloitus pelivaiheesta, robotin avauslähtö,
// tarjousten esto, uudelleenyhdistäminen ja tavallisten pelimuotojen säilyminen.
const test = require('node:test');
const assert = require('node:assert');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
const { io: connect } = require('socket.io-client');

const SERVER = path.join(__dirname, '..', '..', 'server.js');
const POSITIONS = ['north', 'east', 'south', 'west'];
const leftOf = (p) => POSITIONS[(POSITIONS.indexOf(p) + 1) % 4];
const partnerOf = (p) => POSITIONS[(POSITIONS.indexOf(p) + 2) % 4];

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
    c.find = (event, from = 0) => c.events.slice(from).find(e => e.event === event);
    c.wait = (event, what = event, ms = 15000, from = 0) => until(() => c.find(event, from), what, ms);
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

async function createTable(seat, gameMode, practiceType, name = `Pelaaja ${seat}`) {
    const c = client();
    c.socket.emit('createTable', { playerName: name, position: seat, gameMode, practiceType });
    const created = await c.wait('tableCreated', 'pöydän luonti');
    c.code = created.data.tableCode;
    c.name = name;
    return c;
}

async function startPractice(seat, practiceType = 'major-game') {
    const c = await createTable(seat, 'declarerPractice', practiceType);
    c.socket.emit('startGame', { tableCode: c.code });
    await c.wait('biddingComplete', `sopimus (${seat})`);
    return c;
}

test('harjoituspöytä aloittaa pelivaiheesta, pelaaja on pelinviejä ja vasen avaa', async () => {
    await Promise.all(POSITIONS.map(async (seat) => {
        const c = await startPractice(seat);
        try {
            const started = c.find('gameStarted').data;
            assert.strictEqual(started.gameMode, 'declarerPractice');
            assert.strictEqual(started.practice.specId, 'major-game');
            assert.strictEqual(started.practice.current.declarer, seat);
            assert.strictEqual(started.dealer, seat);

            const contract = c.find('biddingComplete').data;
            assert.strictEqual(contract.declarer, seat);
            assert.strictEqual(contract.dummy, partnerOf(seat));
            assert.ok(['4S', '4H'].includes(contract.contract), contract.contract);
            assert.strictEqual(contract.currentPlayer, leftOf(seat));
            assert.strictEqual(contract.contract, started.practice.current.contract);

            const cards = c.find('yourCards').data;
            assert.strictEqual(cards.position, seat);
            assert.strictEqual(Object.values(cards.cards).flat().length, 13);

            // Robotti avaa pelinviejän vasemmalta, ja lepääjä paljastuu vasta sen jälkeen.
            assert.strictEqual(c.find('dummyRevealed'), undefined);
            const lead = await c.wait('cardPlayed', `avauslähtö (${seat})`, 20000);
            assert.strictEqual(lead.data.position, leftOf(seat));
            const dummy = await c.wait('dummyRevealed', `lepääjä (${seat})`);
            assert.strictEqual(dummy.data.dummyPosition, partnerOf(seat));

            // Jakoa tai muiden käsiä ei lähetetä missään viestissä.
            const sent = JSON.stringify(c.events.filter(e => e.event !== 'dummyRevealed' && e.event !== 'yourCards'));
            for (const secret of ['pbn', 'originalHands', '"hands"', 'ddTricks', '"note"']) {
                assert.ok(!sent.includes(secret), `vuoto (${seat}): ${secret}`);
            }
        } finally {
            c.close();
        }
    }));
});

test('tarjous harjoituspöydässä palauttaa virheen', async () => {
    const c = await startPractice('south');
    try {
        const from = c.events.length;
        c.socket.emit('makeBid', { tableCode: c.code, position: 'south', bid: '1C' });
        const error = await c.wait('error', 'virhe', 5000, from);
        assert.strictEqual(error.data.message, 'Bidding is not used in declarer practice');
    } finally {
        c.close();
    }
});

test('uudelleenyhdistäminen palauttaa sopimuksen ja oman käden, muttei muiden käsiä', async () => {
    const first = await startPractice('east', 'notrump-game');
    const contract = first.find('biddingComplete').data;
    const ownCards = first.find('yourCards').data.cards;
    first.close();
    await new Promise(r => setTimeout(r, 300));

    const again = client();
    try {
        again.socket.emit('getTableInfo', { tableCode: first.code, playerName: first.name });
        const reconnect = (await again.wait('gameReconnect', 'uudelleenyhdistäminen')).data;
        assert.strictEqual(reconnect.gameMode, 'declarerPractice');
        assert.strictEqual(reconnect.playerPosition, 'east');
        assert.strictEqual(reconnect.practice.current.declarer, 'east');
        assert.strictEqual(reconnect.practice.current.contract, '3N');
        assert.strictEqual(reconnect.gameState.contract, contract.contract);
        assert.strictEqual(reconnect.gameState.declarer, 'east');
        assert.strictEqual(reconnect.gameState.hands, undefined);
        const text = JSON.stringify(reconnect);
        for (const secret of ['pbn', 'originalHands', 'ddTricks', '"note"']) {
            assert.ok(!text.includes(secret), `vuoto: ${secret}`);
        }

        const cards = await again.wait('yourCards', 'oma käsi');
        assert.strictEqual(cards.data.position, 'east');
        // Avauslähtö on voinut jo tulla, joten verrataan kortteja, joita ei ole pelattu.
        for (const suit of Object.keys(cards.data.cards)) {
            for (const card of cards.data.cards[suit]) assert.ok(ownCards[suit].includes(card));
        }
    } finally {
        again.close();
    }
});

test('seuraava jako harjoituspöydässä alkaa taas pelivaiheesta', async () => {
    const c = await startPractice('west', 'slam');
    try {
        const from = c.events.length;
        c.socket.emit('requestNextDeal', { tableCode: c.code });
        const next = (await c.wait('newDealStarted', 'seuraava jako', 15000, from)).data;
        assert.strictEqual(next.abandoned, true);
        assert.strictEqual(next.dealNumber, 2);
        assert.strictEqual(next.practice.current.declarer, 'west');
        const contract = (await c.wait('biddingComplete', 'sopimus', 15000, from)).data;
        assert.strictEqual(contract.declarer, 'west');
        assert.strictEqual(contract.contract.charAt(0), '6');
    } finally {
        c.close();
    }
});

test('tuntematon harjoitustyyppi on mixed ja näkyy pöydän tiedoissa', async () => {
    const c = await createTable('south', 'declarerPractice', 'grand-slam');
    try {
        const table = c.find('tableCreated').data.table;
        assert.strictEqual(table.gameMode, 'declarerPractice');
        assert.strictEqual(table.practiceType, 'mixed');
        assert.strictEqual(table.practiceLabel, 'Mixed');
    } finally {
        c.close();
    }
});

test('tavallinen bridge ja minibridge toimivat kuten ennen', async () => {
    const bridge = await createTable('south', 'bridge');
    const mini = await createTable('south', 'minibridge');
    const unknown = await createTable('south', 'poker');
    try {
        assert.strictEqual(unknown.find('tableCreated').data.table.gameMode, 'bridge');
        assert.strictEqual(bridge.find('tableCreated').data.table.practiceType, null);

        bridge.socket.emit('startGame', { tableCode: bridge.code });
        const started = (await bridge.wait('gameStarted', 'bridge alkaa')).data;
        assert.strictEqual(started.gameState.gamePhase, 'bidding');
        assert.strictEqual(started.practice, undefined);
        assert.strictEqual(started.biddingState.currentBidder, 'south');
        await new Promise(r => setTimeout(r, 500));
        assert.strictEqual(bridge.find('biddingComplete'), undefined, 'bridge ei ohita tarjousta');

        mini.socket.emit('startGame', { tableCode: mini.code });
        await until(() => mini.find('gameStarted') || mini.find('miniRedeal'), 'minibridge alkaa');
        const miniStarted = await mini.wait('gameStarted', 'minibridge alkaa');
        assert.strictEqual(miniStarted.data.gameMode, 'minibridge');
        assert.strictEqual(miniStarted.data.gameState.gamePhase, 'contract');
    } finally {
        bridge.close();
        mini.close();
        unknown.close();
    }
});
