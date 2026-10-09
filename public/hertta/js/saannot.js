// Hertan säännöt ja englanninkieliset korttien nimet. Käytössä sekä palvelimella
// (require) että selaimessa (window.HerttaSaannot). Peli on englanniksi.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.HerttaSaannot = factory();
    }
})(this, function () {
    'use strict';

    const SUITS = ['spades', 'hearts', 'diamonds', 'clubs'];
    const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
    const RANK_WORDS = { J: 'jack', Q: 'queen', K: 'king', A: 'ace' };
    const SUIT_SINGULAR = { spades: 'spade', hearts: 'heart', diamonds: 'diamond', clubs: 'club' };

    // Kierrokset toistuvat tässä järjestyksessä: vasemmalle, oikealle, vastapäätä, ei vaihtoa.
    const PASS_DIRECTIONS = ['left', 'right', 'across', 'none'];
    // Vastaanottajan paikka antajaan nähden (pelaajat myötäpäivään, seuraava = vasen).
    const PASS_OFFSETS = { left: 1, right: 3, across: 2 };
    const PASS_COUNT = 3;
    const GAME_END_SCORE = 50;

    function rankValue(rank) {
        return RANKS.indexOf(rank);
    }

    function rankWord(rank) {
        return RANK_WORDS[rank] || rank;
    }

    // "queen of spades", "10 of hearts"
    function cardName(card) {
        return `${rankWord(card.rank)} of ${card.suit}`;
    }

    function isQueenOfSpades(card) {
        return card.suit === 'spades' && card.rank === 'Q';
    }

    function isTwoOfClubs(card) {
        return card.suit === 'clubs' && card.rank === '2';
    }

    function isTenOfDiamonds(card) {
        return card.suit === 'diamonds' && card.rank === '10';
    }

    // Hertta 1, pata rouva 13, ruutu 10 miinus 10.
    function points(card) {
        if (card.suit === 'hearts') return 1;
        if (isQueenOfSpades(card)) return 13;
        if (isTenOfDiamonds(card)) return -10;
        return 0;
    }

    function trickPoints(cards) {
        return cards.reduce((sum, card) => sum + points(card), 0);
    }

    // Tikin voittaa aloitetun maan suurin kortti. Palauttaa indeksin.
    function trickWinner(cards) {
        const lead = cards[0].suit;
        let best = 0;
        cards.forEach((card, i) => {
            if (card.suit === lead && rankValue(card.rank) > rankValue(cards[best].rank)) best = i;
        });
        return best;
    }

    function isPenalty(card) {
        return card.suit === 'hearts' || isQueenOfSpades(card);
    }

    // Selittää, miksi kortin lyöminen ei ole sallittu. null = sallittu.
    // ctx: { lead: aloitettu maa tai null, firstTrick, heartsBroken }.
    function illegalReason(hand, card, ctx) {
        if (ctx.lead === null) {
            if (ctx.firstTrick && !isTwoOfClubs(card)) return 'The first trick must be led with the 2 of clubs.';
            if (card.suit === 'hearts' && !ctx.heartsBroken && hand.some(c => c.suit !== 'hearts')) {
                return 'Hearts have not been broken yet. Lead another suit.';
            }
            return null;
        }
        if (card.suit !== ctx.lead && hand.some(c => c.suit === ctx.lead)) {
            return `You must follow suit: play a ${SUIT_SINGULAR[ctx.lead]}.`;
        }
        if (ctx.firstTrick && card.suit !== ctx.lead && isPenalty(card) && hand.some(c => !isPenalty(c))) {
            return 'Hearts and the queen of spades cannot be played on the first trick.';
        }
        return null;
    }

    function legalCards(hand, ctx) {
        return hand.filter(card => illegalReason(hand, card, ctx) === null);
    }

    return {
        SUITS, RANKS, SUIT_SINGULAR, PASS_DIRECTIONS, PASS_OFFSETS, PASS_COUNT, GAME_END_SCORE,
        rankValue, rankWord, cardName, isQueenOfSpades, isTwoOfClubs, isTenOfDiamonds,
        points, trickPoints, trickWinner, illegalReason, legalCards
    };
});
