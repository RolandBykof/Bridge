'use strict';
// Musta Maijan pelilogiikka. Ei tiedä mitään yhteyksistä eikä ajastimista,
// joten sitä voi testata suoraan (game.test.js).

const {
    SUITS, RANKS, cardId, rankValue, isMaija, sortCards, plural
} = require('../public/maija/js/kortit.js');

const HAND_SIZE = 5;
const MAX_ATTACK = 5;
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 5;

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

// Kaatuuko attackCard kortilla defenseCard?
function canBeat(attackCard, defenseCard, trump) {
    if (isMaija(attackCard) || isMaija(defenseCard)) return false;
    if (defenseCard.suit === attackCard.suit) {
        return rankValue(defenseCard.rank) > rankValue(attackCard.rank);
    }
    return defenseCard.suit === trump;
}

// Etsii parituksen, joka kaataa mahdollisimman monta pöytäkorttia. Tasatilanteessa
// käytetään mahdollisimman heikot kortit (valtit viimeisenä). Pöydässä on enintään
// viisi korttia, joten kaikkien vaihtoehtojen läpikäynti on nopeaa. Ahne haku
// voisi hukata kelvollisen kaadon.
// Palauttaa assign-taulukon: assign[i] = defenses-indeksi tai -1.
function bestDefense(attacks, defenses, trump) {
    const cost = card => (card.suit === trump ? 100 : 0) + rankValue(card.rank);
    const assign = new Array(attacks.length).fill(-1);
    const used = new Array(defenses.length).fill(false);
    let best = { count: -1, cost: Infinity, assign: assign.slice() };

    function search(i, count, total) {
        if (count + (attacks.length - i) < best.count) return;
        if (i === attacks.length) {
            if (count > best.count || (count === best.count && total < best.cost)) {
                best = { count, cost: total, assign: assign.slice() };
            }
            return;
        }
        for (let j = 0; j < defenses.length; j++) {
            if (!used[j] && canBeat(attacks[i], defenses[j], trump)) {
                used[j] = true;
                assign[i] = j;
                search(i + 1, count + 1, total + cost(defenses[j]));
                used[j] = false;
                assign[i] = -1;
            }
        }
        search(i + 1, count, total);
    }

    search(0, 0, 0);
    return best.assign;
}

class Game {
    // players: [{ id, name }] istumajärjestyksessä. dealerIndex: jakajan paikka;
    // jos sitä ei anneta, jakaja arvotaan. Jakajaa seuraava aloittaa.
    constructor(players, { rng = Math.random, dealerIndex = null } = {}) {
        if (players.length < MIN_PLAYERS || players.length > MAX_PLAYERS) {
            throw new GameError(`Peliin tarvitaan ${MIN_PLAYERS}–${MAX_PLAYERS} pelaajaa.`);
        }
        this.rng = rng;
        this.players = players.map(p => ({ id: p.id, name: p.name, hand: [], out: false, place: null }));
        this.deck = shuffle(createDeck(), rng);
        const n = this.players.length;
        this.dealer = dealerIndex !== null ? dealerIndex : Math.floor(rng() * n);

        // deck[deck.length - 1] on pakan päällimmäinen kortti, deck[0] pohjimmainen.
        // Jako alkaa jakajaa seuraavasta, ja jakaja saa korttinsa viimeisenä.
        for (let round = 0; round < HAND_SIZE; round++) {
            for (let step = 1; step <= n; step++) {
                this.players[(this.dealer + step) % n].hand.push(this.deck.pop());
            }
        }

        // Pohjimmainen kortti käännetään valtiksi. Pata ei kelpaa: kortti
        // sekoitetaan takaisin pakan sisään ja käännetään uusi.
        while (this.deck[0].suit === 'spades') {
            const [card] = this.deck.splice(0, 1);
            const position = 1 + Math.floor(rng() * this.deck.length);
            this.deck.splice(position, 0, card);
        }
        this.trumpCard = this.deck[0];
        this.trump = this.trumpCard.suit;
        this.players.forEach(p => sortCards(p.hand));

        this.table = [];            // [{ card, beatenBy }]
        this.lastTable = [];        // edellisen kaadon lopputulos näytettäväksi
        this.lastTableEvent = null;
        this.discardCount = 0;
        this.finishOrder = [];      // pelaajien id:t pois pääsemisjärjestyksessä
        this.maijaId = null;
        this.noBeatRounds = 0;      // peräkkäiset kaadot, joissa mitään ei kaatunut
        this.attacker = (this.dealer + 1) % n;
        this.defender = this.nextActive(this.attacker);
        this.phase = 'attack';      // 'attack' | 'defend' | 'over'
    }

