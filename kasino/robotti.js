'use strict';
// Kasinon robottipelaaja. Robotti näkee saman kuin ihminen: oman
// pelaajanäkymänsä (game.getView(robotinId)), ei muiden käsiä.

const { cardId } = require('../public/korttipelit/kortit.js');
const { bestCapture, cardPoints, tableValue } = require('../public/kasino/js/saannot.js');

function pickRandom(items, rng) {
    return items[Math.floor(rng() * items.length)];
}

// Valitsee parhaan pisteen saaneen vaihtoehdon. Tasatilanteessa arvotaan.
function best(options, rng) {
    const top = Math.max(...options.map(o => o.score));
    return pickRandom(options.filter(o => o.score === top), rng);
}

// Kortin arvo omassa pinossa: pistekortit ja padat painavat eniten.
function worth(card) {
    return 1 + cardPoints(card) * 4 + (card.suit === 'spades' ? 1 : 0);
}

// Oton arvo: otetut kortit ja pelattu kortti päätyvät omaan pinoon.
function takeScore(card, capture, view) {
    let score = worth(card) + capture.cards.reduce((sum, c) => sum + worth(c), 0);
    if (capture.cards.length === view.table.length && !view.lastHand) score += 6;     // mökki
    return score;
}

// Lyönnin hinta: arvokasta korttia ei anneta pöytään, eikä pöytää jätetä niin,
// että seuraava voi tyhjentää sen yhdellä tavallisella kortilla (summa 2–13).
function layScore(card, view) {
    let score = -worth(card) * 2;
    const sum = view.table.reduce((s, c) => s + tableValue(c), tableValue(card));
    if (!view.lastHand && sum >= 2 && sum <= 13) score -= 4;
    return score;
}

// Vuorossa: { action: 'take' | 'lay', cardId }.
function decideMove(view, rng = Math.random) {
    const options = [];
    for (const card of view.hand) {
        const capture = view.table.length ? bestCapture(card, view.table) : null;
        if (capture) options.push({ action: 'take', card, score: 100 + takeScore(card, capture, view) });
        options.push({ action: 'lay', card, score: layScore(card, view) });
    }
    const choice = best(options, rng);
    return { action: choice.action, cardId: cardId(choice.card) };
}

function randomMove(view, rng) {
    return { action: 'lay', cardId: cardId(pickRandom(view.hand, rng)) };
}

module.exports = { decideMove, randomMove };
