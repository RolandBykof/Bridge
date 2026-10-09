'use strict';
// Pöydät: jäsenet istumajärjestyksessä, pöydän luoja, robotit ja jakovuoro.
// Yhteinen Musta Maijalle, ristiseiskalle ja hertalle. Peli annetaan parametrina:
//
//   new Tables({ createGame: (players, { rng, dealerIndex }) => new Game(...),
//                minPlayers: 2, maxPlayers: 5 })
//
// Pelin on tarjottava startInfo(), jonka kentät lisätään aloitustapahtumaan.
// Ei tiedä mitään yhteyksistä, joten tämän voi testata suoraan.

const crypto = require('crypto');

const MAX_NAME_LENGTH = 20;
const CREATOR_RECONNECT_MS = 5 * 60 * 1000;    // Bridgen RECONNECT_TIMEOUT
const EMPTY_TABLE_MS = 5 * 60 * 1000;
const MAX_IDLE_MS = 60 * 60 * 1000;            // Bridgen MAX_IDLE_TIME
const ROBOT_SPEEDS = ['slow', 'normal', 'fast'];

// Virhe, jonka viesti näytetään käyttäjälle sellaisenaan.
class TableError extends Error {}

// Käyttäjälle näytettävät tekstit. Hertta on englanniksi (lang: 'en'), muut suomeksi.
const TEXTS = {
    fi: {
        enterName: 'Kirjoita nimesi.',
        nameTaken: name => `Nimi ${name} on jo käytössä tässä pöydässä. Valitse toinen nimi.`,
        creatorOnly: action => `Vain pöydän luoja voi ${action}.`,
        actions: {
            addRobot: 'lisätä robotteja', removeRobot: 'poistaa robotteja',
            setSpeed: 'muuttaa robottien nopeutta', start: 'aloittaa pelin',
            abort: 'keskeyttää pelin', toLobby: 'palata odotushuoneeseen'
        },
        addRobotRunning: 'Robotteja voi lisätä vain, kun peli ei ole käynnissä.',
        tableFull: max => `Pöytä on täynnä, ${max}/${max} pelaajaa.`,
        robotName: n => `Robotti ${n}`,
        removeRobotRunning: 'Robotin voi poistaa vain, kun peli ei ole käynnissä.',
        robotNotFound: 'Robottia ei löydy.',
        unknownSpeed: 'Tuntematon nopeus.',
        alreadyRunning: 'Peli on jo käynnissä.',
        tooFewPlayers: min => `Peliin tarvitaan vähintään ${min} pelaajaa. Voit lisätä robotin.`,
        needHuman: 'Pelissä on oltava vähintään yksi ihminen.',
        notRunning: 'Peli ei ole käynnissä.',
        stillRunning: 'Peli on vielä käynnissä.',
        cannotLeave: 'Et voi poistua kesken pelin. Pöydän luoja voi keskeyttää pelin.'
    },
    en: {
        enterName: 'Enter your name.',
        nameTaken: name => `The name ${name} is already taken at this table. Choose another name.`,
        creatorOnly: action => `Only the table creator can ${action}.`,
        actions: {
            addRobot: 'add robots', removeRobot: 'remove robots',
            setSpeed: 'change the robot speed', start: 'start the game',
            abort: 'abort the game', toLobby: 'return to the lobby'
        },
        addRobotRunning: 'Robots can only be added when no game is running.',
        tableFull: max => `The table is full, ${max}/${max} players.`,
        robotName: n => `Robot ${n}`,
        removeRobotRunning: 'Robots can only be removed when no game is running.',
        robotNotFound: 'Robot not found.',
        unknownSpeed: 'Unknown speed.',
        alreadyRunning: 'A game is already running.',
        tooFewPlayers: min => `The game needs ${min} players. You can add a robot.`,
        needHuman: 'At least one human must play.',
        notRunning: 'No game is running.',
        stillRunning: 'The game is still running.',
        cannotLeave: 'You cannot leave during a game. The table creator can abort the game.'
    }
};

function cleanName(name) {
    return typeof name === 'string' ? name.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH) : '';
}