    get deckEmpty() {
        return this.deck.length === 0;
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

    // Montako korttia hyökkääjä saa lyödä: enintään viisi ja enintään niin
    // monta kuin vastaanottajalla on kädessä.
    maxAttack() {
        return Math.min(MAX_ATTACK, this.players[this.defender].hand.length);
    }

    // Hakee kortit kädestä id:iden perusteella. Ei vielä poista niitä.
    pickFromHand(player, cardIds) {
        if (!Array.isArray(cardIds)) throw new GameError('Virheellinen korttilista.');
        if (new Set(cardIds).size !== cardIds.length) throw new GameError('Sama kortti on valittu kahdesti.');
        return cardIds.map(id => {
            const card = player.hand.find(c => cardId(c) === id);
            if (!card) throw new GameError('Valitsemasi kortti ei ole kädessäsi.');
            return card;
        });
    }

    removeFromHand(player, cards) {
        player.hand = player.hand.filter(c => !cards.includes(c));
    }

    // Täydentää käden viiteen, jos pakassa on kortteja. Palauttaa nostetut kortit.
    refill(player) {
        const drawn = [];
        while (player.hand.length + drawn.length < HAND_SIZE && this.deck.length > 0) {
            drawn.push(this.deck.pop());
        }
        player.hand.push(...drawn);
        sortCards(player.hand);
        return drawn;
    }

    // Tarkistaa, pääsivätkö pelaajat pois. Palauttaa tapahtumat.
    checkOut() {
        const events = [];
        if (!this.deckEmpty) return events;
        for (const player of this.players) {
            if (!player.out && player.hand.length === 0) {
                player.out = true;
                this.finishOrder.push(player.id);
                player.place = this.finishOrder.length;
                events.push({ type: 'out', playerId: player.id, name: player.name, place: player.place });
            }
        }
        return events;
    }

    attack(playerId, cardIds) {
        if (this.phase !== 'attack') throw new GameError('Nyt ei lyödä vaan kaadetaan.');
        const attacker = this.players[this.attacker];
        if (attacker.id !== playerId) throw new GameError(`Ei ole sinun vuorosi lyödä. Vuorossa on ${attacker.name}.`);

        const cards = this.pickFromHand(attacker, cardIds);
        if (cards.length === 0) throw new GameError('Valitse ensin lyötävät kortit.');
        if (cards.some(c => c.suit !== cards[0].suit)) throw new GameError('Lyötävien korttien pitää olla samaa maata.');
        const max = this.maxAttack();
        if (cards.length > max) {
            throw new GameError(`Voit lyödä enintään ${plural(max, 'kortin', 'korttia')}.`);
        }

        const defender = this.players[this.defender];
        const deckWasEmpty = this.deckEmpty;
        this.removeFromHand(attacker, cards);
        sortCards(cards);
        this.table = cards.map(card => ({ card, beatenBy: null }));
        const drawn = this.refill(attacker);

        const event = {
            type: 'attack',
            attackerId: attacker.id, attackerName: attacker.name,
            defenderId: defender.id, defenderName: defender.name,
            cards: cards.slice(),
            drew: drawn.length
        };
        this.lastTableEvent = event;
        this.phase = 'defend';

        const events = [event];
        if (!deckWasEmpty && this.deckEmpty) events.push({ type: 'deck-empty' });
        events.push(...this.checkOut());
        return events;
    }

    // Kaataa valituilla korteilla niin monta pöytäkorttia kuin pystyy. Kaatamatta
    // jääneet nostetaan automaattisesti kaatajan käteen. Tyhjä lista nostaa kaikki.
    defend(playerId, cardIds) {
        if (this.phase !== 'defend') throw new GameError('Pöydässä ei ole kaadettavaa.');
        const defender = this.players[this.defender];
        if (defender.id !== playerId) throw new GameError(`Ei ole sinun vuorosi kaataa. Vuorossa on ${defender.name}.`);

        const selected = this.pickFromHand(defender, cardIds);
        const attacks = this.table.map(t => t.card);
        const assign = bestDefense(attacks, selected, this.trump);

        const pairs = [];
        const pickedUp = [];
        attacks.forEach((attackCard, i) => {
            if (assign[i] >= 0) {
                const defenseCard = selected[assign[i]];
                this.table[i].beatenBy = defenseCard;
                pairs.push({ attack: attackCard, defense: defenseCard });
            } else {
                pickedUp.push(attackCard);
            }
        });
        const usedCards = pairs.map(p => p.defense);
        const unused = selected.filter(c => !usedCards.includes(c));

        const deckWasEmpty = this.deckEmpty;
        this.removeFromHand(defender, usedCards);
        defender.hand.push(...pickedUp);
        this.discardCount += pairs.length * 2;
        this.noBeatRounds = pairs.length > 0 ? 0 : this.noBeatRounds + 1;
        const drawn = this.refill(defender);
        const allBeaten = pickedUp.length === 0;

        const attacker = this.players[this.attacker];
        const event = {
            type: 'defend',
            attackerId: attacker.id, attackerName: attacker.name,
            defenderId: defender.id, defenderName: defender.name,
            pairs, pickedUp, allBeaten,
            unused,             // vain kaatajalle, ks. publicEvent()
            drew: drawn.length
        };
        this.lastTableEvent = event;
        this.lastTable = this.table;
        this.table = [];

        const events = [event];
        if (!deckWasEmpty && this.deckEmpty) events.push({ type: 'deck-empty' });
        events.push(...this.checkOut());

        if (this.activePlayers().length <= 1) {
            events.push(this.finish());
            return events;
        }

        this.attacker = allBeaten && !defender.out ? this.defender : this.nextActive(this.defender);
        this.defender = this.nextActive(this.attacker);
        this.phase = 'attack';
        return events;
    }

    finish() {
        const maija = this.activePlayers()[0];
        maija.out = true;
        maija.place = this.players.length;
        this.finishOrder.push(maija.id);
        this.maijaId = maija.id;
        this.phase = 'over';
        return {
            type: 'over',
            maijaId: maija.id, maijaName: maija.name,
            ranking: this.finishOrder.map(id => {
                const p = this.players[this.indexOf(id)];
                return { id: p.id, name: p.name, place: p.place };
            })
        };
    }

    // Tapahtuma muille kuin kaatajalle: käteen jääneitä valittuja kortteja ei paljasteta.
    static publicEvent(event, viewerId) {
        if (event.type === 'defend' && event.defenderId !== viewerId) {
            return { ...event, unused: [] };
        }
        return event;
    }

    // Pelaajakohtainen näkymä. viewerId = null katsojalle.
    getView(viewerId) {
        const viewer = this.players.find(p => p.id === viewerId) || null;
        const attacker = this.players[this.attacker];
        const defender = this.players[this.defender];
        const allowedActions = [];
        if (viewer && this.phase === 'attack' && viewer === attacker) allowedActions.push('attack');
        if (viewer && this.phase === 'defend' && viewer === defender) allowedActions.push('defend');

        return {
            phase: this.phase,
            hand: viewer ? viewer.hand.slice() : null,
            players: this.players.map(p => ({
                id: p.id, name: p.name, cardCount: p.hand.length, out: p.out, place: p.place
            })),
            attackerId: attacker.id,
            defenderId: defender.id,
            dealerId: this.players[this.dealer].id,
            noBeatRounds: this.noBeatRounds,
            table: this.table.map(t => ({ card: t.card, beatenBy: t.beatenBy })),
            lastTable: this.lastTable.map(t => ({ card: t.card, beatenBy: t.beatenBy })),
            lastTableEvent: this.lastTableEvent ? Game.publicEvent(this.lastTableEvent, viewerId) : null,
            trump: this.trump,
            trumpCard: this.trumpCard,
            trumpCardInDeck: this.deck.length > 0,
            deckCount: this.deck.length,
            discardCount: this.discardCount,
            maxAttack: this.phase === 'over' ? 0 : this.maxAttack(),
            allowedActions,
            finishOrder: this.finishOrder.slice(),
            maijaId: this.maijaId
        };
    }
}

module.exports = {
    Game, GameError, canBeat, bestDefense, createDeck, shuffle,
    HAND_SIZE, MAX_ATTACK, MIN_PLAYERS, MAX_PLAYERS
};
