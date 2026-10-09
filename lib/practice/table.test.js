const test = require('node:test');
const assert = require('node:assert');
const { POSITIONS, parseDealString, formatDealString } = require('../deal');
const {
    MODE, practiceTypeLabel, validPracticeType, createPracticeState, partnerOf,
    pickPracticeDeal, practiceContract, recordPracticeResult, practicePublic
} = require('./table');

const PBN_1 = 'N:J98.QT83.K6.J853 Q762.AK.AJ9.Q962 AKT5.J976.T87.K4 43.542.Q5432.AT7';
const PBN_2 = 'N:AKT5.J976.T87.K4 43.542.Q5432.AT7 J98.QT83.K6.J853 Q762.AK.AJ9.Q962';

// Pankin sijainen: palauttaa ensimmäisen pelaamattoman jaon kuten bank.pickDeal.
function fakeBank(entries) {
    return {
        pickDeal(specId, excludeIds) {
            let candidates = entries.filter(e => !excludeIds.includes(e.id));
            const recycled = candidates.length === 0;
            if (recycled) candidates = entries;
            const entry = candidates[0];
            return entry ? { ...entry, spec: 'major-game', hands: parseDealString(entry.pbn), recycled } : null;
        }
    };
}

const ENTRIES = [
    { id: 'major-game-0001', pbn: PBN_1, contract: '4S', declarer: 'south', ddTricks: 10, note: 'Draw trumps first.' },
    { id: 'major-game-0002', pbn: PBN_2, contract: '4H', declarer: 'south', ddTricks: 10, note: null }
];

test('harjoitustyyppi: tunnettu tyyppi kelpaa, tuntematon on mixed', () => {
    assert.strictEqual(MODE, 'declarerPractice');
    assert.strictEqual(validPracticeType('slam'), 'slam');
    assert.strictEqual(validPracticeType('mixed'), 'mixed');
    assert.strictEqual(validPracticeType('grand-slam'), null);
    assert.strictEqual(createPracticeState('grand-slam').specId, 'mixed');
    assert.deepStrictEqual(createPracticeState('slam'), {
        specId: 'slam', playedIds: [], current: null, stats: { played: 0, made: 0 }
    });
    assert.strictEqual(practiceTypeLabel('notrump-game'), '3 no trump');
    assert.strictEqual(practiceTypeLabel('mixed'), 'Mixed');
    assert.strictEqual(partnerOf('east'), 'west');
});

test('pelaaja on pelinviejä jokaisella paikalla', () => {
    const south = parseDealString(PBN_1).south;
    for (const declarer of POSITIONS) {
        const practice = createPracticeState('major-game');
        const hands = pickPracticeDeal(practice, fakeBank(ENTRIES), declarer);
        assert.deepStrictEqual(hands[declarer], south, `pelinviejän käsi paikalla ${declarer}`);
        assert.strictEqual(practice.current.declarer, declarer);
        const contract = practiceContract(practice.current);
        assert.deepStrictEqual(contract, {
            contract: '4S', declarer, dummy: partnerOf(declarer), trumpSuit: 'spades'
        });
    }
});

test('pelatut jaot jätetään pois, ja kierros alkaa alusta, kun kaikki on pelattu', () => {
    const practice = createPracticeState('major-game');
    const bank = fakeBank(ENTRIES);
    pickPracticeDeal(practice, bank, 'south');
    assert.strictEqual(practice.current.id, 'major-game-0001');
    pickPracticeDeal(practice, bank, 'south');
    assert.strictEqual(practice.current.id, 'major-game-0002');
    assert.strictEqual(practice.current.contract, '4H');
    assert.deepStrictEqual(practice.playedIds, ['major-game-0001', 'major-game-0002']);
    pickPracticeDeal(practice, bank, 'south');
    assert.strictEqual(practice.current.id, 'major-game-0001');
    assert.deepStrictEqual(practice.playedIds, ['major-game-0001']);
});

test('tyhjä pankki on virhe', () => {
    assert.throws(() => pickPracticeDeal(createPracticeState('slam'), fakeBank([]), 'south'), /No practice deals/);
});

test('tulos ja tilastot; uusinta ei kasvata tilastoja', () => {
    const practice = createPracticeState('major-game');
    pickPracticeDeal(practice, fakeBank(ENTRIES), 'west');

    const made = recordPracticeResult(practice, 10, false);
    assert.deepStrictEqual(made, {
        made: true, actualTricks: 10, ddTricks: 10, contract: '4S',
        label: '4 hearts or 4 spades', note: 'Draw trumps first.', stats: { played: 1, made: 1 }
    });
    assert.strictEqual(recordPracticeResult(practice, 9, false).made, false);
    assert.deepStrictEqual(practice.stats, { played: 2, made: 1 });

    const replay = recordPracticeResult(practice, 11, true);
    assert.strictEqual(replay.made, true);
    assert.deepStrictEqual(replay.stats, { played: 2, made: 1 });
    assert.deepStrictEqual(practice.stats, { played: 2, made: 1 });
});

test('pelaajille lähtevä tieto ei paljasta jakoa eikä vihjettä', () => {
    const practice = createPracticeState('major-game');
    assert.deepStrictEqual(practicePublic(practice).current, null);
    pickPracticeDeal(practice, fakeBank(ENTRIES), 'north');
    const sent = practicePublic(practice);
    assert.deepStrictEqual(sent, {
        specId: 'major-game', label: '4 hearts or 4 spades', stats: { played: 0, made: 0 },
        current: { contract: '4S', declarer: 'north', label: '4 hearts or 4 spades' }
    });
    const text = JSON.stringify(sent);
    for (const secret of ['pbn', 'hands', 'note', 'ddTricks', formatDealString(parseDealString(PBN_1)).slice(2, 12)]) {
        assert.ok(!text.includes(secret), `vuoto: ${secret}`);
    }
    assert.strictEqual(practicePublic(null), null);
});
