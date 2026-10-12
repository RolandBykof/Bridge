'use strict';
// Tarkistimien yksikkötestit: säännöt tunnetuilla arvoilla sekä keinotekoinen
// jako, joka ensin menee läpi ja josta sitten tehdään tahallaan virheellisiä
// versioita. Jokaisen tarkistuksen pitää huomata oma virheensä.
const test = require('node:test');
const assert = require('node:assert');
const T = require('./tarkistimet');
const { dealCards } = require('../lib/deal');
const { mulberry32 } = require('./simulaattori');

const { POSITIONS, SUITS, nextPos, partnerOf, sideOf } = T;

test('pisteet: tavallinen bridge', () => {
    assert.strictEqual(T.scoreBridge('4H', 10, false), 420);
    assert.strictEqual(T.scoreBridge('3N', 10, true), 630);
    assert.strictEqual(T.scoreBridge('1N', 6, false), -50);
    assert.strictEqual(T.scoreBridge('4SX', 7, true), -800);
    assert.strictEqual(T.scoreBridge('2CX', 8, false), 180);
    assert.strictEqual(T.scoreBridge('2CXX', 8, false), 560);
    assert.strictEqual(T.scoreBridge('6N', 12, false), 990);
    assert.strictEqual(T.scoreBridge('7S', 13, true), 2210);
    assert.strictEqual(T.scoreBridge('1NX', 3, false), -800);
    assert.strictEqual(T.scoreBridge('3NX', 7, true), -500);
    assert.strictEqual(T.scoreBridge('1HX', 8, true), 360);
    assert.strictEqual(T.scoreBridge('2SXX', 6, false), -600);
    assert.strictEqual(T.scoreBridge('5D', 11, true), 600);
    assert.strictEqual(T.scoreBridge('2H', 9, false), 140);
});

test('pisteet: minibridge', () => {
    assert.strictEqual(T.scoreMini('1N', 7), 90);
    assert.strictEqual(T.scoreMini('3N', 9), 400);
    assert.strictEqual(T.scoreMini('4S', 8), -100);
    assert.strictEqual(T.scoreMini('1C', 9), 110);
    assert.strictEqual(T.scoreMini('5D', 11), 400);
});

test('tikin voittaja', () => {
    const t = (cards) => cards.map(([player, suit, card]) => ({ player, suit, card }));
    assert.strictEqual(T.trickWinner(t([['north', 'spades', '2'], ['east', 'spades', 'A'], ['south', 'hearts', 'A'], ['west', 'spades', 'K']]), null), 'east');
    assert.strictEqual(T.trickWinner(t([['north', 'spades', '2'], ['east', 'spades', 'A'], ['south', 'hearts', '2'], ['west', 'spades', 'K']]), 'hearts'), 'south');
    assert.strictEqual(T.trickWinner(t([['north', 'clubs', '10'], ['east', 'hearts', '3'], ['south', 'hearts', 'Q'], ['west', 'clubs', 'J']]), 'hearts'), 'south');
    assert.strictEqual(T.trickWinner(t([['north', 'clubs', '10'], ['east', 'diamonds', 'A'], ['south', 'clubs', '9'], ['west', 'clubs', '2']]), 'spades'), 'north');
});

test('tarjoussäännöt', () => {
    const h = (...bids) => bids.map(([player, bid]) => ({ player, bid }));
    assert.strictEqual(T.callError([], 'south', 'X') !== null, true);
    assert.strictEqual(T.callError(h(['south', '1H']), 'west', 'X'), null);
    assert.notStrictEqual(T.callError(h(['south', '1H'], ['west', 'P']), 'north', 'X'), null, 'oman puolen tarjousta ei voi kahdentaa');
    assert.strictEqual(T.callError(h(['south', '1H'], ['west', 'X']), 'north', 'XX'), null);
    assert.notStrictEqual(T.callError(h(['south', '1H'], ['west', 'X']), 'east', 'XX'), null);
    assert.notStrictEqual(T.callError(h(['south', '2H']), 'west', '2D'), null);
    assert.notStrictEqual(T.callError(h(['south', '2H']), 'west', '2H'), null);
    assert.strictEqual(T.callError(h(['south', '2H']), 'west', '2S'), null);
});

