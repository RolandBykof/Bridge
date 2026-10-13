'use strict';
// PBN-jakosetin luku ja tallennustiedoston kirjoitus (lib/pbn.js), ks. jaot.html.
const test = require('node:test');
const assert = require('node:assert');
const { parseDealString, formatDealString } = require('./deal');
const Pbn = require('./pbn');

const DEAL_A = 'N:AQ86.K73.J5.AT94 T73.Q862.K94.J65 KJ9.AJ4.AQ86.K82 542.T95.T732.Q73';
const DEAL_B = 'N:542.T95.T732.Q73 AQ86.K73.J5.AT94 T73.Q862.K94.J65 KJ9.AJ4.AQ86.K82';

test('kiertofunktiot: jakaja ja vaaratilanne jaon numerosta', () => {
    assert.deepStrictEqual([1, 2, 3, 4, 5].map(Pbn.dealerForBoard), ['north', 'east', 'south', 'west', 'north']);
    assert.deepStrictEqual([1, 2, 3, 4, 16, 17].map(Pbn.vulnerabilityForBoard), ['None', 'NS', 'EW', 'Both', 'EW', 'None']);
    assert.strictEqual(Pbn.vulnerabilityForBoard(0), 'None');
});

test('monen jaon PBN: Board, Dealer, Vulnerable ja #-periytyminen', () => {
    const text = [
        '[Event "Kerhoilta"]',
        '[Board "7"]',
        '[Dealer "S"]',
        '[Vulnerable "Both"]',
        `[Deal "${DEAL_A}"]`,
        '',
        '[Event "#"]',
        '[Board "8"]',
        '[Dealer "#"]',
        '[Vulnerable "#"]',
        `[Deal "${DEAL_B}"]`,
        ''
    ].join('\n');
    const { deals, skipped, hadPlayedDeals } = Pbn.parsePbn(text);
    assert.strictEqual(skipped.length, 0);
    assert.strictEqual(hadPlayedDeals, false);
    assert.deepStrictEqual(deals.map(d => [d.board, d.dealer, d.vulnerable]), [[7, 'south', 'Both'], [8, 'south', 'Both']]);
    assert.deepStrictEqual(deals[0].hands, parseDealString(DEAL_A));
    assert.deepStrictEqual(deals[1].hands, parseDealString(DEAL_B));
});

test('puuttuvat Dealer ja Vulnerable johdetaan jaon numerosta', () => {
    const text = `[Board "2"]\n[Deal "${DEAL_A}"]\n\n[Board "4"]\n[Deal "${DEAL_B}"]\n`;
    const { deals } = Pbn.parsePbn(text);
    assert.deepStrictEqual(deals.map(d => [d.board, d.dealer, d.vulnerable]), [[2, 'east', 'NS'], [4, 'west', 'Both']]);
});

test('vaaratilanteen kirjoitusasut', () => {
    assert.deepStrictEqual(
        ['None', 'Love', '-', 'NS', 'EW', 'All', 'Both', 'both', 'outo'].map(Pbn.normalizeVulnerable),
        ['None', 'None', 'None', 'NS', 'EW', 'Both', 'Both', 'Both', null]
    );
});

test('viallinen jako ohitetaan jaon numerolla ja syyllä, muut ladataan', () => {
    const twelveCards = 'N:AQ8.K73.J5.AT94 T73.Q862.K94.J65 KJ9.AJ4.AQ86.K82 542.T95.T732.Q736';
    const twice = 'N:AQ86.K73.J5.AT94 AQ86.Q862.K94.J65 KJ9.AJ4.AQ86.K82 542.T95.T732.Q73';
    const text = [
        `[Board "1"]\n[Deal "${DEAL_A}"]`,
        `[Board "2"]\n[Deal "${twelveCards}"]`,
        `[Board "3"]\n[Deal "${twice}"]`,
        '[Board "4"]\n[Dealer "W"]'
    ].join('\n\n');
    const { deals, skipped } = Pbn.parsePbn(text);
    assert.deepStrictEqual(deals.map(d => d.board), [1]);
    assert.deepStrictEqual(skipped.map(s => s.board), [2, 3, 4]);
    assert.match(skipped[0].reason, /north has 12 cards, expected 13/);
    assert.match(skipped[1].reason, /Card appears twice/);
    assert.strictEqual(skipped[2].reason, 'no Deal tag');
});

