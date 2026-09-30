'use strict';
// Maijan Socket.IO-kerros. Liitetään olemassa olevaan Socket.IO-palvelimeen omaan
// nimiavaruuteensa (/maija), joten sama palvelin voi ajaa myös Bridgeä:
//
//   require('./maija/socket').attach(io, { app });

const { Game, MIN_PLAYERS, MAX_PLAYERS } = require('./game.js');
const { Tables, TableError, GameError } = require('./poydat.js');
const robotti = require('./robotti.js');

const ROBOT_BASE_DELAY_MS = { slow: 4500, normal: 2500, fast: 1200 };
const ROBOTS_ONLY_DELAY_MS = 1000;
const MAINTENANCE_INTERVAL_MS = 60 * 1000;

// Arvio siitä, kauanko ruudunlukijalta kestää lukea tapahtuman ilmoitus
// (sama 60 ms/merkki kuin selaimen ilmoitusjonossa).
function estimateReadingMs(events) {
    let chars = 0;
    for (const e of events) {
        if (e.type === 'attack') chars += 45 + e.cards.length * 10;
        else if (e.type === 'defend') chars += 45 + e.pairs.length * 30 + e.pickedUp.length * 12;
        else chars += 60;
    }
    return Math.min(6000, chars * 60);
}

function attach(io, options = {}) {
    const nsp = io.of(options.namespace || '/maija');
    const tables = new Tables({ rng: options.rng || Math.random, now: options.now || Date.now });
    const robotDelay = options.robotDelayMs;   // testeissä kiinteä lyhyt viive

    if (options.app) {
        options.app.get('/maija/health', (req, res) => {
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
                minPlayers: MIN_PLAYERS,
                maxPlayers: MAX_PLAYERS,
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

    // ===== Robotit (Bridgen maybeTriggerRobot / runRobotTurn) =====

    function currentActorId(game) {
        if (!game || game.phase === 'over') return null;
        return game.players[game.phase === 'attack' ? game.attacker : game.defender].id;
    }

    function clearRobotTimer(table) {
        if (table.robotTimer) clearTimeout(table.robotTimer);
        table.robotTimer = null;
    }

    function maybeTriggerRobot(table, lastEvents = []) {
        const game = table.game;
        const actorId = currentActorId(game);
        if (!actorId) return;
        const actor = table.member(actorId);
        if (!actor || actor.type !== 'robot') return;
        // Robotit odottavat, kun pöydässä ei ole yhtään yhdistettyä ihmistä.
        if (table.connectedHumans().length === 0) return;
        if (table.robotTimer) return;

        let delay;
        if (robotDelay !== undefined) {
            delay = robotDelay;
        } else {
            const humansStillPlaying = game.players.some(p => !p.out && table.member(p.id)?.type === 'human');
            delay = humansStillPlaying
                ? ROBOT_BASE_DELAY_MS[table.robotSpeed] + estimateReadingMs(lastEvents)
                : ROBOTS_ONLY_DELAY_MS;
        }
        const epoch = table.gameEpoch;
        const phase = game.phase;
        table.robotTimer = setTimeout(() => {
            table.robotTimer = null;
            runRobotTurn(table, epoch, phase, actorId);
        }, delay);
    }

    function runRobotTurn(table, epoch, phase, actorId) {
        if (tables.get(table.code) !== table) return;          // pöytä poistettiin
        if (table.gameEpoch !== epoch || !table.game) return;  // peli keskeytettiin tai aloitettiin uusi
        const game = table.game;
        if (game.phase !== phase || currentActorId(game) !== actorId) return;

        const view = game.getView(actorId);
        const method = phase === 'attack' ? 'attack' : 'defend';
        const decide = phase === 'attack' ? robotti.decideAttack : robotti.decideDefense;
        const fallback = phase === 'attack' ? robotti.randomAttack : robotti.randomDefense;
        let events;
        try {
            events = game[method](actorId, decide(view, table.rng));
        } catch (err) {
            if (!(err instanceof GameError)) throw err;
            console.error(`Maija: robotin siirto hylättiin pöydässä ${table.code}: ${err.message}`);
            events = game[method](actorId, fallback(view, table.rng));
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
                socket.emit('join-error', { text: code ? `Pöytää ${code} ei löydy.` : 'Kirjoita pöytäkoodi.', code, missing: true });
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
                seated: table.seated().length, max: MAX_PLAYERS
            }];
        }));

        socket.on('remove-robot', creatorAction((table, member, data) => {
            const robot = table.removeRobot(member, data.id);
            return [{
                type: 'robot-removed', byName: member.name, name: robot.name, playerId: robot.id,
                seated: table.seated().length, max: MAX_PLAYERS
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

        function playerAction(method) {
            return (data) => {
                const ctx = current();
                if (!ctx || !ctx.table.game) return;
                const cardIds = data && data.cardIds;
                if (!Array.isArray(cardIds) || cardIds.length > 52 || !cardIds.every(id => typeof id === 'string')) {
                    socket.emit('action-error', { text: 'Virheellinen korttivalinta.' });
                    return;
                }
                try {
                    const events = ctx.table.game[method](ctx.member.id, cardIds);
                    ctx.table.touch();
                    publish(ctx.table, events);
                } catch (err) {
                    fail(err);
                }
            };
        }

        socket.on('attack', playerAction('attack'));
        socket.on('defend', playerAction('defend'));

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
