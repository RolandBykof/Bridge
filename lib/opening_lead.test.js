const test = require('node:test');
const assert = require('node:assert');
const { chooseOpeningLead, conventionalLeadCard } = require('./opening_lead');
const solver = require('./bridge_solver_wasm');
const DdReview = require('../public/js/dd-review.js');

// Sama jako kuin dd-review.test.js:ssä.
const HANDS = {
    north: { spades: ['J', '9', '8'], hearts: ['Q', '10', '8', '3'], diamonds: ['K', '6'], clubs: ['J', '8', '5', '3'] },
    east: { spades: ['Q', '7', '6', '2'], hearts: ['A', 'K'], diamonds: ['A', 'J', '9'], clubs: ['Q', '9', '6', '2'] },
    south: { spades: ['A', 'K', '10', '5'], hearts: ['J', '9', '7', '6'], diamonds: ['10', '8', '7'], clubs: ['K', '4'] },
    west: { spades: ['4', '3'], hearts: ['5', '4', '2'], diamonds: ['Q', '5', '4', '3', '2'], clubs: ['A', '10', '7'] }
};

test('maan sisällä tavanomainen avauskortti', () => {
    const suit = (cards, nt = false) => conventionalLeadCard(cards, nt);
    assert.strictEqual(suit(['A', 'K', '5', '3']), 'A', 'ässä AK:sta valttipelissä');
    assert.strictEqual(suit(['K', 'Q', '10', '4']), 'K', 'ylin rikkonaisesta sarjasta');
    assert.strictEqual(suit(['K', 'Q', '7', '4']), 'K', 'ylin kahden honöörin sarjasta valttipelissä');
    assert.strictEqual(suit(['K', 'Q', '7', '4'], true), '4', 'sangissa neljänneksi paras');
    assert.strictEqual(suit(['Q', 'J', '10', '2'], true), 'Q', 'ylin kolmen kortin sarjasta');
    assert.strictEqual(suit(['K', 'J', '10', '3']), 'J', 'sisäsarjasta sen ylin');
    assert.strictEqual(suit(['Q', '10', '9', '5']), '10', 'sisäsarja Q109');
    assert.strictEqual(suit(['A', '8', '6', '3']), 'A', 'ässää ei aliavata valttipelissä');
    assert.strictEqual(suit(['A', '8', '6', '3'], true), '3', 'sangissa neljänneksi paras');
    assert.strictEqual(suit(['Q', '8', '6', '3', '2']), '3', 'neljänneksi paras honöörin alta');
    assert.strictEqual(suit(['K', '8', '6']), '6', 'pienin kolmesta honöörin alta');
    assert.strictEqual(suit(['9', '8']), '9', 'ylin dubbelista');
    assert.strictEqual(suit(['8', '6', '3']), '8', 'roskasta ylin');
    assert.strictEqual(suit(['9', '7', '5', '2']), '7', 'neljästä pienestä toiseksi ylin');
});

test('partnerin tarjoama maa valitaan, kun avaukset ovat yhtä hyviä', () => {
    const hand = { spades: ['8', '6', '3'], hearts: ['K', 'Q', 'J', '4'], diamonds: ['9', '5', '2'], clubs: ['A', '7', '4'] };
    const candidates = [{ suit: 'spades', card: '8' }, { suit: 'hearts', card: 'K' }];
    // Itä (lännen partneri) tarjosi padat.
    const auction = [{ player: 'south', bid: '1C' }, { player: 'west', bid: 'P' }, { player: 'north', bid: '1D' }, { player: 'east', bid: '1S' }];
    assert.deepStrictEqual(
        chooseOpeningLead({ hand, trump: 'clubs', candidates, auction, leader: 'west' }),
        { suit: 'spades', card: '8' }
    );
    // Ilman partnerin tarjousta ylin sarjasta (KQJ) on paras.
    assert.deepStrictEqual(
        chooseOpeningLead({ hand, trump: 'clubs', candidates, auction: [], leader: 'west' }),
        { suit: 'hearts', card: 'K' }
    );
});

