'use strict';
// Hertan robottipelaaja. Robotti näkee saman kuin ihminen: oman pelaajanäkymänsä
// (game.getView(robotinId)) eli oman kätensä ja pöydälle pelatut kortit.

const { cardId } = require('../public/korttipelit/kortit.js');
const {
    PASS_COUNT, rankValue, isQueenOfSpades, isTenOfDiamonds, points, trickPoints, legalCards
} = require('../public/hertta/js/saannot.js');

const QUEEN = rankValue('Q');

function pickRandom(items, rng) {
    return items[Math.floor(rng() * items.length)];
}

// Valitsee parhaan pisteen saaneen vaihtoehdon. Tasatilanteessa arvotaan.
function best(options, rng) {
    const top = Math.max(...options.map(o => o.score));
    return pickRandom(options.filter(o => o.score === top), rng);
}

function rulesContext(view) {
    return {
        lead: view.trick.length > 0 ? view.trick[0].card.suit : null,
        firstTrick: view.tricksPlayed === 0,
        heartsBroken: view.heartsBroken
    };
}

// Onko pata rouva vielä jonkun toisen kädessä?
function queenOutstanding(view) {
    return !view.played.some(isQueenOfSpades) && !view.hand.some(isQueenOfSpades);
}

// Annetaan vaarallisimmat kortit: pata rouva, isot padat ja isot hertat.
// Ruutu 10 ja pienet padat (rouvan suojana) pidetään.
function passScore(card, hand) {
    const v = rankValue(card.rank);
    const ofSuit = hand.filter(c => c.suit === card.suit).length;
    if (isQueenOfSpades(card)) return 100;
    if (isTenOfDiamonds(card)) return -100;
    if (card.suit === 'spades') return v > QUEEN ? 60 + v : -10;
    if (card.suit === 'hearts') return 20 + v;
    // Lyhyt maa kannattaa tyhjentää, jotta voi myöhemmin sakata.
    return v + (ofSuit <= PASS_COUNT ? 5 : 0);
}

function decidePass(view, rng = Math.random) {
    const scored = view.hand.map(card => ({ card, score: passScore(card, view.hand) + rng() * 0.1 }));
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, PASS_COUNT).map(o => cardId(o.card));
}

// Sakattaessa (ei aloitettua maata) pois vaarallisin kortti.
function discardScore(card, view) {
    const v = rankValue(card.rank);
    if (isQueenOfSpades(card)) return 200;
    if (isTenOfDiamonds(card)) return -100;
    if (card.suit === 'spades' && v > QUEEN && queenOutstanding(view)) return 150 + v;
    if (card.suit === 'hearts') return 50 + v;
    return v;
}

// Aloitettaessa pieniä kortteja. Hertoilla ja isoilla padoilla ei aloiteta,
// jos pata rouva on vielä muilla; pienillä padoilla rouvaa yritetään houkutella esiin.
function leadScore(card, view) {
    const v = rankValue(card.rank);
    let score = -v;
    if (card.suit === 'hearts') score -= 8;
    if (card.suit === 'spades') {
        if (isQueenOfSpades(card)) score -= 50;
        else if (queenOutstanding(view)) score += v > QUEEN ? -40 : 4;
    }
    if (isTenOfDiamonds(card)) score -= 20;
    return score;
}

// Maata tunnustettaessa.
function followScore(card, view, winningRank, last) {
    const v = rankValue(card.rank);
    const wins = v > winningRank;
    const pts = trickPoints(view.trick.map(t => t.card)) + points(card);
    if (isQueenOfSpades(card) && !wins) return 100;     // rouva toisen isomman alle
    if (last) {
        // Viimeisenä tiedetään tikin pisteet: voitetaan vain, jos se kannattaa.
        // Tasatilanteessa pois mahdollisimman iso kortti.
        return (wins ? -pts * 10 : 0) + v * 0.1;
    }
    if (isQueenOfSpades(card)) return -100;
    if (!wins) return 50 + v;                  // isoin kortti, joka alittaa
    // Pakko ottaa johto: pienin kortti, ellei kyse ole padoista ilman rouvan uhkaa.
    if (card.suit === 'spades' && queenOutstanding(view)) return -v - (v > QUEEN ? 30 : 0);
    return -v;
}

function decidePlay(view, rng = Math.random) {
    const legal = legalCards(view.hand, rulesContext(view));
    if (legal.length === 1) return cardId(legal[0]);

    let options;
    if (view.trick.length === 0) {
        options = legal.map(card => ({ card, score: leadScore(card, view) }));
    } else {
        const lead = view.trick[0].card.suit;
        if (legal[0].suit !== lead) {
            options = legal.map(card => ({ card, score: discardScore(card, view) }));
        } else {
            const winningRank = Math.max(...view.trick.filter(t => t.card.suit === lead).map(t => rankValue(t.card.rank)));
            const last = view.trick.length === 3;
            options = legal.map(card => ({ card, score: followScore(card, view, winningRank, last) }));
        }
    }
    return cardId(best(options, rng).card);
}

function randomPass(view, rng) {
    const shuffled = view.hand.slice().sort(() => rng() - 0.5);
    return shuffled.slice(0, PASS_COUNT).map(cardId);
}

function randomPlay(view, rng) {
    return cardId(pickRandom(legalCards(view.hand, rulesContext(view)), rng));
}

module.exports = { decidePass, decidePlay, randomPass, randomPlay };
