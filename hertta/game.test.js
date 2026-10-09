'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { Game, GameError } = require('./game.js');
const { legalCards, illegalReason, trickWinner, trickPoints } = require('../public/hertta/js/saannot.js');
const { cardId } = require('../public/korttipelit/kortit.js');

// Toistettava satunnaisluku testejä varten.
function seeded(seed) {
    let s = seed >>> 0;
    return () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 4294967296;
    };
}

function players(n = 4) {
    return Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `Player ${i}` }));
}

function card(text) {
    const [suit, rank] = text.split('-');
    return { suit, rank };
}

function cards(...texts) {
    return texts.map(card);
}

// Kaikki antavat kolme ensimmäistä korttiaan.
function passAll(game) {
    for (const p of game.players) game.pass(p.id, p.hand.slice(0, 3).map(cardId));
}

function context(view) {
    return {
        lead: view.trick.length ? view.trick[0].card.suit : null,
        firstTrick: view.tricksPlayed === 0,
        heartsBroken: view.heartsBroken
    };
}

// Pelaa kierroksen loppuun ensimmäisellä sallitulla kortilla.
function playRound(game) {
    while (game.phase === 'play') {
        const p = game.players[game.current];
        const view = game.getView(p.id);
        game.play(p.id, cardId(legalCards(view.hand, context(view))[0]));
    }
}

test('säännöt: tikin voittaja ja pisteet', () => {
    assert.strictEqual(trickWinner(cards('clubs-5', 'clubs-K', 'hearts-A', 'clubs-2')), 1);
    assert.strictEqual(trickWinner(cards('diamonds-3', 'spades-A', 'clubs-A', 'hearts-A')), 0, 'vain aloitettu maa voittaa');
    assert.strictEqual(trickPoints(cards('hearts-2', 'hearts-A', 'spades-Q', 'clubs-3')), 15);
    assert.strictEqual(trickPoints(cards('diamonds-10', 'hearts-4', 'diamonds-2', 'diamonds-3')), -9);
});

test('säännöt: maan tunnustus, hertan rikkominen ja ensimmäinen tikki', () => {
    const hand = cards('hearts-2', 'spades-Q', 'diamonds-5');
    const first = { lead: 'clubs', firstTrick: true, heartsBroken: false };
    assert.deepStrictEqual(legalCards(hand, first), [card('diamonds-5')], 'ei herttaa eikä pata rouvaa ensimmäiseen tikkiin');
    assert.match(illegalReason(hand, card('spades-Q'), first), /first trick/);
    // Jos kädessä on vain herttoja ja pata rouva, niitä saa lyödä.
    assert.strictEqual(legalCards(cards('hearts-2', 'spades-Q'), first).length, 2);

    const lead = { lead: null, firstTrick: false, heartsBroken: false };
    assert.deepStrictEqual(legalCards(hand, lead), cards('spades-Q', 'diamonds-5'), 'hertalla ei aloiteta');
    assert.match(illegalReason(hand, card('hearts-2'), lead), /not been broken/);
    assert.strictEqual(legalCards(cards('hearts-2', 'hearts-9'), lead).length, 2, 'pelkillä hertoilla saa aloittaa');
    assert.strictEqual(legalCards(hand, { ...lead, heartsBroken: true }).length, 3);

    const follow = { lead: 'diamonds', firstTrick: false, heartsBroken: false };
    assert.deepStrictEqual(legalCards(hand, follow), [card('diamonds-5')]);
    assert.match(illegalReason(hand, card('hearts-2'), follow), /follow suit: play a diamond/);
});

test('jako, vaihto vasemmalle ja ristikakkonen pöytään automaattisesti', () => {
    const game = new Game(players(), { rng: seeded(1), dealerIndex: 0 });
    assert.strictEqual(game.phase, 'pass');
    assert.strictEqual(game.passDirection, 'left');
    assert.ok(game.players.every(p => p.hand.length === 13));
    assert.throws(() => game.play('p0', 'clubs-2'), /Pass your cards first/);
    assert.throws(() => game.pass('p0', ['x']), GameError);

    const given = game.players.map(p => p.hand.slice(0, 3));
    for (let i = 0; i < 3; i++) {
        const events = game.pass(game.players[i].id, given[i].map(cardId));
        assert.strictEqual(events.length, 1);
        assert.strictEqual(Game.publicEvent(events[0], 'p3').cards, null, 'muut eivät näe annettuja kortteja');
    }
    assert.throws(() => game.pass('p0', given[0].map(cardId)), /already passed/);
    const events = game.pass('p3', given[3].map(cardId));
    const exchange = events.find(e => e.type === 'exchange');
    assert.strictEqual(Game.publicEvent(exchange, 'p0').transfers.length, 2, 'näkee vain omat vaihdot');
    // Vasemmalle = seuraavalle pelaajalle.
    for (let i = 0; i < 4; i++) {
        const receiver = game.players[(i + 1) % 4];
        for (const c of given[i]) assert.ok(receiver.hand.includes(c) || game.played.includes(c));
    }
    const auto = events.find(e => e.type === 'play');
    assert.ok(auto.auto);
    assert.deepStrictEqual(auto.card, card('clubs-2'));
    assert.strictEqual(game.phase, 'play');
    assert.strictEqual(game.trick.length, 1);
    assert.strictEqual(game.current, (game.indexOf(auto.playerId) + 1) % 4);
});

