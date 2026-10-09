'use strict';
// Hertan Socket.IO-kerros. Liitetään olemassa olevaan Socket.IO-palvelimeen
// omaan nimiavaruuteensa (/hertta), kuten Musta Maija ja ristiseiska:
//
//   require('./hertta/socket').attach(io, { app });
//
// Peli on englanniksi, joten myös pöytien virheilmoitukset ovat englanniksi.

const { Game, GameError, PLAYERS } = require('./game.js');
const { Tables, TableError } = require('../korttipelit/poydat.js');
const robotti = require('./robotti.js');

const ROBOT_BASE_DELAY_MS = { slow: 4500, normal: 2500, fast: 1200 };
const ROBOTS_ONLY_DELAY_MS = 800;
const PASS_DELAY_MS = 600;          // robotit valitsevat vaihtokortit yhtä aikaa ihmisten kanssa
const MAINTENANCE_INTERVAL_MS = 60 * 1000;

// Arvio siitä, kauanko ruudunlukijalta kestää lukea tapahtuman ilmoitus
// (sama 45 ms/merkki kuin selaimen ilmoitusjonossa, MS_PER_CHAR).
const MS_PER_CHAR = 45;

function estimateReadingMs(events) {
    let chars = 0;
    for (const e of events) {
        if (e.type === 'play') chars += 30;
        else if (e.type === 'trick') chars += 40;
        else if (e.type === 'passed') chars += 0;
        else chars += 60;
    }
    return Math.min(4000, chars * MS_PER_CHAR);
}

