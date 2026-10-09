'use strict';
// Hertan pelilogiikka. Ei tiedä mitään yhteyksistä eikä ajastimista, joten sitä
// voi testata suoraan (game.test.js). Pelaajille näytettävät tekstit ovat englanniksi.
//
// Peli koostuu kierroksista (jaoista). Kierroksen alussa annetaan kolme korttia
// vuorotellen vasemmalle, oikealle ja vastapäätä; joka neljännellä kierroksella
// ei vaihdeta. Peli päättyy kierroksen jälkeen, kun jollakin on vähintään 100 pistettä.

const { sortCards } = require('../public/korttipelit/kortit.js');
const {
    SUITS, RANKS, PASS_DIRECTIONS, PASS_OFFSETS, PASS_COUNT, GAME_END_SCORE,
    isTwoOfClubs, trickPoints, trickWinner, illegalReason
} = require('../public/hertta/js/saannot.js');

const PLAYERS = 4;
const TRICKS_PER_ROUND = 13;

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

class Game {
    // players: [{ id, name }] istumajärjestyksessä (myötäpäivään). dealerIndex:
    // ensimmäisen kierroksen jakaja; jos sitä ei anneta, jakaja arvotaan.
    constructor(players, { rng = Math.random, dealerIndex = null } = {}) {
        if (players.length !== PLAYERS) {
            throw new GameError(`Hearts needs exactly ${PLAYERS} players.`);
        }
        this.rng = rng;
        this.players = players.map(p => ({
            id: p.id, name: p.name, hand: [], score: 0, roundPoints: 0, tricks: 0,
            passSelection: null, received: null
        }));
        this.dealer = dealerIndex !== null ? dealerIndex : Math.floor(rng() * PLAYERS);
        this.round = 0;
        this.history = [];          // [{ round, points: [pelaajien pisteet istumajärjestyksessä] }]
        this.winnerIds = [];
        this.moves = 0;             // kasvaa jokaisesta siirrosta (robottien ajastus)
        this.startRound();          // ensimmäisellä kierroksella vaihdetaan aina, joten tapahtumia ei synny
    }

    // Pöydän aloitustapahtumaan lisättävät tiedot (korttipelit/poydat.js).
    startInfo() {
        return { round: this.round, passDirection: this.passDirection };
    }

    indexOf(playerId) {
        return this.players.findIndex(p => p.id === playerId);
    }

    player(playerId) {
        return this.players[this.indexOf(playerId)] || null;
    }

    passTarget(index) {
        return (index + PASS_OFFSETS[this.passDirection]) % PLAYERS;
    }

    startRound() {
        this.round++;
        if (this.round > 1) this.dealer = (this.dealer + 1) % PLAYERS;
        this.passDirection = PASS_DIRECTIONS[(this.round - 1) % PASS_DIRECTIONS.length];

        const deck = shuffle(createDeck(), this.rng);
        for (const p of this.players) {
            p.hand = [];
            p.roundPoints = 0;
            p.tricks = 0;
            p.passSelection = null;
            p.received = null;
        }
        deck.forEach((card, i) => {
            this.players[(this.dealer + 1 + i) % PLAYERS].hand.push(card);
        });
        this.players.forEach(p => sortCards(p.hand));

        this.trick = [];            // [{ playerId, card }]
        this.lastTrick = null;      // { cards, winnerId, points }
        this.played = [];           // kierroksella pelatut kortit pelijärjestyksessä
        this.tricksPlayed = 0;
        this.heartsBroken = false;
        this.current = null;

        const events = [];
        if (this.round > 1) {
            events.push({
                type: 'round-start', round: this.round, passDirection: this.passDirection,
                dealerId: this.players[this.dealer].id, dealerName: this.players[this.dealer].name
            });
        }
        if (this.passDirection === 'none') {
            events.push(...this.beginPlay());
        } else {
            this.phase = 'pass';    // 'pass' | 'play' | 'round-over' | 'over'
        }
        return events;
    }

    // Ristikakkosen haltija aloittaa. Kakkonen lyödään pöytään automaattisesti.
    beginPlay() {
        this.phase = 'play';
        const holder = this.players.findIndex(p => p.hand.some(isTwoOfClubs));
        this.current = holder;
        return this.play(this.players[holder].id, 'clubs-2', { auto: 'two-of-clubs' });
    }

    findInHand(player, id) {
        if (typeof id !== 'string') throw new GameError('Invalid card.');
        const card = player.hand.find(c => `${c.suit}-${c.rank}` === id);
        if (!card) throw new GameError('That card is not in your hand.');
        return card;
    }

