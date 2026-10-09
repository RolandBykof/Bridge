const test = require('node:test');
const assert = require('node:assert');
const { parseDealString } = require('../deal');
const {
    parseContract, roleSeats, suitLengths, isBalanced, constraintsFor,
    validateConstraints, matchesConstraints, topTricks
} = require('./constraints');
const { SPECS } = require('./specs');
const { validateSpec } = require('./generator');

// Etelä AKT5.J976.T87.K4 (11 p, 4432), pohjoinen J98.QT83.K6.J853 (7 p).
// Puolella 7 pataa ja 8 herttaa.
const HANDS = parseDealString('N:J98.QT83.K6.J853 Q762.AK.AJ9.Q962 AKT5.J976.T87.K4 43.542.Q5432.AT7');

const hand = (spades, hearts, diamonds, clubs) => ({ spades, hearts, diamonds, clubs });

test('parseContract tulkitsee sopimuksen ja vaaditut tikit', () => {
    assert.deepStrictEqual(parseContract('4S'), { level: 4, strain: 'S', trump: 'spades', required: 10, text: '4S' });
    assert.deepStrictEqual(parseContract('3n'), { level: 3, strain: 'N', trump: null, required: 9, text: '3N' });
    assert.throws(() => parseContract('8S'), /Invalid contract/);
    assert.throws(() => parseContract('4X'), /Invalid contract/);
});

test('roolit asettuvat pelinviejän mukaan', () => {
    assert.deepStrictEqual(roleSeats('south'), {
        declarer: ['south'], lho: ['west'], dummy: ['north'], rho: ['east'],
        side: ['south', 'north'], defenders: ['west', 'east']
    });
    assert.deepStrictEqual(roleSeats('east').lho, ['south']);
    assert.deepStrictEqual(roleSeats('east').dummy, ['west']);
});

test('tasajakoisuus: 4333, 4432 ja 5332', () => {
    const shape = (...lengths) => hand(...lengths.map(n => Array(n).fill('2')));
    assert.ok(isBalanced(shape(4, 3, 3, 3)));
    assert.ok(isBalanced(shape(2, 4, 3, 4)));
    assert.ok(isBalanced(shape(3, 2, 5, 3)));
    assert.ok(!isBalanced(shape(5, 4, 2, 2)));
    assert.ok(!isBalanced(shape(4, 4, 4, 1)));
    assert.ok(!isBalanced(shape(6, 3, 2, 2)));
    assert.deepStrictEqual(suitLengths(HANDS.south), { spades: 4, hearts: 4, diamonds: 3, clubs: 2 });
});

test('pisteet ja valttien pituus lasketaan roolin käsistä', () => {
    const spec = (constraints) => ({ constraints });
    assert.ok(matchesConstraints(HANDS, spec({ side: { hcp: [18, 18] } }), '2H'));
    assert.ok(!matchesConstraints(HANDS, spec({ side: { hcp: [19, 25] } }), '2H'));
    assert.ok(matchesConstraints(HANDS, spec({ declarer: { hcp: [11, 11] }, dummy: { hcp: [7, 7] } }), '2H'));
    assert.ok(matchesConstraints(HANDS, spec({ side: { trumpLength: [8, 8] } }), '2H'));
    assert.ok(!matchesConstraints(HANDS, spec({ side: { trumpLength: [8, 9] } }), '2S'));
    // Sangissa valttiehto ei rajaa.
    assert.ok(matchesConstraints(HANDS, spec({ side: { trumpLength: [8, 9] } }), '1N'));
    // Lännen avatessa (pelinviejä etelä) avaajalla on 6 pistettä.
    assert.ok(matchesConstraints(HANDS, spec({ lho: { hcp: [6, 6] } }), '2H'));
    // Idän pelatessa avaaja on etelä.
    assert.ok(matchesConstraints(HANDS, spec({ lho: { hcp: [11, 11] } }), '2H', 'east'));
});

test('tasajako, pisin maa ja ylämaan sopu', () => {
    const spec = (constraints) => ({ constraints });
    assert.ok(matchesConstraints(HANDS, spec({ declarer: { balanced: true } }), '3N'));
    assert.ok(matchesConstraints(HANDS, spec({ side: { maxSuitLength: 4 } }), '3N'));
    assert.ok(!matchesConstraints(HANDS, spec({ defenders: { maxSuitLength: 4 } }), '3N'));
    assert.ok(!matchesConstraints(HANDS, spec({ side: { noMajorFit: true } }), '3N'));
    assert.ok(matchesConstraints(HANDS, spec({ defenders: { noMajorFit: true } }), '3N'));
});

test('maa- ja sangiehdot lisätään yhteisiin ehtoihin', () => {
    const spec = {
        constraints: { side: { hcp: [20, 24] } },
        suitConstraints: { side: { trumpLength: [8, 10] } },
        notrumpConstraints: { declarer: { balanced: true } }
    };
    assert.deepStrictEqual(constraintsFor(spec, parseContract('2S')), { side: { hcp: [20, 24], trumpLength: [8, 10] } });
    assert.deepStrictEqual(constraintsFor(spec, parseContract('1N')), { side: { hcp: [20, 24] }, declarer: { balanced: true } });
});

test('tuntematon rooli tai ehto on virhe', () => {
    assert.throws(() => validateConstraints({ partner: { hcp: [1, 2] } }), /Unknown role/);
    assert.throws(() => validateConstraints({ side: { points: [1, 2] } }), /Unknown constraint/);
    assert.throws(() => validateConstraints({ declarer: { noMajorFit: true } }), /noMajorFit/);
});

test('varmat tikit: katkeamaton kärkisarja, enintään pidemmän käden pituus', () => {
    const none = hand([], [], [], []);
    const tops = (south, north) => topTricks({ south, north, east: none, west: none });
    // AK vastaan Qx: kolme kärkeä mutta vain kaksi tikkiä.
    assert.strictEqual(tops(hand(['A', 'K'], [], [], []), hand(['Q', '2'], [], [], [])), 2);
    // AKQ vastaan xx: kolme.
    assert.strictEqual(tops(hand(['A', 'K', 'Q'], [], [], []), hand(['3', '2'], [], [], [])), 3);
    // AQ ilman kuningasta: yksi.
    assert.strictEqual(tops(hand(['A', 'Q', '2'], [], [], []), hand(['3'], [], [], [])), 1);
    // Kuningas ilman ässää: ei yhtään.
    assert.strictEqual(tops(hand([], ['K', 'Q', 'J'], [], []), hand([], ['10'], [], [])), 0);
    // Maat lasketaan yhteen.
    assert.strictEqual(tops(hand(['A'], ['A', 'K'], [], []), hand(['K', '2'], [], ['A'], [])), 5);
    assert.strictEqual(topTricks(HANDS), 2);
});

test('kaikki harjoitustyypit ovat kelvollisia', () => {
    const ids = new Set();
    for (const spec of SPECS) {
        validateSpec(spec);
        assert.ok(!ids.has(spec.id), `kaksi tyyppiä tunnisteella ${spec.id}`);
        ids.add(spec.id);
    }
});
