'use strict';
// Ässän lyönti: asiakas kertoi, ettei ässää voinut lyödä, vaikka se olisi
// sopinut. Testit käyvät ässän läpi säännöissä, pelissä, näkymässä,
// satunnaisissa peleissä ja oikean Socket.IO-yhteyden yli.
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { Server } = require('socket.io');
const { io: connect } = require('socket.io-client');
const { Game } = require('./game.js');
const ristiseiska = require('./socket.js');
const { ORDER, SEVEN, nextCards, isPlayable, emptyTable, placeCard } = require('../public/ristiseiska/js/saannot.js');
const { SUITS, cardId } = require('../public/korttipelit/kortit.js');

function seeded(seed) {
    let s = seed >>> 0;
    return () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 4294967296;
    };
}

function players(n) {
    return Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `Pelaaja ${i}` }));
}

function card(text) {
    const [suit, rank] = text.split('-');
    return { suit, rank };
}

function arrange(game, hands, table, current = 0) {
    game.players.forEach((p, i) => { p.hand = (hands[i] || []).map(card); p.out = false; });
    // Pinot kopioidaan: placeCard muuttaa niitä, eikä yhteinen TWO_DOWN saa muuttua.
    game.table = emptyTable();
    for (const suit of Object.keys(table)) game.table[suit] = { ...table[suit] };
    game.current = current;
    game.phase = 'play';
    game.bonus = false;
}

// Maa, jonka alapää on kakkosessa: ässä sopii.
const TWO_DOWN = { low: '2', high: '8' };

// ===== Säännöt =====

test('ässä: kaikki pinon tilat käydään läpi, ässä sopii vain kakkosen jälkeen', () => {
    for (const suit of SUITS) {
        const ace = { suit, rank: 'A' };
        assert.strictEqual(isPlayable(emptyTable(), ace), false, `${suit}: tyhjä maa`);
        for (let low = 0; low <= SEVEN; low++) {
            for (let high = SEVEN; high < ORDER.length; high++) {
                // Pöydässä mahdolliset tilat: alle kuutosen vasta, kun kahdeksikko on pöydässä.
                if (low < SEVEN - 1 && high === SEVEN) continue;
                const table = { ...emptyTable(), [suit]: { low: ORDER[low], high: ORDER[high] } };
                const expected = ORDER[low] === '2';
                assert.strictEqual(isPlayable(table, ace), expected,
                    `${suit} ${ORDER[low]}–${ORDER[high]}: ässä ${expected ? 'sopii' : 'ei sovi'}`);
            }
        }
    }
});

test('ässä: maa rakennetaan seiskasta ässään kortti kerrallaan', () => {
    for (const suit of SUITS) {
        const table = emptyTable();
        for (const rank of ['7', '6', '8', '5', '4', '3', '2']) {
            assert.ok(isPlayable(table, { suit, rank }), `${suit} ${rank} sopii`);
            assert.ok(!isPlayable(table, { suit, rank: 'A' }), `${suit}: ässä ei sovi ennen kakkosta`);
            placeCard(table, { suit, rank });
        }
        assert.ok(isPlayable(table, { suit, rank: 'A' }), `${suit}: ässä sopii kakkosen jälkeen`);
        placeCard(table, { suit, rank: 'A' });
        assert.deepStrictEqual(table[suit], { low: 'A', high: '8' });
        assert.deepStrictEqual(nextCards(table, suit), ['9'], 'alapää on suljettu');
    }
});

// ===== Peli =====

test('ässä lyödään tavallisella vuorolla ja se antaa lisävuoron', () => {
    for (const suit of SUITS) {
        const game = new Game(players(2), { rng: seeded(1) });
        arrange(game, [[`${suit}-A`, 'hearts-2'], ['diamonds-2', 'diamonds-3']],
            { clubs: { low: '7', high: '7' }, [suit]: TWO_DOWN });
        assert.deepStrictEqual(game.getView('p0').allowedActions, ['play'], `${suit}: lyönti sallittu, ei pyyntöä`);
        const [e] = game.play('p0', `${suit}-A`);
        assert.strictEqual(e.type, 'play');
        assert.strictEqual(e.bonus, true);
        assert.strictEqual(game.table[suit].low, 'A');
        assert.strictEqual(game.current, 0, 'lisävuoro');
    }
});

