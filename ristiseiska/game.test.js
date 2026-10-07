'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { Game, GameError } = require('./game.js');
const { nextCards, isPlayable, emptyTable } = require('../public/ristiseiska/js/saannot.js');
const { cardId } = require('../public/korttipelit/kortit.js');

// Toistettava satunnaisluku testejä varten.
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

// Asettaa pelin tilanteen käsin: kädet, pöytä ja vuorossa oleva.
function arrange(game, hands, table, current = 0) {
    game.players.forEach((p, i) => { p.hand = (hands[i] || []).map(card); });
    game.table = { ...emptyTable(), ...table };
    game.current = current;
    game.phase = 'play';
    game.bonus = false;
}

test('säännöt: seuraavat kortit', () => {
    const t = emptyTable();
    assert.deepStrictEqual(nextCards(t, 'spades'), ['7']);
    t.spades = { low: '7', high: '7' };
    assert.deepStrictEqual(nextCards(t, 'spades'), ['6'], 'vain 7: kuutonen');
    t.spades = { low: '6', high: '7' };
    assert.deepStrictEqual(nextCards(t, 'spades'), ['8'], '6 ja 7: kahdeksikko, ei vitosta');
    t.spades = { low: '6', high: '8' };
    assert.deepStrictEqual(nextCards(t, 'spades'), ['5', '9']);
    t.spades = { low: '4', high: '8' };
    assert.deepStrictEqual(nextCards(t, 'spades'), ['3', '9']);
    t.spades = { low: 'A', high: '9' };
    assert.deepStrictEqual(nextCards(t, 'spades'), ['10'], 'ässä sulkee alapään');
    t.spades = { low: '3', high: 'K' };
    assert.deepStrictEqual(nextCards(t, 'spades'), ['2'], 'kuningas sulkee yläpään');
    t.spades = { low: 'A', high: 'K' };
    assert.deepStrictEqual(nextCards(t, 'spades'), [], 'valmis maa');
    t.hearts = { low: '6', high: '7' };
    assert.strictEqual(isPlayable(t, card('hearts-5')), false);
    assert.strictEqual(isPlayable(t, card('hearts-8')), true);
});

test('jako 2–8 pelaajalle ja ristiseiska pöytään automaattisesti', () => {
    for (let n = 2; n <= 8; n++) {
        const game = new Game(players(n), { rng: seeded(n), dealerIndex: 0 });
        const total = game.players.reduce((s, p) => s + p.hand.length, 0);
        assert.strictEqual(total, 51, 'ristiseiska on pöydässä');
        // Jaetut määrät: ristiseiskan haltijalla oli yksi kortti enemmän.
        const counts = game.players.map((p, i) => p.hand.length + (i === game.sevenHolder ? 1 : 0));
        assert.ok(Math.max(...counts) - Math.min(...counts) <= 1, 'jako lähes tasan');
        assert.deepStrictEqual(game.table.clubs, { low: '7', high: '7' });
        assert.strictEqual(game.current, (game.sevenHolder + 1) % n, 'haltijaa seuraava aloittaa');
        assert.ok(game.players.every(p => !p.hand.some(c => c.suit === 'clubs' && c.rank === '7')));
    }
    assert.throws(() => new Game(players(1)), GameError);
    assert.throws(() => new Game(players(9)), GameError);
});

test('käsi järjestetään ässä alimpana', () => {
    const game = new Game(players(2), { rng: seeded(3), dealerIndex: 0 });
    for (const p of game.players) {
        const spades = p.hand.filter(c => c.suit === 'spades');
        if (spades.some(c => c.rank === 'A')) assert.strictEqual(spades[0].rank, 'A');
    }
});

test('sopimaton kortti ja väärä vuoro hylätään', () => {
    const game = new Game(players(3), { rng: seeded(1) });
    arrange(game, [['spades-5', 'hearts-7'], ['spades-9'], ['spades-2']], { clubs: { low: '7', high: '7' } });
    assert.throws(() => game.play('p0', 'spades-5'), /Pata 5 ei sovi pöytään/);
    assert.throws(() => game.play('p1', 'spades-9'), /Ei ole sinun vuorosi/);
    const events = game.play('p0', 'hearts-7');
    assert.strictEqual(events[0].type, 'play');
    assert.strictEqual(game.current, 1);
});

test('lyöntipakko: pyyntö hylätään, jos voi lyödä', () => {
    const game = new Game(players(3), { rng: seeded(1) });
    arrange(game, [['spades-7', 'hearts-2'], ['spades-9', 'spades-10'], ['spades-2', 'diamonds-3']], { clubs: { low: '7', high: '7' } });
    assert.throws(() => game.ask('p0'), (err) => err instanceof GameError && err.message === 'Sinulla on lyötävä kortti.');
});

