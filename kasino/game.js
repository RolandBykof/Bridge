'use strict';
// Kasinon pelilogiikka. Ei tiedä mitään yhteyksistä eikä ajastimista, joten sitä
// voi testata suoraan (game.test.js).
//
// Peli koostuu jaoista. Jaon alussa jokaiselle jaetaan 4 korttia ja pöytään 4.
// Kun kaikkien kädet ovat tyhjät, jaetaan 4 uutta korttia, kunnes pakka loppuu.
// Jaon jälkeen lasketaan pisteet, ja peli päättyy, kun joku saavuttaa 16 pistettä
// (GAME_END_SCORE). Kesken jaon peli päättyy heti, kun jollakulla on varmasti 16.

const { sortCards, cardName } = require('../public/korttipelit/kortit.js');
const {
    SUITS, HAND_SIZE, TABLE_START, GAME_END_SCORE, CARD_WIN_POINTS, SPADE_WIN_POINTS, CABIN_POINTS,
    SURE_CARD_WIN, SURE_SPADE_WIN,
    sortTable, bestCapture, summarizePile, pilePoints, uniqueMax
} = require('../public/kasino/js/saannot.js');

const MIN_PLAYERS = 2;
const MAX_PLAYERS = 4;
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

// Virhe, joka johtuu pelaajan siirrosta. Viesti näytetään pelaajalle sellaisenaan.
class GameError extends Error {}

function createDeck() {
    const deck = [];
    for (const suit of SUITS) {
        for (const rank of RANKS) {
            deck.push({ suit, rank });
        }
    }
    return deck;
}

function shuffle(array, rng) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

const idOf = card => `${card.suit}-${card.rank}`;

class Game {
    // players: [{ id, name }] istumajärjestyksessä (myötäpäivään). dealerIndex:
    // ensimmäisen jaon jakaja; jos sitä ei anneta, jakaja arvotaan.
    // progress: tallennetun pelin jatkaminen (toProgress()); players samassa järjestyksessä.
    constructor(players, { rng = Math.random, dealerIndex = null, progress = null } = {}) {
        if (players.length < MIN_PLAYERS || players.length > MAX_PLAYERS) {
            throw new GameError(`Kasinoon tarvitaan ${MIN_PLAYERS}–${MAX_PLAYERS} pelaajaa.`);
        }
        this.rng = rng;
        this.players = players.map(p => ({
            id: p.id, name: p.name, hand: [], pile: [], cabins: 0, score: 0
        }));
        this.dealer = dealerIndex !== null ? dealerIndex : Math.floor(rng() * players.length);
        this.round = 0;
        this.history = [];          // [{ round, points: [pelaajien pisteet istumajärjestyksessä] }]
        this.carry = { cards: 0, spades: 0 };   // tasan menneet voitot siirtyvät seuraavaan jakoon
        this.winnerIds = [];
        this.moves = 0;             // kasvaa jokaisesta siirrosta (robottien ajastus)
        if (progress) this.applyProgress(progress);
        this.startRound();
        this.startEvents = [];      // pöytä välittää jatketun pelin aloitustapahtumat
    }

    // Tallennettava eteneminen jakojen välissä. Kesken oleva jako pelataan uudelleen.
    toProgress() {
        const finished = this.phase === 'round-over' || this.phase === 'over';
        return {
            round: finished ? this.round + 1 : this.round,
            dealer: finished ? (this.dealer + 1) % this.players.length : this.dealer,
            scores: this.players.map(p => p.score),
            history: this.history.map(h => ({ round: h.round, points: h.points.slice() })),
            carry: { ...(finished ? this.carry : this.roundStartCarry) }
        };
    }

    applyProgress(progress) {
        const n = this.players.length;
        const { round, dealer, scores, history, carry } = progress;
        const valid = Number.isInteger(round) && round >= 1
            && Number.isInteger(dealer) && dealer >= 0 && dealer < n
            && Array.isArray(scores) && scores.length === n && scores.every(Number.isFinite)
            && Array.isArray(history) && history.every(h => h && Array.isArray(h.points))
            && (!carry || (Number.isInteger(carry.cards) && Number.isInteger(carry.spades)));
        if (!valid) throw new GameError('Tallennettua peliä ei voitu lukea.');
        this.players.forEach((p, i) => { p.score = scores[i]; });
        this.history = history.map(h => ({ round: h.round, points: h.points.slice() }));
        this.carry = carry ? { cards: carry.cards, spades: carry.spades } : { cards: 0, spades: 0 };
        // startRound() kasvattaa jakoa ja siirtää jakajaa (jaosta 2 alkaen).
        this.round = round - 1;
        this.dealer = round > 1 ? (dealer + n - 1) % n : dealer;
    }