test('kierroksen pisteet ovat yhteensä 16, ja vaihtosuunta kiertää', () => {
    const game = new Game(players(), { rng: seeded(7), dealerIndex: 0 });
    const directions = [];
    for (let round = 1; round <= 5 && game.phase !== 'over'; round++) {
        directions.push(game.passDirection);
        if (game.phase === 'pass') passAll(game);
        playRound(game);
        assert.strictEqual(game.history.length, round);
        assert.strictEqual(game.history[round - 1].points.reduce((a, b) => a + b, 0), 16);
        assert.strictEqual(game.players.reduce((s, p) => s + p.tricks, 0), 13);
        if (game.phase === 'round-over') game.nextRound('p0');
    }
    assert.deepStrictEqual(directions.slice(0, 4), ['left', 'right', 'across', 'none']);
});

test('neljännellä kierroksella ei vaihdeta, ja ristikakkonen lyödään heti', () => {
    const game = new Game(players(), { rng: seeded(3), dealerIndex: 0 });
    for (let i = 0; i < 3; i++) {
        passAll(game);
        playRound(game);
        game.history.length = i + 1;
        game.players.forEach(p => { p.score = 0; });
        game.phase = 'round-over';
        const events = game.nextRound('p1');
        assert.strictEqual(events[0].type, 'round-start');
        assert.strictEqual(events[0].byName, 'Player 1');
        if (i === 2) {
            assert.strictEqual(events[0].passDirection, 'none');
            assert.ok(events.some(e => e.type === 'play' && e.auto));
            assert.strictEqual(game.phase, 'play');
        }
    }
});

test('peli päättyy, kun joku saa 100 pistettä, ja pienimmät pisteet voittavat', () => {
    const game = new Game(players(), { rng: seeded(11), dealerIndex: 0 });
    game.players.forEach((p, i) => { p.score = [90, 40, 45, 70][i]; });
    game.players.forEach((p, i) => { p.roundPoints = [9, 15, 2, -10][i]; });
    let events = game.finishRound();
    assert.strictEqual(game.phase, 'round-over', '99 ei vielä riitä');
    assert.strictEqual(events[0].results[0].total, 99);

    game.startRound();
    game.players.forEach((p, i) => { p.roundPoints = [1, 0, 2, 13][i]; });
    events = game.finishRound();
    assert.strictEqual(game.phase, 'over');
    const over = events.find(e => e.type === 'over');
    assert.deepStrictEqual(over.winnerNames, ['Player 2'], 'pienimmät pisteet: 49');
    assert.strictEqual(over.winningScore, 49);
    assert.deepStrictEqual(over.ranking.map(r => r.score), [49, 55, 73, 100]);
    assert.throws(() => game.nextRound('p0'), /not over/);

    // Tasapisteillä voittajia on useampi.
    const tie = new Game(players(), { rng: seeded(12), dealerIndex: 0 });
    tie.players.forEach((p, i) => { p.score = [100, 30, 30, 50][i]; });
    tie.finishRound();
    assert.deepStrictEqual(tie.winnerIds, ['p1', 'p2']);
});

test('viimeinen tikki pelataan automaattisesti', () => {
    const game = new Game(players(), { rng: seeded(21), dealerIndex: 0 });
    passAll(game);
    let events = [];
    while (game.tricksPlayed < 12) {
        const p = game.players[game.current];
        const view = game.getView(p.id);
        events = game.play(p.id, cardId(legalCards(view.hand, context(view))[0]));
    }
    // Kahdennentoista tikin viimeinen kortti pelasi myös viimeisen tikin ja päätti kierroksen.
    assert.ok(events.some(e => e.type === 'last-trick'));
    assert.strictEqual(events.filter(e => e.type === 'play' && e.auto === 'last-trick').length, 4);
    assert.strictEqual(game.tricksPlayed, 13);
    assert.ok(game.players.every(p => p.hand.length === 0));
    assert.ok(['round-over', 'over'].includes(game.phase));
    assert.strictEqual(game.history[0].points.reduce((a, b) => a + b, 0), 16);
});

test('hertat rikkoutuvat, kun hertta pelataan', () => {
    const game = new Game(players(), { rng: seeded(5), dealerIndex: 0 });
    passAll(game);
    let broke = null;
    while (game.phase === 'play' && !broke) {
        const p = game.players[game.current];
        const view = game.getView(p.id);
        const legal = legalCards(view.hand, context(view));
        const heart = legal.find(c => c.suit === 'hearts');
        const events = game.play(p.id, cardId(heart || legal[0]));
        broke = events.find(e => e.type === 'play' && e.brokeHearts);
    }
    assert.ok(broke, 'joku pelasi hertan');
    assert.strictEqual(game.heartsBroken, true);
});

test('väärät siirrot hylätään englanninkielisellä selityksellä', () => {
    const game = new Game(players(), { rng: seeded(2), dealerIndex: 0 });
    passAll(game);
    const current = game.players[game.current];
    const other = game.players[(game.current + 1) % 4];
    assert.throws(() => game.play(other.id, cardId(other.hand[0])), /not your turn/);
    assert.throws(() => game.play(current.id, 'spades-1'), /not in your hand/);
    const view = game.getView(current.id);
    const illegal = view.hand.find(c => illegalReason(view.hand, c, context(view)));
    if (illegal) assert.throws(() => game.play(current.id, cardId(illegal)), GameError);
    assert.throws(() => new Game(players(3)), /exactly 4/);
});

test('näkymä ei paljasta muiden kortteja', () => {
    const game = new Game(players(), { rng: seeded(9), dealerIndex: 0 });
    const view = game.getView('p0');
    assert.strictEqual(view.hand.length, 13);
    assert.deepStrictEqual(view.allowedActions, ['pass']);
    assert.strictEqual(view.passTargetId, 'p1');
    assert.strictEqual(view.passSourceId, 'p3');
    const spectator = game.getView(null);
    assert.strictEqual(spectator.hand, null);
    assert.deepStrictEqual(spectator.allowedActions, []);
    assert.ok(!('hand' in view.players[1]));
});