test('ässä lisävuorolla: kuninkaan jälkeen ja toisen ässän jälkeen', () => {
    const game = new Game(players(2), { rng: seeded(1) });
    arrange(game, [['spades-K', 'hearts-A', 'diamonds-A', 'clubs-5', 'clubs-2'], ['diamonds-9', 'diamonds-10']], {
        clubs: { low: '6', high: '8' },
        spades: { low: '6', high: 'Q' },
        hearts: TWO_DOWN,
        diamonds: TWO_DOWN
    });
    game.play('p0', 'spades-K');
    assert.strictEqual(game.bonus, true);
    assert.deepStrictEqual(game.getView('p0').allowedActions, ['play', 'end-turn']);
    let [e] = game.play('p0', 'hearts-A');
    assert.strictEqual(e.bonus, true, 'ässä kuninkaan jälkeen');
    [e] = game.play('p0', 'diamonds-A');
    assert.strictEqual(e.bonus, true, 'ässä ässän jälkeen');
    [e] = game.play('p0', 'clubs-5');
    assert.strictEqual(e.bonus, false);
    assert.strictEqual(game.current, 1);
});

test('ässä viimeisenä korttina vie pelaajan pois ilman lisävuoroa', () => {
    const game = new Game(players(3), { rng: seeded(1) });
    arrange(game, [['spades-A'], ['hearts-2', 'hearts-3'], ['diamonds-2', 'diamonds-3']],
        { clubs: { low: '7', high: '7' }, spades: TWO_DOWN });
    const events = game.play('p0', 'spades-A');
    assert.deepStrictEqual(events.map(x => x.type), ['play', 'out']);
    assert.strictEqual(events[0].bonus, false);
    assert.strictEqual(game.current, 1);
});

test('pyytämällä saatu ässä lyödään seuraavalla vuorolla', () => {
    const game = new Game(players(2), { rng: seeded(1) });
    arrange(game, [['hearts-3', 'hearts-4'], ['spades-A', 'diamonds-3', 'diamonds-4']],
        { clubs: { low: '7', high: '7' }, spades: TWO_DOWN });
    assert.deepStrictEqual(game.getView('p0').allowedActions, ['ask']);
    game.ask('p0');
    game.give('p1', 'spades-A');
    assert.strictEqual(game.current, 1, 'saatua korttia ei lyödä samalla vuorolla');
    game.ask('p1');
    game.give('p0', 'hearts-3');
    assert.strictEqual(game.current, 0);
    assert.deepStrictEqual(game.getView('p0').allowedActions, ['play']);
    const [e] = game.play('p0', 'spades-A');
    assert.strictEqual(e.type, 'play');
});

test('näkymä: kun ainoa sopiva kortti on ässä, pyyntöä ei tarjota', () => {
    const game = new Game(players(2), { rng: seeded(1) });
    arrange(game, [['spades-A', 'spades-K', 'hearts-5', 'diamonds-Q'], ['hearts-9', 'hearts-10']],
        { clubs: { low: '7', high: '7' }, spades: TWO_DOWN });
    const view = game.getView('p0');
    assert.deepStrictEqual(view.allowedActions, ['play']);
    assert.ok(view.nextCards.spades.includes('A'), 'pöytä kertoo, että pataan sopii ässä');
    assert.throws(() => game.ask('p0'), /lyötävä kortti/);
});

// ===== Satunnaiset pelit =====