function attach(io, options = {}) {
    const nsp = io.of(options.namespace || '/hertta');
    const tables = new Tables({
        rng: options.rng || Math.random,
        now: options.now || Date.now,
        createGame: (players, gameOptions) => new Game(players, gameOptions),
        minPlayers: PLAYERS,
        maxPlayers: PLAYERS,
        lang: 'en'
    });
    const robotDelay = options.robotDelayMs;   // testeissä kiinteä lyhyt viive

    if (options.app) {
        options.app.get('/hertta/health', (req, res) => {
            res.json({ status: 'OK', tables: tables.size, uptime: process.uptime() });
        });
    }

    // ===== Lähetys =====

    function memberView(table, member) {
        const creator = table.creator();
        return {
            table: {
                code: table.code,
                creatorName: creator ? creator.name : null,
                robotSpeed: table.robotSpeed,
                minPlayers: PLAYERS,
                maxPlayers: PLAYERS,
                seatedCount: table.seated().length
            },
            you: { id: member.id, name: member.name, isCreator: table.isCreator(member) },
            members: table.members.map(m => ({
                id: m.id, name: m.name, type: m.type, connected: m.connected,
                isCreator: table.isCreator(m), spectator: table.isSpectator(m)
            })),
            game: table.game ? table.game.getView(table.inGame(member) ? member.id : null) : null
        };
    }

    function humansOnline(table) {
        return table.members.filter(m => m.type === 'human' && m.connected && m.socketId);
    }

    function broadcastState(table) {
        for (const member of humansOnline(table)) {
            nsp.to(member.socketId).emit('state', memberView(table, member));
        }
    }

    function broadcastEvents(table, events) {
        for (const member of humansOnline(table)) {
            for (const event of events) {
                nsp.to(member.socketId).emit('game-event', Game.publicEvent(event, member.id));
            }
        }
    }

    function publish(table, events) {
        if (events.length) broadcastEvents(table, events);
        broadcastState(table);
        maybeTriggerRobot(table, events);
    }

    // ===== Robotit =====

    // Robotti, jonka pitää toimia: vaihtovaiheessa ensimmäinen, joka ei ole vielä
    // valinnut kortteja, pelivaiheessa vuorossa oleva.
    function robotActorId(table) {
        const game = table.game;
        if (!game) return null;
        const isRobot = p => table.member(p.id)?.type === 'robot';
        if (game.phase === 'pass') {
            const robot = game.players.find(p => !p.passSelection && isRobot(p));
            return robot ? robot.id : null;
        }
        if (game.phase === 'play') {
            const current = game.players[game.current];
            return isRobot(current) ? current.id : null;
        }
        return null;
    }

    function clearRobotTimer(table) {
        if (table.robotTimer) clearTimeout(table.robotTimer);
        table.robotTimer = null;
    }

    function maybeTriggerRobot(table, lastEvents = []) {
        const actorId = robotActorId(table);
        if (!actorId) return;
        // Robotit odottavat, kun pöydässä ei ole yhtään yhdistettyä ihmistä.
        if (table.connectedHumans().length === 0) return;
        if (table.robotTimer) return;

        const game = table.game;
        let delay;
        if (robotDelay !== undefined) {
            delay = robotDelay;
        } else if (game.phase === 'pass') {
            delay = PASS_DELAY_MS;
        } else {
            const humansPlaying = game.players.some(p => table.member(p.id)?.type === 'human');
            delay = humansPlaying
                ? ROBOT_BASE_DELAY_MS[table.robotSpeed] + estimateReadingMs(lastEvents)
                : ROBOTS_ONLY_DELAY_MS;
        }
        const epoch = table.gameEpoch;
        const moves = game.moves;
        table.robotTimer = setTimeout(() => {
            table.robotTimer = null;
            runRobotTurn(table, epoch, moves, actorId);
        }, delay);
    }

    function robotMove(game, actorId, view, decidePass, decidePlay, rng) {
        if (game.phase === 'pass') return game.pass(actorId, decidePass(view, rng));
        return game.play(actorId, decidePlay(view, rng));
    }

    function runRobotTurn(table, epoch, moves, actorId) {
        if (tables.get(table.code) !== table) return;          // pöytä poistettiin
        if (table.gameEpoch !== epoch || !table.game) return;  // peli keskeytettiin tai aloitettiin uusi
        const game = table.game;
        if (game.moves !== moves || robotActorId(table) !== actorId) {
            // Joku muu ehti siirtää välissä (esim. ihminen antoi korttinsa): ajastetaan uudelleen.
            maybeTriggerRobot(table);
            return;
        }

        const view = game.getView(actorId);
        let events;
        try {
            events = robotMove(game, actorId, view, robotti.decidePass, robotti.decidePlay, table.rng);
        } catch (err) {
            if (!(err instanceof GameError)) throw err;
            console.error(`Hertta: robotin siirto hylättiin pöydässä ${table.code}: ${err.message}`);
            events = robotMove(game, actorId, view, robotti.randomPass, robotti.randomPlay, table.rng);
        }
        table.touch();
        publish(table, events);
    }

    // ===== Ylläpito =====

    const maintenanceTimer = setInterval(() => {
        for (const table of [...tables]) {
            const { events, remove } = table.maintenance();
            if (remove) {
                clearRobotTimer(table);
                broadcastEvents(table, [{ type: 'table-closed' }]);
                tables.delete(table.code);
                continue;
            }
            if (events.length) publish(table, events);
        }
    }, MAINTENANCE_INTERVAL_MS);
    if (maintenanceTimer.unref) maintenanceTimer.unref();

    // ===== Yhteydet =====

    nsp.on('connection', (socket) => {
        function current() {
            const table = tables.get(socket.data.tableCode);
            const member = table ? table.memberByToken(socket.data.token) : null;
            return member ? { table, member } : null;
        }

        function fail(err) {
            if (err instanceof TableError || err instanceof GameError) {
                socket.emit('action-error', { text: err.message });
                return;
            }
            throw err;
        }

        function enter(table, member) {
            socket.data.tableCode = table.code;
            socket.data.token = member.token;
            socket.emit('joined', { code: table.code, token: member.token, name: member.name });
        }

        socket.on('create-table', (data) => {
            if (current()) return;
            const table = tables.create();
            let member;
            try {
                member = table.addHuman(data && data.name, socket.id);
            } catch (err) {
                tables.delete(table.code);
                if (err instanceof TableError) {
                    socket.emit('join-error', { text: err.message });
                    return;
                }
                throw err;
            }
            enter(table, member);
            publish(table, [{ type: 'table-created', code: table.code, name: member.name, playerId: member.id }]);
        });

        socket.on('join-table', (data) => {
            if (current()) return;
            const code = data && String(data.code || '').trim();
            const table = tables.get(code);
            if (!table) {
                socket.emit('join-error', { text: code ? `Table ${code} was not found.` : 'Enter a table code.', code, missing: true });
                return;
            }
            const existing = table.memberByToken(data.token);
            if (existing) {
                if (existing.connected && existing.socketId && existing.socketId !== socket.id) {
                    nsp.to(existing.socketId).emit('replaced');
                }
                table.reconnect(existing, socket.id);
                enter(table, existing);
                publish(table, [{ type: 'reconnected', name: existing.name, playerId: existing.id }]);
                return;
            }
            let member;
            try {
                member = table.addHuman(data.name, socket.id);
            } catch (err) {
                if (err instanceof TableError) {
                    socket.emit('join-error', { text: err.message, code });
                    return;
                }
                throw err;
            }
            enter(table, member);
            publish(table, [{
                type: 'joined', name: member.name, playerId: member.id,
                spectator: table.isSpectator(member)
            }]);
        });

        // Pöydän luojan toiminnot
        function creatorAction(handler) {
            return (data) => {
                const ctx = current();
                if (!ctx) return;
                try {
                    const events = handler(ctx.table, ctx.member, data || {});
                    publish(ctx.table, events);
                } catch (err) {
                    fail(err);
                }
            };
        }

        socket.on('start-game', creatorAction((table, member) => {
            clearRobotTimer(table);
            return [table.start(member)];
        }));

        socket.on('abort-game', creatorAction((table, member) => {
            clearRobotTimer(table);
            return [table.abort(member)];
        }));

        socket.on('to-lobby', creatorAction((table, member) => [table.toLobby(member)]));

        socket.on('add-robot', creatorAction((table, member) => {
            const robot = table.addRobot(member);
            return [{
                type: 'robot-added', byName: member.name, name: robot.name, playerId: robot.id,
                seated: table.seated().length, max: PLAYERS
            }];
        }));

        socket.on('remove-robot', creatorAction((table, member, data) => {
            const robot = table.removeRobot(member, data.id);
            return [{
                type: 'robot-removed', byName: member.name, name: robot.name, playerId: robot.id,
                seated: table.seated().length, max: PLAYERS
            }];
        }));

        socket.on('set-robot-speed', creatorAction((table, member, data) => {
            table.setRobotSpeed(member, data.speed);
            return [{ type: 'speed-changed', speed: table.robotSpeed, byName: member.name }];
        }));

        socket.on('leave-table', () => {
            const ctx = current();
            if (!ctx) return;
            try {
                const events = ctx.table.leave(ctx.member);
                socket.data.tableCode = null;
                socket.data.token = null;
                socket.emit('left-table');
                if (ctx.table.members.every(m => m.type === 'robot')) {
                    clearRobotTimer(ctx.table);
                    tables.delete(ctx.table.code);
                    return;
                }
                publish(ctx.table, events);
            } catch (err) {
                fail(err);
            }
        });

        // Pelitoiminnot: pass { cardIds }, play { cardId }, next-round.
        function playerAction(handler) {
            return (data) => {
                const ctx = current();
                if (!ctx || !ctx.table.game) return;
                try {
                    const events = handler(ctx.table.game, ctx.member.id, data || {});
                    ctx.table.touch();
                    publish(ctx.table, events);
                } catch (err) {
                    fail(err);
                }
            };
        }

        socket.on('pass', playerAction((game, id, data) => {
            const cardIds = data.cardIds;
            if (!Array.isArray(cardIds) || cardIds.length > 13 || !cardIds.every(c => typeof c === 'string')) {
                throw new GameError('Invalid card selection.');
            }
            return game.pass(id, cardIds);
        }));
        socket.on('play', playerAction((game, id, data) => {
            if (typeof data.cardId !== 'string') throw new GameError('Select a card first.');
            return game.play(id, data.cardId);
        }));
        socket.on('next-round', playerAction((game, id) => game.nextRound(id)));

        socket.on('disconnect', () => {
            const ctx = current();
            if (!ctx || ctx.member.socketId !== socket.id) return;
            const { table, member } = ctx;
            const waiting = table.gameRunning() && table.inGame(member);
            table.disconnect(member);
            publish(table, [{ type: 'left', name: member.name, playerId: member.id, waiting }]);
        });
    });

    return {
        namespace: nsp,
        tables,
        close() {
            clearInterval(maintenanceTimer);
            for (const table of tables) clearRobotTimer(table);
        }
    };
}

module.exports = { attach, estimateReadingMs };
