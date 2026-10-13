'use strict';
// Jakosetin tuonti ja jaon tallennus oikeaa palvelinta (server.js) vastaan, ks. jaot.html.
const test = require('node:test');
const assert = require('node:assert');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
const { io: connect } = require('socket.io-client');
const { parseDealString, formatDealString } = require('./deal');
const Pbn = require('./pbn');

const SERVER = path.join(__dirname, '..', 'server.js');

// Etelällä 18 ja pohjoisella 14 pistettä: paikallinen robottitarjoaja avaa
// jakajana aina, joten jako pelataan loppuun eikä passata pois.
const DEAL = 'N:AQ86.K73.J5.AT94 T73.Q862.K94.J65 KJ9.AJ4.AQ86.K82 542.T95.T732.Q73';

// Ensimmäisessä jaossa on toisaalla pelattu tarjoussarja, pelatut kortit ja
// tulos. Niitä ei saa käyttää: jako alkaa tyhjästä tarjousvaiheesta.
const DEAL_SET = [
    '[Event "Kerhoilta"]',
    '[Board "7"]',
    '[Dealer "S"]',
    '[Vulnerable "Both"]',
    `[Deal "${DEAL}"]`,
    '[Declarer "N"]',
    '[Contract "7NTXX"]',
    '[Result "13"]',
    '[Auction "S"]',
    '7NT X XX Pass',
    'Pass Pass',
    '[Play "E"]',
    'S3 SJ S2 SA',
    '',
    '[Event "#"]',
    '[Board "12"]',
    '[Dealer "N"]',
    '[Vulnerable "EW"]',
    `[Deal "${DEAL}"]`,
    ''
].join('\r\n');

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
    c.wait = (event, what = event, ms = 30000) => until(() => c.find(event), what, ms);
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

async function createKibitzerTable(name = 'Opettaja') {
    const c = client();
    c.socket.emit('createTable', { playerName: name, position: 'kibitzer', gameMode: 'bridge' });
    c.code = (await c.wait('tableCreated', 'pöydän luonti')).data.tableCode;
    return c;
}

// Jaon alku: tyhjä tarjousvaihe jakajasta alkaen, ei sopimusta eikä pelattuja kortteja.
function assertFreshAuction(started, dealer) {
    assert.strictEqual(started.dealer, dealer);
    assert.strictEqual(started.gameState.gamePhase, 'bidding');
    assert.strictEqual(started.gameState.contract, null);
    assert.deepStrictEqual(started.gameState.playedCards, []);
    assert.deepStrictEqual(started.biddingState.bidHistory, []);
    assert.strictEqual(started.biddingState.currentBidder, dealer);
    assert.strictEqual(started.biddingState.biddingComplete, false);
    assert.strictEqual(started.biddingState.contract, null);
}

