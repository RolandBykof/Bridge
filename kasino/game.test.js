'use strict';
// Kasinon sääntöjen ja pelilogiikan testit.
const test = require('node:test');
const assert = require('node:assert');
const { Game, GameError } = require('./game.js');
const {
    handValue, tableValue, bestCapture, summarizePile, pilePoints
} = require('../public/kasino/js/saannot.js');

const SUIT = { S: 'spades', H: 'hearts', D: 'diamonds', C: 'clubs' };
// 'S2' → { suit: 'spades', rank: '2' }, 'D10' → ruutu 10.
const c = text => ({ suit: SUIT[text[0]], rank: text.slice(1) });
const cards = list => list.split(' ').map(c);
const names = list => list.map(x => `${x.suit[0].toUpperCase()}${x.rank}`).sort().join(' ');
const id = card => `${card.suit}-${card.rank}`;

// Siemenellinen satunnaislukugeneraattori (mulberry32).
function seeded(seed) {
    return function () {
        seed |= 0;
        seed = (seed + 0x6D2B79F5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function players(n) {
    return Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `Pelaaja ${i}` }));
}

// Asettaa pelin tilan käsin: kädet, pöytä ja pakka.
function setup(game, { hands, table, deck = [] }) {
    game.players.forEach((p, i) => { p.hand = cards(hands[i]); });
    game.table = table ? cards(table) : [];
    game.deck = deck.length ? cards(deck) : [];
    game.current = 0;
}

// ===== Säännöt =====

test('käsi- ja pöytäarvot', () => {
    assert.strictEqual(handValue(c('HA')), 14);
    assert.strictEqual(tableValue(c('HA')), 1);
    assert.strictEqual(handValue(c('S2')), 15);
    assert.strictEqual(tableValue(c('S2')), 2);
    assert.strictEqual(handValue(c('H2')), 2);
    assert.strictEqual(handValue(c('D10')), 16);
    assert.strictEqual(tableValue(c('D10')), 10);
    assert.strictEqual(handValue(c('C10')), 10);
    assert.strictEqual(handValue(c('CJ')), 11);
    assert.strictEqual(handValue(c('CK')), 13);
});

test('otto: samanarvoiset ja summat erillisinä ryhminä', () => {
    const table = cards('CA S3 H3 D8 CJ');
    const jack = bestCapture(c('HJ'), table);
    assert.strictEqual(names(jack.cards), 'CJ D8 S3');      // pata 3 hertta 3:n sijaan
    assert.strictEqual(jack.groups.length, 2);
    const small = bestCapture(c('S2'), table);
    assert.strictEqual(names(small.cards), 'CA D8 H3 S3');   // 4 korttia voittaa 3 kortin oton
});

test('ässä ottaa vain summan 14, ei pöydän ässää', () => {
    assert.strictEqual(bestCapture(c('HA'), cards('CA')), null);
    assert.strictEqual(names(bestCapture(c('HA'), cards('CA CK')).cards), 'CA CK');
    assert.strictEqual(names(bestCapture(c('HA'), cards('CA D9 H5')).cards), 'D9 H5');
});

test('patakakkonen ei ota kakkosta eikä ruutukymppi kymppiä', () => {
    assert.strictEqual(bestCapture(c('S2'), cards('H2')), null);
    assert.strictEqual(bestCapture(c('D10'), cards('H10')), null);
    assert.strictEqual(names(bestCapture(c('D10'), cards('H10 C6')).cards), 'C6 H10');
    assert.strictEqual(names(bestCapture(c('H10'), cards('D10 C4')).cards), 'D10');
});

test('tasaotoissa pisteet ratkaisevat', () => {
    // Molemmat 2 korttia; ruutukymppi (2 p) voittaa.
    const capture = bestCapture(c('CQ'), cards('D10 H2 C10 S2'));
    assert.ok(capture.cards.some(x => x.suit === 'diamonds' && x.rank === '10'));
});

