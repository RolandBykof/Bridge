// Korttien perustiedot ja suomenkieliset nimet. Käytössä sekä palvelimella
// (game.js, require) että selaimessa (window.Kortit).
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.Kortit = factory();
    }
})(this, function () {
    'use strict';

    // Sama maajärjestys kuin Accessible Bridgessä.
    const SUITS = ['spades', 'hearts', 'diamonds', 'clubs'];
    const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

    const SUIT_SYMBOLS = { spades: '♠', hearts: '♥', diamonds: '♦', clubs: '♣' };
    const SUIT_NAMES = { spades: 'pata', hearts: 'hertta', diamonds: 'ruutu', clubs: 'risti' };
    // Partitiivi lukumäärän kanssa: "2 pataa", "3 ristiä".
    const SUIT_PARTITIVES = { spades: 'pataa', hearts: 'herttaa', diamonds: 'ruutua', clubs: 'ristiä' };
    // "Ei patoja", "Ei ristejä".
    const SUIT_NONE = { spades: 'Ei patoja', hearts: 'Ei herttoja', diamonds: 'Ei ruutuja', clubs: 'Ei ristejä' };
    const RANK_NAMES = { J: 'jätkä', Q: 'rouva', K: 'kuningas', A: 'ässä' };

    function cardId(card) {
        return `${card.suit}-${card.rank}`;
    }

    function parseCardId(id) {
        if (typeof id !== 'string') return null;
        const [suit, rank] = id.split('-');
        if (!SUITS.includes(suit) || !RANKS.includes(rank)) return null;
        return { suit, rank };
    }

    function rankValue(rank) {
        return RANKS.indexOf(rank);
    }

    function isMaija(card) {
        return card.suit === 'spades' && card.rank === 'Q';
    }

    function rankName(rank) {
        return RANK_NAMES[rank] || rank;
    }

    function capitalize(text) {
        return text.charAt(0).toUpperCase() + text.slice(1);
    }

    // "pata rouva", "hertta 10"
    function cardName(card) {
        return `${SUIT_NAMES[card.suit]} ${rankName(card.rank)}`;
    }

    // Peräkkäiset saman maan kortit ryhmitellään: "pata 2, 3, 4, hertta 10".
    function formatCardList(cards) {
        const parts = [];
        let previousSuit = null;
        for (const card of cards) {
            if (card.suit === previousSuit) {
                parts.push(rankName(card.rank));
            } else {
                parts.push(cardName(card));
                previousSuit = card.suit;
            }
        }
        return parts.join(', ');
    }

    function sortCards(cards) {
        return cards.sort((a, b) => {
            if (a.suit !== b.suit) return SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit);
            return rankValue(a.rank) - rankValue(b.rank);
        });
    }

    // plural(1, 'kortti', 'korttia') -> "1 kortti"
    function plural(count, one, many) {
        return `${count} ${count === 1 ? one : many}`;
    }

    return {
        SUITS, RANKS, SUIT_SYMBOLS, SUIT_NAMES, SUIT_PARTITIVES, SUIT_NONE, RANK_NAMES,
        cardId, parseCardId, rankValue, isMaija, rankName, cardName, formatCardList,
        sortCards, plural, capitalize
    };
});
