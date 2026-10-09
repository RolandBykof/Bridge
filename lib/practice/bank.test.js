const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseDealString, formatDealString } = require('../deal');
const solver = require('../bridge_solver_wasm');
const { parseContract, matchesConstraints, topTricks } = require('./constraints');
const { withinDd } = require('./generator');
const { getSpec } = require('./specs');
const { BANK_DIR, formatBankFile, readBankFile, loadBank, createBank } = require('./bank');

const PBN_1 = 'N:J98.QT83.K6.J853 Q762.AK.AJ9.Q962 AKT5.J976.T87.K4 43.542.Q5432.AT7';
const PBN_2 = 'N:AKT5.J976.T87.K4 43.542.Q5432.AT7 J98.QT83.K6.J853 Q762.AK.AJ9.Q962';
const PBN_3 = 'N:Q762.AK.AJ9.Q962 AKT5.J976.T87.K4 43.542.Q5432.AT7 J98.QT83.K6.J853';

const entry = (id, pbn, contract = '4S') => ({ id, pbn, contract, declarer: 'south', ddTricks: 10, note: null });

function tempBank(files) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'practice-bank-'));
    for (const [spec, deals] of Object.entries(files)) {
        fs.writeFileSync(path.join(dir, `${spec}.json`),
            formatBankFile({ spec, label: spec, generated: '2026-10-09', deals }));
    }
    return dir;
}

// Kiinteä "satunnaisluku", jolla valinta on ennustettava.
const first = () => 0;

test('pankkitiedosto on kelvollista JSONia, yksi jako riviä kohden', () => {
    const data = { spec: 'major-game', label: '4 hearts or 4 spades', generated: '2026-10-09',
        deals: [entry('major-game-0001', PBN_1), entry('major-game-0002', PBN_2)] };
    const text = formatBankFile(data);
    assert.deepStrictEqual(JSON.parse(text), data);
    assert.strictEqual(text.split('\n').filter(line => line.includes('"pbn"')).length, 2);
    assert.deepStrictEqual(JSON.parse(formatBankFile({ ...data, deals: [] })).deals, []);
});

test('pankki ohittaa rikkinäiset jaot ja varoittaa', () => {
    const dir = tempBank({
        'major-game': [entry('a', PBN_1), entry('b', 'N:J98.QT83'), { ...entry('c', PBN_2), ddTricks: 14 }]
    });
    fs.writeFileSync(path.join(dir, 'broken.json'), '{ not json');
    const warnings = [];
    const bank = loadBank(dir, { warn: (message) => warnings.push(message) });
    assert.deepStrictEqual(bank['major-game'].map(e => e.id), ['a']);
    assert.strictEqual(warnings.length, 3);
});

test('pickDeal jättää pelatut jaot pois ja aloittaa alusta, kun kaikki on pelattu', () => {
    const dir = tempBank({ 'major-game': [entry('a', PBN_1), entry('b', PBN_2)] });
    const bank = createBank(dir);

    const deal = bank.pickDeal('major-game', ['a'], first);
    assert.strictEqual(deal.id, 'b');
    assert.strictEqual(deal.spec, 'major-game');
    assert.strictEqual(deal.recycled, false);
    assert.strictEqual(formatDealString(deal.hands), PBN_2);

    const again = bank.pickDeal('major-game', ['a', 'b'], first);
    assert.strictEqual(again.id, 'a');
    assert.strictEqual(again.recycled, true);
});

test('mixed valitsee kaikista tyypeistä ja tuntematon tyyppi palauttaa null', () => {
    const dir = tempBank({
        'major-game': [entry('m1', PBN_1)],
        'notrump-game': [entry('n1', PBN_2, '3N'), entry('n2', PBN_3, '3N')]
    });
    const bank = createBank(dir);
    const ids = new Set();
    for (const r of [0, 0.4, 0.9]) ids.add(bank.pickDeal('mixed', [], () => r).id);
    assert.deepStrictEqual([...ids].sort(), ['m1', 'n1', 'n2']);
    assert.strictEqual(bank.pickDeal('mixed', ['m1', 'n1'], first).id, 'n2');
    assert.strictEqual(bank.count('mixed'), 3);
    assert.strictEqual(bank.pickDeal('slam'), null);
    assert.strictEqual(createBank(path.join(dir, 'missing')).pickDeal('mixed'), null);
});

// Versionhallinnassa olevan pankin tarkistus: jokainen jako on ehjä, täyttää
// tyyppinsä ehdot ja tikkimäärä vastaa ratkaisijaa.
test('jakopankin jokainen jako on kelvollinen', async () => {
    if (!fs.existsSync(BANK_DIR)) return;
    const files = fs.readdirSync(BANK_DIR).filter(name => name.endsWith('.json'));
    for (const name of files) {
        const data = readBankFile(path.join(BANK_DIR, name));
        const spec = getSpec(data.spec);
        assert.ok(spec, `${name}: tuntematon tyyppi ${data.spec}`);
        assert.strictEqual(name, `${spec.id}.json`);
        const ids = new Set();
        const pbns = new Set();
        for (const deal of data.deals) {
            assert.ok(!ids.has(deal.id), `${name}: tunniste ${deal.id} kahdesti`);
            ids.add(deal.id);
            const hands = parseDealString(deal.pbn); // 52 eri korttia, 13 kullakin
            const pbn = formatDealString(hands);
            assert.ok(!pbns.has(pbn), `${name}: jako ${deal.id} kahdesti`);
            pbns.add(pbn);

            const contract = parseContract(deal.contract);
            assert.ok(spec.contracts.includes(contract.text), `${deal.id}: sopimus ${deal.contract}`);
            assert.ok(matchesConstraints(hands, spec, contract, deal.declarer), `${deal.id}: ehdot`);
            assert.ok(topTricks(hands, deal.declarer) < contract.required, `${deal.id}: varmat tikit`);
            assert.ok(withinDd(deal.ddTricks, spec.dd, contract), `${deal.id}: ddTricks`);
            assert.strictEqual(await solver.declarerTricks(hands, contract.trump, deal.declarer), deal.ddTricks,
                `${deal.id}: ratkaisija`);
        }
    }
});