test('pinon yhteenveto ja pisteet', () => {
    const summary = summarizePile(cards('SA HA S2 D10 S5 C3'));
    assert.deepStrictEqual(summary, { cards: 6, spades: 3, aces: 2, smallCasino: true, bigCasino: true });
    assert.strictEqual(pilePoints(summary), 5);
});

// ===== Pelilogiikka =====

test('jako 2–4 pelaajalle ja oikea määrä käsiä', () => {
    for (const [n, hands] of [[2, 6], [3, 4], [4, 3]]) {
        const game = new Game(players(n), { rng: seeded(n), dealerIndex: 0 });
        assert.strictEqual(game.table.length, 4);
        assert.ok(game.players.every(p => p.hand.length === 4));
        assert.strictEqual(game.deck.length, 52 - 4 - 4 * n);
        assert.strictEqual(game.players[game.current].id, 'p1');    // etukäsi
        let deals = 1;
        while (game.phase === 'play') {
            const p = game.players[game.current];
            const events = game.lay(p.id, id(p.hand[0]));
            if (events.some(e => e.type === 'deal')) deals++;
        }
        assert.strictEqual(deals, hands, `${n} pelaajaa`);
    }
});

test('väärä vuoro, puuttuva kortti ja tyhjä otto hylätään', () => {
    const game = new Game(players(2), { rng: seeded(1), dealerIndex: 1 });
    setup(game, { hands: ['H5 C9', 'S7 D3'], table: 'C4', deck: 'H6 H7 H8 H9 HJ HQ HK D2' });
    assert.throws(() => game.lay('p1', 'spades-7'), /Ei ole sinun vuorosi/);
    assert.throws(() => game.lay('p0', 'spades-7'), /Sinulla ei ole/);
    assert.throws(() => game.take('p0', 'hearts-5'), /ei saa pöydästä mitään/);
    assert.throws(() => game.take('p0', 'hearts-5'), GameError);
});

test('lyönti sallitaan, vaikka kortilla voisi ottaa', () => {
    const game = new Game(players(2), { rng: seeded(1), dealerIndex: 1 });
    setup(game, { hands: ['C4 C9', 'S7 D3'], table: 'H4', deck: 'H6 H7 H8 H9 HJ HQ HK D2' });
    game.lay('p0', 'clubs-4');
    assert.strictEqual(game.table.length, 2);
    assert.strictEqual(game.players[game.current].id, 'p1');
});

test('mökki ja viimeisen käden mökit', () => {
    const game = new Game(players(2), { rng: seeded(1), dealerIndex: 1 });
    setup(game, { hands: ['C4 H9', 'S4 D9'], table: 'H4', deck: 'H6 H7 H8 H10 HJ HQ HK D2' });
    const [made] = game.take('p0', 'clubs-4');
    assert.strictEqual(made.cabin, 'made');
    assert.strictEqual(game.players[0].cabins, 1);
    game.lay('p1', 'spades-4');
    game.lay('p0', 'hearts-9');
    const [take] = game.take('p1', 'diamonds-9');                // pöytä: S4 H9 → 9 vie H9, S4 jää
    assert.strictEqual(take.cabin, null);
    assert.strictEqual(game.players[0].cabins, 1);

    // Uudet kortit jaettiin; pakka on nyt tyhjä.
    assert.strictEqual(game.lastHand, true);
    setup(game, { hands: ['C2 C3', 'D4 S6'], table: 'H4' });
    game.current = 1;
    const [knock] = game.take('p1', 'diamonds-4');
    assert.strictEqual(knock.cabin, 'ignored');                  // viimeinen käsi: ei mökkiä
    assert.strictEqual(game.players[0].cabins, 1);
});

test('kaksinpelissä uusi mökki kaataa vastustajan mökin', () => {
    const game = new Game(players(2), { rng: seeded(1), dealerIndex: 1 });
    setup(game, { hands: ['C4 H9', 'S6 D9'], table: 'H4', deck: 'H6 H7 H8 H10 HJ HQ HK D2' });
    game.take('p0', 'clubs-4');                                  // p0 mökki
    assert.strictEqual(game.players[0].cabins, 1);
    game.table = cards('H6');
    const [knock] = game.take('p1', 'spades-6');                 // p1 tyhjentää pöydän
    assert.strictEqual(knock.cabin, 'knocked');
    assert.strictEqual(knock.knockedId, 'p0');
    assert.strictEqual(game.players[0].cabins, 0);
    assert.strictEqual(game.players[1].cabins, 0);
});