test('sopimus ja pelinviejä', () => {
    const h = (...bids) => bids.map(([player, bid]) => ({ player, bid }));
    let c = T.computeContract(h(['south', '1H'], ['west', 'P'], ['north', '4H'], ['east', 'X'], ['south', 'P'], ['west', 'P'], ['north', 'P']));
    assert.strictEqual(c.contract, '4HX');
    assert.strictEqual(c.declarer, 'south');
    assert.strictEqual(c.dummy, 'north');
    // Vastapuoli nimesi maan ensin: pelinviejä on sopimuspuolen ensimmäinen
    c = T.computeContract(h(['north', '1D'], ['east', 'P'], ['south', 'P'], ['west', '2D'], ['north', 'P'], ['east', '3D'], ['south', 'P'], ['west', 'P'], ['north', 'P']));
    assert.strictEqual(c.contract, '3D');
    assert.strictEqual(c.declarer, 'west');
    c = T.computeContract(h(['south', '1C'], ['west', 'X'], ['north', 'XX'], ['east', 'P'], ['south', 'P'], ['west', 'P']));
    assert.strictEqual(c.contract, '1CXX');
    c = T.computeContract(h(['south', '1C'], ['west', 'X'], ['north', '1H'], ['east', 'P'], ['south', 'P'], ['west', 'P']));
    assert.strictEqual(c.contract, '1H');
    assert.strictEqual(c.declarer, 'north');
    assert.strictEqual(T.computeContract(h(['south', 'P'], ['west', 'P'], ['north', 'P'], ['east', 'P'])), null);
});

test('vyöhykkeet ja jakaja', () => {
    assert.strictEqual(T.vulnerabilityFor(1), 'None');
    assert.strictEqual(T.vulnerabilityFor(4), 'Both');
    assert.strictEqual(T.vulnerabilityFor(16), 'EW');
    assert.strictEqual(T.vulnerabilityFor(17), 'None');
    assert.strictEqual(T.nextDealer('south'), 'west');
    assert.strictEqual(T.nextDealer('east'), 'south');
});

// ---------- Keinotekoinen jako ----------

/**
 * Rakentaa jaon tallenteen samaan muotoon kuin simulaattori: kunkin
 * ihmisen saamat viestit, lähetetyt siirrot ja palvelimen jaon tiedot.
 * Tarjoukset: S 1H, W P, N 4H, E P, S P, W P (etelä jakaa).
 */
