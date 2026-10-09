'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { Game } = require('./game.js');
const robotti = require('./robotti.js');
const { GAME_END_SCORE } = require('../public/hertta/js/saannot.js');

function seeded(seed) {
    let s = seed >>> 0;
    return () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 4294967296;
    };
}

function card(text) {
    const [suit, rank] = text.split('-');
    return { suit, rank };
}

function view(hand, trick = [], extra = {}) {
    return {
        hand: hand.map(card),
        trick: trick.map((t, i) => ({ playerId: `p${i}`, card: card(t) })),
        played: trick.map(card),
        tricksPlayed: 3,
        heartsBroken: true,
        ...extra
    };
}

test('vaihdossa annetaan pata rouva ja isot hertat, ruutu 10 pidetään', () => {
    const v = view(['spades-Q', 'spades-3', 'hearts-A', 'hearts-K', 'diamonds-10', 'clubs-2', 'clubs-5']);
    const pass = robotti.decidePass(v, seeded(1));
    assert.strictEqual(pass.length, 3);
    assert.ok(pass.includes('spades-Q'));
    assert.ok(pass.includes('hearts-A'));
    assert.ok(!pass.includes('diamonds-10'));
});

test('sakatessa pois pata rouva, maata tunnustaessa alitetaan', () => {
    assert.strictEqual(robotti.decidePlay(view(['spades-Q', 'hearts-9', 'diamonds-2'], ['clubs-5']), seeded(1)), 'spades-Q');
    assert.strictEqual(robotti.decidePlay(view(['clubs-3', 'clubs-9', 'clubs-A'], ['clubs-10', 'hearts-4']), seeded(1)), 'clubs-9');
    // Pata rouva kuninkaan alle.
    assert.strictEqual(robotti.decidePlay(view(['spades-Q', 'spades-2'], ['spades-K']), seeded(1)), 'spades-Q');
});

test('viimeisenä otetaan ruutu 10 sisältävä tikki', () => {
    const move = robotti.decidePlay(view(['diamonds-K', 'diamonds-2'], ['diamonds-10', 'diamonds-4', 'diamonds-5']), seeded(1));
    assert.strictEqual(move, 'diamonds-K');
});

test('robotit pelaavat kokonaisen pelin vain sallituilla siirroilla', () => {
    const rng = seeded(42);
    const ids = ['a', 'b', 'c', 'd'];
    const game = new Game(ids.map(id => ({ id, name: id })), { rng, dealerIndex: 0 });
    for (let i = 0; i < 2000 && game.phase !== 'over'; i++) {
        if (game.phase === 'pass') {
            const p = game.players.find(x => !x.passSelection);
            game.pass(p.id, robotti.decidePass(game.getView(p.id), rng));
        } else if (game.phase === 'play') {
            const p = game.players[game.current];
            game.play(p.id, robotti.decidePlay(game.getView(p.id), rng));
        } else {
            game.nextRound('a');
        }
    }
    assert.strictEqual(game.phase, 'over');
    assert.ok(game.players.some(p => p.score >= GAME_END_SCORE));
});