    // Pöydän aloitustapahtumaan lisättävät tiedot (korttipelit/poydat.js).
    startInfo() {
        const starter = this.players[this.current];
        return {
            round: this.round, table: this.table.slice(),
            starterId: starter.id, starterName: starter.name
        };
    }

    indexOf(playerId) {
        return this.players.findIndex(p => p.id === playerId);
    }

    player(playerId) {
        return this.players[this.indexOf(playerId)] || null;
    }

    startRound() {
        this.round++;
        if (this.round > 1) this.dealer = (this.dealer + 1) % this.players.length;
        this.deck = shuffle(createDeck(), this.rng);
        for (const p of this.players) {
            p.hand = [];
            p.pile = [];
            p.cabins = 0;
        }
        this.table = sortTable(this.deck.splice(0, TABLE_START));
        this.dealHands();
        this.lastTaker = null;
        this.lastMove = null;
        this.roundResult = null;
        this.roundStartCarry = { ...this.carry };
        this.current = (this.dealer + 1) % this.players.length;     // etukäsi
        this.phase = 'play';        // 'play' | 'round-over' | 'over'
        const dealer = this.players[this.dealer];
        const starter = this.players[this.current];
        return [{
            type: 'round-start', round: this.round, dealerId: dealer.id, dealerName: dealer.name,
            table: this.table.slice(), starterId: starter.id, starterName: starter.name
        }];
    }

    // Jokaiselle 4 korttia etukädestä alkaen.
    dealHands() {
        const n = this.players.length;
        for (let k = 0; k < HAND_SIZE; k++) {
            for (let i = 1; i <= n; i++) {
                this.players[(this.dealer + i) % n].hand.push(this.deck.shift());
            }
        }
        this.players.forEach(p => sortCards(p.hand));
    }

    // Pakka on tyhjä: viimeinen käsi, jolloin mökkejä ei lasketa.
    get lastHand() {
        return this.deck.length === 0;
    }

    findInHand(player, id) {
        if (typeof id !== 'string') throw new GameError('Virheellinen kortti.');
        const card = player.hand.find(c => idOf(c) === id);
        if (!card) throw new GameError('Sinulla ei ole sitä korttia.');
        return card;
    }

    requireTurn(playerId) {
        if (this.phase !== 'play') throw new GameError('Kortteja ei nyt pelata.');
        const player = this.players[this.current];
        if (!player || player.id !== playerId) {
            if (!this.player(playerId)) throw new GameError('Et pelaa tässä pelissä.');
            throw new GameError(`Ei ole sinun vuorosi. Vuorossa: ${player.name}.`);
        }
        return player;
    }

    // Kortti pöytään. Lyödä saa aina, vaikka kortilla voisi ottaa.
    lay(playerId, id) {
        const player = this.requireTurn(playerId);
        const card = this.findInHand(player, id);
        player.hand = player.hand.filter(c => c !== card);
        this.table.push(card);
        sortTable(this.table);
        this.lastMove = { type: 'lay', playerId: player.id, name: player.name, card, taken: [] };
        this.moves++;
        return [{ type: 'lay', playerId: player.id, name: player.name, card }, ...this.advance()];
    }

    // Kortilla otetaan pöydästä kaikki, minkä sillä saa (bestCapture).
    take(playerId, id) {
        const player = this.requireTurn(playerId);
        const card = this.findInHand(player, id);
        if (this.table.length === 0) throw new GameError('Pöytä on tyhjä. Lyö kortti L:llä.');
        const capture = bestCapture(card, this.table);
        if (!capture) throw new GameError(`Kortilla ${cardName(card)} ei saa pöydästä mitään.`);

        player.hand = player.hand.filter(c => c !== card);
        this.table = this.table.filter(c => !capture.cards.includes(c));
        player.pile.push(card, ...capture.cards);
        this.lastTaker = this.indexOf(player.id);

        // Mökki: pöytä tyhjeni. Kaksinpelissä kaadetaan ensin vastustajan mökki.
        let cabin = null;
        let knocked = null;
        if (this.table.length === 0) {
            if (this.lastHand) {
                cabin = 'ignored';
            } else {
                const opponent = this.players.length === 2 ? this.players.find(p => p !== player) : null;
                if (opponent && opponent.cabins > 0) {
                    opponent.cabins--;
                    cabin = 'knocked';
                    knocked = { id: opponent.id, name: opponent.name };
                } else {
                    player.cabins++;
                    cabin = 'made';
                }
            }
        }
        this.lastMove = { type: 'take', playerId: player.id, name: player.name, card, taken: capture.cards };
        this.moves++;
        const event = {
            type: 'take', playerId: player.id, name: player.name, card,
            taken: capture.cards, cabin,
            knockedId: knocked ? knocked.id : null, knockedName: knocked ? knocked.name : null
        };
        const early = this.checkEarlyWin();
        if (early) return [event, ...early];
        return [event, ...this.advance()];
    }