test('kolmella pelaajalla mökki ei kaadu', () => {
    const game = new Game(players(3), { rng: seeded(1), dealerIndex: 2 });
    setup(game, {
        hands: ['C4 H9', 'S5 D9', 'H5 C2'], table: 'H4',
        deck: 'H6 H7 H8 H10 HJ HQ HK D2 D3 D4 D5 D6'
    });
    game.take('p0', 'clubs-4');
    game.lay('p1', 'spades-5');
    const [take] = game.take('p2', 'hearts-5');
    assert.strictEqual(take.cabin, 'made');
    assert.strictEqual(game.players[0].cabins, 1);
    assert.strictEqual(game.players[2].cabins, 1);
});

test('pöydän loput viimeksi ottaneelle ja pisteet', () => {
    const game = new Game(players(2), { rng: seeded(1), dealerIndex: 1 });
    setup(game, { hands: ['C5', 'D8'], table: 'H5 S3 SA' });
    game.players[0].pile = cards('S4 S5 S6 S7 S8 S9 SJ D10 HA');
    game.players[1].pile = cards('H2 H3');
    game.take('p0', 'clubs-5');                                  // vie H5, pöytään jää S3 SA
    const events = game.lay('p1', 'diamonds-8');
    const sweep = events.find(e => e.type === 'sweep');
    assert.strictEqual(sweep.playerId, 'p0');
    assert.strictEqual(names(sweep.cards), 'D8 S3 SA');
    const over = events.find(e => e.type === 'round-over');
    const [r0, r1] = over.results;
    // p0: 14 korttia, 9 pataa, HA SA = 2 ässää, ♦10 = 2 → 1 + 2 + 2 + 2 = 7.
    assert.strictEqual(r0.cards, 14);
    assert.strictEqual(r0.spades, 9);
    assert.strictEqual(r0.points, 7);
    assert.strictEqual(r1.points, 0);
    assert.strictEqual(game.phase, 'round-over');
});

test('tasan mennyt korttivoitto siirtyy seuraavaan jakoon', () => {
    const game = new Game(players(2), { rng: seeded(1), dealerIndex: 1 });
    setup(game, { hands: ['C5', 'D8'], table: 'H5' });
    game.players[0].pile = cards('H2 H3');
    game.players[1].pile = cards('H4 H6 H7');
    game.take('p0', 'clubs-5');                                  // p0: 4 korttia
    const events = game.lay('p1', 'diamonds-8');                 // D8 jää: ei ottajaa sen jälkeen → p0
    const over = events.find(e => e.type === 'round-over');
    assert.strictEqual(over.cardWinner.id, 'p0');                // 5 vs 3
    const game2 = new Game(players(2), { rng: seeded(2), dealerIndex: 1 });
    setup(game2, { hands: ['C5', 'D8'], table: 'H5' });
    game2.players[0].pile = cards('H2');
    game2.players[1].pile = cards('H4 H6 H7 H9');
    game2.take('p0', 'clubs-5');                                 // p0: 3, pöytään jää ei mitään
    const over2 = game2.lay('p1', 'diamonds-8').find(e => e.type === 'round-over');
    // p0 vie D8 viimeksi ottaneena: 4 vs 4 → tasan.
    assert.strictEqual(over2.cardWinner, null);
    assert.strictEqual(game2.carry.cards, 1);
    assert.strictEqual(over2.spadeWinner, null);                 // 0 vs 0 pataa
    assert.strictEqual(game2.carry.spades, 2);
});

