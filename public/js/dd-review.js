// Double dummy -katselun puhtaat apufunktiot. Käytössä sekä palvelimella
// (server.js, require) että selaimessa (window.DdReview), jotta tikkien
// voittajat ja kädet tikin alussa lasketaan molemmissa samalla tavalla.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.DdReview = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
    const SUITS = ['spades', 'hearts', 'diamonds', 'clubs'];

    function isNorthSouth(position) {
        return position === 'north' || position === 'south';
    }

    /**
     * Winner of one trick. `cards` are [{ player, suit, card }] in play
     * order; `trump` is a suit name or null for no-trump.
     */
    function trickWinner(cards, trump) {
        let best = cards[0];
        for (let i = 1; i < cards.length; i++) {
            const c = cards[i];
            if (c.suit === best.suit) {
                if (RANKS.indexOf(c.card) > RANKS.indexOf(best.card)) best = c;
            } else if (trump && c.suit === trump) {
                best = c;
            }
        }
        return best.player;
    }

    /**
     * Groups a full play sequence (52 cards, play order) into tricks with the
     * winner and the running trick count after each trick.
     */
    function buildTricks(plays, trump, declarer) {
        const tricks = [];
        let declarerTricks = 0;
        let defenderTricks = 0;
        for (let i = 0; i + 4 <= plays.length; i += 4) {
            const cards = plays.slice(i, i + 4).map(c => ({ player: c.player, suit: c.suit, card: c.card }));
            const winner = trickWinner(cards, trump);
            if (isNorthSouth(winner) === isNorthSouth(declarer)) declarerTricks++;
            else defenderTricks++;
            tricks.push({
                number: tricks.length + 1,
                leader: cards[0].player,
                winner,
                cards,
                declarerTricks,
                defenderTricks
            });
        }
        return tricks;
    }

    /**
     * Every hand as it was at the start of trick `index` (0-based):
     * the original hands minus the cards of tricks 0 .. index-1.
     */
    function handsBeforeTrick(originalHands, tricks, index) {
        const hands = {};
        for (const position of Object.keys(originalHands)) {
            hands[position] = {};
            for (const suit of SUITS) {
                hands[position][suit] = (originalHands[position][suit] || []).slice();
            }
        }
        for (let t = 0; t < index && t < tricks.length; t++) {
            for (const c of tricks[t].cards) {
                const suitCards = hands[c.player] && hands[c.player][c.suit];
                if (!suitCards) continue;
                const at = suitCards.indexOf(c.card);
                if (at >= 0) suitCards.splice(at, 1);
            }
        }
        return hands;
    }

    return { RANKS, SUITS, trickWinner, buildTricks, handsBeforeTrick };
}));
