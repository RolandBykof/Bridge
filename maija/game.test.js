'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { Game, GameError, canBeat, bestDefense } = require('./game.js');
const { cardId, isMaija } = require('../public/maija/js/kortit.js');

// Toistettava satunnaislukugeneraattori testejä varten.
function mulberry32(seed) {
    return function () {
        seed |= 0; seed = seed + 0x6D2B79F5 | 0;
        let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

const c = (suit, rank) => ({ suit, rank });
const ids = cards => cards.map(cardId);
const PLAYERS3 = [{ id: 'a', name: 'Anna' }, { id: 'b', name: 'Kalle' }, { id: 'c', name: 'Liisa' }];

// Peli, jonka kädet, pakka ja valtti asetetaan testiä varten.
function setupGame({ hands, deck = [], trump = 'hearts', attacker = 0, players = PLAYERS3 }) {
    const game = new Game(players, { rng: mulberry32(1), dealerIndex: 0 });
    game.players.forEach((p, i) => { p.hand = hands[i].slice(); });
    game.deck = deck.slice();
    game.trump = trump;
    game.trumpCard = c(trump, '6');
    game.attacker = attacker;
    game.defender = game.nextActive(attacker);
    return game;
}

function totalCards(game) {
    return game.players.reduce((sum, p) => sum + p.hand.length, 0)
        + game.deck.length + game.table.length + game.discardCount;
}

test('valtti kaataa muun maan kortin, muu maa ei', () => {
    assert.ok(canBeat(c('clubs', 'A'), c('hearts', '2'), 'hearts'));
    assert.ok(!canBeat(c('clubs', '2'), c('diamonds', 'A'), 'hearts'));
});

test('saman maan korkeampi kaataa, matalampi ei', () => {
    assert.ok(canBeat(c('clubs', '7'), c('clubs', '8'), 'hearts'));
    assert.ok(!canBeat(c('clubs', '8'), c('clubs', '7'), 'hearts'));
    assert.ok(!canBeat(c('clubs', '8'), c('clubs', '8'), 'hearts'));
});

test('valtin kaataa vain korkeampi valtti', () => {
    assert.ok(canBeat(c('hearts', '9'), c('hearts', '10'), 'hearts'));
    assert.ok(!canBeat(c('hearts', '9'), c('hearts', '3'), 'hearts'));
    assert.ok(!canBeat(c('hearts', '2'), c('clubs', 'A'), 'hearts'));
});

test('Musta Maijaa ei voi kaataa eikä sillä voi kaataa', () => {
    assert.ok(!canBeat(c('spades', 'Q'), c('spades', 'A'), 'hearts'));
    assert.ok(!canBeat(c('spades', 'Q'), c('hearts', 'A'), 'hearts'));
    assert.ok(!canBeat(c('spades', '2'), c('spades', 'Q'), 'hearts'));
});

test('paritus löytää kaadon, jonka ahne haku hukkaisi', () => {
    // Vanha käsittelijä käytti risti 3:n (valtti) hertta 5:een, jolloin pata 8 jäi kaatamatta.
    const attacks = [c('hearts', '5'), c('spades', '8')];
    const defenses = [c('clubs', '3'), c('hearts', '9')];
    const assign = bestDefense(attacks, defenses, 'clubs');
    assert.deepStrictEqual(assign, [1, 0]);
});

test('paritus säästää valtin, kun sama määrä kaatuu ilmankin', () => {
    const attacks = [c('diamonds', '4')];
    const defenses = [c('hearts', 'A'), c('diamonds', '5')];
    assert.deepStrictEqual(bestDefense(attacks, defenses, 'hearts'), [1]);
});

test('valtti käännetään pakan pohjalta eikä se ole koskaan pata', () => {
    for (let seed = 1; seed <= 300; seed++) {
        const game = new Game(PLAYERS3, { rng: mulberry32(seed) });
        assert.notStrictEqual(game.trump, 'spades');
        assert.strictEqual(game.deck[0], game.trumpCard);
        assert.strictEqual(totalCards(game), 52);
        game.players.forEach(p => assert.strictEqual(p.hand.length, 5));
    }
});

test('jakajaa seuraava aloittaa ja jako alkaa jakajaa seuraavasta', () => {
    for (let dealer = 0; dealer < 3; dealer++) {
        const game = new Game(PLAYERS3, { rng: mulberry32(7), dealerIndex: dealer });
        assert.strictEqual(game.attacker, (dealer + 1) % 3);
        assert.strictEqual(game.getView(null).dealerId, PLAYERS3[dealer].id);
    }
    // Sama sekoitus: ensimmäinen jaettu kortti menee jakajaa seuraavalle.
    const a = new Game(PLAYERS3, { rng: mulberry32(9), dealerIndex: 0 });
    const b = new Game(PLAYERS3, { rng: mulberry32(9), dealerIndex: 1 });
    assert.deepStrictEqual(ids(a.players[1].hand), ids(b.players[2].hand));
    assert.deepStrictEqual(ids(a.players[0].hand), ids(b.players[1].hand), 'jakaja saa viimeiset kortit');
});

test('kaadottomat kierrokset lasketaan ja nollautuvat kaadosta', () => {
    const game = setupGame({
        hands: [[c('clubs', '2'), c('clubs', '3')], [c('diamonds', 'A'), c('clubs', '9')], [c('hearts', 'A'), c('diamonds', '2')]]
    });
    game.attack('a', ids([c('clubs', '2')]));
    game.defend('b', []);
    assert.strictEqual(game.noBeatRounds, 1);
    game.attack('c', ids([c('hearts', 'A')]));
    game.defend('a', []);
    assert.strictEqual(game.noBeatRounds, 2);
    game.attack('b', ids([c('clubs', '2')]));
    game.defend('c', []);
    game.attack('a', ids([c('clubs', '3')]));
    game.defend('b', ids([c('clubs', '9')]));
    assert.strictEqual(game.noBeatRounds, 0);
});

test('lyönnin pitää olla samaa maata', () => {
    const game = setupGame({ hands: [[c('clubs', '2'), c('diamonds', '3')], [c('clubs', 'A')], [c('clubs', 'K')]] });
    assert.throws(() => game.attack('a', ids([c('clubs', '2'), c('diamonds', '3')])), GameError);
});

test('lyödä saa enintään vastaanottajan korttimäärän', () => {
    const game = setupGame({
        hands: [[c('clubs', '2'), c('clubs', '3'), c('clubs', '4')], [c('diamonds', 'A'), c('diamonds', 'K')], [c('clubs', 'K')]]
    });
    assert.strictEqual(game.maxAttack(), 2);
    assert.throws(() => game.attack('a', ids([c('clubs', '2'), c('clubs', '3'), c('clubs', '4')])), /enintään 2/);
    game.attack('a', ids([c('clubs', '2'), c('clubs', '3')]));
    assert.strictEqual(game.phase, 'defend');
});

test('lyödä saa enintään viisi korttia', () => {
    const six = ['2', '3', '4', '5', '6', '7'].map(r => c('clubs', r));
    const game = setupGame({ hands: [six, six.map(x => c('diamonds', x.rank)), [c('hearts', 'A')]] });
    assert.strictEqual(game.maxAttack(), 5);
    assert.throws(() => game.attack('a', ids(six)), GameError);
});

test('väärä vuoro ja vieras kortti hylätään', () => {
    const game = setupGame({ hands: [[c('clubs', '2')], [c('clubs', 'A')], [c('clubs', 'K')]] });
    assert.throws(() => game.attack('b', ids([c('clubs', 'A')])), /Ei ole sinun vuorosi/);
    assert.throws(() => game.attack('a', ids([c('clubs', 'A')])), /ei ole kädessäsi/);
    assert.throws(() => game.defend('b', []), GameError);
});

test('lyöjä täydentää kätensä viiteen', () => {
    const deck = [c('diamonds', '2'), c('diamonds', '3'), c('diamonds', '4')];
    const game = setupGame({
        hands: [[c('clubs', '2'), c('clubs', '3'), c('clubs', '4'), c('clubs', '5'), c('clubs', '6')],
            [c('clubs', 'A'), c('clubs', 'K'), c('clubs', 'Q'), c('clubs', 'J'), c('clubs', '10')], [c('hearts', 'A')]],
        deck
    });
    game.attack('a', ids([c('clubs', '2'), c('clubs', '3')]));
    assert.strictEqual(game.players[0].hand.length, 5);
    assert.strictEqual(game.deck.length, 1);
});

test('kaikki kaatuu: kaataja täydentää käden ja lyö seuraavaksi', () => {
    const deck = ['2', '3', '4', '5', '6', '7', '8', '9'].map(r => c('diamonds', r));
    const game = setupGame({
        hands: [[c('clubs', '2'), c('clubs', '3'), c('diamonds', 'J')],
            [c('clubs', '9'), c('hearts', '2'), c('spades', '5')], [c('hearts', 'A')]],
        deck
    });
    game.attack('a', ids([c('clubs', '2'), c('clubs', '3')]));
    const events = game.defend('b', ids([c('clubs', '9'), c('hearts', '2')]));
    assert.ok(events[0].allBeaten);
    assert.strictEqual(game.players[1].hand.length, 5);
    assert.strictEqual(game.phase, 'attack');
    assert.strictEqual(game.players[game.attacker].id, 'b');
    assert.strictEqual(game.players[game.defender].id, 'c');
    assert.strictEqual(game.discardCount, 4);
});

test('osittainen kaato: loput nostetaan käteen ja lyöntivuoro siirtyy ohi', () => {
    const game = setupGame({
        hands: [[c('clubs', '2'), c('clubs', '3'), c('clubs', 'Q'), c('diamonds', 'J')],
            [c('clubs', '9'), c('diamonds', '3'), c('spades', '5')], [c('hearts', 'A')]]
    });
    game.attack('a', ids([c('clubs', '2'), c('clubs', '3'), c('clubs', 'Q')]));
    const [event] = game.defend('b', ids([c('clubs', '9'), c('diamonds', '3')]));
    assert.strictEqual(event.pairs.length, 1);
    assert.strictEqual(event.allBeaten, false);
    assert.deepStrictEqual(ids(event.pickedUp).sort(), ids([c('clubs', '3'), c('clubs', 'Q')]).sort());
    assert.deepStrictEqual(ids(event.unused), ids([c('diamonds', '3')]));
    const handIds = ids(game.players[1].hand);
    assert.ok(handIds.includes('diamonds-3'), 'kaatamaton valittu kortti jää käteen');
    assert.ok(handIds.includes('clubs-Q') && handIds.includes('clubs-3'));
    assert.ok(!handIds.includes('clubs-9'));
    assert.strictEqual(game.players[game.attacker].id, 'c');
    assert.strictEqual(game.players[game.defender].id, 'a');
});

test('tyhjä kaato nostaa kaikki pöydän kortit', () => {
    const game = setupGame({ hands: [[c('clubs', '2'), c('clubs', '3')], [c('diamonds', 'A'), c('diamonds', 'K')], [c('hearts', 'A')]] });
    game.attack('a', ids([c('clubs', '2'), c('clubs', '3')]));
    const [event] = game.defend('b', []);
    assert.strictEqual(event.pickedUp.length, 2);
    assert.strictEqual(game.players[1].hand.length, 4);
});

test('Musta Maija pitää aina nostaa', () => {
    const game = setupGame({ hands: [[c('spades', 'Q'), c('clubs', '3')], [c('spades', 'A'), c('hearts', 'A')], [c('hearts', 'K')]] });
    game.attack('a', ids([c('spades', 'Q')]));
    const [event] = game.defend('b', ids([c('spades', 'A'), c('hearts', 'A')]));
    assert.strictEqual(event.pairs.length, 0);
    assert.ok(game.players[1].hand.some(isMaija));
});

test('kaatajan käteen jääneitä kortteja ei paljasteta muille', () => {
    const game = setupGame({ hands: [[c('clubs', '2')], [c('diamonds', '3'), c('clubs', '9')], [c('hearts', 'A')]] });
    game.attack('a', ids([c('clubs', '2')]));
    game.defend('b', ids([c('clubs', '9'), c('diamonds', '3')]));
    assert.strictEqual(game.getView('b').lastTableEvent.unused.length, 1);
    assert.strictEqual(game.getView('a').lastTableEvent.unused.length, 0);
    assert.strictEqual(game.getView('a').hand.length, 0);
    assert.strictEqual(game.getView(null).hand, null);
});

test('pakasta nostetut kortit näkyvät vain nostajalle', () => {
    const game = setupGame({
        hands: [[c('clubs', '2')], [c('diamonds', '3'), c('clubs', '9')], [c('hearts', 'A')]],
        deck: [c('spades', '7'), c('spades', '8')]
    });
    const [event] = game.attack('a', ids([c('clubs', '2')]));
    assert.ok(event.drew > 0);
    assert.strictEqual(event.drawn.length, event.drew);
    assert.deepStrictEqual(Game.publicEvent(event, 'a').drawn, event.drawn);
    assert.deepStrictEqual(Game.publicEvent(event, 'b').drawn, []);
    assert.deepStrictEqual(Game.publicEvent(event, null).drawn, []);
});

test('pakan loputtua tyhjäkätinen pääsee pois ja viimeisestä tulee Maija', () => {
    const game = setupGame({
        hands: [[c('clubs', '2')], [c('clubs', '9'), c('spades', 'Q')], [c('diamonds', 'A')]]
    });
    let events = game.attack('a', ids([c('clubs', '2')]));
    assert.ok(events.some(e => e.type === 'out' && e.playerId === 'a' && e.place === 1));
    events = game.defend('b', ids([c('clubs', '9')]));
    assert.strictEqual(game.players[game.attacker].id, 'b');
    assert.strictEqual(game.players[game.defender].id, 'c', 'pois päässyt ohitetaan');
    events = game.attack('b', ids([c('spades', 'Q')]));
    assert.ok(events.some(e => e.type === 'out' && e.playerId === 'b'));
    events = game.defend('c', []);
    const over = events.find(e => e.type === 'over');
    assert.ok(over);
    assert.strictEqual(over.maijaId, 'c');
    assert.deepStrictEqual(over.ranking.map(r => r.id), ['a', 'b', 'c']);
    assert.strictEqual(game.phase, 'over');
});

// Satunnaiset botit pelaavat laillisia siirtoja. Korttien määrä pysyy samana,
// yksikään peli ei jää jumiin ja Maijalla on aina pata rouva.
function randomBotGame(seed, playerCount) {
    const rng = mulberry32(seed);
    const players = Array.from({ length: playerCount }, (_, i) => ({ id: `p${i}`, name: `P${i}` }));
    const game = new Game(players, { rng });
    for (let step = 0; step < 5000; step++) {
        assert.strictEqual(totalCards(game), 52);
        if (game.phase === 'over') return game;
        if (game.phase === 'attack') {
            const attacker = game.players[game.attacker];
            const suits = [...new Set(attacker.hand.map(x => x.suit))];
            const suit = suits[Math.floor(rng() * suits.length)];
            const ofSuit = attacker.hand.filter(x => x.suit === suit);
            const count = 1 + Math.floor(rng() * Math.min(ofSuit.length, game.maxAttack()));
            game.attack(attacker.id, ids(ofSuit.slice(0, count)));
        } else {
            const defender = game.players[game.defender];
            const selection = rng() < 0.8 ? defender.hand : defender.hand.filter(() => rng() < 0.5);
            game.defend(defender.id, ids(selection));
        }
    }
    assert.fail(`Peli ${seed} jäi jumiin`);
}

test('1000 satunnaista peliä päättyy aina Maijaan', () => {
    for (let seed = 1; seed <= 1000; seed++) {
        const game = randomBotGame(seed, 2 + (seed % 4));
        const maija = game.players.find(p => p.id === game.maijaId);
        assert.ok(maija.hand.some(isMaija), `peli ${seed}: Maijalla ei ole pata rouvaa`);
        assert.strictEqual(new Set(game.players.map(p => p.place)).size, game.players.length);
    }
});