    // Vuoro seuraavalle. Kun kädet ovat tyhjät, jaetaan uudet kortit tai jako päättyy.
    advance() {
        this.current = (this.current + 1) % this.players.length;
        if (this.players.some(p => p.hand.length > 0)) return [];
        if (this.deck.length > 0) {
            this.dealHands();
            const deal = {
                type: 'deal', deckCount: this.deck.length, lastHand: this.lastHand,
                hands: this.players.map(p => ({ id: p.id, cards: p.hand.slice() }))
            };
            // Kaksinpelin mökit ovat varmoja vasta viimeisessä kädessä.
            return [deal, ...(this.lastHand ? this.checkEarlyWin() || [] : [])];
        }
        return this.finishRound();
    }

    // Pelaajan varmat pisteet kesken jaon: pistekortit, mökit (kaksinpelissä vasta,
    // kun niitä ei voi enää kaataa) sekä kortti- ja patavoitto, jos ne ovat jo varmoja.
    securedPoints(player) {
        const summary = summarizePile(player.pile);
        let points = player.score + pilePoints(summary);
        if (this.players.length > 2 || this.lastHand) points += player.cabins * CABIN_POINTS;
        if (summary.cards >= SURE_CARD_WIN) points += CARD_WIN_POINTS + this.carry.cards;
        if (summary.spades >= SURE_SPADE_WIN) points += SPADE_WIN_POINTS + this.carry.spades;
        return points;
    }

    // Peli päättyy kesken jaon heti, kun jollakulla on varmasti 16 pistettä.
    // Jos useammalla on yhtä paljon, jako jatkuu.
    checkEarlyWin() {
        const secured = this.players.map(p => this.securedPoints(p));
        const top = Math.max(...secured);
        if (top < GAME_END_SCORE) return null;
        const leaders = this.players.filter((p, i) => secured[i] === top);
        if (leaders.length > 1) return null;
        const player = leaders[0];
        const points = this.players.map((p, i) => secured[i] - p.score);
        this.players.forEach((p, i) => { p.score += points[i]; });
        this.history.push({ round: this.round, points });
        this.current = null;
        this.winnerIds = [player.id];
        this.phase = 'over';
        return [{
            type: 'over', early: true,
            winnerIds: this.winnerIds, winnerNames: [player.name], winningScore: player.score,
            ranking: this.ranking()
        }];
    }

    finishRound() {
        const events = [];
        // Pöytään jääneet kortit viimeksi ottaneelle. Ne eivät ole mökki.
        if (this.table.length > 0 && this.lastTaker !== null) {
            const taker = this.players[this.lastTaker];
            const cards = this.table;
            taker.pile.push(...cards);
            this.table = [];
            events.push({ type: 'sweep', playerId: taker.id, name: taker.name, cards });
        }
        this.current = null;

        const summaries = this.players.map(p => summarizePile(p.pile));
        const cardWinner = uniqueMax(summaries.map(s => s.cards));
        const spadeWinner = uniqueMax(summaries.map(s => s.spades));
        const cardWinPoints = CARD_WIN_POINTS + this.carry.cards;
        const spadeWinPoints = SPADE_WIN_POINTS + this.carry.spades;
        const carriedIn = { ...this.carry };
        this.carry = {
            cards: cardWinner === -1 ? cardWinPoints : 0,
            spades: spadeWinner === -1 ? spadeWinPoints : 0
        };

        // Pisteet lasketaan säännön järjestyksessä: pistekortit ja mökit, korttivoitto, patavoitto.
        const steps = [
            this.players.map((p, i) => pilePoints(summaries[i]) + p.cabins * CABIN_POINTS),
            this.players.map((p, i) => (i === cardWinner ? cardWinPoints : 0)),
            this.players.map((p, i) => (i === spadeWinner ? spadeWinPoints : 0))
        ];
        const roundPoints = this.players.map((p, i) => steps.reduce((sum, s) => sum + s[i], 0));
        const before = this.players.map(p => p.score);
        this.players.forEach((p, i) => { p.score += roundPoints[i]; });
        this.history.push({ round: this.round, points: roundPoints });

        const results = this.players.map((p, i) => ({
            id: p.id, name: p.name, ...summaries[i], cabins: p.cabins,
            points: roundPoints[i], total: p.score
        }));
        const winnerOf = i => (i === -1 ? null : { id: this.players[i].id, name: this.players[i].name });
        this.roundResult = {
            round: this.round, results,
            cardWinner: winnerOf(cardWinner), cardWinPoints,
            spadeWinner: winnerOf(spadeWinner), spadeWinPoints,
            carriedIn, carry: { ...this.carry }
        };
        events.push({ type: 'round-over', ...this.roundResult });

        const winners = this.gameWinners(before, steps);
        if (winners) {
            this.winnerIds = winners.map(i => this.players[i].id);
            this.phase = 'over';
            events.push({
                type: 'over', early: false,
                winnerIds: this.winnerIds, winnerNames: winners.map(i => this.players[i].name),
                winningScore: this.players[winners[0]].score,
                ranking: this.ranking()
            });
        } else {
            this.phase = 'round-over';
        }
        return events;
    }

