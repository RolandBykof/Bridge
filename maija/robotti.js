'use strict';
// Robottipelaajan päätökset. Robotti näkee saman kuin ihminen: oman
// pelaajanäkymänsä (game.getView(robotinId)), ei muiden käsiä.

const { bestDefense } = require('./game.js');
const { SUITS, cardId, rankValue, isMaija } = require('../public/maija/js/kortit.js');

// Kun näin monta kaatoa peräkkäin ei ole kaatanut mitään, robotit alkavat
// pelata satunnaisesti, jotta peli ei jää ikuiseen kierteeseen.
const CHAOS_AFTER_NO_BEAT_ROUNDS = 20;
const HIGH_RANK = rankValue('J');
const LOW_RANK = rankValue('9');

function pickRandom(items, rng) {
    return items[Math.floor(rng() * items.length)];
}

function byRank(a, b) {
    return rankValue(a.rank) - rankValue(b.rank);
}

// Valitsee parhaan pisteen saaneen vaihtoehdon. Tasatilanteessa arvotaan.
function best(options, rng) {
    const top = Math.max(...options.map(o => o.score));
    return pickRandom(options.filter(o => o.score === top), rng);
}

function randomAttack(view, rng) {
    const suits = [...new Set(view.hand.map(c => c.suit))];
    const suit = pickRandom(suits, rng);
    const ofSuit = view.hand.filter(c => c.suit === suit);
    const count = 1 + Math.floor(rng() * Math.min(ofSuit.length, view.maxAttack));
    return ofSuit.sort(() => rng() - 0.5).slice(0, count).map(cardId);
}

function randomDefense(view, rng) {
    return view.hand.filter(() => rng() < 0.6).map(cardId);
}

function decideAttack(view, rng = Math.random) {
    if (view.noBeatRounds >= CHAOS_AFTER_NO_BEAT_ROUNDS) return randomAttack(view, rng);

    const hand = view.hand;
    const max = view.maxAttack;
    const endgame = view.deckCount === 0;

    // Pata rouvaa ei voi kaataa, joten sen lyöminen siirtää Maijan varmasti eteenpäin.
    if (hand.some(isMaija)) {
        const spades = hand.filter(c => c.suit === 'spades' && !isMaija(c)).sort(byRank);
        const maija = hand.find(isMaija);
        return [maija, ...spades.slice(0, max - 1)].map(cardId);
    }

    const options = [];
    for (const suit of SUITS) {
        const cards = hand.filter(c => c.suit === suit).sort(byRank);
        if (cards.length === 0) continue;
        const isTrump = suit === view.trump;

        if (endgame) {
            // Loppukirissä mahdollisimman monta korttia kerralla.
            const chosen = cards.slice(0, max);
            const avg = chosen.reduce((s, c) => s + rankValue(c.rank), 0) / chosen.length;
            options.push({ cards: chosen, score: chosen.length * 10 - avg - (isTrump ? 5 : 0) });
        } else {
            // Ennen loppukiriä lyödään matalia kortteja, vahvat säästetään kaatamiseen.
            const low = cards.filter(c => rankValue(c.rank) <= LOW_RANK).slice(0, max);
            if (low.length > 0) {
                const avg = low.reduce((s, c) => s + rankValue(c.rank), 0) / low.length;
                options.push({ cards: low, score: low.length * 3 - avg - (isTrump ? 20 : 0) });
            } else {
                options.push({ cards: [cards[0]], score: -rankValue(cards[0].rank) - (isTrump ? 40 : 20) });
            }
        }
    }
    return best(options, rng).cards.map(cardId);
}

// Palauttaa kädestä ne kortit, joita bestDefense käyttäisi.
function usedCards(table, candidates, trump) {
    const assign = bestDefense(table, candidates, trump);
    return assign.filter(j => j >= 0).map(j => candidates[j]);
}

function decideDefense(view, rng = Math.random) {
    if (view.noBeatRounds >= CHAOS_AFTER_NO_BEAT_ROUNDS) return randomDefense(view, rng);

    const table = view.table.map(t => t.card);
    const hand = view.hand;
    const all = usedCards(table, hand, view.trump);

    // Kaikki kaatuu, tai pakka on loppu ja jokainen kaadettu kortti vie lähemmäs pois pääsyä.
    if (all.length === table.length || view.deckCount === 0) return all.map(cardId);

    // Osittainen kaato ennen loppukiriä: vahvoja kortteja ei tuhlata, koska
    // kaatamatta jäävät kortit tulevat käteen joka tapauksessa.
    const cheap = hand.filter(c => c.rank !== 'A' && !(c.suit === view.trump && rankValue(c.rank) >= HIGH_RANK));
    return usedCards(table, cheap, view.trump).map(cardId);
}

module.exports = {
    decideAttack, decideDefense, randomAttack, randomDefense, CHAOS_AFTER_NO_BEAT_ROUNDS
};
