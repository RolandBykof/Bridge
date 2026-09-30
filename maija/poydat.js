'use strict';
// Pöydät: jäsenet istumajärjestyksessä, pöydän luoja, robotit ja jakovuoro.
// Ei tiedä mitään yhteyksistä, joten tämän voi testata suoraan.

const crypto = require('crypto');
const { Game, GameError, MIN_PLAYERS, MAX_PLAYERS } = require('./game.js');

const MAX_NAME_LENGTH = 20;
const CREATOR_RECONNECT_MS = 5 * 60 * 1000;    // Bridgen RECONNECT_TIMEOUT
const EMPTY_TABLE_MS = 5 * 60 * 1000;
const MAX_IDLE_MS = 60 * 60 * 1000;            // Bridgen MAX_IDLE_TIME
const ROBOT_SPEEDS = ['slow', 'normal', 'fast'];

// Virhe, jonka viesti näytetään käyttäjälle sellaisenaan.
class TableError extends Error {}

function cleanName(name) {
    return typeof name === 'string' ? name.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH) : '';
}

class Table {
    constructor(code, { rng = Math.random, now = Date.now } = {}) {
        this.code = code;
        this.rng = rng;
        this.now = now;
        this.members = [];          // istumajärjestyksessä (seat kasvaa liittymisjärjestyksessä)
        this.nextSeat = 0;
        this.robotCounter = 0;
        this.creatorId = null;
        this.game = null;
        this.gameEpoch = 0;
        this.lastDealerSeat = null;
        this.robotSpeed = 'normal';
        this.lastActivity = now();
        this.noHumansSince = null;
    }

    touch() {
        this.lastActivity = this.now();
    }

    member(id) {
        return this.members.find(m => m.id === id) || null;
    }

    memberByToken(token) {
        return token ? this.members.find(m => m.token === token) || null : null;
    }

    creator() {
        return this.member(this.creatorId);
    }

    isCreator(member) {
        return !!member && member.id === this.creatorId;
    }

    gameRunning() {
        return this.game !== null && this.game.phase !== 'over';
    }

    inGame(member) {
        return this.game !== null && this.game.indexOf(member.id) !== -1;
    }

    connectedHumans() {
        return this.members.filter(m => m.type === 'human' && m.connected);
    }

    // Seuraavaan peliin pääsevät: robotit ja yhdistetyt ihmiset istumajärjestyksessä, enintään viisi.
    seated() {
        return this.members.filter(m => m.type === 'robot' || m.connected).slice(0, MAX_PLAYERS);
    }

    isSpectator(member) {
        if (this.gameRunning()) return !this.inGame(member);
        return !this.seated().includes(member);
    }

    addHuman(rawName, socketId) {
        const name = cleanName(rawName);
        if (!name) throw new TableError('Kirjoita nimesi.');
        if (this.members.some(m => m.name.toLowerCase() === name.toLowerCase())) {
            throw new TableError(`Nimi ${name} on jo käytössä tässä pöydässä. Valitse toinen nimi.`);
        }
        const member = {
            id: crypto.randomUUID(),
            token: crypto.randomUUID(),
            name,
            type: 'human',
            seat: this.nextSeat++,
            socketId,
            connected: true,
            disconnectedAt: null
        };
        this.members.push(member);
        if (!this.creatorId) this.creatorId = member.id;
        this.noHumansSince = null;
        this.touch();
        return member;
    }

    reconnect(member, socketId) {
        member.socketId = socketId;
        member.connected = true;
        member.disconnectedAt = null;
        this.noHumansSince = null;
        this.touch();
    }

    requireCreator(member, action) {
        if (!this.isCreator(member)) throw new TableError(`Vain pöydän luoja voi ${action}.`);
    }

    addRobot(byMember) {
        this.requireCreator(byMember, 'lisätä robotteja');
        if (this.gameRunning()) throw new TableError('Robotteja voi lisätä vain, kun peli ei ole käynnissä.');
        if (this.seated().length >= MAX_PLAYERS) {
            throw new TableError(`Pöytä on täynnä, ${MAX_PLAYERS}/${MAX_PLAYERS} pelaajaa.`);
        }
        let name;
        do {
            name = `Robotti ${++this.robotCounter}`;
        } while (this.members.some(m => m.name === name));
        const robot = {
            id: crypto.randomUUID(), token: null, name, type: 'robot',
            seat: this.nextSeat++, socketId: null, connected: true, disconnectedAt: null
        };
        this.members.push(robot);
        this.touch();
        return robot;
    }

    removeRobot(byMember, robotId) {
        this.requireCreator(byMember, 'poistaa robotteja');
        if (this.gameRunning()) throw new TableError('Robotin voi poistaa vain, kun peli ei ole käynnissä.');
        const robot = this.member(robotId);
        if (!robot || robot.type !== 'robot') throw new TableError('Robottia ei löydy.');
        this.members = this.members.filter(m => m !== robot);
        this.touch();
        return robot;
    }

    setRobotSpeed(byMember, speed) {
        this.requireCreator(byMember, 'muuttaa robottien nopeutta');
        if (!ROBOT_SPEEDS.includes(speed)) throw new TableError('Tuntematon nopeus.');
        this.robotSpeed = speed;
    }

    // Jakaja kiertää: edellistä jakajaa istumajärjestyksessä seuraava. Ensimmäisessä pelissä arvotaan.
    nextDealerIndex(participants) {
        if (this.lastDealerSeat === null) return Math.floor(this.rng() * participants.length);
        const next = participants.findIndex(m => m.seat > this.lastDealerSeat);
        return next === -1 ? 0 : next;
    }