function buildDeal(opts = {}) {
    const humanSeats = opts.humanSeats || ['south', 'west'];
    const creator = opts.creator || humanSeats[0];
    const seatTypes = {};
    for (const p of POSITIONS) seatTypes[p] = humanSeats.includes(p) ? 'human' : 'robot';
    const table = { mode: 'bridge', creator, humanSeats, seatTypes };
    const rng = mulberry32(opts.seed || 7);
    const hands = dealCards(rng);
    const dealer = 'south';
    const dealNumber = 1;
    const vulnerable = T.vulnerabilityFor(dealNumber);
    const bids = [['south', '1H'], ['west', 'P'], ['north', '4H'], ['east', 'P'], ['south', 'P'], ['west', 'P'], ['north', 'P']]
        .map(([player, bid]) => ({ player, bid }));
    const contract = { contract: '4H', declarer: 'south', dummy: 'north', trumpSuit: 'hearts' };

    const shared = []; // kaikille lähetetyt viestit järjestyksessä
    const priv = {}; // paikka -> yksityiset viestit indeksin kohdalle
    for (const p of humanSeats) priv[p] = [];
    const t0 = 1000;
    let t = t0;
    const push = (event, data) => shared.push({ t: t++, event, data });
    const pushPrivate = (seat, event, data) => { if (priv[seat]) priv[seat].push({ at: shared.length, ev: { t: t++, event, data } }); };

    push('newDealStarted', {
        type: 'newDealStarted', dealNumber, dealer,
        gameState: { gamePhase: 'bidding', vulnerable }, biddingState: { currentBidder: dealer, bidHistory: [] }
    });
    for (const p of humanSeats) pushPrivate(p, 'yourCards', { position: p, cards: JSON.parse(JSON.stringify(hands[p])) });
    const history = [];
    bids.forEach((b, i) => {
        history.push(b);
        if (i < bids.length - 1) push('bidMade', { position: b.player, bid: b.bid, nextBidder: nextPos(b.player), biddingState: { bidHistory: [...history] } });
    });
    push('biddingComplete', { ...contract, currentPlayer: nextPos(contract.declarer) });
    const robotDeclHumanDummy = seatTypes[contract.declarer] === 'robot' && seatTypes[contract.dummy] === 'human';
    if (robotDeclHumanDummy) {
        pushPrivate(contract.dummy, 'declarerHandRevealed', { declarerPosition: contract.declarer, declarerCards: JSON.parse(JSON.stringify(hands[contract.declarer])) });
    }

    // Satunnainen laillinen pelaaminen
    const remaining = JSON.parse(JSON.stringify(hands));
    const played = [];
    const emissions = [];
    let leader = nextPos(contract.declarer);
    let trick = [];
    const tricks = { ns: 0, ew: 0 };
    for (let n = 0; n < 52; n++) {
        const player = nextPos(leader, trick.length);
        const hand = remaining[player];
        let options = [];
        for (const s of SUITS) for (const c of hand[s]) options.push({ suit: s, card: c });
        if (trick.length) {
            const follow = options.filter(o => o.suit === trick[0].suit);
            if (follow.length) options = follow;
        }
        const pickCard = options[Math.floor(rng() * options.length)];
        const card = { player, suit: pickCard.suit, card: pickCard.card };
        hand[card.suit] = hand[card.suit].filter(x => x !== card.card);
        trick.push(card);
        played.push(card);
        let controller = player;
        if (robotDeclHumanDummy && (player === contract.declarer || player === contract.dummy)) controller = contract.dummy;
        else if (player === contract.dummy) controller = contract.declarer;
        if (seatTypes[controller] === 'human' && n < 48) {
            emissions.push({ t: t++, seat: controller, event: 'playCard', data: { position: player, suit: card.suit, card: card.card }, legal: true });
        }
        push('cardPlayed', { position: player, suit: card.suit, card: card.card, currentTrick: [...trick] });
        if (n === 0) push('dummyRevealed', { dummyPosition: contract.dummy, dummyCards: JSON.parse(JSON.stringify(hands[contract.dummy])) });
        if (trick.length < 4) {
            push('nextPlayer', { currentPlayer: nextPos(player) });
        } else {
            const winner = T.trickWinner(trick, contract.trumpSuit);
            tricks[sideOf(winner)]++;
            if (n < 51) push('trickComplete', { winner, trick: [...trick], tricks: { ...tricks }, nextPlayer: winner });
            leader = winner;
            trick = [];
        }
    }
    const declSide = sideOf(contract.declarer);
    const declVul = vulnerable === 'Both' || vulnerable === declSide.toUpperCase();
    const dealScore = T.scoreBridge(contract.contract, tricks[declSide], declVul);
    const totalScore = { ns: 0, ew: 0 };
    if (dealScore >= 0) totalScore[declSide] += dealScore; else totalScore[declSide === 'ns' ? 'ew' : 'ns'] += -dealScore;
    push('gameOver', { type: 'gameOver', message: 'tulos', tricks: { ...tricks }, contract: contract.contract, dealNumber, dealer, isReplay: false, dealScore, totalScore, vulnerable });
    const record = {
        type: 'testDealRecord', reason: 'end', dealNumber, dealer, gameMode: 'bridge', vulnerable,
        hands, bidHistory: bids, ...contract, playedCards: played, tricks: { ...tricks }, miniPoints: null, isReplay: false
    };
    push('testDealRecord', record);

    const clientEvents = {};
    for (const seat of humanSeats) {
        const list = [];
        shared.forEach((ev, i) => {
            for (const p of priv[seat].filter(x => x.at === i)) list.push(p.ev);
            list.push(JSON.parse(JSON.stringify(ev)));
        });
        clientEvents[seat] = list;
    }
    const deal = {
        index: 0, kind: 'deal', start: clientEvents[creator][0], clientEvents, emissions,
        attempts: [], unexpectedErrors: [], clientViolations: [], record, outcome: 'end'
    };
    return { deal, table };
}

