'use strict';
// Ristiseiskan pelilogiikka. Ei tiedä mitään yhteyksistä eikä ajastimista,
// joten sitä voi testata suoraan (game.test.js).

const { SUITS, RANKS, cardId, cardName, sortCards, capitalize } = require('../public/korttipelit/kortit.js');
const {
    ORDER, emptyTable, nextCards, isPlayable, playableCards, placeCard
} = require('../public/ristiseiska/js/saannot.js');

const MIN_PLAYERS = 2;
const MAX_PLAYERS = 8;

// Sääntötulkinnat (ks. ristiseiska-suunnitelma.html):
// - Jos pyydetyllä on vain yksi kortti, hänen ei tarvitse antaa, ja pyyntö
//   siirtyy seuraavalle vastapäivään. Jos kukaan ei voi antaa, vuoro siirtyy.
// - Saatua korttia ei voi lyödä samalla vuorolla.
// - Jos voi lyödä, on lyötävä (ask hylätään).
const MIN_CARDS_TO_GIVE = 2;

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

// Ässä ja kuningas sulkevat pinon ja antavat lisäkortin.
function givesBonus(card) {
    return card.rank === 'A' || card.rank === 'K';
}

class Game {
    // players: [{ id, name }] istumajärjestyksessä. dealerIndex: jakajan paikka;
    // jos sitä ei anneta, jakaja arvotaan. Ristiseiskan haltija aloittaa, ja
    // ristiseiska pelataan pöytään automaattisesti.
    constructor(players, { rng = Math.random, dealerIndex = null } = {}) {
        if (players.length < MIN_PLAYERS || players.length > MAX_PLAYERS) {
            throw new GameError(`Peliin tarvitaan ${MIN_PLAYERS}–${MAX_PLAYERS} pelaajaa.`);
        }
        this.rng = rng;
        this.players = players.map(p => ({ id: p.id, name: p.name, hand: [], out: false, place: null }));
        const n = this.players.length;
        this.dealer = dealerIndex !== null ? dealerIndex : Math.floor(rng() * n);

        // Kaikki kortit jaetaan jakajaa seuraavasta alkaen. Jako ei aina mene tasan.
        const deck = shuffle(createDeck(), rng);
        deck.forEach((card, i) => {
            this.players[(this.dealer + 1 + i) % n].hand.push(card);
        });
        this.players.forEach(p => sortCards(p.hand, ORDER));

        this.table = emptyTable();
        this.finishOrder = [];
        this.loserId = null;
        this.moves = 0;             // kasvaa jokaisesta siirrosta (robottien ajastus)

        const holder = this.players.findIndex(p => p.hand.some(c => c.suit === 'clubs' && c.rank === '7'));
        const seven = this.players[holder].hand.find(c => c.suit === 'clubs' && c.rank === '7');
        this.removeFromHand(this.players[holder], seven);
        placeCard(this.table, seven);
        this.sevenHolder = holder;
        this.lastPlay = { playerId: this.players[holder].id, name: this.players[holder].name, card: seven };

        this.current = this.nextActive(holder);
        this.phase = 'play';        // 'play' | 'give' | 'over'
        this.bonus = false;         // ässän tai kuninkaan jälkeinen lisäkortti
        this.asker = null;
        this.giver = null;
    }

    // Pöydän aloitustapahtumaan lisättävät tiedot (korttipelit/poydat.js).
    startInfo() {
        const holder = this.players[this.sevenHolder];
        const starter = this.players[this.current];
        return {
            sevenHolderId: holder.id, sevenHolderName: holder.name,
            starterId: starter.id, starterName: starter.name
        };
    }

    indexOf(playerId) {
        return this.players.findIndex(p => p.id === playerId);
    }

    activePlayers() {
        return this.players.filter(p => !p.out);
    }

    nextActive(index) {
        const n = this.players.length;
        for (let step = 1; step <= n; step++) {
            const candidate = (index + step) % n;
            if (!this.players[candidate].out) return candidate;
        }
        return index;
    }

    // Pelaajat vastapäivään annetusta alkaen (ei itseä), pois päässeet ohitetaan.
    previousActives(index) {
        const n = this.players.length;
        const result = [];
        for (let step = 1; step < n; step++) {
            const candidate = (index - step + n) % n;
            if (!this.players[candidate].out) result.push(candidate);
        }
        return result;
    }

    removeFromHand(player, card) {
        player.hand = player.hand.filter(c => c !== card);
    }

    findInHand(player, id) {
        if (typeof id !== 'string') throw new GameError('Virheellinen kortti.');
        const card = player.hand.find(c => cardId(c) === id);
        if (!card) throw new GameError('Valitsemasi kortti ei ole kädessäsi.');
        return card;
    }

    requireCurrent(playerId) {
        if (this.phase === 'over') throw new GameError('Peli on päättynyt.');
        if (this.phase === 'give') {
            throw new GameError(`Odotetaan, että ${this.players[this.giver].name} antaa kortin.`);
        }
        const current = this.players[this.current];
        if (current.id !== playerId) throw new GameError(`Ei ole sinun vuorosi. Vuorossa on ${current.name}.`);
        return current;
    }

    // Vuoro seuraavalle pelissä olevalle.
    advance() {
        this.bonus = false;
        this.current = this.nextActive(this.current);
    }

    play(playerId, id) {
        const player = this.requireCurrent(playerId);
        const card = this.findInHand(player, id);
        if (!isPlayable(this.table, card)) {
            throw new GameError(`${capitalize(cardName(card))} ei sovi pöytään.`);
        }
        this.removeFromHand(player, card);
        placeCard(this.table, card);
        this.lastPlay = { playerId: player.id, name: player.name, card };
        this.moves++;

        const out = player.hand.length === 0;
        const bonus = givesBonus(card) && !out;
        const events = [{ type: 'play', playerId: player.id, name: player.name, card, bonus }];
        if (out) {
            events.push(this.markOut(player));
            if (this.activePlayers().length <= 1) {
                events.push(this.finish());
                return events;
            }
        }
        if (bonus) {
            this.bonus = true;
        } else {
            this.advance();
        }
        return events;
    }

