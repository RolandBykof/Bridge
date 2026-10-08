/**
 * Opening lead choice among cards the double dummy solver rates equal.
 *
 * The solver often finds several leads that all hold declarer to the same
 * number of tricks (in one test deal, ten of the leader's thirteen cards).
 * The trick count can't tell them apart, so the tie is broken with the
 * standard defensive leading principles a human defender would use: first
 * pick the suit, then the conventional card in that suit.
 *
 * Suit choice:
 *   - partner's bid suit first; avoid suits declarer or dummy bid
 *   - against no-trump: the longest and strongest suit
 *   - against a suit contract: a top honour sequence, a short side suit
 *     (singleton or small doubleton) or a passive lead from small cards;
 *     don't underlead an ace, lead away from a king or an AQ tenace,
 *     and avoid leading trumps
 *
 * Card within the suit:
 *   - top of a sequence (AK, KQ, QJ, J10 against a suit; three touching
 *     cards or KQ10/QJ9-type broken ones against no-trump)
 *   - top of an interior sequence (KJ10 -> J, Q109 -> 10)
 *   - the ace from a suit headed by it against a suit contract
 *   - top of a doubleton, the singleton
 *   - fourth best from four or more cards headed by an honour, the lowest
 *     from three to an honour
 *   - top of nothing from three small cards, second highest from four or
 *     more small cards
 */

const RANK_ORDER = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const HCP = { A: 4, K: 3, Q: 2, J: 1 };
const BID_SUIT = { C: 'clubs', D: 'diamonds', H: 'hearts', S: 'spades' };
const PARTNER = { north: 'south', south: 'north', east: 'west', west: 'east' };

const rankValue = (card) => RANK_ORDER.indexOf(card);
const touching = (a, b) => rankValue(a) - rankValue(b) === 1;
const isHonour = (card) => rankValue(card) >= rankValue('J');

function sortDesc(cards) {
    return [...cards].sort((a, b) => rankValue(b) - rankValue(a));
}

/**
 * Conventional lead from one suit holding (array of ranks). `noTrump` is
 * true against a no-trump contract.
 */
function conventionalLeadCard(holding, noTrump) {
    const s = sortDesc(holding);
    if (s.length <= 2) return s[0];

    // Top sequence
    if (touching(s[0], s[1])) {
        const threeTouching = touching(s[1], s[2]);
        const brokenThree = rankValue(s[1]) - rankValue(s[2]) === 2;   // KQ10, QJ9
        const twoHonours = rankValue(s[1]) >= rankValue('10');           // AK, KQ, QJ, J10
        if (threeTouching || brokenThree) return s[0];
        if (!noTrump && twoHonours) return s[0];
    }

    // Interior sequence: a high card, a gap, then two touching cards
    // headed by the ten or better (AJ10, KJ10, K109, Q109).
    if (!touching(s[0], s[1]) && isHonour(s[0]) &&
        touching(s[1], s[2]) && rankValue(s[1]) >= rankValue('10')) {
        return s[1];
    }

    // Don't underlead an ace against a suit contract.
    if (!noTrump && s[0] === 'A') return 'A';

    if (isHonour(s[0])) {
        return s.length >= 4 ? s[3] : s[s.length - 1];   // fourth best / low from three
    }
    return s.length === 3 ? s[0] : s[1];                  // top of nothing / second highest
}

/** Suits bid (by strain, not no-trump) by the given players. */
function suitsBidBy(auction, players) {
    const suits = new Set();
    for (const entry of auction || []) {
        if (!players.includes(entry.player)) continue;
        const suit = BID_SUIT[String(entry.bid || '').charAt(1)];
        if (suit) suits.add(suit);
    }
    return suits;
}

/**
 * How attractive leading from `suit` is, by the principles above. Only
 * compares suits with each other: every candidate is already double dummy
 * equal, so this just picks the lead a sound defender would choose.
 */
function suitScore(suit, holding, { trump, partnerSuits, opponentSuits, trumpLength }) {
    const s = sortDesc(holding);
    const len = s.length;
    const has = (card) => s.includes(card);
    const hcp = s.reduce((n, c) => n + (HCP[c] || 0), 0);
    let score = 0;

    if (partnerSuits.has(suit)) score += 50;
    if (opponentSuits.has(suit)) score -= 30;

    if (!trump) {
        // Against no-trump: set up the long suit.
        score += len * 4 + hcp;
        if (len >= 3 && touching(s[0], s[1]) && isHonour(s[1])) score += 10;
        return score;
    }

    if (suit === trump) score -= 20;

    const topSequence = len >= 2 && touching(s[0], s[1]) && rankValue(s[1]) >= rankValue('10');
    if (topSequence) score += rankValue(s[1]) >= rankValue('J') ? 25 : 10;

    if (suit !== trump && trumpLength > 0) {
        if (len === 1) score += 15;                           // hoping for a ruff
        if (len === 2 && !isHonour(s[0])) score += 5;
    }
    if (!isHonour(s[0])) score += 5;                          // passive, gives nothing away

    if (!topSequence && len >= 2) {
        if (has('A') && !has('K')) score -= 20;               // unsupported ace
        if (has('K') && !has('A') && !has('Q')) score -= 15;  // leading away from a king
        if (has('Q') && !has('K') && !has('J')) score -= 8;
    }
    score += len;
    return score;
}

/**
 * Pick the opening lead among `candidates` ([{ suit, card }], all equally
 * good double dummy). `hand` is the leader's full thirteen cards in the
 * server's shape { spades: [...], ... }; `trump` a suit name or null;
 * `auction` the bid history [{ player, bid }].
 */
function chooseOpeningLead({ hand, trump, candidates, auction, leader }) {
    if (!candidates || candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0];

    const partner = PARTNER[leader];
    const opponents = Object.keys(PARTNER).filter(p => p !== leader && p !== partner);
    const context = {
        trump: trump || null,
        partnerSuits: suitsBidBy(auction, [partner]),
        opponentSuits: suitsBidBy(auction, opponents),
        trumpLength: trump ? (hand[trump] || []).length : 0
    };

    let best = null;
    for (const suit of ['spades', 'hearts', 'diamonds', 'clubs']) {
        const inSuit = candidates.filter(c => c.suit === suit);
        if (inSuit.length === 0) continue;

        const holding = hand[suit] || [];
        const wanted = conventionalLeadCard(holding, !trump);
        let pick = inSuit.find(c => c.card === wanted);
        let score = suitScore(suit, holding, context);
        if (!pick) {
            // The conventional card costs a trick here; take the equal card
            // nearest to it, and prefer suits where the normal card works.
            pick = inSuit.reduce((a, b) =>
                Math.abs(rankValue(b.card) - rankValue(wanted)) < Math.abs(rankValue(a.card) - rankValue(wanted)) ? b : a);
            score -= 5;
        }
        if (!best || score > best.score) best = { score, pick };
    }
    return best.pick;
}

module.exports = { chooseOpeningLead, conventionalLeadCard };