test('pelkät jakorivit ilman tageja: jakaja ja vaaratilanne järjestysnumerosta', () => {
    const text = `Harjoitusjaot\n${DEAL_A}\n\n  e:${DEAL_B.slice(2)}\nmuuta tekstiä\n`;
    const { deals, skipped } = Pbn.parsePbn(text);
    assert.strictEqual(skipped.length, 0);
    assert.deepStrictEqual(deals.map(d => [d.board, d.dealer, d.vulnerable]), [[1, 'north', 'None'], [2, 'east', 'NS']]);
    // E: aloittaa idästä, joten pohjoisen käsi on rivin viimeinen.
    assert.deepStrictEqual(deals[1].hands.north, parseDealString(DEAL_B).west);
});

test('tarjoukset, pelatut kortit ja tulos ohitetaan, mutta niiden olemassaolo kerrotaan', () => {
    const text = [
        '% PBN 2.1',
        '; kommenttirivi',
        '[Event "Kerho"]',
        '[Board "1"]',
        '[Dealer "N"]',
        '[Vulnerable "None"]',
        `[Deal "${DEAL_A}"]`,
        '[Declarer "S"]',
        '[Contract "7NTXX"]',
        '[Result "13"]',
        '[Auction "N"]',
        '1NT Pass 3NT Pass {selitys, jossa [Board "99"] ja tyhjä',
        '',
        'rivi kommentin sisällä}',
        '7NT =1= X XX',
        '[Note "1:vahva"]',
        'Pass Pass Pass',
        '[Note "2:toinen huomautus"]',
        '[Play "E"]',
        'S2 SA S3 SJ',
        'H3 HQ HA H5',
        '*',
        '[OptimumResultTable "Declarer;Denomination\\2R;Result\\2R"]',
        'N NT 9',
        'S NT 9',
        '',
        '[Board "2"]',
        `[Deal "${DEAL_B}"]`
    ].join('\r\n');
    const { deals, skipped, hadPlayedDeals } = Pbn.parsePbn(text);
    assert.strictEqual(skipped.length, 0);
    assert.strictEqual(hadPlayedDeals, true);
    assert.deepStrictEqual(deals.map(d => d.board), [1, 2]);
    // Jaossa on vain kädet, jakaja, vaaratilanne ja numero.
    assert.deepStrictEqual(Object.keys(deals[0]).sort(), ['board', 'dealer', 'hands', 'vulnerable']);
});

test('jaot ilman tyhjää riviä välissä erotetaan toistuvasta Board- tai Deal-tagista', () => {
    const text = `[Board "1"]\n[Deal "${DEAL_A}"]\n[Board "2"]\n[Deal "${DEAL_B}"]\n`;
    assert.deepStrictEqual(Pbn.parsePbn(text).deals.map(d => d.board), [1, 2]);
});

test('enimmäismäärä: ylimääräiset jaot jätetään pois ja siitä kerrotaan', () => {
    const text = [1, 2, 3].map(n => `[Board "${n}"]\n[Deal "${DEAL_A}"]`).join('\n\n');
    const result = Pbn.parsePbn(text, { maxDeals: 2 });
    assert.deepStrictEqual(result.deals.map(d => d.board), [1, 2]);
    assert.strictEqual(result.truncated, true);
});

test('tyhjä ja jakoja sisältämätön teksti antaa tyhjän tuloksen', () => {
    assert.deepStrictEqual(Pbn.parsePbn('').deals, []);
    assert.deepStrictEqual(Pbn.parsePbn('[Event "Pelkkä otsikko"]\n').deals, []);
    assert.deepStrictEqual(Pbn.parsePbn(undefined).deals, []);
});

