// Ristiseiskan pöytäsäännöt. Käytössä sekä palvelimella (require) että
// selaimessa (window.Saannot).
//
// Pöytä: { spades: { low, high } | null, ... }. Maan kortit ovat aina yhtenäinen
// jono seiskan ympärillä, joten alin ja ylin kortti riittävät.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.Saannot = factory();
    }
})(this, function () {
    'use strict';

    // Ristiseiskassa ässä on alin. Seiskan indeksi on 6, eli 13 paikan keskellä.
    const ORDER = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
    const SEVEN = 6;

    function orderIndex(rank) {
        return ORDER.indexOf(rank);
    }

    function emptyTable() {
        return { spades: null, hearts: null, diamonds: null, clubs: null };
    }

    // Seuraavaksi maahan sopivat arvot: alapää ensin, sitten yläpää.
    // - Maata ei ole aloitettu: 7.
    // - Vain 7: 6.
    // - 6 ja 7: 8. Pienet kortit (5 alaspäin) avautuvat vasta, kun 8 on pöydässä.
    // - Muuten alapäästä seuraava pienempi (ässään asti) ja yläpäästä seuraava suurempi (kuninkaaseen asti).
    function nextCards(table, suit) {
        const pile = table[suit];
        if (!pile) return ['7'];
        const low = orderIndex(pile.low);
        const high = orderIndex(pile.high);
        if (low === SEVEN && high === SEVEN) return ['6'];
        if (high === SEVEN) return ['8'];
        const result = [];
        if (low > 0) result.push(ORDER[low - 1]);
        if (high < ORDER.length - 1) result.push(ORDER[high + 1]);
        return result;
    }

    function isPlayable(table, card) {
        return nextCards(table, card.suit).includes(card.rank);
    }

    function playableCards(table, hand) {
        return hand.filter(card => isPlayable(table, card));
    }

    // Lisää kortin pöytään. Kortin oletetaan sopivan (isPlayable).
    function placeCard(table, card) {
        const pile = table[card.suit];
        if (!pile) {
            table[card.suit] = { low: card.rank, high: card.rank };
            return;
        }
        if (orderIndex(card.rank) < orderIndex(pile.low)) pile.low = card.rank;
        else pile.high = card.rank;
    }

    function isComplete(table, suit) {
        const pile = table[suit];
        return !!pile && pile.low === 'A' && pile.high === 'K';
    }

    return { ORDER, SEVEN, orderIndex, emptyTable, nextCards, isPlayable, playableCards, placeCard, isComplete };
});