function check(deal, table, ctxPatch) {
    const ctx = T.createTableContext(table);
    Object.assign(ctx, ctxPatch || {});
    return T.checkDeal(deal, ctx);
}

const checksOf = (findings) => [...new Set(findings.filter(f => f.severity === 'error').map(f => f.check))];
const forEachSeat = (deal, fn) => { for (const seat of Object.keys(deal.clientEvents)) deal.clientEvents[seat].forEach(fn); };

test('virheetön jako menee läpi eri kokoonpanoilla', () => {
    const layouts = [['south'], ['north'], ['south', 'west'], ['north', 'east'], ['south', 'north', 'east'], POSITIONS];
    layouts.forEach((humanSeats, i) => {
        const { deal, table } = buildDeal({ humanSeats, seed: 11 + i });
        const findings = check(deal, table);
        assert.deepStrictEqual(findings, [], `${humanSeats.join(',')}: ${JSON.stringify(findings)}`);
    });
});

test('väärä tikin voittaja huomataan', () => {
    const { deal, table } = buildDeal();
    forEachSeat(deal, e => { if (e.event === 'trickComplete' && e.data.tricks.ns + e.data.tricks.ew === 3) e.data.winner = nextPos(e.data.winner); });
    assert.ok(checksOf(check(deal, table)).includes('Tikin voittaja'));
});

test('väärät pisteet ja kokonaispisteet huomataan', () => {
    const { deal, table } = buildDeal();
    forEachSeat(deal, e => { if (e.event === 'gameOver') { e.data.dealScore += 10; } });
    assert.ok(checksOf(check(deal, table)).includes('Pisteet'));
    const second = buildDeal();
    forEachSeat(second.deal, e => { if (e.event === 'gameOver') e.data.totalScore = { ns: 1, ew: 2 }; });
    assert.ok(checksOf(check(second.deal, second.table)).includes('Pisteet'));
});

test('maan seuraamatta jättäminen huomataan', () => {
    const { deal, table } = buildDeal();
    // Annetaan pelaajalle jaettuun käteen aloitusmaan kortti, jota hän ei pelannut
    // (hän olisi siis voinut seurata maata): siirretään kortti toiselta.
    const r = deal.record;
    const played = r.playedCards;
    for (let i = 0; i < 48; i += 4) {
        const trick = played.slice(i, i + 4);
        const lead = trick[0].suit;
        const off = trick.find(c => c.suit !== lead);
        if (!off) continue;
        // Etsitään aloitusmaan kortti, joka pelattiin myöhemmin jonkun muun kädestä
        const later = played.slice(i + 4).find(c => c.suit === lead && c.player !== off.player);
        if (!later) continue;
        r.hands[later.player][lead] = r.hands[later.player][lead].filter(x => x !== later.card);
        r.hands[off.player][lead].push(later.card);
        break;
    }
    assert.ok(checksOf(check(deal, table)).includes('Maan seuraaminen'));
});

test('väärä pelinviejä huomataan', () => {
    const { deal, table } = buildDeal();
    forEachSeat(deal, e => { if (e.event === 'biddingComplete') { e.data.declarer = 'north'; e.data.dummy = 'south'; e.data.currentPlayer = 'east'; } });
    assert.ok(checksOf(check(deal, table)).includes('Sopimus ja pelinviejä'));
});

test('tarjous väärällä vuorolla huomataan', () => {
    const { deal, table } = buildDeal();
    deal.record.bidHistory[1].player = 'north';
    assert.ok(checksOf(check(deal, table)).includes('Tarjousvuorot'));
});

