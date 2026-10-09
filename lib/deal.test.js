const test = require('node:test');
const assert = require('node:assert');
const { SUITS, RANKS, POSITIONS, dealCards, countHcp, formatDealString, parseDealString, rotateHands } = require('./deal');

// Toistettava satunnaislukugeneraattori testejä varten.
function mulberry32(seed) {
    return function () {
        seed |= 0; seed = seed + 0x6D2B79F5 | 0;
        let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

const DEAL = 'N:J98.QT83.K6.J853 Q762.AK.AJ9.Q962 AKT5.J976.T87.K4 43.542.Q5432.AT7';

test('jaossa on 52 eri korttia, 13 kullakin ja maat suurimmasta pienimpään', () => {
    const hands = dealCards(mulberry32(1));
    const all = new Set();
    for (const position of POSITIONS) {
        let count = 0;
        for (const suit of SUITS) {
            const cards = hands[position][suit];
            count += cards.length;
            for (const card of cards) all.add(`${suit}${card}`);
            const order = cards.map(card => RANKS.indexOf(card));
            assert.deepStrictEqual(order, [...order].sort((a, b) => b - a));
        }
        assert.strictEqual(count, 13);
    }
    assert.strictEqual(all.size, 52);
});

test('sama siemen antaa saman jaon', () => {
    assert.deepStrictEqual(dealCards(mulberry32(7)), dealCards(mulberry32(7)));
    assert.notDeepStrictEqual(dealCards(mulberry32(7)), dealCards(mulberry32(8)));
});

test('parseDealString ja formatDealString ovat toistensa vastapareja', () => {
    assert.strictEqual(formatDealString(parseDealString(DEAL)), DEAL);
    const rng = mulberry32(3);
    for (let i = 0; i < 20; i++) {
        const hands = dealCards(rng);
        assert.deepStrictEqual(parseDealString(formatDealString(hands)), hands);
    }
});

test('parseDealString lukee jaon mistä tahansa paikasta alkaen', () => {
    const fromSouth = 'S:AKT5.J976.T87.K4 43.542.Q5432.AT7 J98.QT83.K6.J853 Q762.AK.AJ9.Q962';
    assert.deepStrictEqual(parseDealString(fromSouth), parseDealString(DEAL));
    const hands = parseDealString(DEAL.toLowerCase().replace('t5', '105'));
    assert.deepStrictEqual(hands.south.spades, ['A', 'K', '10', '5']);
});

test('parseDealString hylkää virheellisen jaon', () => {
    assert.throws(() => parseDealString('J98.QT83.K6.J853'), /Invalid deal string/);
    assert.throws(() => parseDealString('N:J98.QT83.K6.J853 Q762.AK.AJ9.Q962 AKT5.J976.T87.K4'), /four hands/);
    assert.throws(() => parseDealString('N:J98.QT83.K6.J85 Q762.AK.AJ9.Q962 AKT5.J976.T87.K4 43.542.Q5432.AT73'), /13/);
    assert.throws(() => parseDealString('N:J98.QT83.K6.J853 Q762.AK.AJ9.Q962 AKT5.J976.T87.K4 43.542.Q5432.AT8'), /twice/);
    assert.throws(() => parseDealString('N:J98.QT83.K6.J853 Q762.AK.AJ9.Q962 AKT5.J976.T87.K4 43.542.Q5432.AT1'), /Invalid card/);
});

test('rotateHands kiertää jaon niin, että käsi siirtyy halutulle paikalle', () => {
    const hands = parseDealString(DEAL);
    for (const to of POSITIONS) {
        const rotated = rotateHands(hands, 'south', to);
        assert.deepStrictEqual(rotated[to], hands.south);
        // Muutkin kädet siirtyvät saman verran: etelän vasen (länsi) on uuden paikan vasen.
        const left = POSITIONS[(POSITIONS.indexOf(to) + 1) % 4];
        const partner = POSITIONS[(POSITIONS.indexOf(to) + 2) % 4];
        assert.deepStrictEqual(rotated[left], hands.west);
        assert.deepStrictEqual(rotated[partner], hands.north);
    }
    assert.deepStrictEqual(rotateHands(hands, 'east', 'east'), hands);
    // Alkuperäinen jako ei muutu.
    rotateHands(hands, 'south', 'north').north.spades.pop();
    assert.strictEqual(formatDealString(hands), DEAL);
    assert.throws(() => rotateHands(hands, 'south', 'middle'), /Invalid seats/);
});

test('countHcp laskee honööripisteet', () => {
    const hands = parseDealString(DEAL);
    assert.strictEqual(countHcp(hands.south), 11);
    assert.strictEqual(countHcp(hands.north), 7);
    assert.strictEqual(POSITIONS.reduce((sum, p) => sum + countHcp(hands[p]), 0), 40);
});