test('pyyntö ja antaminen: edellinen antaa, vuoro siirtyy pyytäjää seuraavalle', () => {
    const game = new Game(players(3), { rng: seeded(1) });
    arrange(game, [['spades-9', 'spades-10'], ['hearts-2', 'hearts-3'], ['diamonds-2', 'diamonds-3']], { clubs: { low: '7', high: '7' } }, 1);
    const [ask] = game.ask('p1');
    assert.strictEqual(ask.type, 'ask');
    assert.strictEqual(ask.giverId, 'p0', 'edellinen vastapäivään');
    assert.strictEqual(game.phase, 'give');
    assert.throws(() => game.give('p2', 'diamonds-2'), /antaa kortin/);
    assert.throws(() => game.play('p1', 'hearts-2'), /Odotetaan/);

    const [give] = game.give('p0', 'spades-9');
    assert.strictEqual(give.type, 'give');
    assert.strictEqual(game.phase, 'play');
    assert.strictEqual(game.current, 2, 'pyytäjää seuraava');
    assert.ok(game.players[1].hand.some(c => cardId(c) === 'spades-9'));
    assert.strictEqual(game.players[0].hand.length, 1);

    assert.strictEqual(Game.publicEvent(give, 'p2').card, null, 'muut eivät näe korttia');
    assert.deepStrictEqual(Game.publicEvent(give, 'p1').card, card('spades-9'));
    assert.deepStrictEqual(Game.publicEvent(give, 'p0').card, card('spades-9'));
});

test('pyydetyllä vain yksi kortti: pyyntö siirtyy seuraavalle, pois päässeet ohitetaan', () => {
    const game = new Game(players(4), { rng: seeded(1) });
    arrange(game, [['spades-2', 'spades-3'], ['hearts-2'], ['diamonds-2', 'diamonds-3'], ['hearts-3', 'hearts-4']], { clubs: { low: '7', high: '7' } }, 2);
    const [ask] = game.ask('p2');
    assert.deepStrictEqual(ask.skipped, ['Pelaaja 1']);
    assert.strictEqual(ask.giverId, 'p0');

    const game2 = new Game(players(3), { rng: seeded(1) });
    arrange(game2, [['spades-2'], [], ['diamonds-2', 'diamonds-3']], { clubs: { low: '7', high: '7' } }, 2);
    game2.players[1].out = true;
    const [ask2] = game2.ask('p2');
    assert.strictEqual(ask2.giverId, null, 'kukaan ei voi antaa');
    assert.strictEqual(game2.phase, 'play');
    assert.strictEqual(game2.current, 0, 'vuoro siirtyy, pois päässyt ohitetaan');
});

test('ässä ja kuningas antavat lisäkortin, joka päättyy lyöntiin tai lopetukseen', () => {
    const game = new Game(players(2), { rng: seeded(1) });
    arrange(game, [['spades-A', 'spades-K', 'hearts-2', 'hearts-3'], ['diamonds-2', 'diamonds-3']], {
        clubs: { low: '7', high: '7' }, spades: { low: '2', high: 'Q' }
    });
    let [e] = game.play('p0', 'spades-A');
    assert.strictEqual(e.bonus, true);
    assert.strictEqual(game.current, 0);
    assert.throws(() => game.ask('p0'), /Voit jatkaa/);
    [e] = game.play('p0', 'spades-K');
    assert.strictEqual(e.bonus, true, 'kuningas jatkaa taas');
    assert.strictEqual(game.getView('p0').allowedActions.includes('end-turn'), true);
    const [end] = game.endTurn('p0');
    assert.strictEqual(end.type, 'end-turn');
    assert.strictEqual(game.current, 1);
    assert.throws(() => game.endTurn('p1'), /ei voi lopettaa/);
});

test('pois pääsy ja pelin loppu', () => {
    const game = new Game(players(3), { rng: seeded(1) });
    arrange(game, [['hearts-7'], ['hearts-6', 'spades-2'], ['diamonds-2', 'diamonds-3']], { clubs: { low: '7', high: '7' } });
    let events = game.play('p0', 'hearts-7');
    assert.deepStrictEqual(events.map(e => e.type), ['play', 'out']);
    assert.strictEqual(events[1].place, 1);
    assert.strictEqual(game.current, 1);
    // Viimeisenä lyöty ässä ei anna lisävuoroa.
    arrange(game, [[], ['hearts-6'], ['diamonds-2']], { clubs: { low: '7', high: '7' }, hearts: { low: '7', high: '7' } }, 1);
    game.players[0].out = true;
    events = game.play('p1', 'hearts-6');
    assert.deepStrictEqual(events.map(e => e.type), ['play', 'out', 'over']);
    assert.strictEqual(events[2].loserId, 'p2');
    assert.strictEqual(game.phase, 'over');
});

test('näkymä ei paljasta muiden käsiä eikä lyötäviä kortteja', () => {
    const game = new Game(players(3), { rng: seeded(2) });
    const view = game.getView('p0');
    assert.ok(Array.isArray(view.hand));
    assert.strictEqual(view.playable, undefined);
    assert.ok(view.players.every(p => p.hand === undefined));
    assert.deepStrictEqual(view.nextCards.clubs, ['6']);
    assert.strictEqual(game.getView(null).hand, null);
});

test('satunnaiset pelit päättyvät aina (lyöntipakko estää jumin)', () => {
    for (let seed = 1; seed <= 200; seed++) {
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
            const p = game.players[game.current];
            const playable = p.hand.filter(c => isPlayable(game.table, c));
            if (playable.length > 0) game.play(p.id, cardId(playable[Math.floor(rng() * playable.length)]));
            else if (game.bonus) game.endTurn(p.id);
            else game.ask(p.id);
        }
        assert.strictEqual(game.finishOrder.length, n);
    }
});