    pass(playerId, cardIds) {
        if (this.phase !== 'pass') throw new GameError('Cards are not being passed now.');
        const player = this.player(playerId);
        if (!player) throw new GameError('You are not playing in this game.');
        if (player.passSelection) throw new GameError('You have already passed your cards.');
        if (!Array.isArray(cardIds) || cardIds.length !== PASS_COUNT) {
            throw new GameError(`Select exactly ${PASS_COUNT} cards to pass.`);
        }
        if (new Set(cardIds).size !== cardIds.length) throw new GameError('The same card was selected twice.');
        const cards = cardIds.map(id => this.findInHand(player, id));
        player.passSelection = cards;
        this.moves++;

        const target = this.players[this.passTarget(this.indexOf(playerId))];
        const events = [{
            type: 'passed', playerId: player.id, name: player.name,
            toId: target.id, toName: target.name,
            cards: sortCards(cards.slice())     // vain antajalle, ks. publicEvent()
        }];
        if (this.players.every(p => p.passSelection)) events.push(...this.exchange());
        return events;
    }

    // Kaikki ovat valinneet: kortit vaihdetaan yhtä aikaa.
    exchange() {
        const transfers = this.players.map((from, i) => {
            const to = this.players[this.passTarget(i)];
            return { fromId: from.id, fromName: from.name, toId: to.id, toName: to.name, cards: from.passSelection };
        });
        for (const t of transfers) {
            const from = this.player(t.fromId);
            from.hand = from.hand.filter(c => !t.cards.includes(c));
        }
        for (const t of transfers) {
            const to = this.player(t.toId);
            to.hand.push(...t.cards);
            to.received = sortCards(t.cards.slice());
            sortCards(to.hand);
        }
        const event = {
            type: 'exchange', direction: this.passDirection,
            transfers: transfers.map(t => ({ ...t, cards: sortCards(t.cards.slice()) }))
        };
        return [event, ...this.beginPlay()];
    }

    rulesContext() {
        return {
            lead: this.trick.length > 0 ? this.trick[0].card.suit : null,
            firstTrick: this.tricksPlayed === 0,
            heartsBroken: this.heartsBroken
        };
    }

    play(playerId, id, { auto = false } = {}) {
        if (this.phase === 'pass') throw new GameError('Pass your cards first.');
        if (this.phase !== 'play') throw new GameError('No cards are being played now.');
        const player = this.players[this.current];
        if (player.id !== playerId) throw new GameError(`It is not your turn. ${player.name} is to play.`);
        const card = this.findInHand(player, id);
        const reason = illegalReason(player.hand, card, this.rulesContext());
        if (reason) throw new GameError(reason);

        player.hand = player.hand.filter(c => c !== card);
        this.trick.push({ playerId: player.id, card });
        this.played.push(card);
        const brokeHearts = card.suit === 'hearts' && !this.heartsBroken;
        if (brokeHearts) this.heartsBroken = true;
        this.moves++;

        const events = [{
            type: 'play', playerId: player.id, name: player.name, card,
            lead: this.trick.length === 1, auto, brokeHearts
        }];
        if (this.trick.length < PLAYERS) {
            this.current = (this.current + 1) % PLAYERS;
            return events;
        }
        events.push(this.finishTrick());
        if (this.tricksPlayed === TRICKS_PER_ROUND) events.push(...this.finishRound());
        else if (this.tricksPlayed === TRICKS_PER_ROUND - 1) events.push(...this.playLastTrick());
        return events;
    }

    // Viimeisessä tikissä jokaisella on yksi kortti, joten se pelataan automaattisesti
    // voittajasta alkaen. Viimeinen play() päättää myös kierroksen.
    playLastTrick() {
        const events = [{ type: 'last-trick' }];
        for (let i = 0; i < PLAYERS; i++) {
            const player = this.players[this.current];
            const card = player.hand[0];
            events.push(...this.play(player.id, `${card.suit}-${card.rank}`, { auto: 'last-trick' }));
        }
        return events;
    }

    finishTrick() {
        const cards = this.trick.map(t => t.card);
        const winnerIndex = this.indexOf(this.trick[trickWinner(cards)].playerId);
        const winner = this.players[winnerIndex];
        const pts = trickPoints(cards);
        winner.roundPoints += pts;
        winner.tricks++;
        this.tricksPlayed++;
        this.lastTrick = { cards: this.trick, winnerId: winner.id, points: pts };
        this.trick = [];
        this.current = winnerIndex;
        return {
            type: 'trick', number: this.tricksPlayed,
            winnerId: winner.id, winnerName: winner.name,
            points: pts, cards: this.lastTrick.cards
        };
    }