test('sangissa pitkä maa ennen lyhyttä', () => {
    const hand = { spades: ['K', 'J', '8', '6', '3'], hearts: ['9', '4'], diamonds: ['Q', '5', '2'], clubs: ['7', '4', '3'] };
    const candidates = [{ suit: 'spades', card: '6' }, { suit: 'hearts', card: '9' }, { suit: 'clubs', card: '7' }];
    assert.deepStrictEqual(chooseOpeningLead({ hand, trump: null, candidates, auction: [], leader: 'west' }),
        { suit: 'spades', card: '6' });
});

/** Pelaa koko jaon robotin tavoin: bestCard jokaiselle kortille. */
async function robotPlay(hands, trump, declarer, leader) {
    const remaining = {};
    for (const p of Object.keys(hands)) {
        remaining[p] = {};
        for (const s of DdReview.SUITS) remaining[p][s] = hands[p][s].slice();
    }
    const order = ['north', 'east', 'south', 'west'];
    const played = [];
    let trick = [];
    let mover = leader;
    for (let i = 0; i < 52; i++) {
        const hand = remaining[mover];
        let legal = [];
        if (trick.length > 0 && hand[trick[0].suit].length > 0) {
            legal = hand[trick[0].suit].map(card => ({ suit: trick[0].suit, card }));
        } else {
            for (const s of DdReview.SUITS) for (const card of hand[s]) legal.push({ suit: s, card });
        }
        const best = await solver.bestCard({ hands, trump, declarer, leader, playedCards: played, legalCards: legal, auction: [] });
        const play = { player: mover, suit: best.suit, card: best.card };
        played.push(play);
        hand[best.suit].splice(hand[best.suit].indexOf(best.card), 1);
        trick.push(play);
        if (trick.length === 4) {
            mover = DdReview.trickWinner(trick, trump);
            trick = [];
        } else {
            mover = order[(order.indexOf(mover) + 1) % 4];
        }
    }
    return played;
}

test('katselu näyttää saman pelin kuin robotit pelasivat', async () => {
    for (const [trump, declarer, leader] of [['spades', 'south', 'west'], [null, 'east', 'south']]) {
        const robot = await robotPlay(HANDS, trump, declarer, leader);
        const line = await solver.optimalLine({ hands: HANDS, trump, declarer, leader, auction: [], actualLead: robot[0] });
        assert.deepStrictEqual(line.plays, robot, `${trump || 'NT'}: katselun kortit ovat robottien kortit`);
        assert.strictEqual(line.actualLeadCost, 0);
        assert.strictEqual(line.declaringTricks, await solver.solveContract(HANDS, trump, declarer));
    }
});

test('katselu alkaa todellisella avauksella, jos se oli yksi parhaista', async () => {
    // Sangissa idän pelaamana etelän avauksista osa maksaa tikin.
    const base = { hands: HANDS, trump: null, declarer: 'east', leader: 'south', auction: [] };
    const free = await solver.optimalLine(base);

    // Etsi toinen, yhtä hyvä avaus kuin katselun oma valinta, ja tikin maksava avaus.
    let equal = null;
    let costly = null;
    for (const suit of DdReview.SUITS) {
        for (const card of HANDS.south[suit]) {
            if (suit === free.plays[0].suit && card === free.plays[0].card) continue;
            const line = await solver.optimalLine({ ...base, actualLead: { suit, card } });
            if (line.actualLeadCost === 0 && !equal) equal = { suit, card, line };
            if (line.actualLeadCost > 0 && !costly) costly = { suit, card, line };
        }
    }

    assert.ok(equal, 'jaossa on useampi yhtä hyvä avaus');
    assert.deepStrictEqual({ suit: equal.line.plays[0].suit, card: equal.line.plays[0].card }, { suit: equal.suit, card: equal.card });
    assert.strictEqual(equal.line.declaringTricks, free.declaringTricks);

    assert.ok(costly, 'jaossa on tikin maksava avaus');
    assert.deepStrictEqual(costly.line.plays[0], free.plays[0], 'huono avaus korvataan parhaalla');
    assert.strictEqual(costly.line.declaringTricks, free.declaringTricks);
});