test('tuodut jaot pelataan puhtaalta pöydältä järjestyksessä, tallennus ja uusinta toimivat', async () => {
    const creator = await createKibitzerTable();
    try {
        const code = creator.code;
        creator.socket.emit('loadDealSet', { tableCode: code, fileName: 'kerho.pbn', text: DEAL_SET });
        const loaded = (await creator.wait('dealSetLoaded', 'setin lataus')).data;
        assert.strictEqual(loaded.total, 2);
        assert.strictEqual(loaded.firstBoard, 7);
        assert.strictEqual(loaded.fileName, 'kerho.pbn');
        assert.strictEqual(loaded.skippedCount, 0);
        assert.strictEqual(loaded.ignoredPlay, true);
        assert.strictEqual(loaded.dealInProgress, false);
        assert.deepStrictEqual((await creator.wait('dealSetChanged')).data.dealSet, { total: 2, remaining: 2 });

        // Tallennettavaa ei ole ennen ensimmäisen jaon loppua.
        creator.socket.emit('exportLastDeal', { tableCode: code });
        await creator.waitError('No finished deal to save yet');

        // Jako 1: setin ensimmäinen, tiedoston jakaja ja vaaratilanne, tyhjä tarjousvaihe.
        creator.clear();
        creator.socket.emit('startGame', { tableCode: code });
        const first = (await creator.wait('gameStarted', 'peli alkaa')).data;
        assertFreshAuction(first, 'south');
        assert.strictEqual(first.board, 7);
        assert.deepStrictEqual(first.dealSet, { index: 1, total: 2 });
        assert.strictEqual(first.gameState.vulnerable, 'Both');
        assert.strictEqual(first.gameState.board, 7);
        assert.deepStrictEqual((await creator.wait('kibitzerHands')).data.hands, parseDealString(DEAL));

        const over = (await creator.wait('gameOver', 'jako 1 päättyy')).data;
        // Robotit tarjosivat itse: tiedoston 7NTXX ei siirtynyt peliin.
        assert.notStrictEqual(over.contract, '7NXX');
        assert.match(over.contract, /^1[CDHSN]$/);
        assert.strictEqual(over.vulnerable, 'Both');
        assert.strictEqual(over.savedDealBoard, 7);
        assert.strictEqual(over.isReplay, false);
        const auctionPlayed = creator.events.filter(e => e.event === 'bidMade').map(e => e.data.position);
        assert.strictEqual(auctionPlayed[0], 'south', 'ensimmäinen tarjous tulee jakajalta');

        // Tallennus: kädet, tarjoukset, pelatut kortit, sopimus ja tulos.
        creator.socket.emit('exportLastDeal', { tableCode: code });
        const exported = (await creator.wait('dealExport', 'tallennus')).data;
        assert.match(exported.fileName, new RegExp(`^bridge-${code}-board-7-\\d{4}-\\d{2}-\\d{2}\\.pbn$`));
        const lines = exported.pbn.split('\r\n');
        assert.ok(lines.includes('[Board "7"]'));
        assert.ok(lines.includes('[Dealer "S"]'));
        assert.ok(lines.includes('[Vulnerable "Both"]'));
        assert.ok(lines.includes(`[Deal "${formatDealString(parseDealString(DEAL))}"]`));
        assert.ok(lines.includes(`[Contract "${Pbn.formatContract(over.contract)}"]`));
        assert.ok(lines.includes('[Auction "S"]'));
        assert.ok(lines.includes('[North "Robot"]'));
        const play = lines.indexOf(lines.find(l => l.startsWith('[Play ')));
        assert.ok(play > 0, 'Play-osio');
        const trickLines = lines.slice(play + 1).filter(l => /^[SHDC]/.test(l));
        assert.strictEqual(trickLines.length, 13);
        // Tallennetun tiedoston voi tuoda takaisin: samat kädet, ei tarjouksia.
        const reread = Pbn.parsePbn(exported.pbn);
        assert.deepStrictEqual(reread.deals[0].hands, parseDealString(DEAL));

        // Uusinta: sama jaon numero ja vaaratilanne, ei kuluta settiä, ei vaikuta kokonaispisteisiin.
        creator.clear();
        creator.socket.emit('replayDeal', { tableCode: code });
        const replay = (await creator.wait('newDealStarted', 'uusinta')).data;
        assert.strictEqual(replay.replayed, true);
        assertFreshAuction(replay, 'south');
        assert.strictEqual(replay.board, 7);
        assert.deepStrictEqual(replay.dealSet, { index: 1, total: 2 });
        const replayOver = (await creator.wait('gameOver', 'uusinta päättyy')).data;
        assert.strictEqual(replayOver.isReplay, true);
        assert.strictEqual(replayOver.vulnerable, 'Both');
        assert.deepStrictEqual(replayOver.totalScore, over.totalScore);

        // Jako 2: setin toinen jako.
        creator.clear();
        creator.socket.emit('requestNextDeal', { tableCode: code });
        const second = (await creator.wait('newDealStarted', 'jako 2')).data;
        assertFreshAuction(second, 'north');
        assert.strictEqual(second.board, 12);
        assert.strictEqual(second.dealNumber, 2);
        assert.deepStrictEqual(second.dealSet, { index: 2, total: 2 });
        assert.strictEqual(second.gameState.vulnerable, 'EW');
        assert.strictEqual(creator.find('dealSetFinished'), undefined);

        // Edellisen jaon tallennus onnistuu, vaikka seuraava jako on jo alkanut.
        creator.socket.emit('exportLastDeal', { tableCode: code });
        assert.strictEqual((await creator.wait('dealExport')).data.board, 7);

        const secondOver = (await creator.wait('gameOver', 'jako 2 päättyy')).data;
        assert.strictEqual(secondOver.vulnerable, 'EW');
        assert.strictEqual(secondOver.savedDealBoard, 12);

        // Setti loppui: seuraava jako on satunnainen ja numeroitu tavalliseen tapaan.
        creator.clear();
        creator.socket.emit('requestNextDeal', { tableCode: code });
        await creator.wait('dealSetFinished', 'setti loppui');
        const third = (await creator.wait('newDealStarted', 'jako 3')).data;
        assert.strictEqual(third.dealSet, null);
        assert.strictEqual(third.board, 3);
        assert.strictEqual(third.gameState.vulnerable, Pbn.vulnerabilityForBoard(3));
        const finishedAt = creator.events.findIndex(e => e.event === 'dealSetFinished');
        const startedAt = creator.events.findIndex(e => e.event === 'newDealStarted');
        assert.ok(finishedAt < startedAt, 'ilmoitus ennen uuden jaon alkua');
    } finally {
        creator.close();
    }
});