    finishRound() {
        for (const p of this.players) p.score += p.roundPoints;
        this.history.push({ round: this.round, points: this.players.map(p => p.roundPoints) });
        this.current = null;
        const results = this.players.map(p => ({ id: p.id, name: p.name, points: p.roundPoints, total: p.score }));
        const events = [{ type: 'round-over', round: this.round, results }];

        if (this.players.some(p => p.score >= GAME_END_SCORE)) {
            const best = Math.min(...this.players.map(p => p.score));
            const winners = this.players.filter(p => p.score === best);
            this.winnerIds = winners.map(p => p.id);
            this.phase = 'over';
            events.push({
                type: 'over',
                winnerIds: this.winnerIds, winnerNames: winners.map(p => p.name), winningScore: best,
                ranking: this.ranking()
            });
        } else {
            this.phase = 'round-over';
        }
        return events;
    }

    // Pienimmät pisteet ensin. Tasapisteillä sama sija.
    ranking() {
        const sorted = this.players.slice().sort((a, b) => a.score - b.score);
        return sorted.map(p => ({
            id: p.id, name: p.name, score: p.score,
            place: 1 + sorted.filter(o => o.score < p.score).length
        }));
    }

    // Kuka tahansa pelaaja voi aloittaa seuraavan kierroksen, kun kaikki ovat nähneet tuloksen.
    nextRound(playerId) {
        if (this.phase !== 'round-over') throw new GameError('The round is not over yet.');
        const player = this.player(playerId);
        if (!player) throw new GameError('You are not playing in this game.');
        this.moves++;
        const events = this.startRound();
        events[0] = { ...events[0], byId: player.id, byName: player.name };
        return events;
    }

    // Tapahtuma muille pelaajille: annetut ja saadut kortit näkyvät vain asianosaisille.
    static publicEvent(event, viewerId) {
        if (event.type === 'passed' && event.playerId !== viewerId) {
            return { ...event, cards: null, toId: null, toName: null };
        }
        if (event.type === 'exchange') {
            return { ...event, transfers: event.transfers.filter(t => t.fromId === viewerId || t.toId === viewerId) };
        }
        return event;
    }

    // Pelaajakohtainen näkymä. viewerId = null katsojalle. Pelattavia kortteja
    // ei nimetä: pelaaja päättelee ne itse, ja palvelin kertoo syyn virheelliseen siirtoon.
    getView(viewerId) {
        const viewerIndex = this.indexOf(viewerId);
        const viewer = this.players[viewerIndex] || null;
        const allowedActions = [];
        if (viewer) {
            if (this.phase === 'pass' && !viewer.passSelection) allowedActions.push('pass');
            if (this.phase === 'play' && viewerIndex === this.current) allowedActions.push('play');
            if (this.phase === 'round-over') allowedActions.push('next-round');
        }
        const passing = this.passDirection !== 'none';
        return {
            phase: this.phase,
            round: this.round,
            passDirection: this.passDirection,
            passTargetId: viewer && passing ? this.players[this.passTarget(viewerIndex)].id : null,
            passSourceId: viewer && passing
                ? this.players[this.players.findIndex((_, i) => this.passTarget(i) === viewerIndex)].id
                : null,
            passSelection: viewer && viewer.passSelection ? sortCards(viewer.passSelection.slice()) : null,
            received: viewer ? viewer.received : null,
            hand: viewer ? viewer.hand.slice() : null,
            players: this.players.map(p => ({
                id: p.id, name: p.name, cardCount: p.hand.length, score: p.score,
                roundPoints: p.roundPoints, tricks: p.tricks, passed: !!p.passSelection
            })),
            currentId: this.phase === 'play' ? this.players[this.current].id : null,
            dealerId: this.players[this.dealer].id,
            trick: this.trick.map(t => ({ playerId: t.playerId, card: t.card })),
            lastTrick: this.lastTrick,
            played: this.played.slice(),
            tricksPlayed: this.tricksPlayed,
            heartsBroken: this.heartsBroken,
            allowedActions,
            history: this.history.map(h => ({ round: h.round, points: h.points.slice() })),
            winnerIds: this.winnerIds.slice(),
            moves: this.moves
        };
    }
}

module.exports = { Game, GameError, createDeck, shuffle, PLAYERS, TRICKS_PER_ROUND };
