'use strict';
// Kasinon robotin testit.
const test = require('node:test');
const assert = require('node:assert');
const { Game } = require('./game.js');
const robotti = require('./robotti.js');

const SUIT = { S: 'spades', H: 'hearts', D: 'diamonds', C: 'clubs' };
const cards = list => list.split(' ').map(t => ({ suit: SUIT[t[0]], rank: t.slice(1) }));

function seeded(seed) {
    return function () {
        seed |= 0;
        seed = (seed + 0x6D2B79F5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function view(hand, table, lastHand = false) {
    return { hand: cards(hand), table: table ? cards(table) : [], lastHand };
}

test('robotti ottaa, kun voi, ja suosii arvokasta ottoa', () => {
    assert.deepStrictEqual(robotti.decideMove(view('H5 C9', 'D5 H3')), { action: 'take', cardId: 'hearts-5' });
    // Ruutukymppi (2 p) on arvokkaampi kuin risti 4.
    assert.deepStrictEqual(robotti.decideMove(view('C10 H4', 'D10 C4')), { action: 'take', cardId: 'clubs-10' });
});

test('robotti ei lyö pistekorttia, jos muuta on', () => {
    const move = robotti.decideMove(view('D10 HA C9', 'H2'));
    assert.strictEqual(move.action, 'lay');
    assert.strictEqual(move.cardId, 'clubs-9');
});

test('satunnainen siirto lyö kortin kädestä', () => {
    const move = robotti.randomMove(view('H5 C9', ''), seeded(1));
    assert.strictEqual(move.action, 'lay');
    assert.ok(['hearts-5', 'clubs-9'].includes(move.cardId));
});

test('1 000 robottien peliä päättyy ilman hylättyjä siirtoja', () => {
    const players = n => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `Robotti ${i + 1}` }));
    let games = 0;
    for (const n of [2, 3, 4]) {
        for (let seed = 1; seed <= 334; seed++) {
            const rng = seeded(seed * 10 + n);
            const game = new Game(players(n), { rng, dealerIndex: 0 });
            let steps = 0;
            while (game.phase !== 'over') {
                if (game.phase === 'round-over') {
                    game.nextRound('p0');
                    continue;
                }
                const actor = game.players[game.current];
                const move = robotti.decideMove(game.getView(actor.id), rng);
                if (move.action === 'take') game.take(actor.id, move.cardId);
                else game.lay(actor.id, move.cardId);
                assert.ok(++steps < 5000, 'peli ei pääty');
            }
            assert.ok(game.players.some(p => p.score >= 16));
            games++;
        }
    }
    assert.ok(games >= 1000);
});