    start(byMember) {
        this.requireCreator(byMember, 'aloittaa pelin');
        if (this.gameRunning()) throw new TableError('Peli on jo käynnissä.');
        const participants = this.seated();
        if (participants.length < MIN_PLAYERS) {
            throw new TableError(`Peliin tarvitaan vähintään ${MIN_PLAYERS} pelaajaa. Voit lisätä robotin.`);
        }
        if (!participants.some(m => m.type === 'human')) {
            throw new TableError('Pelissä on oltava vähintään yksi ihminen.');
        }
        const dealerIndex = this.nextDealerIndex(participants);
        this.game = new Game(participants.map(m => ({ id: m.id, name: m.name })), { rng: this.rng, dealerIndex });
        this.lastDealerSeat = participants[dealerIndex].seat;
        this.gameEpoch++;
        this.pruneDisconnected();
        this.touch();
        const dealer = participants[dealerIndex];
        const starter = this.game.players[this.game.attacker];
        return {
            type: 'start',
            trumpCard: this.game.trumpCard,
            dealerId: dealer.id, dealerName: dealer.name,
            starterId: starter.id, starterName: starter.name,
            playerNames: this.game.players.map(p => p.name)
        };
    }

    abort(byMember) {
        this.requireCreator(byMember, 'keskeyttää pelin');
        if (!this.gameRunning()) throw new TableError('Peli ei ole käynnissä.');
        this.game = null;
        this.gameEpoch++;
        this.pruneDisconnected();
        this.touch();
        return { type: 'aborted', name: byMember.name };
    }

    // Pelin päätyttyä takaisin odotushuoneeseen, jossa robotteja voi lisätä ja poistaa.
    toLobby(byMember) {
        this.requireCreator(byMember, 'palata odotushuoneeseen');
        if (this.gameRunning()) throw new TableError('Peli on vielä käynnissä.');
        this.game = null;
        this.gameEpoch++;
        this.pruneDisconnected();
        this.touch();
        return { type: 'to-lobby', name: byMember.name };
    }

    // Poistaa katkenneet ihmiset, jotka eivät ole kesken olevassa pelissä. Luojaa odotetaan.
    pruneDisconnected() {
        this.members = this.members.filter(m =>
            m.type === 'robot' || m.connected || (this.gameRunning() && this.inGame(m)) || m.id === this.creatorId);
    }

    disconnect(member) {
        member.connected = false;
        member.disconnectedAt = this.now();
        this.pruneDisconnected();
        if (this.connectedHumans().length === 0) this.noHumansSince = this.now();
        this.touch();
    }

    // Poistuminen pöydästä omasta tahdosta. Kesken pelin ei voi poistua pelaajana.
    leave(member) {
        if (this.gameRunning() && this.inGame(member)) {
            throw new TableError('Et voi poistua kesken pelin. Pöydän luoja voi keskeyttää pelin.');
        }
        this.members = this.members.filter(m => m !== member);
        const events = [{ type: 'left', name: member.name, playerId: member.id, waiting: false }];
        if (member.id === this.creatorId) {
            const event = this.transferCreator();
            if (event) events.push(event);
        }
        if (this.connectedHumans().length === 0) this.noHumansSince = this.now();
        this.touch();
        return events;
    }

    // Luojan oikeudet pisimpään pöydässä olleelle yhdistetylle ihmiselle.
    transferCreator() {
        const previous = this.creator();
        const next = this.connectedHumans().find(m => m !== previous);
        if (!next) {
            this.creatorId = null;
            return null;
        }
        this.creatorId = next.id;
        if (previous && !previous.connected) {
            this.pruneDisconnected();
        }
        return { type: 'creator-changed', name: next.name, playerId: next.id };
    }

    // Ajastettu tarkistus. Palauttaa tapahtumat ja tiedon, pitääkö pöytä poistaa.
    maintenance() {
        const now = this.now();
        const events = [];
        const creator = this.creator();
        if ((!creator || !creator.connected)
            && (!creator || now - creator.disconnectedAt >= CREATOR_RECONNECT_MS)) {
            if (this.connectedHumans().length > 0) {
                const event = this.transferCreator();
                if (event) events.push(event);
            }
        }
        const empty = this.noHumansSince !== null && now - this.noHumansSince >= EMPTY_TABLE_MS;
        const idle = now - this.lastActivity >= MAX_IDLE_MS;
        return { events, remove: empty || idle };
    }
}

class Tables {
    constructor({ rng = Math.random, now = Date.now } = {}) {
        this.rng = rng;
        this.now = now;
        this.tables = new Map();
    }

    // Nelinumeroinen koodi kuten Bridgessä.
    create() {
        let code;
        do {
            code = String(1000 + Math.floor(this.rng() * 9000));
        } while (this.tables.has(code));
        const table = new Table(code, { rng: this.rng, now: this.now });
        this.tables.set(code, table);
        return table;
    }

    get(code) {
        return this.tables.get(String(code || '').trim()) || null;
    }

    delete(code) {
        this.tables.delete(code);
    }

    get size() {
        return this.tables.size;
    }

    [Symbol.iterator]() {
        return this.tables.values();
    }
}

module.exports = {
    Table, Tables, TableError, GameError, cleanName, ROBOT_SPEEDS,
    CREATOR_RECONNECT_MS, EMPTY_TABLE_MS, MAX_IDLE_MS
};