    // Voittaja jaon lopussa: se, joka ensimmäisenä laskuvaiheena saavuttaa 16.
    // Jos useampi saavuttaa sen samassa vaiheessa, enemmän pisteitä voittaa.
    // Täysi tasapeli ratkaistaan vielä yhdellä jaolla (null).
    gameWinners(before, steps) {
        const running = before.slice();
        for (const step of steps) {
            step.forEach((points, i) => { running[i] += points; });
            const reached = running.map((s, i) => i).filter(i => running[i] >= GAME_END_SCORE);
            if (reached.length === 0) continue;
            const top = Math.max(...reached.map(i => running[i]));
            const leaders = reached.filter(i => running[i] === top);
            if (leaders.length === 1) return leaders;
        }
        return null;
    }

    // Suurimmat pisteet ensin. Tasapisteillä sama sija.
    ranking() {
        const sorted = this.players.slice().sort((a, b) => b.score - a.score);
        return sorted.map(p => ({
            id: p.id, name: p.name, score: p.score,
            place: 1 + sorted.filter(o => o.score > p.score).length
        }));
    }

    // Seuraava jako, kun kaikki ovat nähneet tuloksen. Kuka sen saa aloittaa,
    // päättää pöytä (kasino/socket.js: pöydän luoja). name: aloittajan nimi, jos
    // aloittaja ei itse pelaa (luoja katsojana).
    nextRound(playerId, name = null) {
        if (this.phase !== 'round-over') throw new GameError('Jako ei ole vielä päättynyt.');
        const player = this.player(playerId);
        if (!player && !name) throw new GameError('Et pelaa tässä pelissä.');
        this.moves++;
        const events = this.startRound();
        events[0] = { ...events[0], byId: playerId, byName: player ? player.name : name };
        return events;
    }

    // Tapahtuma pelaajalle: uusista korteista näkyvät vain omat.
    static publicEvent(event, viewerId) {
        if (event.type === 'deal') {
            const own = event.hands.find(h => h.id === viewerId);
            const { hands, ...rest } = event;
            return { ...rest, hand: own ? own.cards : null };
        }
        return event;
    }

    // Pelaajakohtainen näkymä. viewerId = null katsojalle. Kerättyjen korttien
    // määrät ovat julkisia, koska jokainen otto tehdään näkyvästi.
    getView(viewerId) {
        const viewerIndex = this.indexOf(viewerId);
        const viewer = this.players[viewerIndex] || null;
        const allowedActions = [];
        if (viewer) {
            if (this.phase === 'play' && viewerIndex === this.current) allowedActions.push('lay', 'take');
            if (this.phase === 'round-over') allowedActions.push('next-round');
        }
        return {
            phase: this.phase,
            round: this.round,
            hand: viewer ? viewer.hand.slice() : null,
            table: this.table.slice(),
            deckCount: this.deck.length,
            lastHand: this.lastHand,
            players: this.players.map(p => ({
                id: p.id, name: p.name, cardCount: p.hand.length,
                pile: summarizePile(p.pile), cabins: p.cabins, score: p.score
            })),
            currentId: this.phase === 'play' ? this.players[this.current].id : null,
            dealerId: this.players[this.dealer].id,
            lastTakerId: this.lastTaker !== null ? this.players[this.lastTaker].id : null,
            lastMove: this.lastMove,
            carry: { ...this.carry },
            roundResult: this.roundResult,
            history: this.history.map(h => ({ round: h.round, points: h.points.slice() })),
            winnerIds: this.winnerIds.slice(),
            allowedActions,
            moves: this.moves
        };
    }
}

module.exports = { Game, GameError, createDeck, shuffle, MIN_PLAYERS, MAX_PLAYERS };
