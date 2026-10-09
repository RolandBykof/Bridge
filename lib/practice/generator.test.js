const test = require('node:test');
const assert = require('node:assert');
const { dealCards, formatDealString } = require('../deal');
const solver = require('../bridge_solver_wasm');
const { parseContract, matchesConstraints, topTricks } = require('./constraints');
const { generateDeals, withinDd, resolveDdBound } = require('./generator');
const { getSpec } = require('./specs');

// Toistettava satunnaislukugeneraattori testejä varten.
function mulberry32(seed) {
    return function () {
        seed |= 0; seed = seed + 0x6D2B79F5 | 0;
        let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

// Ratkaisijan sijainen: pelinviejä saa aina täsmälleen vaaditut tikit.
const makesExactly = (spec) => async (hands, trump) => {
    const contract = spec.contracts.map(parseContract).find(c => c.trump === trump);
    return contract.required;
};

function assertValidDeal(deal, spec) {
    const contract = parseContract(deal.contract);
    assert.ok(spec.contracts.includes(deal.contract));
    assert.strictEqual(deal.declarer, 'south');
    assert.strictEqual(deal.pbn, formatDealString(deal.hands));
    assert.ok(matchesConstraints(deal.hands, spec, contract), `${deal.pbn} ei täytä ehtoja`);
    assert.ok(topTricks(deal.hands) < contract.required, `${deal.pbn}: tikit kotiutuvat ilman tekniikkaa`);
    assert.ok(withinDd(deal.ddTricks, spec.dd, contract));
}

test('tuplanukkeraja: luku, contract ja contract±n', () => {
    const fourSpades = parseContract('4S');
    assert.strictEqual(resolveDdBound(7, fourSpades), 7);
    assert.strictEqual(resolveDdBound('contract', fourSpades), 10);
    assert.strictEqual(resolveDdBound('contract+1', fourSpades), 11);
    assert.strictEqual(resolveDdBound('contract - 2', fourSpades), 8);
    assert.throws(() => resolveDdBound('game', fourSpades), /Invalid dd bound/);

    const exactly = { min: 'contract', max: 'contract' };
    assert.ok(withinDd(10, exactly, fourSpades));
    assert.ok(!withinDd(9, exactly, fourSpades));
    assert.ok(!withinDd(11, exactly, fourSpades));
    assert.ok(withinDd(13, { min: 'contract' }, fourSpades));
    assert.ok(withinDd(0, undefined, fourSpades));
});

test('generaattori tuottaa vain ehdot täyttäviä jakoja', async () => {
    for (const id of ['partscore', 'notrump-game', 'major-game', 'minor-game', 'slam']) {
        const spec = getSpec(id);
        const { deals, stats } = await generateDeals(spec, {
            count: 5, timeLimitMs: 20000, rng: mulberry32(11), solve: makesExactly(spec)
        });
        assert.strictEqual(deals.length, 5, `${id}: liian vähän jakoja`);
        for (const deal of deals) assertValidDeal(deal, spec);
        assert.strictEqual(stats.accepted, 5);
        assert.ok(stats.dealt >= stats.passedConstraints && stats.passedConstraints >= stats.passedInterest);
        assert.ok(stats.passedInterest >= stats.solved && stats.solved >= stats.accepted);
    }
});

test('generaattori ohittaa pankissa jo olevat jaot', async () => {
    const spec = getSpec('major-game');
    const first = await generateDeals(spec, { count: 3, rng: mulberry32(5), solve: makesExactly(spec) });
    const skip = new Set(first.deals.map(d => d.pbn));
    const second = await generateDeals(spec, { count: 3, rng: mulberry32(5), solve: makesExactly(spec), skip });
    assert.strictEqual(second.deals.length, 3);
    for (const deal of second.deals) assert.ok(!skip.has(deal.pbn));
});

test('generaattori lopettaa aikarajaan, jos sopivia jakoja ei löydy', async () => {
    const spec = getSpec('major-game');
    const start = Date.now();
    const { deals } = await generateDeals(spec, { count: 1, timeLimitMs: 300, solve: async () => 0 });
    assert.strictEqual(deals.length, 0);
    assert.ok(Date.now() - start < 5000);
});

// solveContract ratkaisee koko taulukon (~0,4 s), joten tapauksia on vähän.
test('nopea declarerTricks antaa saman tuloksen kuin dd_table', async () => {
    const rng = mulberry32(2026);
    const cases = [];
    for (let i = 0; i < 2; i++) {
        const hands = dealCards(rng);
        for (const trump of ['spades', 'hearts', 'diamonds', 'clubs', null]) cases.push([hands, trump, 'south']);
        for (const declarer of ['north', 'east', 'west']) cases.push([hands, 'hearts', declarer]);
    }
    for (const [hands, trump, declarer] of cases) {
        assert.strictEqual(
            await solver.declarerTricks(hands, trump, declarer),
            await solver.solveContract(hands, trump, declarer),
            `${formatDealString(hands)} ${trump} ${declarer}`
        );
    }
});

test('oikealla ratkaisijalla generoitu jako menee täsmälleen kotiin', async () => {
    const spec = getSpec('major-game');
    const { deals } = await generateDeals(spec, { count: 2, timeLimitMs: 60000, rng: mulberry32(99) });
    assert.strictEqual(deals.length, 2);
    for (const deal of deals) {
        assertValidDeal(deal, spec);
        const contract = parseContract(deal.contract);
        assert.strictEqual(deal.ddTricks, contract.required);
        const line = await solver.optimalLine({
            hands: deal.hands, trump: contract.trump, declarer: 'south', leader: 'west'
        });
        assert.strictEqual(line.declaringTricks, deal.ddTricks);
    }
});
