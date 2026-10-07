'use strict';
// Ristiseiskan robottipelaaja. Robotti näkee saman kuin ihminen: oman
// pelaajanäkymänsä (game.getView(robotinId)), ei muiden käsiä.

const { cardId } = require('../public/korttipelit/kortit.js');
const { orderIndex, playableCards, SEVEN } = require('../public/ristiseiska/js/saannot.js');

function pickRandom(items, rng) {
    return items[Math.floor(rng() * items.length)];
}

// Valitsee parhaan pisteen saaneen vaihtoehdon. Tasatilanteessa arvotaan.
function best(options, rng) {
    const top = Math.max(...options.map(o => o.score));
    return pickRandom(options.filter(o => o.score === top), rng);
}

// Montako omaa korttia lyönti tuo lähemmäs pöytää. Seiska, kuutonen ja
// kahdeksikko avaavat koko maan; pienet kortit avaavat alaspäin ja isot ylöspäin.
function ownCardsOpened(card, hand) {
    const i = orderIndex(card.rank);
    const sameSuit = hand.filter(c => c.suit === card.suit && c !== card);
    if (i >= SEVEN - 1 && i <= SEVEN + 1) return sameSuit.length;
    if (i < SEVEN) return sameSuit.filter(c => orderIndex(c.rank) < i).length;
    return sameSuit.filter(c => orderIndex(c.rank) > i).length;
}

function playScore(card, hand) {
    const opened = ownCardsOpened(card, hand);
    const i = orderIndex(card.rank);
    let score = opened * 2;
    // Seiskaa, kuutosta ja kahdeksikkoa pidätetään, jos ne avaisivat maan vain muille.
    if (opened === 0 && i >= SEVEN - 1 && i <= SEVEN + 1) score -= 3;
    // Ässä ja kuningas antavat lisäkortin.
    if (card.rank === 'A' || card.rank === 'K') score += 5;
    return score;
}

// Montako korttia pitää vielä lyödä ennen kuin kortti sopii pöytään (0 = sopii heti).
function distance(table, card) {
    const i = orderIndex(card.rank);
    const pile = table[card.suit];
    if (!pile) {
        // Ensin 7 ja 6; kahdeksikko ja pienet kortit tarvitsevat lisäksi toisen niistä.
        if (i === SEVEN) return 0;
        if (i < SEVEN) return SEVEN - i + (i < SEVEN - 1 ? 1 : 0);
        return i - SEVEN + 1;
    }
    const low = orderIndex(pile.low);
    const high = orderIndex(pile.high);
    if (i < low) {
        // Pienet kortit vaativat kahdeksikon pöytään.
        const extra = high === SEVEN && i < SEVEN - 1 ? 1 : 0;
        return low - i - 1 + extra;
    }
    // Kahdeksikko vaatii kuutosen pöytään.
    const extra = low === SEVEN && i > SEVEN ? 1 : 0;
    return i - high - 1 + extra;
}

// Vuorossa: { action: 'play', cardId } | { action: 'ask' } | { action: 'end-turn' }.
function decideTurn(view, rng = Math.random) {
    const playable = playableCards(view.table, view.hand);
    if (playable.length === 0) return { action: view.bonus ? 'end-turn' : 'ask' };
    const options = playable.map(card => ({ card, score: playScore(card, view.hand) }));
    const choice = best(options, rng);
    // Lisävuorossa jatketaan vain, jos lyönnistä on hyötyä ("liikaa ei kannata pelata").
    if (view.bonus && choice.score < 0) return { action: 'end-turn' };
    return { action: 'play', cardId: cardId(choice.card) };
}

// Annetaan kortti, jota pyytäjä ei pysty lyömään pian. Omia avainkortteja
// (7, 6, 8), joilla robotti pidättää muita, ei anneta mielellään.
function decideGive(view, rng = Math.random) {
    const options = view.hand.map(card => {
        let score = distance(view.table, card) * 2;
        const i = orderIndex(card.rank);
        if (i >= SEVEN - 1 && i <= SEVEN + 1 && ownCardsOpened(card, view.hand) === 0) score -= 2;
        return { card, score };
    });
    return cardId(best(options, rng).card);
}

function randomTurn(view, rng) {
    const playable = playableCards(view.table, view.hand);
    if (playable.length === 0) return { action: view.bonus ? 'end-turn' : 'ask' };
    return { action: 'play', cardId: cardId(pickRandom(playable, rng)) };
}

function randomGive(view, rng) {
    return cardId(pickRandom(view.hand, rng));
}

module.exports = { decideTurn, decideGive, randomTurn, randomGive, distance };