    endTurn(playerId) {
        const player = this.requireCurrent(playerId);
        if (!this.bonus) throw new GameError('Vuoroa ei voi lopettaa. Lyö kortti tai pyydä kortti.');
        this.moves++;
        this.advance();
        return [{ type: 'end-turn', playerId: player.id, name: player.name }];
    }

    // Pyydetään kortti edelliseltä pelaajalta, kun omasta kädestä ei sovi mikään.
    ask(playerId) {
        const player = this.requireCurrent(playerId);
        if (this.bonus) throw new GameError('Voit jatkaa lyömällä kortin tai lopettaa vuoron.');
        if (playableCards(this.table, player.hand).length > 0) {
            throw new GameError('Sinulla on lyötävä kortti.');
        }
        this.moves++;
        const skipped = [];
        let giver = null;
        for (const index of this.previousActives(this.current)) {
            if (this.players[index].hand.length >= MIN_CARDS_TO_GIVE) {
                giver = index;
                break;
            }
            skipped.push(this.players[index].name);
        }
        const event = {
            type: 'ask',
            askerId: player.id, askerName: player.name,
            giverId: giver === null ? null : this.players[giver].id,
            giverName: giver === null ? null : this.players[giver].name,
            skipped
        };
        if (giver === null) {
            this.advance();
        } else {
            this.phase = 'give';
            this.asker = this.current;
            this.giver = giver;
        }
        return [event];
    }

    give(playerId, id) {
        if (this.phase !== 'give') throw new GameError('Kukaan ei nyt pyydä korttia.');
        const giver = this.players[this.giver];
        if (giver.id !== playerId) {
            throw new GameError(`Ei ole sinun vuorosi. ${giver.name} antaa kortin.`);
        }
        const card = this.findInHand(giver, id);
        const receiver = this.players[this.asker];
        this.removeFromHand(giver, card);
        receiver.hand.push(card);
        sortCards(receiver.hand, ORDER);
        this.moves++;

        this.phase = 'play';
        this.current = this.asker;
        this.asker = null;
        this.giver = null;
        this.advance();
        return [{
            type: 'give',
            giverId: giver.id, giverName: giver.name,
            receiverId: receiver.id, receiverName: receiver.name,
            card                // vain antajalle ja saajalle, ks. publicEvent()
        }];
    }

    markOut(player) {
        player.out = true;
        this.finishOrder.push(player.id);
        player.place = this.finishOrder.length;
        return { type: 'out', playerId: player.id, name: player.name, place: player.place };
    }

    finish() {
        const loser = this.activePlayers()[0];
        loser.out = true;
        loser.place = this.players.length;
        this.finishOrder.push(loser.id);
        this.loserId = loser.id;
        this.phase = 'over';
        this.bonus = false;
        return {
            type: 'over',
            loserId: loser.id, loserName: loser.name,
            ranking: this.finishOrder.map(id => {
                const p = this.players[this.indexOf(id)];
                return { id: p.id, name: p.name, place: p.place };
            })
        };
    }

    // Tapahtuma muille pelaajille: annettu kortti näkyy vain antajalle ja saajalle.
    static publicEvent(event, viewerId) {
        if (event.type === 'give' && event.giverId !== viewerId && event.receiverId !== viewerId) {
            return { ...event, card: null };
        }
        return event;
    }

    // Pelaajakohtainen näkymä. viewerId = null katsojalle. Lyötäviä kortteja ei
    // nimetä, mutta allowedActions kertoo, voiko vuorossa oleva lyödä mitään:
    // 'play' vain, jos jokin sopii, ja 'ask' vain, jos mikään ei sovi.
    getView(viewerId) {
        const viewer = this.players.find(p => p.id === viewerId) || null;
        const allowedActions = [];
        if (viewer && this.phase === 'play' && viewer === this.players[this.current]) {
            const canPlay = playableCards(this.table, viewer.hand).length > 0;
            if (canPlay) allowedActions.push('play');
            if (this.bonus) allowedActions.push('end-turn');
            else if (!canPlay) allowedActions.push('ask');
        }
        if (viewer && this.phase === 'give' && viewer === this.players[this.giver]) {
            allowedActions.push('give');
        }
        const table = {};
        const next = {};
        for (const suit of SUITS) {
            table[suit] = this.table[suit] ? { ...this.table[suit] } : null;
            next[suit] = nextCards(this.table, suit);
        }
        return {
            phase: this.phase,
            bonus: this.bonus,
            hand: viewer ? viewer.hand.slice() : null,
            players: this.players.map(p => ({
                id: p.id, name: p.name, cardCount: p.hand.length, out: p.out, place: p.place
            })),
            currentId: this.phase === 'over' ? null : this.players[this.current].id,
            askerId: this.asker === null ? null : this.players[this.asker].id,
            giverId: this.giver === null ? null : this.players[this.giver].id,
            table,
            nextCards: next,
            allowedActions,
            dealerId: this.players[this.dealer].id,
            sevenHolderId: this.players[this.sevenHolder].id,
            lastPlay: this.lastPlay,
            finishOrder: this.finishOrder.slice(),
            loserId: this.loserId,
            moves: this.moves
        };
    }
}

module.exports = { Game, GameError, createDeck, shuffle, givesBonus, MIN_PLAYERS, MAX_PLAYERS, MIN_CARDS_TO_GIVE };
