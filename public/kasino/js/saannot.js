// Kasinon säännöt: korttien arvot, otto ja pisteet. Käytössä sekä palvelimella
// (require) että selaimessa (window.Saannot).
//
// Kortilla on kaksi arvoa: käsiarvo (pelattaessa) ja pöytäarvo (pöydässä).
// Ässä 14/1, patakakkonen (pieni kasino) 15/2, ruutukymppi (iso kasino) 16/10.
// Otto perustuu pelkkään käsiarvoon: ässällä ei voi ottaa pöydän ässää, vaan
// ainoastaan kortteja, joiden summa on 14.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.Saannot = factory();
    }
})(this, function () {
    'use strict';

    const SUITS = ['spades', 'hearts', 'diamonds', 'clubs'];
    const HAND_SIZE = 4;
    const TABLE_START = 4;
    const GAME_END_SCORE = 16;
    const CARD_WIN_POINTS = 1;
    const SPADE_WIN_POINTS = 2;
    const ACE_POINTS = 1;
    const SMALL_CASINO_POINTS = 1;
    const BIG_CASINO_POINTS = 2;
    const CABIN_POINTS = 1;
    // Korttivoitto ja patavoitto ovat varmoja, kun niitä ei voi enää menettää.
    const SURE_CARD_WIN = 27;       // yli puolet 52 kortista
    const SURE_SPADE_WIN = 7;       // yli puolet 13 padasta

    const TABLE_VALUES = {
        A: 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10,
        J: 11, Q: 12, K: 13
    };

    function isSmallCasino(card) {
        return card.suit === 'spades' && card.rank === '2';
    }

    function isBigCasino(card) {
        return card.suit === 'diamonds' && card.rank === '10';
    }

    function tableValue(card) {
        return TABLE_VALUES[card.rank];
    }

    function handValue(card) {
        if (card.rank === 'A') return 14;
        if (isSmallCasino(card)) return 15;
        if (isBigCasino(card)) return 16;
        return tableValue(card);
    }

    // Kortin pisteet jaon lopussa (ässät ja kasinot).
    function cardPoints(card) {
        if (card.rank === 'A') return ACE_POINTS;
        if (isSmallCasino(card)) return SMALL_CASINO_POINTS;
        if (isBigCasino(card)) return BIG_CASINO_POINTS;
        return 0;
    }

    // Pöytä luetaan ja näytetään arvojärjestyksessä, saman arvon kortit maajärjestyksessä.
    function sortTable(cards) {
        return cards.sort((a, b) => tableValue(a) - tableValue(b) || SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit));
    }

    // Kaikki pöydän korttien osajoukot (indeksilistoina), joiden pöytäarvojen summa on target.
    function groupsFor(target, table) {
        const order = table.map((card, i) => i).sort((a, b) => tableValue(table[a]) - tableValue(table[b]));
        const groups = [];
        const chosen = [];
        (function search(start, sum) {
            if (sum === target) {
                groups.push(chosen.slice().sort((a, b) => a - b));
                return;
            }
            for (let k = start; k < order.length; k++) {
                const value = tableValue(table[order[k]]);
                if (sum + value > target) break;        // järjestetty: isommat eivät mahdu
                chosen.push(order[k]);
                search(k + 1, sum + value);
                chosen.pop();
            }
        })(0, 0);
        return groups;
    }

    // Oton arvo: ensin korttien määrä, sitten pisteet, sitten padat.
    function captureRank(cards) {
        return [
            cards.length,
            cards.reduce((sum, c) => sum + cardPoints(c), 0),
            cards.filter(c => c.suit === 'spades').length
        ];
    }

    function better(a, b) {
        for (let i = 0; i < a.length; i++) {
            if (a[i] !== b[i]) return a[i] > b[i];
        }
        return false;
    }

    // Suurin otto kortilla card: mahdollisimman monta pöydän korttia erillisinä
    // ryhminä, joiden summa on käsiarvo. Tasatilanteessa pisteet ja padat ratkaisevat.
    // Palauttaa { cards, groups } (pöydän kortteja) tai null, jos mitään ei saa.
    function bestCapture(card, table) {
        const groups = groupsFor(handValue(card), table);
        if (groups.length === 0) return null;
        // Ryhmät pienimmän indeksinsä mukaan: jokainen yhdistelmä käydään läpi kerran.
        const byFirst = table.map(() => []);
        for (const g of groups) byFirst[g[0]].push(g);

        const used = table.map(() => false);
        const picked = [];
        let best = null;
        let bestRank = null;
        (function search(i) {
            while (i < table.length && used[i]) i++;
            if (i === table.length) {
                if (picked.length === 0) return;
                const cards = picked.flat().map(k => table[k]);
                const rank = captureRank(cards);
                if (!best || better(rank, bestRank)) {
                    best = picked.map(g => g.slice());
                    bestRank = rank;
                }
                return;
            }
            // Kortti i jää pöytään...
            search(i + 1);
            // ...tai se otetaan jonkin ryhmän mukana.
            for (const g of byFirst[i]) {
                if (g.some(k => used[k])) continue;
                g.forEach(k => { used[k] = true; });
                picked.push(g);
                search(i + 1);
                picked.pop();
                g.forEach(k => { used[k] = false; });
            }
        })(0);

        const indexes = best.flat().sort((a, b) => a - b);
        return {
            cards: indexes.map(k => table[k]),
            groups: best.map(g => g.map(k => table[k]))
        };
    }

    // Kerättyjen korttien yhteenveto.
    function summarizePile(cards) {
        return {
            cards: cards.length,
            spades: cards.filter(c => c.suit === 'spades').length,
            aces: cards.filter(c => c.rank === 'A').length,
            smallCasino: cards.some(isSmallCasino),
            bigCasino: cards.some(isBigCasino)
        };
    }

    // Pistekorttien pisteet yhteenvedosta.
    function pilePoints(summary) {
        return summary.aces * ACE_POINTS
            + (summary.smallCasino ? SMALL_CASINO_POINTS : 0)
            + (summary.bigCasino ? BIG_CASINO_POINTS : 0);
    }

    // Ainoa suurimman arvon saanut indeksi, tai -1 tasatilanteessa.
    function uniqueMax(values) {
        const top = Math.max(...values);
        const winners = values.map((v, i) => (v === top ? i : -1)).filter(i => i !== -1);
        return winners.length === 1 ? winners[0] : -1;
    }

    return {
        SUITS, HAND_SIZE, TABLE_START, GAME_END_SCORE,
        CARD_WIN_POINTS, SPADE_WIN_POINTS, ACE_POINTS, SMALL_CASINO_POINTS, BIG_CASINO_POINTS, CABIN_POINTS,
        SURE_CARD_WIN, SURE_SPADE_WIN,
        isSmallCasino, isBigCasino, tableValue, handValue, cardPoints, sortTable,
        groupsFor, bestCapture, summarizePile, pilePoints, uniqueMax
    };
});