test('2 000 satunnaista peliä: jokainen sopiva ässä menee pöytään, näkymä on johdonmukainen', () => {
    let acesPlayed = 0;
    let bonusAces = 0;
    for (let seed = 1; seed <= 2000; seed++) {
        const rng = seeded(seed);
        const n = 2 + (seed % 7);
        const game = new Game(players(n), { rng });
        let steps = 0;
        while (game.phase !== 'over') {
            if (++steps > 5000) assert.fail(`peli ${seed} ei päättynyt`);
            if (game.phase === 'give') {
                const giver = game.players[game.giver];
                game.give(giver.id, cardId(giver.hand[Math.floor(rng() * giver.hand.length)]));
                continue;
            }
            const player = game.players[game.current];
            const view = game.getView(player.id);
            const playable = player.hand.filter(c => isPlayable(game.table, c));
            assert.strictEqual(view.allowedActions.includes('play'), playable.length > 0, `peli ${seed}: play`);
            assert.strictEqual(view.allowedActions.includes('ask'), !game.bonus && playable.length === 0, `peli ${seed}: ask`);
            for (const c of playable) {
                assert.ok(view.nextCards[c.suit].includes(c.rank), `peli ${seed}: pöydän teksti kertoo kortin ${cardId(c)}`);
            }
            // Ässä lyödään aina, kun se sopii.
            const ace = playable.find(c => c.rank === 'A');
            if (ace) {
                const wasBonus = game.bonus;
                const [e] = game.play(player.id, cardId(ace));
                assert.strictEqual(e.type, 'play', `peli ${seed}: ässän lyönti`);
                acesPlayed++;
                if (wasBonus) bonusAces++;
                continue;
            }
            if (playable.length > 0) game.play(player.id, cardId(playable[Math.floor(rng() * playable.length)]));
            else if (game.bonus) game.endTurn(player.id);
            else game.ask(player.id);
        }
    }
    assert.ok(acesPlayed > 1000, `ässiä lyötiin ${acesPlayed}`);
    assert.ok(bonusAces > 0, `lisävuorolla lyötyjä ässiä ${bonusAces}`);
});

// ===== Socket.IO =====

async function until(check, what, ms = 5000) {
    const start = Date.now();
    while (Date.now() - start < ms) {
        const value = check();
        if (value) return value;
        await new Promise(r => setTimeout(r, 5));
    }
    throw new Error(`Aikakatkaisu: ${what}`);
}

function client(url) {
    const socket = connect(url, { transports: ['websocket'], forceNew: true });
    const c = { socket, state: null, events: [], errors: [] };
    socket.on('state', s => { c.state = s; });
    socket.on('game-event', e => c.events.push(e));
    socket.on('action-error', e => c.errors.push(e.text));
    return c;
}

test('Socket.IO: ihminen lyö ässän tavallisella vuorolla ja lisävuorolla', async () => {
    const server = http.createServer();
    const io = new Server(server);
    const handle = ristiseiska.attach(io, { robotDelayMs: 2 });
    await new Promise(resolve => server.listen(0, resolve));
    const url = `http://localhost:${server.address().port}/ristiseiska`;
    const kalle = client(url);
    const liisa = client(url);
    try {
        kalle.socket.emit('create-table', { name: 'Kalle' });
        await until(() => kalle.state, 'pöydän luonti');
        const code = kalle.state.table.code;
        liisa.socket.emit('join-table', { code, name: 'Liisa' });
        await until(() => kalle.state.table.seatedCount === 2, 'liittyminen');
        kalle.socket.emit('start-game');
        await until(() => kalle.state.game, 'pelin alku');

        // Tilanne käsin: Kallen vuoro, pataan ja herttaan sopii ässä.
        const game = handle.tables.get(code).game;
        const kalleIndex = game.players.findIndex(p => p.name === 'Kalle');
        const hands = [];
        hands[kalleIndex] = ['spades-A', 'hearts-A', 'clubs-5'];
        hands[1 - kalleIndex] = ['diamonds-9', 'diamonds-10'];
        arrange(game, hands, { clubs: { low: '7', high: '7' }, spades: TWO_DOWN, hearts: TWO_DOWN }, kalleIndex);

        const before = kalle.state;
        kalle.socket.emit('play', { cardId: 'spades-A' });
        await until(() => kalle.state !== before || kalle.errors.length, 'ensimmäinen ässä');
        assert.deepStrictEqual(kalle.errors, []);
        assert.strictEqual(kalle.state.game.table.spades.low, 'A');
        assert.strictEqual(kalle.state.game.bonus, true);
        assert.deepStrictEqual(kalle.state.game.allowedActions, ['play', 'end-turn']);

        const before2 = kalle.state;
        kalle.socket.emit('play', { cardId: 'hearts-A' });
        await until(() => kalle.state !== before2 || kalle.errors.length, 'toinen ässä');
        assert.deepStrictEqual(kalle.errors, []);
        assert.strictEqual(kalle.state.game.table.hearts.low, 'A');
    } finally {
        kalle.socket.close();
        liisa.socket.close();
        handle.close();
        io.close();
        await new Promise(resolve => server.close(resolve));
    }
});
