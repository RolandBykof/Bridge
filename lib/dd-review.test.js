const test = require('node:test');
const assert = require('node:assert');
const DdReview = require('../public/js/dd-review.js');
const solver = require('./bridge_solver_wasm');

const c = (player, suit, card) => ({ player, suit, card });

// PBN "N:J98.QT83.K6.J853 Q762.AK.AJ9.Q962 AKT5.J976.T87.K4 43.542.Q5432.AT7"
// (sama jako, jolla ratkaisijan dd_optimal_line kokeiltiin suunnitelmassa)
const HANDS = {
    north: { spades: ['J', '9', '8'], hearts: ['Q', '10', '8', '3'], diamonds: ['K', '6'], clubs: ['J', '8', '5', '3'] },
    east: { spades: ['Q', '7', '6', '2'], hearts: ['A', 'K'], diamonds: ['A', 'J', '9'], clubs: ['Q', '9', '6', '2'] },
    south: { spades: ['A', 'K', '10', '5'], hearts: ['J', '9', '7', '6'], diamonds: ['10', '8', '7'], clubs: ['K', '4'] },
    west: { spades: ['4', '3'], hearts: ['5', '4', '2'], diamonds: ['Q', '5', '4', '3', '2'], clubs: ['A', '10', '7'] }
};

test('tikin voittaa korkein johdettua maata, jos valttia ei pelattu', () => {
    const trick = [c('west', 'hearts', '5'), c('north', 'hearts', 'Q'), c('east', 'hearts', 'K'), c('south', 'clubs', 'A')];
    assert.strictEqual(DdReview.trickWinner(trick, 'spades'), 'east');
    assert.strictEqual(DdReview.trickWinner(trick, null), 'east');
});

test('valtti voittaa, ja korkein valtti voittaa matalamman', () => {
    const trick = [c('west', 'hearts', 'A'), c('north', 'spades', '2'), c('east', 'spades', '9'), c('south', 'hearts', 'K')];
    assert.strictEqual(DdReview.trickWinner(trick, 'spades'), 'east');
    assert.strictEqual(DdReview.trickWinner(trick, 'clubs'), 'west');
});

test('sangissa muu maa ei voita koskaan', () => {
    const trick = [c('west', 'diamonds', '2'), c('north', 'spades', 'A'), c('east', 'diamonds', '10'), c('south', 'clubs', 'A')];
    assert.strictEqual(DdReview.trickWinner(trick, null), 'east');
});

test('buildTricks laskee voittajat ja juoksevan tikkitilanteen', () => {
    const plays = [
        c('west', 'hearts', '5'), c('north', 'hearts', 'Q'), c('east', 'hearts', 'K'), c('south', 'hearts', 'A'),
        c('south', 'clubs', '2'), c('west', 'clubs', 'A'), c('north', 'clubs', '3'), c('east', 'clubs', '4')
    ];
    const tricks = DdReview.buildTricks(plays, null, 'south');
    assert.strictEqual(tricks.length, 2);
    assert.strictEqual(tricks[0].winner, 'south');
    assert.strictEqual(tricks[0].leader, 'west');
    assert.deepStrictEqual([tricks[0].declarerTricks, tricks[0].defenderTricks], [1, 0]);
    assert.strictEqual(tricks[1].winner, 'west');
    assert.deepStrictEqual([tricks[1].declarerTricks, tricks[1].defenderTricks], [1, 1]);
});

test('handsBeforeTrick poistaa vain aiempien tikkien kortit', () => {
    const plays = [
        c('west', 'hearts', '5'), c('north', 'hearts', 'Q'), c('east', 'hearts', 'K'), c('south', 'hearts', 'J')
    ];
    const tricks = DdReview.buildTricks(plays, 'spades', 'south');
    const before = DdReview.handsBeforeTrick(HANDS, tricks, 0);
    assert.deepStrictEqual(before.west.hearts, ['5', '4', '2']);
    const after = DdReview.handsBeforeTrick(HANDS, tricks, 1);
    assert.deepStrictEqual(after.west.hearts, ['4', '2']);
    assert.deepStrictEqual(after.north.hearts, ['10', '8', '3']);
    assert.deepStrictEqual(HANDS.west.hearts, ['5', '4', '2'], 'alkuperäisiä käsiä ei muuteta');
});

test('ratkaisijan linja: 13 tikkiä, voittaja johtaa seuraavaa ja tikit täsmäävät', async () => {
    const line = await solver.optimalLine({ hands: HANDS, trump: 'spades', declarer: 'south', leader: 'west' });
    assert.strictEqual(line.plays.length, 52);

    const tricks = DdReview.buildTricks(line.plays, 'spades', 'south');
    assert.strictEqual(tricks.length, 13);
    assert.strictEqual(tricks[0].leader, 'west');
    for (let i = 1; i < tricks.length; i++) {
        assert.strictEqual(tricks[i].leader, tricks[i - 1].winner, `tikin ${i + 1} johtaja on edellisen voittaja`);
    }
    assert.strictEqual(tricks[12].declarerTricks, line.declaringTricks);
    assert.strictEqual(line.declaringTricks, await solver.solveContract(HANDS, 'spades', 'south'));

    const lastHands = DdReview.handsBeforeTrick(HANDS, tricks, 12);
    for (const position of ['north', 'east', 'south', 'west']) {
        const count = DdReview.SUITS.reduce((n, s) => n + lastHands[position][s].length, 0);
        assert.strictEqual(count, 1, `${position}: viimeisen tikin alussa yksi kortti`);
    }
});