test('tietovuodot huomataan', () => {
    const leak = buildDeal({ humanSeats: ['south', 'west'] });
    leak.deal.clientEvents.west.push({ t: 1, event: 'tableInfo', data: { hands: leak.deal.record.hands } });
    assert.ok(checksOf(check(leak.deal, leak.table)).includes('Tietosuoja'));

    const other = buildDeal({ humanSeats: ['south', 'west'] });
    other.deal.clientEvents.west.splice(2, 0, { t: 1, event: 'yourCards', data: { position: 'south', cards: other.deal.record.hands.south } });
    assert.ok(checksOf(check(other.deal, other.table)).includes('Tietosuoja'));

    const early = buildDeal({ humanSeats: ['south', 'west'] });
    const ev = early.deal.clientEvents.west;
    const reveal = ev.findIndex(e => e.event === 'dummyRevealed');
    const [moved] = ev.splice(reveal, 1);
    ev.splice(ev.findIndex(e => e.event === 'biddingComplete') + 1, 0, moved);
    assert.ok(checksOf(check(early.deal, early.table)).includes('Tietosuoja'));

    const tokens = buildDeal({ humanSeats: ['south', 'west'] });
    tokens.deal.clientEvents.west[0].data.gameState.players = { south: { name: 'S', type: 'human', token: 'salainen' } };
    assert.ok(checksOf(check(tokens.deal, tokens.table)).includes('Tietosuoja'));

    const declarerHand = buildDeal({ humanSeats: ['east', 'west'] });
    declarerHand.deal.clientEvents.east.push({ t: 1, event: 'declarerHandRevealed', data: { declarerPosition: 'south', declarerCards: {} } });
    assert.ok(checksOf(check(declarerHand.deal, declarerHand.table)).includes('Tietosuoja'));
});

test('ohjausoikeuden rikkominen huomataan', () => {
    const missing = buildDeal({ humanSeats: ['south', 'west'] });
    missing.deal.emissions.splice(3, 1);
    assert.ok(checksOf(check(missing.deal, missing.table)).includes('Ohjausoikeus'));

    const wrongSeat = buildDeal({ humanSeats: ['south', 'west'] });
    const em = wrongSeat.deal.emissions.find(e => e.seat === 'south');
    em.seat = 'west';
    assert.ok(checksOf(check(wrongSeat.deal, wrongSeat.table)).includes('Ohjausoikeus'));
});

test('eri tulos eri pelaajille huomataan', () => {
    const { deal, table } = buildDeal({ humanSeats: ['south', 'west'] });
    const over = deal.clientEvents.west.find(e => e.event === 'gameOver');
    over.data.message = 'toinen tulos';
    assert.ok(checksOf(check(deal, table)).includes('Sama tulos kaikille'));
});

test('jakonumero ja jakaja tarkistetaan edelliseen jakoon nähden', () => {
    const { deal, table } = buildDeal();
    assert.ok(checksOf(check(deal, table, { prevDealNumber: 3, prevDealer: 'north' })).includes('Jakaja ja jakonumero'));
    deal.record.dealNumber = 2;
    deal.record.vulnerable = 'NS';
    deal.start.data.dealNumber = 2;
    deal.record.dealer = 'south';
    assert.ok(!checksOf(check(deal, table, { prevDealNumber: 1, prevDealer: 'east' })).includes('Jakaja ja jakonumero'));
});

test('laittomat siirrot: hyväksytty tai vastaamaton on virhe, tunnettu ongelma ei', () => {
    const { deal, table } = buildDeal();
    deal.attempts.push({ seat: 'south', description: 'kortti väärällä vuorolla', result: 'accepted' });
    deal.attempts.push({ seat: 'south', description: 'kahdennus', result: 'accepted', knownIssue: true });
    deal.attempts.push({ seat: 'south', description: 'liian matala', result: 'rejected' });
    const findings = check(deal, table).filter(f => f.check === 'Hylätyt siirrot');
    assert.strictEqual(findings.length, 2);
    assert.deepStrictEqual(findings.map(f => f.severity).sort(), ['error', 'known']);
});

test('puuttuva jaon tallenne ja jumittuminen raportoidaan', () => {
    const { deal, table } = buildDeal();
    deal.record = null;
    assert.ok(checksOf(check(deal, table)).includes('Palvelimen virheet'));
    deal.outcome = 'stalled';
    deal.stallMs = 31000;
    assert.ok(checksOf(check(deal, table)).includes('Jumittuminen'));
});