test('vain luoja lataa, poistaa ja tallentaa; muut saavat vain yhteenvedon', async () => {
    const creator = await createKibitzerTable();
    const other = client();
    try {
        const code = creator.code;
        other.socket.emit('getTableInfo', { tableCode: code, playerName: 'Katsoja' });
        await other.wait('tableInfo');
        other.socket.emit('selectPosition', { tableCode: code, position: 'kibitzer', playerName: 'Katsoja' });
        await until(() => other.events.filter(e => e.event === 'tableInfo').length >= 2, 'kibitseriksi');

        other.socket.emit('loadDealSet', { tableCode: code, fileName: 'x.pbn', text: DEAL_SET });
        await other.waitError('Only the table creator can load deals');
        other.socket.emit('clearDealSet', { tableCode: code });
        await other.waitError('Only the table creator can remove the deal set');
        other.socket.emit('exportLastDeal', { tableCode: code });
        await other.waitError('Only the table creator can save a deal');

        creator.socket.emit('loadDealSet', { tableCode: code, fileName: 'x.pbn', text: DEAL_SET });
        const changed = (await other.wait('dealSetChanged', 'yhteenveto muille')).data;
        assert.deepStrictEqual(changed, { type: 'dealSetChanged', dealSet: { total: 2, remaining: 2 }, loaded: true });
        assert.strictEqual(other.find('dealSetLoaded'), undefined);

        // Myöhemmin liittyvä näkee tilan pöydän tiedoissa, ei käsiä.
        const late = client();
        try {
            late.socket.emit('getTableInfo', { tableCode: code, playerName: 'Myöhäinen' });
            const info = (await late.wait('tableInfo')).data;
            assert.deepStrictEqual(info.table.dealSet, { total: 2, remaining: 2 });
            assert.ok(!JSON.stringify(info).includes('spades'), 'ei käsiä');
        } finally {
            late.close();
        }

        other.clear();
        creator.socket.emit('clearDealSet', { tableCode: code });
        const cleared = (await other.wait('dealSetChanged', 'poisto')).data;
        assert.strictEqual(cleared.dealSet, null);
        assert.strictEqual(cleared.cleared, true);
    } finally {
        creator.close();
        other.close();
    }
});

test('virheelliset tiedostot hylätään selkeällä syyllä, harjoituksessa tuontia ei ole', async () => {
    const creator = await createKibitzerTable();
    try {
        const code = creator.code;
        const send = (text) => creator.socket.emit('loadDealSet', { tableCode: code, fileName: 'x.pbn', text });

        send('');
        await creator.waitError('The file is empty');
        send('x'.repeat(512 * 1024 + 1));
        await creator.waitError('The file is too large. The maximum size is 512 KB.');
        send('[Event "Tyhjä"]\n');
        await creator.waitError('No deals found in the file');
        send('[Board "5"]\n[Deal "N:AQ8.K73.J5.AT94 T73.Q862.K94.J65 KJ9.AJ4.AQ86.K82 542.T95.T732.Q73"]\n');
        await creator.waitError('No valid deals in the file. Board 5: north has 12 cards, expected 13');

        // Viallinen jako ohitetaan, kelvolliset ladataan.
        creator.clear();
        send(`[Board "1"]\n[Deal "N:AQ8.K73.J5.AT94 - - -"]\n\n[Board "2"]\n[Deal "${DEAL}"]\n`);
        const loaded = (await creator.wait('dealSetLoaded')).data;
        assert.strictEqual(loaded.total, 1);
        assert.strictEqual(loaded.firstBoard, 2);
        assert.strictEqual(loaded.skippedCount, 1);
        assert.strictEqual(loaded.skipped[0].board, 1);
        assert.strictEqual(loaded.ignoredPlay, false);
    } finally {
        creator.close();
    }

    const practice = client();
    try {
        practice.socket.emit('createTable', { playerName: 'Harjoittelija', position: 'south', gameMode: 'declarerPractice', practiceType: 'major-game' });
        const code = (await practice.wait('tableCreated')).data.tableCode;
        practice.socket.emit('loadDealSet', { tableCode: code, fileName: 'x.pbn', text: DEAL_SET });
        await practice.waitError('Deal sets are not available in declarer practice');
    } finally {
        practice.close();
    }
});
