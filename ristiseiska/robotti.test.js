'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { Game } = require('./game.js');
const robotti = require('./robotti.js');
const { emptyTable } = require('../public/ristiseiska/js/saannot.js');

function seeded(seed) {
    let s = seed >>> 0;
    return () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 4294967296;
    };
}

function players(n) {
    return Array.from({ length: n }, (_, i) => ({ id: `r${i}`, name: `Robotti ${i}` }));
}

function card(text) {
    const [suit, rank] = text.split('-');
    return { suit, rank };
}

test('robotti pyytää, kun ei voi lyödä, ja lopettaa lisävuoron, jos lyötävää ei ole', () => {
    const view = { hand: [card('spades-2')], table: { ...emptyTable(), clubs: { low: '7', high: '7' } }, bonus: false };
    assert.deepStrictEqual(robotti.decideTurn(view, seeded(1)), { action: 'ask' });
    assert.deepStrictEqual(robotti.decideTurn({ ...view, bonus: true }, seeded(1)), { action: 'end-turn' });
});

test('robotti suosii korttia, joka avaa sen omia kortteja', () => {
    const table = { ...emptyTable(), clubs: { low: '7', high: '7' } };
    const hand = [card('hearts-7'), card('spades-7'), card('spades-6'), card('spades-5')];
    const choice = robotti.decideTurn({ hand, table, bonus: false }, seeded(1));
    assert.deepStrictEqual(choice, { action: 'play', cardId: 'spades-7' });
});

test('robotti antaa kortin, joka on kaukana pöydästä, eikä heti sopivaa', () => {
    const table = { ...emptyTable(), clubs: { low: '7', high: '7' }, hearts: { low: '6', high: '8' } };
    const hand = [card('hearts-9'), card('diamonds-K'), card('hearts-5')];
    assert.strictEqual(robotti.decideGive({ hand, table }, seeded(1)), 'diamonds-K');
    assert.strictEqual(robotti.distance(table, card('hearts-9')), 0);
    assert.strictEqual(robotti.distance(table, card('spades-8')), 2);
});

test('pelkät robotit pelaavat 1 000 peliä ilman hylättyjä siirtoja', () => {
    for (let seed = 1; seed <= 1000; seed++) {
        const rng = seeded(seed);
        const n = 2 + (seed % 7);
        const game = new Game(players(n), { rng });
        let steps = 0;
        while (game.phase !== 'over') {
            if (++steps > 5000) assert.fail(`peli ${seed} ei päättynyt`);
            if (game.phase === 'give') {
                const id = game.players[game.giver].id;
                game.give(id, robotti.decideGive(game.getView(id), rng));
                continue;
            }
            const id = game.players[game.current].id;
            const choice = robotti.decideTurn(game.getView(id), rng);
            if (choice.action === 'play') game.play(id, choice.cardId);
            else if (choice.action === 'end-turn') game.endTurn(id);
            else game.ask(id);
        }
        assert.strictEqual(game.finishOrder.length, n);
    }
});