function sampleRecord(overrides = {}) {
    const hands = parseDealString(DEAL_A);
    // Etelä pelaa 3NT, lännen avaus; kaksi tikkiä pelattu eri järjestyksessä.
    return {
        event: 'AccessibleBridge, table 4821',
        site: 'AccessibleBridge',
        date: new Date(2026, 9, 13),
        board: 7,
        dealer: 'south',
        vulnerable: 'Both',
        hands,
        players: { north: 'Anna', east: 'Robot', south: 'Pekka "P" \\', west: 'Robot' },
        auction: ['1N', 'P', '3N', 'P', 'P', 'P'].map((bid, i) => ({ player: ['south', 'west', 'north', 'east'][i % 4], bid })),
        contract: '3N',
        declarer: 'south',
        declarerTricks: 10,
        openingLeader: 'west',
        playedCards: [
            { player: 'west', suit: 'spades', card: '2' },
            { player: 'north', suit: 'spades', card: 'A' },
            { player: 'east', suit: 'spades', card: '3' },
            { player: 'south', suit: 'spades', card: 'J' },
            // Toisen tikin aloittaa pohjoinen, mutta sarakkeet pysyvät lännestä alkaen.
            { player: 'north', suit: 'hearts', card: '3' },
            { player: 'east', suit: 'hearts', card: 'Q' },
            { player: 'south', suit: 'hearts', card: 'A' },
            { player: 'west', suit: 'hearts', card: '10' }
        ],
        ...overrides
    };
}

test('formatPbn: tagit, tarjoukset neljän ryhmissä, Play-sarakkeet ja escapoidut nimet', () => {
    const text = Pbn.formatPbn(sampleRecord());
    const lines = text.split('\r\n');
    assert.ok(lines.includes('[Date "2026.10.13"]'));
    assert.ok(lines.includes('[Board "7"]'));
    assert.ok(lines.includes('[Dealer "S"]'));
    assert.ok(lines.includes('[Vulnerable "Both"]'));
    assert.ok(lines.includes(`[Deal "${formatDealString(parseDealString(DEAL_A))}"]`));
    assert.ok(lines.includes('[South "Pekka \\"P\\" \\\\"]'));
    assert.ok(lines.includes('[Declarer "S"]'));
    assert.ok(lines.includes('[Contract "3NT"]'));
    assert.ok(lines.includes('[Result "10"]'));
    const auction = lines.indexOf('[Auction "S"]');
    assert.deepStrictEqual(lines.slice(auction + 1, auction + 3), ['1NT Pass 3NT Pass', 'Pass Pass']);
    const play = lines.indexOf('[Play "W"]');
    assert.deepStrictEqual(lines.slice(play + 1, play + 3), ['S2 SA S3 SJ', 'HT H3 HQ HA']);
});

test('formatPbn: kahdennettu sopimus ja jako ilman tarjouksia (minibridge, harjoitus)', () => {
    assert.strictEqual(Pbn.formatContract('4SX'), '4SX');
    assert.strictEqual(Pbn.formatContract('2NXX'), '2NTXX');
    assert.deepStrictEqual(['P', 'X', 'XX', '1N', '7C'].map(Pbn.formatCall), ['Pass', 'X', 'XX', '1NT', '7C']);
    const text = Pbn.formatPbn(sampleRecord({ auction: null }));
    assert.ok(!text.includes('[Auction'));
    assert.ok(text.includes('[Play "W"]'));
});

test('edestakainen muunnos säilyttää kädet, jakajan ja vaaratilanteen, ei tarjouksia', () => {
    const record = sampleRecord();
    const { deals, hadPlayedDeals } = Pbn.parsePbn(Pbn.formatPbn(record));
    assert.strictEqual(deals.length, 1);
    assert.strictEqual(hadPlayedDeals, true);
    assert.deepStrictEqual(deals[0], { board: 7, dealer: 'south', vulnerable: 'Both', hands: record.hands });
});
