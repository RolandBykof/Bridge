// Hertta (Hearts) – selainohjelma. Palvelin tarkistaa kaikki siirrot. Tämä tiedosto
// piirtää pelitilanteen, hoitaa näppäinkomennot ja ruudunlukijailmoitukset.
// Runko (ilmoitusjono, odotushuone, äänet) on sama kuin ristiseiskassa.
// Peli on englanniksi. Peli ei kerro, mitkä omat kortit ovat pelattavissa:
// pelaaja päättelee sen itse, ja palvelin kertoo syyn, jos siirto ei käy.
(function () {
    'use strict';

    const { SUIT_SYMBOLS, cardId, capitalize } = window.Kortit;
    const { SUITS, PASS_COUNT, GAME_END_SCORE, cardName, rankWord, rankValue } = window.HerttaSaannot;

    // Samat näppäimet kuin Accessible Bridgessä, Maijassa ja ristiseiskassa.
    const SUIT_KEYS = { s: 'spades', h: 'hearts', d: 'diamonds', c: 'clubs' };
    const RANK_KEYS = {
        a: 'A', k: 'K', q: 'Q', j: 'J', t: '10', '1': '10',
        '2': '2', '3': '3', '4': '4', '5': '5', '6': '6', '7': '7', '8': '8', '9': '9'
    };
    // Oma käsi: Alt+A S D F. Pelatut kortit maittain: suoraan yläpuolella Alt+Q W E R.
    const ALT_HAND_CODES = { KeyA: 'spades', KeyS: 'hearts', KeyD: 'diamonds', KeyF: 'clubs' };
    const ALT_PLAYED_CODES = { KeyQ: 'spades', KeyW: 'hearts', KeyE: 'diamonds', KeyR: 'clubs' };
    const DIRECTION_TEXT = { left: 'to the left', right: 'to the right', across: 'across' };
    const MAX_LOG_ITEMS = 150;

    const $ = id => document.getElementById(id);

    // localStorage voi puuttua tai heittää virheen (yksityinen ikkuna, estetyt tiedot).
    const storage = {
        get(key, fallback) {
            try {
                const value = localStorage.getItem(key);
                return value === null ? fallback : value;
            } catch (e) {
                return fallback;
            }
        },
        set(key, value) {
            try {
                localStorage.setItem(key, value);
            } catch (e) { /* ei tallenneta */ }
        },
        remove(key) {
            try {
                localStorage.removeItem(key);
            } catch (e) { /* ei tallennettu */ }
        }
    };

    // Pöytä, johon selain palaa uudelleenlatauksen jälkeen: { code, token, name }.
    const session = {
        get() {
            try {
                return JSON.parse(storage.get('hertta-session', 'null'));
            } catch (e) {
                return null;
            }
        },
        set(value) {
            storage.set('hertta-session', JSON.stringify(value));
        },
        clear() {
            storage.remove('hertta-session');
        }
    };

    const ROBOT_SPEED_NAMES = { slow: 'slow', normal: 'normal', fast: 'fast' };

    const ui = {
        state: null,
        myName: storage.get('hertta-name', storage.get('ristiseiska-name', storage.get('maija-name', ''))),
        selected: [],               // valittujen korttien id:t: pelatessa enintään 1, vaihdossa enintään 3
        pendingSuit: null,
        lastAnnouncement: '',
        previousTurnKey: null,
        soundOn: storage.get('hertta-sound', 'on') === 'on',
        speechOn: storage.get('hertta-speech', 'off') === 'on'
    };

    // ===== Ilmoitukset (Accessible Bridgen announcementQueue) =====

    // Arvioitu lukuaika merkkiä kohden. Sama arvo on palvelimella robottien viiveessä
    // (hertta/socket.js, estimateReadingMs).
    const MS_PER_CHAR = 45;

    const announcer = {
        queue: [],
        processing: false,
        timer: null,
        showTimer: null,

        add(message) {
            if (!message) return;
            ui.lastAnnouncement = message;
            this.queue.push(message);
            if (!this.processing) this.next();
        },

        // Vastaus käyttäjän omaan toimintoon luetaan heti, ei jonon hännillä.
        addUrgent(messages) {
            const list = (Array.isArray(messages) ? messages : [messages]).filter(Boolean);
            if (list.length === 0) return;
            ui.lastAnnouncement = list.join(' ');
            clearTimeout(this.timer);
            clearTimeout(this.showTimer);
            this.queue.unshift(...list);
            this.next();
        },

        next() {
            if (this.queue.length === 0) {
                this.processing = false;
                return;
            }
            this.processing = true;
            const message = this.queue.shift();
            const region = $('announcer');
            region.textContent = '';
            this.showTimer = setTimeout(() => {
                region.textContent = message;
                speak(message);
                const duration = Math.max(400, Math.min(5000, message.length * MS_PER_CHAR));
                this.timer = setTimeout(() => this.next(), duration);
            }, 50);
        }
    };

    function announce(message) {
        announcer.add(message);
    }

    function respond(message) {
        announcer.addUrgent(message);
    }

    function repeatLastAnnouncement() {
        respond(ui.lastAnnouncement || 'No earlier announcements.');
    }

    function speak(message) {
        if (!ui.speechOn || !('speechSynthesis' in window)) return;
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(message);
        utterance.lang = 'en-GB';
        window.speechSynthesis.speak(utterance);
    }

    function addLog(message) {
        const log = $('log');
        const item = document.createElement('li');
        item.textContent = message;
        log.appendChild(item);
        while (log.children.length > MAX_LOG_ITEMS) log.removeChild(log.firstChild);
        log.scrollTop = log.scrollHeight;
    }

    // ===== Äänet =====

    let audioContext = null;

    function unlockAudio() {
        if (!audioContext && (window.AudioContext || window.webkitAudioContext)) {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (audioContext && audioContext.state === 'suspended') audioContext.resume();
    }

    function playSound(name) {
        if (!ui.soundOn) return;
        const audio = $(`sound-${name}`);
        if (!audio) return;
        audio.currentTime = 0;
        audio.play().catch(() => { /* selain esti toiston */ });
    }

    // Lyhyt merkkiääni, kun oma vuoro alkaa.
    function playTurnCue() {
        if (!ui.soundOn || !audioContext) return;
        const oscillator = audioContext.createOscillator();
        const gain = audioContext.createGain();
        oscillator.frequency.value = 660;
        gain.gain.setValueAtTime(0.15, audioContext.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.25);
        oscillator.connect(gain).connect(audioContext.destination);
        oscillator.start();
        oscillator.stop(audioContext.currentTime + 0.25);
    }

    // ===== Apufunktiot =====

    function game() {
        return ui.state ? ui.state.game : null;
    }

    function myId() {
        return ui.state ? ui.state.you.id : null;
    }

    function isMe(id, name) {
        if (id && myId()) return id === myId();
        return name === ui.myName;
    }

    function playerById(id) {
        const g = game();
        return g ? g.players.find(p => p.id === id) : null;
    }

    function nameOf(id) {
        const player = playerById(id);
        return player ? player.name : '';
    }

    // "you" omalle nimelle lauseen keskellä, "You" lauseen alussa.
    function who(id, name, start = false) {
        if (isMe(id, name)) return start ? 'You' : 'you';
        return name || nameOf(id);
    }

    function isRobot(id) {
        const member = ui.state ? ui.state.members.find(m => m.id === id) : null;
        return !!member && member.type === 'robot';
    }

    function myHand() {
        const g = game();
        return g && g.hand ? g.hand : [];
    }

    function selectedCards() {
        return ui.selected.map(id => myHand().find(card => cardId(card) === id)).filter(Boolean);
    }

    function cardsText(count) {
        return count === 1 ? '1 card' : `${count} cards`;
    }

    function pointsText(points) {
        return Math.abs(points) === 1 ? `${points} point` : `${points} points`;
    }

    // "queen of spades, 2 of hearts and ace of hearts"
    function listCards(cards) {
        const names = cards.map(cardName);
        if (names.length <= 1) return names.join('');
        return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
    }

    function listNames(names) {
        if (names.length <= 1) return names.join('');
        return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
    }

    function inPassPhase(g) {
        return g && g.phase === 'pass';
    }

    function maxSelection(g) {
        return inPassPhase(g) ? PASS_COUNT : 1;
    }

    // ===== Tapahtumien tekstit =====

    // Ruudunlukija lukee koodin numero kerrallaan: "4 7 1 2".
    function spellCode(code) {
        return String(code).split('').join(' ');
    }

    function passInstruction(direction) {
        return direction === 'none'
            ? 'No passing this round.'
            : `Pass ${PASS_COUNT} cards ${DIRECTION_TEXT[direction]}.`;
    }

    function eventText(e) {
        switch (e.type) {
            case 'table-created':
                return `You created a table. The table code is ${spellCode(e.code)}. Give the code to others or add robots.`;
            case 'joined':
                if (isMe(e.playerId, e.name)) {
                    return e.spectator
                        ? 'You joined as a spectator. The table is full or a game is running. You can play when a seat is free.'
                        : 'You joined the table.';
                }
                return e.spectator ? `${e.name} joined as a spectator.` : `${e.name} joined.`;
            case 'reconnected':
                return isMe(e.playerId, e.name) ? 'Connection restored.' : `${e.name} is back.`;
            case 'left':
                return e.waiting
                    ? `${e.name} lost connection. The game waits for them to return.`
                    : `${e.name} left.`;
            case 'robot-added':
                return `${isMe(null, e.byName) ? 'You' : e.byName} added ${e.name} to the table. Players ${e.seated}/${e.max}.`;
            case 'robot-removed':
                return `${isMe(null, e.byName) ? 'You' : e.byName} removed ${e.name}. Players ${e.seated}/${e.max}.`;
            case 'speed-changed':
                return `Robot speed: ${ROBOT_SPEED_NAMES[e.speed]}.`;
            case 'creator-changed':
                return isMe(e.playerId, e.name)
                    ? 'You are now the table creator. You can add robots and start the game.'
                    : `The table creator is now ${e.name}.`;
            case 'to-lobby':
                return 'Returned to the lobby.';
            case 'table-closed':
                return 'The table was closed because it was not used.';
            case 'start':
                return `Game started. Players: ${e.playerNames.join(', ')}. Dealer: ${who(e.dealerId, e.dealerName)}. Round ${e.round}. ${passInstruction(e.passDirection)}`;
            case 'round-start':
                return `Round ${e.round} started. Dealer: ${who(e.dealerId, e.dealerName)}. ${passInstruction(e.passDirection)}`;
            case 'aborted':
                return `${e.name} aborted the game.`;
            case 'passed':
                return isMe(e.playerId, e.name)
                    ? `You passed ${listCards(e.cards)} to ${e.toName}.`
                    : `${e.name} has chosen cards to pass.`;
            case 'exchange': {
                const received = e.transfers.find(t => t.toId === myId());
                return received
                    ? `Cards exchanged. You received ${listCards(received.cards)} from ${received.fromName}.`
                    : 'Cards exchanged.';
            }
            case 'play': {
                const broke = e.brokeHearts ? ' Hearts are broken.' : '';
                if (e.auto === 'two-of-clubs') return `${who(e.playerId, e.name, true)} ${isMe(e.playerId, e.name) ? 'lead' : 'leads'} the 2 of clubs.`;
                return `${who(e.playerId, e.name, true)} played ${cardName(e.card)}.${broke}`;
            }
            case 'last-trick':
                return 'Everyone has one card left. The last trick is played automatically.';
            case 'trick': {
                const pts = e.points !== 0 ? `, ${pointsText(e.points)}` : ', no points';
                return `${who(e.winnerId, e.winnerName, true)} won the trick${pts}.`;
            }
            case 'round-over': {
                const round = e.results.map(r => `${who(r.id, r.name)} ${r.points}`).join(', ');
                const totals = e.results.map(r => `${who(r.id, r.name)} ${r.total}`).join(', ');
                return `Round ${e.round} over. Points this round: ${round}. Totals: ${totals}.`;
            }
            case 'over': {
                const names = e.winnerIds.map((id, i) => who(id, e.winnerNames[i]));
                const iWon = e.winnerIds.includes(myId());
                const winner = e.winnerIds.length === 1
                    ? (iWon ? 'You won' : `${names[0]} won`)
                    : `${capitalize(listNames(names))} share the win`;
                return `Game over. ${winner} with ${pointsText(e.winningScore)}.`;
            }
            default:
                return '';
        }
    }

    function isOwnMove(e) {
        return (e.type === 'play' && !e.auto && isMe(e.playerId, e.name))
            || (e.type === 'passed' && isMe(e.playerId, e.name));
    }

    // Oman siirron tulos ja sen välittömät seuraukset luetaan yhtenä ryhmänä heti
    // jonon kärjestä. Palvelin lähettää tapahtumat ja heti perään uuden tilan.
    function isOwnMoveFollowup(e) {
        return ['trick', 'round-over', 'over', 'exchange', 'last-trick'].includes(e.type) || (e.type === 'play' && e.auto);
    }

    function flushOwnMove(turnText) {
        clearTimeout(ui.ownMoveTimer);
        const batch = ui.ownMove;
        ui.ownMove = null;
        if (batch) announcer.addUrgent([...batch, turnText]);
        else if (turnText) announce(turnText);
    }

    function handleEvent(e) {
        const text = eventText(e);
        if (text) {
            addLog(text);
            if (isOwnMove(e)) {
                ui.ownMove = [text];
                clearTimeout(ui.ownMoveTimer);
                ui.ownMoveTimer = setTimeout(() => flushOwnMove(null), 300);
            } else if (ui.ownMove && isOwnMoveFollowup(e)) {
                ui.ownMove.push(text);
            } else {
                announce(text);
            }
        }
        if (e.type === 'start' || e.type === 'round-start') {
            ui.selected = [];
            ui.previousTurnKey = null;
            playSound('deal');
        } else if (e.type === 'play') {
            playSound('play');
        } else if (e.type === 'exchange') {
            playSound('receive');
        } else if (e.type === 'table-closed') {
            session.clear();
            ui.state = null;
            render();
        }
    }

    // Kun oma vuoro alkaa, kerrotaan vain se. Mitä voi pelata, pelaaja päättelee itse.
    function turnChangeText() {
        const g = game();
        if (!g || g.phase === 'over') {
            ui.previousTurnKey = g ? 'over' : null;
            return null;
        }
        const canPass = g.allowedActions.includes('pass');
        const key = `${g.round}:${g.phase}:${g.currentId}:${canPass}`;
        if (key === ui.previousTurnKey) return null;
        ui.previousTurnKey = key;

        if (canPass) {
            playTurnCue();
            return `Choose ${PASS_COUNT} cards to pass to ${nameOf(g.passTargetId)}, then press L.`;
        }
        if (g.phase === 'play' && g.currentId === myId()) {
            playTurnCue();
            if (g.trick.length === 0) return 'Your turn to lead.';
            return `Your turn. ${capitalize(g.trick[0].card.suit)} led.`;
        }
        if (g.phase === 'round-over' && g.allowedActions.includes('next-round')) {
            return 'Press L to start the next round.';
        }
        return null;
    }

    // ===== Piirto =====

    function createCardElement(card, { selectable = false, note = '' } = {}) {
        const id = cardId(card);
        const element = document.createElement('div');
        element.className = `card-display suit-${card.suit}`;
        element.dataset.card = id;
        const selected = selectable && ui.selected.includes(id);
        if (selected) element.classList.add('is-selected');

        const suit = document.createElement('span');
        suit.className = 'card-suit';
        suit.setAttribute('aria-hidden', 'true');
        // U+FE0E pakottaa tekstiesityksen, jottei esim. ♥ piirry emojina.
        suit.textContent = `${SUIT_SYMBOLS[card.suit]}︎`;
        const rank = document.createElement('span');
        rank.className = 'card-rank';
        rank.setAttribute('aria-hidden', 'true');
        rank.textContent = card.rank;

        // Div ei saa fokusta (kuten Bridgessä), joten nimi kerrotaan piilotekstinä selaustilaa varten.
        const label = document.createElement('span');
        label.className = 'sr-only';
        label.textContent = cardName(card) + (selected ? ', selected' : '') + (note ? `, ${note}` : '');

        element.append(suit, rank, label);
        if (selectable) {
            element.addEventListener('click', () => toggleCard(card.suit, card.rank, { playNow: true }));
        }
        return element;
    }

    const VIEW_HEADINGS = { start: 'start-heading', lobby: 'lobby-heading', game: 'game-heading' };
    let currentView = null;

    function showView(name) {
        $('start-view').hidden = name !== 'start';
        $('lobby-view').hidden = name !== 'lobby';
        $('game-view').hidden = name !== 'game';
        $('log-section').hidden = name === 'start';
        if (name === currentView) return;
        const previous = currentView;
        currentView = name;
        const active = document.activeElement;
        const focusLost = !active || active === document.body || active.closest('[hidden]');
        if (previous && focusLost) {
            const heading = $(VIEW_HEADINGS[name]);
            heading.setAttribute('tabindex', '-1');
            heading.focus();
        }
    }

    function render() {
        const state = ui.state;
        if (!state) {
            showView('start');
            document.title = 'Hearts';
            return;
        }
        if (state.game) {
            showView('game');
            renderGame();
        } else {
            showView('lobby');
            renderLobby();
            document.title = `Hearts – table ${state.table.code}`;
        }
    }

    function memberLabel(member, state) {
        const tags = [];
        if (member.id === state.you.id) tags.push('you');
        if (member.isCreator) tags.push('table creator');
        if (member.type === 'robot') tags.push('robot');
        if (member.spectator) tags.push('spectator');
        if (!member.connected) tags.push('connection lost');
        return tags.length ? `${member.name} – ${tags.join(', ')}` : member.name;
    }

    function renderLobby() {
        const state = ui.state;
        const t = state.table;
        $('lobby-heading').textContent = `Table ${t.code} – ${t.seatedCount}/${t.maxPlayers} players`;
        $('lobby-code').textContent = t.code;

        // Jos fokus on robotin Remove-painikkeessa, se palautetaan saman robotin painikkeeseen.
        const active = document.activeElement;
        const focusedRobot = ui.focusRobotAfterRender
            || (active && active.dataset && active.dataset.robotId) || null;
        ui.focusRobotAfterRender = null;

        const list = $('lobby-members');
        list.replaceChildren();
        for (const member of state.members) {
            const item = document.createElement('li');
            const text = document.createElement('span');
            text.textContent = memberLabel(member, state);
            item.appendChild(text);
            if (member.type === 'robot' && state.you.isCreator) {
                const remove = document.createElement('button');
                remove.type = 'button';
                remove.className = 'secondary small';
                remove.textContent = 'Remove';
                remove.setAttribute('aria-label', `Remove ${member.name}`);
                remove.dataset.robotId = member.id;
                remove.addEventListener('click', () => removeRobot(member.id));
                item.append(' ', remove);
            }
            list.appendChild(item);
        }

        if (focusedRobot === 'add-robot-button') {
            $('add-robot-button').focus();
        } else if (focusedRobot) {
            const button = list.querySelector(`[data-robot-id="${focusedRobot}"]`);
            if (button) button.focus();
            else $('add-robot-button').focus();
        }

        const isCreator = state.you.isCreator;
        $('creator-tools').hidden = !isCreator;
        const full = t.seatedCount >= t.maxPlayers;
        $('add-robot-button').setAttribute('aria-disabled', full ? 'true' : 'false');
        $('add-robot-button').textContent = full ? `Add robot (table full, ${t.maxPlayers}/${t.maxPlayers})` : 'Add robot';
        $('start-button').setAttribute('aria-disabled', t.seatedCount < t.minPlayers ? 'true' : 'false');
        $('robot-speed').value = t.robotSpeed;

        const me = state.members.find(m => m.id === state.you.id);
        if (isCreator) {
            const missing = t.minPlayers - t.seatedCount;
            $('lobby-info').textContent = missing > 0
                ? `You are the table creator. Hearts needs exactly ${t.minPlayers} players: give the table code to others or add ${missing === 1 ? 'a robot' : `${missing} robots`}.`
                : 'You are the table creator. You can start the game.';
        } else {
            let text = `Waiting for the table creator ${t.creatorName || ''} to start the game.`;
            if (me && me.spectator) text += ' The table is full, so you are a spectator.';
            $('lobby-info').textContent = text;
        }
    }

    function removeRobot(robotId) {
        const robots = ui.state.members.filter(m => m.type === 'robot');
        const index = robots.findIndex(r => r.id === robotId);
        const next = robots[index + 1] || robots[index - 1];
        ui.focusRobotAfterRender = next ? next.id : 'add-robot-button';
        socket.emit('remove-robot', { id: robotId });
    }

    function turnBarText(g) {
        if (g.phase === 'over') return 'Game over.';
        if (g.phase === 'round-over') return `Round ${g.round} over.`;
        if (g.phase === 'pass') {
            if (g.allowedActions.includes('pass')) {
                return `Choose ${PASS_COUNT} cards to pass to ${nameOf(g.passTargetId)} (${DIRECTION_TEXT[g.passDirection]})`;
            }
            const ready = g.players.filter(p => p.passed).length;
            return `Waiting for others to pass cards (${ready}/${g.players.length} ready)`;
        }
        if (g.currentId === myId()) return g.trick.length === 0 ? 'Your turn to lead' : 'Your turn';
        return `To play: ${nameOf(g.currentId)}${isRobot(g.currentId) ? ' – thinking…' : ''}`;
    }

    function renderGame() {
        const g = game();
        const state = ui.state;
        const isPlayer = g.hand !== null;

        // Valinnat, joita ei enää ole kädessä, poistetaan.
        ui.selected = ui.selected.filter(id => myHand().some(c => cardId(c) === id)).slice(0, maxSelection(g));
        if (inPassPhase(g) && !g.allowedActions.includes('pass')) ui.selected = [];

        const myTurn = g.allowedActions.includes('pass') || g.allowedActions.includes('play');
        const bar = $('turn-bar');
        bar.classList.toggle('is-yours', myTurn);
        bar.textContent = turnBarText(g);
        document.title = myTurn ? 'Your turn – Hearts' : 'Hearts';

        renderPlayers(g, state);
        renderTrick(g);
        renderHand(g, isPlayer, myTurn);
        updateActionButton();

        $('abort-button').hidden = !(state.you.isCreator && g.phase !== 'over');
        renderResult(g, state);
    }

    function renderPlayers(g, state) {
        const list = $('players');
        list.replaceChildren();
        for (const player of g.players) {
            const member = state.members.find(m => m.id === player.id);
            const item = document.createElement('li');
            item.className = 'player';
            const acting = (g.phase === 'play' && player.id === g.currentId)
                || (g.phase === 'pass' && !player.passed);

            if (acting) {
                item.classList.add('is-current');
                const badge = document.createElement('span');
                badge.className = 'turn-badge';
                badge.textContent = g.phase === 'pass' ? 'CHOOSING CARDS' : 'TO PLAY';
                item.appendChild(badge);
            }

            const name = document.createElement('span');
            name.className = 'player-name';
            name.textContent = player.id === myId() ? `${player.name} (you)` : player.name;

            const meta = document.createElement('span');
            meta.className = 'player-meta';
            const details = [];
            if (member && member.type === 'robot') details.push('robot');
            if (player.id === g.dealerId) details.push('dealer');
            details.push(`score ${player.score}`);
            details.push(`this round ${player.roundPoints}`);
            details.push(player.tricks === 1 ? '1 trick' : `${player.tricks} tricks`);
            if (g.phase === 'pass' && player.passed) details.push('passed');
            if (member && !member.connected) details.push('connection lost');
            meta.textContent = details.join(' · ');

            item.append(name, meta);
            list.appendChild(item);
        }
    }

    function playedCardElement(entry, extraClass) {
        const wrap = document.createElement('div');
        wrap.className = `played-card ${extraClass}`.trim();
        const label = document.createElement('span');
        label.className = 'played-label';
        label.textContent = entry.playerId === myId() ? 'You' : nameOf(entry.playerId);
        wrap.append(label, createCardElement(entry.card));
        return wrap;
    }

    function roundInfoText(g) {
        const parts = [`Round ${g.round}`];
        parts.push(g.passDirection === 'none' ? 'no passing' : `pass ${DIRECTION_TEXT[g.passDirection]}`);
        parts.push(g.heartsBroken ? 'hearts broken' : 'hearts not broken');
        return parts.join(' · ');
    }

    // Käynnissä oleva tikki pelijärjestyksessä. Kun tikki on tyhjä, näytetään edellinen.
    function renderTrick(g) {
        $('round-info').textContent = roundInfoText(g);
        const area = $('trick');
        area.replaceChildren();
        const last = g.lastTrick;

        if (g.trick.length > 0 || !last || g.phase === 'pass') {
            $('table-heading').textContent = g.phase === 'play'
                ? `Trick ${g.tricksPlayed + 1} of 13`
                : 'Trick';
            if (g.trick.length === 0 || g.phase === 'pass') {
                const note = document.createElement('p');
                note.className = 'table-empty';
                note.textContent = g.phase === 'pass' ? 'Passing cards.' : 'No cards played yet.';
                area.appendChild(note);
                return;
            }
            for (const entry of g.trick) area.appendChild(playedCardElement(entry, ''));
            return;
        }

        const winner = last.winnerId === myId() ? 'you' : nameOf(last.winnerId);
        $('table-heading').textContent = `Last trick – won by ${winner}, ${pointsText(last.points)}`;
        for (const entry of last.cards) {
            area.appendChild(playedCardElement(entry, entry.playerId === last.winnerId ? 'is-winner is-last-trick' : 'is-last-trick'));
        }
    }

    function handNote(g, card) {
        const id = cardId(card);
        if (g.passSelection && g.passSelection.some(c => cardId(c) === id)) return 'passing';
        if (g.received && g.tricksPlayed === 0 && g.received.some(c => cardId(c) === id)) return 'received';
        return '';
    }

    function renderHand(g, isPlayer, myTurn) {
        const area = $('hand-area');
        const hand = $('hand');
        area.classList.toggle('is-current', myTurn);
        hand.replaceChildren();

        if (!isPlayer) {
            $('hand-heading').textContent = 'You are watching';
            const note = document.createElement('p');
            note.className = 'hand-empty';
            note.textContent = 'You can join the next game.';
            hand.appendChild(note);
            return;
        }

        const cards = myHand();
        const chosen = selectedCards();
        let heading = `Your hand – ${cardsText(cards.length)}`;
        if (inPassPhase(g) && g.allowedActions.includes('pass')) heading += `, ${chosen.length} of ${PASS_COUNT} selected`;
        else if (chosen.length === 1) heading += `, selected ${cardName(chosen[0])}`;
        $('hand-heading').textContent = heading;

        if (cards.length === 0) {
            const note = document.createElement('p');
            note.className = 'hand-empty';
            note.textContent = 'Your hand is empty.';
            hand.appendChild(note);
            return;
        }
        for (const suit of SUITS) {
            const ofSuit = cards.filter(c => c.suit === suit);
            if (ofSuit.length === 0) continue;
            const row = document.createElement('div');
            row.className = 'suit-row';
            for (const card of ofSuit) {
                const note = handNote(g, card);
                const element = createCardElement(card, { selectable: true, note });
                if (note === 'passing') element.classList.add('is-passing');
                if (note === 'received') element.classList.add('is-received');
                row.appendChild(element);
            }
            hand.appendChild(row);
        }
    }

    function renderResult(g, state) {
        const section = $('result');
        const show = g.phase === 'round-over' || g.phase === 'over';
        section.hidden = !show;
        if (!show) return;

        const over = g.phase === 'over';
        $('result-heading').textContent = over ? 'Game over' : `Round ${g.round} over`;
        if (over) {
            const names = g.winnerIds.map(id => (id === myId() ? 'You' : nameOf(id)));
            const score = playerById(g.winnerIds[0]).score;
            $('result-winner').textContent = g.winnerIds.length === 1
                ? `${names[0] === 'You' ? 'You win' : `Winner: ${names[0]}`} with ${pointsText(score)}.`
                : `Shared win: ${listNames(names)} with ${pointsText(score)}.`;
        } else {
            $('result-winner').textContent = `Lowest score wins. The game ends when someone reaches ${GAME_END_SCORE} points.`;
        }
        renderScoreTable(g);

        const canNext = g.allowedActions.includes('next-round');
        $('next-round-button').hidden = !canNext;
        $('new-game-button').hidden = !(over && state.you.isCreator);
        $('to-lobby-button').hidden = !(over && state.you.isCreator);
        if (!over) {
            $('result-wait').textContent = canNext ? 'Any player can start the next round.' : 'Waiting for a player to start the next round.';
        } else {
            $('result-wait').textContent = state.you.isCreator
                ? 'A new game starts with the same players. In the lobby you can add or remove robots.'
                : `Waiting for the table creator ${state.table.creatorName || ''} to start a new game.`;
        }
    }

    function renderScoreTable(g) {
        const table = $('score-table');
        const head = table.querySelector('thead');
        const body = table.querySelector('tbody');
        const headRow = document.createElement('tr');
        const headers = ['Player', ...g.history.map(h => `Round ${h.round}`), 'Total'];
        for (const text of headers) {
            const th = document.createElement('th');
            th.scope = 'col';
            th.textContent = text;
            headRow.appendChild(th);
        }
        head.replaceChildren(headRow);

        body.replaceChildren();
        g.players.forEach((player, i) => {
            const row = document.createElement('tr');
            if (g.winnerIds.includes(player.id)) row.classList.add('is-winner');
            const th = document.createElement('th');
            th.scope = 'row';
            th.textContent = player.id === myId() ? `${player.name} (you)` : player.name;
            row.appendChild(th);
            for (const h of g.history) {
                const td = document.createElement('td');
                td.textContent = h.points[i];
                row.appendChild(td);
            }
            const total = document.createElement('td');
            total.className = 'total';
            total.textContent = player.score;
            row.appendChild(total);
            body.appendChild(row);
        });
    }

    function updateActionButton() {
        const g = game();
        const button = $('action-button');
        const isPlayer = g && g.hand !== null;
        button.hidden = !isPlayer;
        $('clear-button').hidden = !isPlayer;
        if (!isPlayer) return;

        // aria-disabled eikä disabled: painike pysyy fokusoitavana, joten fokus ei
        // katoa, kun vuoro vaihtuu. Painaminen kertoo, mitä pitää tehdä.
        const chosen = selectedCards();
        const actions = g.allowedActions;
        if (actions.includes('pass')) {
            const ready = chosen.length === PASS_COUNT;
            button.setAttribute('aria-disabled', ready ? 'false' : 'true');
            button.textContent = ready
                ? `Pass ${PASS_COUNT} cards to ${nameOf(g.passTargetId)} (L)`
                : `Select ${PASS_COUNT} cards to pass (${chosen.length}/${PASS_COUNT})`;
        } else if (actions.includes('play')) {
            button.setAttribute('aria-disabled', chosen.length === 1 ? 'false' : 'true');
            button.textContent = 'Play selected (L)';
        } else if (actions.includes('next-round')) {
            button.setAttribute('aria-disabled', 'false');
            button.textContent = 'Next round (L)';
        } else {
            button.setAttribute('aria-disabled', 'true');
            if (g.phase === 'over') button.textContent = 'Game over';
            else if (g.phase === 'pass') button.textContent = 'Waiting for others to pass';
            else button.textContent = 'Wait for your turn';
        }
    }

    function refreshSelection() {
        const g = game();
        if (!g) return;
        renderHand(g, g.hand !== null, g.allowedActions.includes('pass') || g.allowedActions.includes('play'));
        updateActionButton();
    }

    // ===== Toiminnot =====

    // Pelatessa valittuna on enintään yksi kortti, vaihdossa enintään kolme.
    // Saman kortin valinta uudelleen poistaa sen. Kirjoitettu (esim. S ja 4) tai
    // napsautettu kortti pelataan heti; vain vaihdossa valitaan ja painetaan L.
    function toggleCard(suit, rank, { playNow = false } = {}) {
        const g = game();
        if (!g || g.hand === null) return;
        const card = myHand().find(c => c.suit === suit && c.rank === rank);
        const name = cardName({ suit, rank });
        if (!card) {
            respond(`You do not have the ${name}.`);
            return;
        }
        const id = cardId(card);
        const passing = inPassPhase(g) && g.allowedActions.includes('pass');
        if (playNow && !passing) {
            if (!g.allowedActions.includes('play')) {
                respond(notYourTurnText(g));
                return;
            }
            ui.selected = [];
            socket.emit('play', { cardId: id });
            return;
        }
        if (ui.selected.includes(id)) {
            ui.selected = ui.selected.filter(s => s !== id);
            refreshSelection();
            respond(passing ? `Deselected ${name}. ${ui.selected.length} of ${PASS_COUNT} selected.` : `Deselected ${name}.`);
            return;
        }
        if (passing) {
            if (ui.selected.length >= PASS_COUNT) {
                respond(`You have already selected ${PASS_COUNT} cards. Deselect one first, or press Escape to clear.`);
                return;
            }
            ui.selected.push(id);
            refreshSelection();
            const count = ui.selected.length;
            respond(`Selected ${name}. ${count} of ${PASS_COUNT} selected.${count === PASS_COUNT ? ' Press L to pass.' : ''}`);
            return;
        }
        ui.selected = [id];
        refreshSelection();
        respond(`Selected ${name}.`);
    }

    function clearSelection() {
        const chosen = selectedCards();
        ui.selected = [];
        ui.pendingSuit = null;
        refreshSelection();
        respond(chosen.length ? `Selection cleared: ${listCards(chosen)}.` : 'No cards selected.');
    }

    function notYourTurnText(g) {
        if (g.phase === 'over') return 'The game is over.';
        if (g.phase === 'pass') return 'You have passed your cards. Waiting for the others.';
        if (g.phase === 'round-over') return 'The round is over.';
        return `It is not your turn. ${nameOf(g.currentId)} is to play.`;
    }

    function performAction() {
        const g = game();
        if (!g || g.hand === null) return;
        const chosen = selectedCards();

        if (g.allowedActions.includes('pass')) {
            if (chosen.length !== PASS_COUNT) {
                respond(`Select ${PASS_COUNT} cards to pass to ${nameOf(g.passTargetId)}. ${chosen.length} selected. For example, press S and then Q.`);
                return;
            }
            socket.emit('pass', { cardIds: chosen.map(cardId) });
            ui.selected = [];
            return;
        }

        if (g.allowedActions.includes('play')) {
            if (chosen.length !== 1) {
                respond('Type a card to play it, for example H and 8.');
                return;
            }
            socket.emit('play', { cardId: cardId(chosen[0]) });
            ui.selected = [];
            return;
        }

        if (g.allowedActions.includes('next-round')) {
            socket.emit('next-round');
            return;
        }

        respond(notYourTurnText(g));
    }

    // Aloitetun maan isoin tai pienin kortti pöytään heti, kuten Bridgessä (I tai nuoli ylös, O tai nuoli alas).
    function playLedSuitExtreme(highest) {
        const g = game();
        if (!g || g.hand === null) return;
        if (!g.allowedActions.includes('play')) {
            respond(notYourTurnText(g));
            return;
        }
        if (g.trick.length === 0) {
            respond('No suit has been led yet. You must lead a card.');
            return;
        }
        const suit = g.trick[0].card.suit;
        const cards = myHand().filter(c => c.suit === suit)
            .sort((a, b) => rankValue(a.rank) - rankValue(b.rank));
        if (cards.length === 0) {
            respond(`You have no ${suit}. Type a card to play, for example S and 4.`);
            return;
        }
        const card = highest ? cards[cards.length - 1] : cards[0];
        ui.selected = [];
        ui.pendingSuit = null;
        socket.emit('play', { cardId: cardId(card) });
    }

    // ===== Lukukomennot =====

    function requireGame() {
        const g = game();
        if (!g) respond('No game is running.');
        return g;
    }

    function requireHand() {
        const g = game();
        if (!g || g.hand === null) {
            respond('You do not have a hand.');
            return null;
        }
        return g;
    }

    function readSuit(suit) {
        const g = requireHand();
        if (!g) return;
        // Luetaan ylhäältä alas, isoin ensin, kuten Bridgessä.
        const cards = myHand().filter(c => c.suit === suit).reverse();
        if (cards.length === 0) {
            respond(`No ${suit}.`);
            return;
        }
        const ranks = cards.map(c => {
            const tags = [];
            if (ui.selected.includes(cardId(c))) tags.push('selected');
            const note = handNote(g, c);
            if (note) tags.push(note);
            return rankWord(c.rank) + (tags.length ? ` (${tags.join(', ')})` : '');
        }).join(', ');
        respond(`${cards.length} ${cards.length === 1 ? suit.slice(0, -1) : suit}: ${ranks}.`);
    }

    function readHand() {
        if (!requireHand()) return;
        const cards = myHand();
        if (cards.length === 0) {
            respond('Your hand is empty.');
            return;
        }
        const parts = SUITS
            .map(suit => {
                const ofSuit = cards.filter(c => c.suit === suit).reverse();   // isoin ensin
                if (ofSuit.length === 0) return null;
                return `${capitalize(suit)}: ${ofSuit.map(c => rankWord(c.rank)).join(', ')}`;
            })
            .filter(Boolean);
        respond(`${cardsText(cards.length)}. ${parts.join('. ')}.`);
    }

    function trickEntriesText(entries) {
        return entries.map(t => `${t.playerId === myId() ? 'you' : nameOf(t.playerId)}: ${cardName(t.card)}`).join(', ');
    }

    function readTrick() {
        const g = requireGame();
        if (!g) return;
        if (g.phase !== 'play') {
            respond(g.phase === 'pass' ? 'Cards are being passed.' : 'No trick in progress.');
            return;
        }
        const next = g.currentId === myId() ? 'you' : nameOf(g.currentId);
        if (g.trick.length === 0) {
            // Tikki tyhjenee heti neljännen kortin jälkeen, joten kerrotaan myös edellinen.
            const last = g.lastTrick;
            const lastText = last
                ? ` Last trick: ${trickEntriesText(last.cards)}, won by ${last.winnerId === myId() ? 'you' : nameOf(last.winnerId)}.`
                : '';
            respond(`Trick ${g.tricksPlayed + 1}: no cards yet. To lead: ${next}.${lastText}`);
            return;
        }
        respond(`Trick ${g.tricksPlayed + 1}: ${trickEntriesText(g.trick)}. To play: ${next}.`);
    }

    function readLastTrick() {
        const g = requireGame();
        if (!g) return;
        const last = g.lastTrick;
        if (!last) {
            respond('No tricks played yet this round.');
            return;
        }
        const winner = last.winnerId === myId() ? 'you' : nameOf(last.winnerId);
        respond(`Last trick: ${trickEntriesText(last.cards)}. Won by ${winner}, ${pointsText(last.points)}.`);
    }

    // Kierroksella jo pelatut kortit maittain, ylhäältä alas (isoin ensin).
    function readPlayedSuit(suit) {
        const g = requireGame();
        if (!g) return;
        const cards = g.played.filter(c => c.suit === suit).sort((a, b) => rankValue(b.rank) - rankValue(a.rank));
        if (cards.length === 0) {
            respond(`No ${suit} played yet this round.`);
            return;
        }
        respond(`${capitalize(suit)} played: ${cards.map(c => rankWord(c.rank)).join(', ')}.`);
    }

    // Kunkin pelaajan pisteet: kokonaispisteet ja kuluvan kierroksen pisteet
    // (Bridgen Alt+P, mutta pelaajakohtaisesti eikä pareittain).
    function readScores() {
        const g = requireGame();
        if (!g) return;
        const parts = g.players
            .map(p => `${p.id === myId() ? 'You' : p.name} ${pointsText(p.score)}, ${p.roundPoints} this round`);
        respond(`${parts.join('. ')}.`);
    }

    function readTurn() {
        const g = requireGame();
        if (!g) return;
        if (g.phase === 'over') {
            respond('The game is over.');
        } else if (g.phase === 'round-over') {
            respond('The round is over. Any player can start the next round.');
        } else if (g.phase === 'pass') {
            const waiting = g.players.filter(p => !p.passed).map(p => (p.id === myId() ? 'you' : p.name));
            respond(`Passing cards. Waiting for ${listNames(waiting)}.`);
        } else if (g.currentId === myId()) {
            respond(g.trick.length === 0 ? 'Your turn to lead.' : `Your turn. ${capitalize(g.trick[0].card.suit)} led.`);
        } else {
            respond(`To play: ${nameOf(g.currentId)}.`);
        }
    }

    function readPassInfo() {
        const g = requireGame();
        if (!g) return;
        if (g.passDirection === 'none') {
            respond('No passing this round.');
            return;
        }
        if (!g.passTargetId) {
            respond(`This round cards are passed ${DIRECTION_TEXT[g.passDirection]}.`);
            return;
        }
        const parts = [`This round you pass ${DIRECTION_TEXT[g.passDirection]} to ${nameOf(g.passTargetId)} and receive from ${nameOf(g.passSourceId)}.`];
        if (g.passSelection) parts.push(`You passed ${listCards(g.passSelection)}.`);
        else if (ui.selected.length) parts.push(`Selected so far: ${listCards(selectedCards())}.`);
        if (g.received) parts.push(`You received ${listCards(g.received)}.`);
        respond(parts.join(' '));
    }

    function readSummary() {
        const g = requireGame();
        if (!g) return;
        const parts = [`Table ${spellCode(ui.state.table.code)}. Round ${g.round}.`];
        if (g.phase === 'play') parts.push(`Trick ${g.tricksPlayed + 1} of 13.`);
        parts.push(g.heartsBroken ? 'Hearts are broken.' : 'Hearts are not broken.');
        parts.push(`Dealer: ${g.dealerId === myId() ? 'you' : nameOf(g.dealerId)}.`);
        const queen = g.played.some(c => c.suit === 'spades' && c.rank === 'Q');
        const ten = g.played.some(c => c.suit === 'diamonds' && c.rank === '10');
        parts.push(`Queen of spades ${queen ? 'played' : 'not played yet'}. 10 of diamonds ${ten ? 'played' : 'not played yet'}.`);
        respond(parts.join(' '));
    }

    // ===== Näppäimistö =====

    function isTyping() {
        const el = document.activeElement;
        if (!el) return false;
        if (el.isContentEditable || el.tagName === 'TEXTAREA') return true;
        return el.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'submit'].includes(el.type);
    }

    function handleAltKey(e) {
        const actions = {
            KeyG: readHand,
            KeyP: readScores,           // kuten Bridgessä; pöydän kortit lukee pelkkä P
            KeyO: readLastTrick,
            KeyX: readScores,
            KeyV: readTurn,
            KeyC: readPassInfo,
            KeyY: readSummary,
            KeyI: repeatLastAnnouncement
        };
        if (ALT_HAND_CODES[e.code]) {
            e.preventDefault();
            readSuit(ALT_HAND_CODES[e.code]);
            return;
        }
        if (ALT_PLAYED_CODES[e.code]) {
            e.preventDefault();
            readPlayedSuit(ALT_PLAYED_CODES[e.code]);
            return;
        }
        const action = actions[e.code];
        if (action) {
            e.preventDefault();
            action();
        }
    }

    function handlePlainKey(e) {
        const g = game();
        const key = e.key.toLowerCase();
        // P lukee pöydän kortit kuten Bridgessä (myös katsojalle).
        if (g && key === 'p') {
            e.preventDefault();
            ui.pendingSuit = null;
            readTrick();
            return;
        }
        if (!g || g.hand === null) return;

        if (key === 'escape') {
            e.preventDefault();
            clearSelection();
            return;
        }
        if (key === 'l') {
            e.preventDefault();
            ui.pendingSuit = null;
            performAction();
            return;
        }
        // Valikossa (robottien nopeus) nuolet jäävät valikolle.
        const inSelect = document.activeElement && document.activeElement.tagName === 'SELECT';
        if (key === 'i' || (key === 'arrowup' && !inSelect)) {
            e.preventDefault();
            playLedSuitExtreme(true);
            return;
        }
        if (key === 'o' || (key === 'arrowdown' && !inSelect)) {
            e.preventDefault();
            playLedSuitExtreme(false);
            return;
        }
        if (SUIT_KEYS[key]) {
            e.preventDefault();
            ui.pendingSuit = SUIT_KEYS[key];
            respond(`${capitalize(ui.pendingSuit)}, enter rank.`);
            return;
        }
        if (ui.pendingSuit && RANK_KEYS[key]) {
            e.preventDefault();
            const suit = ui.pendingSuit;
            ui.pendingSuit = null;
            toggleCard(suit, RANK_KEYS[key], { playNow: true });
        }
    }

    document.addEventListener('keydown', (e) => {
        if ($('confirm-dialog').open) return;
        if (isTyping()) return;
        if (e.ctrlKey || e.metaKey) return;   // myös AltGr (Ctrl+Alt) ohitetaan
        if (e.altKey) {
            if (!e.shiftKey) handleAltKey(e);
            return;
        }
        if (e.shiftKey) return;
        handlePlainKey(e);
    });

    // ===== Vahvistusikkuna =====

    function confirmDialog(text) {
        const dialog = $('confirm-dialog');
        const previousFocus = document.activeElement;
        $('confirm-text').textContent = text;
        return new Promise(resolve => {
            function finish(result) {
                dialog.removeEventListener('close', onClose);
                $('confirm-yes').onclick = null;
                $('confirm-no').onclick = null;
                if (dialog.open) dialog.close();
                if (previousFocus && previousFocus.focus) previousFocus.focus();
                resolve(result);
            }
            function onClose() {
                finish(false);
            }
            $('confirm-yes').onclick = () => finish(true);
            $('confirm-no').onclick = () => finish(false);
            dialog.addEventListener('close', onClose);
            dialog.showModal();
            $('confirm-yes').focus();
        });
    }

    // ===== Yhteys palvelimeen =====

    const socket = io('/hertta');

    function showStartError(text) {
        $('start-error').textContent = text;
        respond(text);
    }

    socket.on('connect', () => {
        const saved = session.get();
        if (saved && saved.code && saved.token) {
            socket.emit('join-table', { code: saved.code, token: saved.token, name: saved.name });
        }
    });

    socket.on('disconnect', () => {
        announce('Lost connection to the server. Trying to reconnect.');
    });

    socket.on('joined', (data) => {
        ui.myName = data.name;
        storage.set('hertta-name', data.name);
        session.set({ code: data.code, token: data.token, name: data.name });
        $('start-error').textContent = '';
        try {
            history.replaceState(null, '', `?table=${data.code}`);
        } catch (e) { /* ei haittaa */ }
    });

    socket.on('join-error', (data) => {
        const saved = session.get();
        if (saved && data.missing && saved.code === data.code) session.clear();
        ui.state = null;
        render();
        showStartError(data.text);
    });

    socket.on('left-table', () => {
        session.clear();
        ui.state = null;
        ui.previousTurnKey = null;
        ui.selected = [];
        render();
        try {
            history.replaceState(null, '', location.pathname);
        } catch (e) { /* ei haittaa */ }
        respond('You left the table.');
    });

    socket.on('replaced', () => {
        announce('The game was opened in another window. This window is no longer connected to the game.');
        socket.disconnect();
    });

    // Varoitus ennen sivun päivittämistä tai sulkemista pöydässä ollessa.
    // Selain näyttää oman tekstinsä; omaa viestiä ei voi asettaa.
    window.addEventListener('beforeunload', (e) => {
        if (ui.state && socket.connected) {
            e.preventDefault();
            e.returnValue = '';
        }
    });

    socket.on('state', (state) => {
        ui.state = state;
        render();
        flushOwnMove(turnChangeText());
    });

    socket.on('game-event', handleEvent);

    socket.on('action-error', (data) => {
        respond(data.text);
    });

    // ===== Painikkeet ja asetukset =====

    $('create-form').addEventListener('submit', (e) => {
        e.preventDefault();
        unlockAudio();
        const name = $('create-name').value.trim();
        if (!name) {
            showStartError('Enter your name.');
            $('create-name').focus();
            return;
        }
        socket.emit('create-table', { name });
    });

    $('join-form').addEventListener('submit', (e) => {
        e.preventDefault();
        unlockAudio();
        const code = $('join-code').value.trim();
        const name = $('join-name').value.trim();
        if (!/^\d{4}$/.test(code)) {
            showStartError('The table code has four digits.');
            $('join-code').focus();
            return;
        }
        if (!name) {
            showStartError('Enter your name.');
            $('join-name').focus();
            return;
        }
        socket.emit('join-table', { code, name });
    });

    $('copy-link-button').addEventListener('click', async () => {
        const link = `${location.origin}${location.pathname}?table=${ui.state.table.code}`;
        try {
            await navigator.clipboard.writeText(link);
            respond(`Link copied: ${link}`);
        } catch (e) {
            respond(`Copying failed. The link is ${link}`);
        }
    });

    $('add-robot-button').addEventListener('click', () => socket.emit('add-robot'));
    $('robot-speed').addEventListener('change', (e) => socket.emit('set-robot-speed', { speed: e.target.value }));
    $('start-button').addEventListener('click', () => socket.emit('start-game'));
    $('next-round-button').addEventListener('click', () => socket.emit('next-round'));
    $('new-game-button').addEventListener('click', () => socket.emit('start-game'));
    $('to-lobby-button').addEventListener('click', () => socket.emit('to-lobby'));
    $('leave-button').addEventListener('click', async () => {
        if (await confirmDialog('Leave the table?')) socket.emit('leave-table');
    });
    $('action-button').addEventListener('click', performAction);
    $('clear-button').addEventListener('click', clearSelection);
    $('abort-button').addEventListener('click', async () => {
        if (await confirmDialog('Abort the game for all players?')) socket.emit('abort-game');
    });

    $('sound-toggle').checked = ui.soundOn;
    $('sound-toggle').addEventListener('change', (e) => {
        ui.soundOn = e.target.checked;
        storage.set('hertta-sound', ui.soundOn ? 'on' : 'off');
        if (ui.soundOn) unlockAudio();
    });
    $('speech-toggle').checked = ui.speechOn;
    $('speech-toggle').addEventListener('change', (e) => {
        ui.speechOn = e.target.checked;
        storage.set('hertta-speech', ui.speechOn ? 'on' : 'off');
        if (!ui.speechOn && 'speechSynthesis' in window) window.speechSynthesis.cancel();
    });

    // Selaimet sallivat äänet vasta käyttäjän toiminnon jälkeen.
    document.addEventListener('pointerdown', unlockAudio, { once: true });
    document.addEventListener('keydown', unlockAudio, { once: true });

    // Nimi muistetaan, ja jaetun linkin pöytäkoodi täytetään valmiiksi.
    $('create-name').value = ui.myName;
    $('join-name').value = ui.myName;
    const linkCode = new URLSearchParams(location.search).get('table');
    if (linkCode) $('join-code').value = linkCode;
    render();
})();