class Table {
    constructor(code, { rng = Math.random, now = Date.now, createGame, minPlayers, maxPlayers, lang = 'fi' }) {
        this.code = code;
        this.texts = TEXTS[lang] || TEXTS.fi;
        this.rng = rng;
        this.now = now;
        this.createGame = createGame;
        this.minPlayers = minPlayers;
        this.maxPlayers = maxPlayers;
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

    // Seuraavaan peliin pääsevät: robotit ja yhdistetyt ihmiset istumajärjestyksessä, enintään maxPlayers.
    seated() {
        return this.members.filter(m => m.type === 'robot' || m.connected).slice(0, this.maxPlayers);
    }

    isSpectator(member) {
        if (this.gameRunning()) return !this.inGame(member);
        return !this.seated().includes(member);
    }

    addHuman(rawName, socketId) {
        const name = cleanName(rawName);
        if (!name) throw new TableError(this.texts.enterName);
        if (this.members.some(m => m.name.toLowerCase() === name.toLowerCase())) {
            throw new TableError(this.texts.nameTaken(name));
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

    // action: avain TEXTS.*.actions-taulussa.
    requireCreator(member, action) {
        if (!this.isCreator(member)) throw new TableError(this.texts.creatorOnly(this.texts.actions[action]));
    }

    addRobot(byMember) {
        this.requireCreator(byMember, 'addRobot');
        if (this.gameRunning()) throw new TableError(this.texts.addRobotRunning);
        if (this.seated().length >= this.maxPlayers) {
            throw new TableError(this.texts.tableFull(this.maxPlayers));
        }
        let name;
        do {
            name = this.texts.robotName(++this.robotCounter);
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
        this.requireCreator(byMember, 'removeRobot');
        if (this.gameRunning()) throw new TableError(this.texts.removeRobotRunning);
        const robot = this.member(robotId);
        if (!robot || robot.type !== 'robot') throw new TableError(this.texts.robotNotFound);
        this.members = this.members.filter(m => m !== robot);
        this.touch();
        return robot;
    }

    setRobotSpeed(byMember, speed) {
        this.requireCreator(byMember, 'setSpeed');
        if (!ROBOT_SPEEDS.includes(speed)) throw new TableError(this.texts.unknownSpeed);
        this.robotSpeed = speed;
    }

    // Jakaja kiertää: edellistä jakajaa istumajärjestyksessä seuraava. Ensimmäisessä pelissä arvotaan.
    nextDealerIndex(participants) {
        if (this.lastDealerSeat === null) return Math.floor(this.rng() * participants.length);
        const next = participants.findIndex(m => m.seat > this.lastDealerSeat);
        return next === -1 ? 0 : next;
    }

    start(byMember) {
        this.requireCreator(byMember, 'start');
        if (this.gameRunning()) throw new TableError(this.texts.alreadyRunning);
        const participants = this.seated();
        if (participants.length < this.minPlayers) {
            throw new TableError(this.texts.tooFewPlayers(this.minPlayers));
        }
        if (!participants.some(m => m.type === 'human')) {
            throw new TableError(this.texts.needHuman);
        }
        const dealerIndex = this.nextDealerIndex(participants);
        this.game = this.createGame(participants.map(m => ({ id: m.id, name: m.name })), { rng: this.rng, dealerIndex });
        this.lastDealerSeat = participants[dealerIndex].seat;
        this.gameEpoch++;
        this.pruneDisconnected();
        this.touch();
        const dealer = participants[dealerIndex];
        return {
            type: 'start',
            dealerId: dealer.id, dealerName: dealer.name,
            playerNames: this.game.players.map(p => p.name),
            ...this.game.startInfo()
        };
    }

    abort(byMember) {
        this.requireCreator(byMember, 'abort');
        if (!this.gameRunning()) throw new TableError(this.texts.notRunning);
        this.game = null;
        this.gameEpoch++;
        this.pruneDisconnected();
        this.touch();
        return { type: 'aborted', name: byMember.name };
    }

    // Pelin päätyttyä takaisin odotushuoneeseen, jossa robotteja voi lisätä ja poistaa.
    toLobby(byMember) {
        this.requireCreator(byMember, 'toLobby');
        if (this.gameRunning()) throw new TableError(this.texts.stillRunning);
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
            throw new TableError(this.texts.cannotLeave);
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
    constructor({ rng = Math.random, now = Date.now, createGame, minPlayers, maxPlayers, lang = 'fi' }) {
        this.rng = rng;
        this.now = now;
        this.gameOptions = { createGame, minPlayers, maxPlayers, lang };
        this.tables = new Map();
    }

    // Nelinumeroinen koodi kuten Bridgessä.
    create() {
        let code;
        do {
            code = String(1000 + Math.floor(this.rng() * 9000));
        } while (this.tables.has(code));
        const table = new Table(code, { rng: this.rng, now: this.now, ...this.gameOptions });
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
    Table, Tables, TableError, cleanName, ROBOT_SPEEDS,
    CREATOR_RECONNECT_MS, EMPTY_TABLE_MS, MAX_IDLE_MS
};