test('peli päättyy jaon lopussa 16 pisteeseen ja jakaja kiertää', () => {
    const game = new Game(players(2), { rng: seeded(1), dealerIndex: 0 });
    game.players[0].score = 15;
    setup(game, { hands: ['C5', 'D8'], table: 'H5' });
    game.players[0].pile = cards('S3 S4 S6 S7 S8 S9');          // 6 pataa: patavoitto ei vielä varma
    game.take('p0', 'clubs-5');
    assert.strictEqual(game.phase, 'play');
    const events = game.lay('p1', 'diamonds-8');
    assert.ok(events.some(e => e.type === 'over'));
    assert.deepStrictEqual(game.winnerIds, ['p0']);

    const next = new Game(players(2), { rng: seeded(3), dealerIndex: 0 });
    setup(next, { hands: ['C5', 'D8'], table: 'H5' });
    next.take('p0', 'clubs-5');
    next.lay('p1', 'diamonds-8');
    assert.strictEqual(next.phase, 'round-over');
    assert.throws(() => next.lay('p0', 'clubs-5'), /Kortteja ei nyt pelata/);
    const [start] = next.nextRound('p0');
    assert.strictEqual(start.type, 'round-start');
    assert.strictEqual(start.dealerId, 'p1');
    assert.strictEqual(next.players[next.current].id, 'p0');
});

test('peli päättyy kesken jaon, kun 16 pistettä on varmaa', () => {
    const game = new Game(players(3), { rng: seeded(1), dealerIndex: 2 });
    game.players[0].score = 14;
    setup(game, { hands: ['CQ C2', 'H3 H4', 'H6 H7'], table: 'DA HJ', deck: 'S2 S3 S4 S5 S6 S7 S8 S9 S10 SJ SQ SK' });
    game.players[0].pile = cards('SA');                          // 1 p → 15
    const events = game.take('p0', 'clubs-Q');                   // DA + HJ = 12: ässä → 16
    const over = events.find(e => e.type === 'over');
    assert.ok(over && over.early);
    assert.deepStrictEqual(over.winnerIds, ['p0']);
    assert.strictEqual(game.phase, 'over');
});

test('getView ja publicEvent eivät paljasta muiden kortteja', () => {
    const game = new Game(players(2), { rng: seeded(5), dealerIndex: 0 });
    const view = game.getView('p0');
    assert.strictEqual(view.hand.length, 4);
    assert.ok(!('deck' in view));
    assert.ok(view.players.every(p => !('hand' in p)));
    assert.deepStrictEqual(view.allowedActions, []);              // p1 aloittaa
    assert.deepStrictEqual(game.getView('p1').allowedActions, ['lay', 'take']);
    assert.strictEqual(game.getView(null).hand, null);

    const deal = { type: 'deal', deckCount: 0, lastHand: true, hands: [{ id: 'p0', cards: [c('H2')] }, { id: 'p1', cards: [c('H3')] }] };
    const seen = Game.publicEvent(deal, 'p0');
    assert.deepStrictEqual(seen.hand, [c('H2')]);
    assert.ok(!('hands' in seen));
    assert.strictEqual(Game.publicEvent(deal, 'x').hand, null);
});

test('tallennus: toProgress ja jatkaminen', () => {
    const game = new Game(players(3), { rng: seeded(4), dealerIndex: 1 });
    setup(game, { hands: ['C5', 'D8', 'H9'], table: 'H5' });
    game.take('p0', 'clubs-5');
    game.lay('p1', 'diamonds-8');
    game.lay('p2', 'hearts-9');
    assert.strictEqual(game.phase, 'round-over');
    const progress = game.toProgress();
    assert.strictEqual(progress.round, 2);
    assert.strictEqual(progress.dealer, 2);
    const resumed = new Game(players(3), { rng: seeded(9), progress });
    assert.strictEqual(resumed.round, 2);
    assert.strictEqual(resumed.dealer, 2);
    assert.deepStrictEqual(resumed.players.map(p => p.score), game.players.map(p => p.score));
    assert.deepStrictEqual(resumed.carry, game.carry);
    assert.throws(() => new Game(players(3), { progress: { round: 0 } }), /ei voitu lukea/);
});
