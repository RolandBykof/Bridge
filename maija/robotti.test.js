'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { Game } = require('./game.js');
const robotti = require('./robotti.js');
const { cardId, isMaija } = require('../public/maija/js/kortit.js');

function mulberry32(seed) {
    return function () {
        seed |= 0; seed = seed + 0x6D2B79F5 | 0;
        let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

const c = (suit, rank) => ({ suit, rank });

function view(overrides) {
    return {
        hand: [], table: [], trump: 'hearts', maxAttack: 5, deckCount: 20, noBeatRounds: 0,
        ...overrides
    };
}

test('robotti lyö pata rouvan aina, kun se on kädessä', () => {
    const v = view({ hand: [c('spades', 'Q'), c('spades', '3'), c('clubs', '2'), c('diamonds', '4')], maxAttack: 2 });
    for (let seed = 1; seed < 20; seed++) {
        const chosen = robotti.decideAttack(v, mulberry32(seed));
        assert.ok(chosen.includes('spades-Q'));
        assert.ok(chosen.length <= 2);
        assert.ok(chosen.every(id => id.startsWith('spades-')));
    }
});

test('ennen loppukiriä robotti lyö matalia kortteja eikä valtteja', () => {
    const v = view({ hand: [c('hearts', '2'), c('clubs', 'A'), c('clubs', 'K'), c('diamonds', '3'), c('diamonds', '5')] });
    const chosen = robotti.decideAttack(v, mulberry32(1));
    assert.deepStrictEqual(chosen.sort(), ['diamonds-3', 'diamonds-5']);
});

test('loppukirissä robotti lyö suurimman ryhmän', () => {
    const v = view({
        deckCount: 0, maxAttack: 5,
        hand: [c('clubs', '10'), c('clubs', 'J'), c('clubs', 'K'), c('diamonds', '2')]
    });
    const chosen = robotti.decideAttack(v, mulberry32(1));
    assert.strictEqual(chosen.length, 3);
});

test('robotti kaataa kaiken, kun pystyy', () => {
    const v = view({
        table: [{ card: c('clubs', '5') }, { card: c('diamonds', '9') }],
        hand: [c('clubs', '7'), c('hearts', '2'), c('spades', 'A')]
    });
    assert.deepStrictEqual(robotti.decideDefense(v, mulberry32(1)).sort(), ['clubs-7', 'hearts-2']);
});

test('osittaisessa kaadossa robotti ei tuhlaa ässää eikä korkeaa valttia', () => {
    const v = view({
        table: [{ card: c('clubs', '5') }, { card: c('diamonds', '9') }, { card: c('spades', 'Q') }],
        hand: [c('clubs', 'A'), c('hearts', 'K'), c('diamonds', '10')]
    });
    assert.deepStrictEqual(robotti.decideDefense(v, mulberry32(1)), ['diamonds-10']);
});

test('loppukirissä robotti kaataa minkä pystyy, vahvoillakin korteilla', () => {
    const v = view({
        deckCount: 0,
        table: [{ card: c('clubs', '5') }, { card: c('spades', 'Q') }],
        hand: [c('clubs', 'A'), c('hearts', 'K')]
    });
    const chosen = robotti.decideDefense(v, mulberry32(1));
    assert.strictEqual(chosen.length, 1);
});

function playGame(seed, playerCount, isRobot) {
    const rng = mulberry32(seed);
    const players = Array.from({ length: playerCount }, (_, i) => ({ id: `p${i}`, name: `P${i}` }));
    const game = new Game(players, { rng });
    for (let step = 0; step < 20000; step++) {
        if (game.phase === 'over') return game;
        const actor = game.players[game.phase === 'attack' ? game.attacker : game.defender];
        const v = game.getView(actor.id);
        const robot = isRobot(actor.id);
        if (game.phase === 'attack') {
            game.attack(actor.id, robot ? robotti.decideAttack(v, rng) : robotti.randomAttack(v, rng));
        } else {
            game.defend(actor.id, robot ? robotti.decideDefense(v, rng) : robotti.randomDefense(v, rng));
        }
    }
    assert.fail(`peli ${seed} ei päättynyt`);
}

test('pelkät robotit: 2000 peliä päättyy ilman laittomia siirtoja', () => {
    for (let seed = 1; seed <= 2000; seed++) {
        const game = playGame(seed, 2 + (seed % 4), () => true);
        const maija = game.players.find(p => p.id === game.maijaId);
        assert.ok(maija.hand.some(isMaija));
    }
});

test('robotti joutuu Maijaksi selvästi harvemmin kuin sattumalta', () => {
    const games = 2000;
    let robotMaija = 0;
    for (let seed = 1; seed <= games; seed++) {
        const game = playGame(seed, 3, id => id === 'p0');
        if (game.maijaId === 'p0') robotMaija++;
    }
    const rate = robotMaija / games;
    // Sattumalta 1/3. Vaaditaan selvä ero.
    assert.ok(rate < 0.2, `robotti oli Maija ${(rate * 100).toFixed(1)} % peleistä`);
    console.log(`Robotti Maijana ${(rate * 100).toFixed(1)} % peleistä (sattumalta 33 %)`);
});

test('robotin valinnat ovat aina laillisia pelin tarkistuksessa', () => {
    // playGame heittäisi GameErrorin laittomasta siirrosta; tarkistetaan vielä kortit.
    const game = new Game([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], { rng: mulberry32(3) });
    const v = game.getView('a');
    const ids = new Set(v.hand.map(cardId));
    assert.ok(robotti.decideAttack(v, mulberry32(3)).every(id => ids.has(id)));
});
