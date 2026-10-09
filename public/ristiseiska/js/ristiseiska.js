// Ristiseiska – selainohjelma. Palvelin tarkistaa kaikki siirrot. Tämä tiedosto
// piirtää pelitilanteen, hoitaa näppäinkomennot ja ruudunlukijailmoitukset.
// Runko (ilmoitusjono, odotushuone, äänet) on sama kuin Musta Maijassa.
// Peli ei kerro, mitkä omat kortit ovat lyötävissä: pelaaja päättelee sen itse.
// Toimintopainike kuitenkin tarjoaa pyyntöä vain, kun mikään kortti ei sovi.
(function () {
    'use strict';

    const {
        SUITS, SUIT_SYMBOLS, SUIT_NAMES, SUIT_PARTITIVES, SUIT_NONE,
        cardId, cardName, rankName, plural, capitalize
    } = window.Kortit;

    // Samat näppäimet kuin Accessible Bridgessä ja Maijassa.
    const SUIT_KEYS = { s: 'spades', h: 'hearts', d: 'diamonds', c: 'clubs' };
    const RANK_KEYS = {
        a: 'A', k: 'K', q: 'Q', j: 'J', t: '10', '1': '10',
        '2': '2', '3': '3', '4': '4', '5': '5', '6': '6', '7': '7', '8': '8', '9': '9'
    };
    // Oma käsi: Alt+A S D F. Pöytä: suoraan yläpuolella Alt+Q W E R.
    const ALT_HAND_CODES = { KeyA: 'spades', KeyS: 'hearts', KeyD: 'diamonds', KeyF: 'clubs' };
    const ALT_TABLE_CODES = { KeyQ: 'spades', KeyW: 'hearts', KeyE: 'diamonds', KeyR: 'clubs' };
    const ORDER = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
    const SEVEN = 6;
    const RANK_GENITIVES = { A: 'ässän', K: 'kuninkaan', Q: 'rouvan', J: 'jätkän' };
    const MAX_LOG_ITEMS = 100;

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
                return JSON.parse(storage.get('ristiseiska-session', 'null'));
            } catch (e) {
                return null;
            }
        },
        set(value) {
            storage.set('ristiseiska-session', JSON.stringify(value));
        },
        clear() {
            storage.remove('ristiseiska-session');
        }
    };

    const ROBOT_SPEED_NAMES = { slow: 'hidas', normal: 'normaali', fast: 'nopea' };

    const ui = {
        state: null,
        myName: storage.get('ristiseiska-name', storage.get('maija-name', '')),
        selected: null,             // valitun kortin id, enintään yksi
        pendingSuit: null,
        pendingEnd: false,          // lisävuoron lopetus vaatii toisen L-painalluksen
        lastAnnouncement: '',
        previousTurnKey: null,
        soundOn: storage.get('ristiseiska-sound', 'on') === 'on',
        speechOn: storage.get('ristiseiska-speech', 'off') === 'on'
    };

    // ===== Ilmoitukset (Accessible Bridgen announcementQueue) =====

    // Arvioitu lukuaika merkkiä kohden. Sama arvo on palvelimella robottien viiveessä
    // (ristiseiska/socket.js, estimateReadingMs).
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
        respond(ui.lastAnnouncement || 'Ei aiempia ilmoituksia.');
    }

    function speak(message) {
        if (!ui.speechOn || !('speechSynthesis' in window)) return;
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(message);
        utterance.lang = 'fi-FI';
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

    function isRobot(id) {
        const member = ui.state ? ui.state.members.find(m => m.id === id) : null;
        return !!member && member.type === 'robot';
    }

    function myHand() {
        const g = game();
        return g && g.hand ? g.hand : [];
    }

    function selectedCard() {
        return myHand().find(card => cardId(card) === ui.selected) || null;
    }

    function korttia(count) {
        return plural(count, 'kortti', 'korttia');
    }

    // "Löit pata ässän", "Löit hertta 10".
    function cardObject(card) {
        return `${SUIT_NAMES[card.suit]} ${RANK_GENITIVES[card.rank] || card.rank}`;
    }

    // Pelissä olevat muut pelaajat vastapäivään (edellinen ensin) tai myötäpäivään.
    function othersInOrder(id, direction) {
        const players = game().players;
        const n = players.length;
        const start = players.findIndex(p => p.id === id);
        const result = [];
        for (let step = 1; step < n; step++) {
            const candidate = players[(((start + direction * step) % n) + n) % n];
            if (!candidate.out) result.push(candidate);
        }
        return result;
    }

    // Keneltä pelaaja pyytää: edellinen, jolla on vähintään kaksi korttia (sama sääntö kuin palvelimella).
    function askTarget(id) {
        return othersInOrder(id, -1).find(p => p.cardCount >= 2) || null;
    }

    // ===== Pöydän tekstit =====

    // "Pata 3, 9." Vain kortit, jotka maahan voi seuraavaksi lyödä.
    function suitTableText(suit) {
        const next = game().nextCards[suit];
        if (next.length === 0) return `${capitalize(SUIT_NAMES[suit])} valmis.`;
        return `${capitalize(SUIT_NAMES[suit])} ${next.map(rankName).join(', ')}.`;
    }

    // ===== Tapahtumien tekstit =====

    // Ruudunlukija lukee koodin numero kerrallaan: "4 7 1 2".
    function spellCode(code) {
        return String(code).split('').join(' ');
    }

    function askText(e) {
        const skipped = e.skipped.length > 0
            ? ` ${e.skipped.join(' ja ')} ${e.skipped.length === 1 ? 'ohitettiin, koska hänellä on' : 'ohitettiin, koska heillä on'} vain yksi kortti.`
            : '';
        if (!e.giverId) {
            return isMe(e.askerId, e.askerName)
                ? `Et voi lyödä, eikä kenelläkään ole annettavaa.${skipped} Vuoro siirtyy.`
                : `${e.askerName} ei voi lyödä, eikä kenelläkään ole annettavaa.${skipped}`;
        }
        if (isMe(e.askerId, e.askerName)) return `Pyysit kortin pelaajalta ${e.giverName}.${skipped}`;
        if (isMe(e.giverId, e.giverName)) return `${e.askerName} pyytää sinulta kortin.${skipped}`;
        return `${e.askerName} ei voi lyödä ja pyytää kortin pelaajalta ${e.giverName}.${skipped}`;
    }

    function giveText(e) {
        if (isMe(e.giverId, e.giverName)) return `Annoit pelaajalle ${e.receiverName} kortin ${cardName(e.card)}.`;
        if (isMe(e.receiverId, e.receiverName)) return `Sait pelaajalta ${e.giverName} kortin ${cardName(e.card)}.`;
        return `${e.giverName} antoi kortin pelaajalle ${e.receiverName}.`;
    }

    function eventText(e) {
        switch (e.type) {
            case 'table-created':
                return `Loit pöydän. Pöytäkoodi on ${spellCode(e.code)}. Anna koodi muille tai lisää robotteja.`;
            case 'joined':
                if (isMe(e.playerId, e.name)) {
                    return e.spectator
                        ? 'Liityit katsojaksi. Pöytä on täynnä tai peli on käynnissä. Pääset mukaan, kun paikka vapautuu.'
                        : 'Liityit pöytään.';
                }
                return e.spectator ? `${e.name} liittyi katsojaksi.` : `${e.name} liittyi.`;
            case 'reconnected':
                return isMe(e.playerId, e.name) ? 'Yhteys palautui.' : `${e.name} palasi.`;
            case 'left':
                return e.waiting
                    ? `Pelaajan ${e.name} yhteys katkesi. Peli odottaa hänen paluutaan.`
                    : `${e.name} poistui.`;
            case 'robot-added':
                return `${isMe(null, e.byName) ? 'Lisäsit' : `${e.byName} lisäsi`} pöytään robotin ${e.name}. Pelaajia ${e.seated}/${e.max}.`;
            case 'robot-removed':
                return `${isMe(null, e.byName) ? 'Poistit' : `${e.byName} poisti`} robotin ${e.name}. Pelaajia ${e.seated}/${e.max}.`;
            case 'speed-changed':
                return `Robottien nopeus: ${ROBOT_SPEED_NAMES[e.speed]}.`;
            case 'creator-changed':
                return isMe(e.playerId, e.name)
                    ? 'Olet nyt pöydän luoja. Voit lisätä robotteja ja aloittaa pelin.'
                    : `Pöydän luoja on nyt ${e.name}.`;
            case 'to-lobby':
                return 'Palattiin odotushuoneeseen.';
            case 'table-closed':
                return 'Pöytä suljettiin, koska sitä ei käytetty.';
            case 'start': {
                const dealer = isMe(e.dealerId, e.dealerName) ? 'sinä' : e.dealerName;
                let text = `Peli alkoi. Pelaajat: ${e.playerNames.join(', ')}. Jakaja: ${dealer}.`;
                text += isMe(e.sevenHolderId, e.sevenHolderName)
                    ? ' Sinulla oli ristiseiska, ja se on pelattu pöytään.'
                    : ` Ristiseiska oli pelaajalla ${e.sevenHolderName}, ja se on pelattu pöytään.`;
                if (!isMe(e.starterId, e.starterName)) text += ` Vuorossa ${e.starterName}.`;
                return text;
            }
            case 'aborted':
                return `${e.name} keskeytti pelin.`;
            case 'play':
                if (isMe(e.playerId, e.name)) return `Löit ${cardObject(e.card)}.${e.bonus ? ' Voit jatkaa.' : ''}`;
                return `${e.name} löi ${cardObject(e.card)}.`;
            case 'end-turn':
                return isMe(e.playerId, e.name) ? 'Lopetit vuoron.' : `${e.name} lopetti vuoronsa.`;
            case 'ask':
                return askText(e);
            case 'give':
                return giveText(e);
            case 'out':
                return isMe(e.playerId, e.name)
                    ? `Pääsit pois pelistä sijalle ${e.place}!`
                    : `${e.name} pääsi pois pelistä sijalle ${e.place}.`;
            case 'over': {
                const ranking = e.ranking.map(r => `${r.place}. ${r.name}`).join(', ');
                const who = isMe(e.loserId, e.loserName) ? 'Jäit viimeiseksi.' : `Häviäjä: ${e.loserName}.`;
                return `Peli päättyi. ${who} Sijoitukset: ${ranking}.`;
            }
            default:
                return '';
        }
    }

    function isOwnMove(e) {
        return (e.type === 'play' && isMe(e.playerId, e.name))
            || (e.type === 'end-turn' && isMe(e.playerId, e.name))
            || (e.type === 'ask' && isMe(e.askerId, e.askerName))
            || (e.type === 'give' && isMe(e.giverId, e.giverName));
    }

    // Oman siirron tulos ja sen välittömät seuraukset luetaan yhtenä ryhmänä heti
    // jonon kärjestä. Palvelin lähettää tapahtumat ja heti perään uuden tilan.
    const OWN_MOVE_FOLLOWUPS = ['out', 'over'];

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
            } else if (ui.ownMove && OWN_MOVE_FOLLOWUPS.includes(e.type)) {
                ui.ownMove.push(text);
            } else {
                announce(text);
            }
        }
        if (e.type === 'start') {
            ui.selected = null;
            ui.previousTurnKey = null;
            playSound('deal');
        } else if (e.type === 'play') {
            playSound('play');
        } else if (e.type === 'give' && isMe(e.receiverId, e.receiverName)) {
            playSound('receive');
        } else if (e.type === 'table-closed') {
            session.clear();
            ui.state = null;
            render();
        }
    }

    // Kun oma vuoro alkaa, kerrotaan vain se. Mitä voi lyödä, pelaaja päättelee itse.
    function turnChangeText() {
        const g = game();
        if (!g || g.phase === 'over') {
            ui.previousTurnKey = g ? 'over' : null;
            return null;
        }
        const key = `${g.phase}:${g.currentId}:${g.giverId}`;
        if (key === ui.previousTurnKey) return null;
        ui.previousTurnKey = key;
        ui.pendingEnd = false;

        if (g.phase === 'play' && g.currentId === myId()) {
            playTurnCue();
            return 'Sinun vuorosi.';
        }
        if (g.phase === 'give' && g.giverId === myId()) {
            playTurnCue();
            return 'Valitse annettava kortti ja paina L.';
        }
        return null;
    }

    // ===== Piirto =====

    function createCardElement(card, { selectable = false } = {}) {
        const id = cardId(card);
        const element = document.createElement('div');
        element.className = `card-display suit-${card.suit}`;
        element.dataset.card = id;
        const selected = selectable && ui.selected === id;
        if (selected) element.classList.add('is-selected');

        const suit = document.createElement('span');
        suit.className = 'card-suit';
        suit.setAttribute('aria-hidden', 'true');
        suit.textContent = SUIT_SYMBOLS[card.suit];
        const rank = document.createElement('span');
        rank.className = 'card-rank';
        rank.setAttribute('aria-hidden', 'true');
        rank.textContent = card.rank;

        // Div ei saa fokusta (kuten Bridgessä), joten nimi kerrotaan piilotekstinä selaustilaa varten.
        const label = document.createElement('span');
        label.className = 'sr-only';
        label.textContent = selected ? `${cardName(card)}, valittu` : cardName(card);

        element.append(suit, rank, label);
        if (selectable) {
            element.addEventListener('click', () => toggleCard(card.suit, card.rank));
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
            document.title = 'Ristiseiska';
            return;
        }
        if (state.game) {
            showView('game');
            renderGame();
        } else {
            showView('lobby');
            renderLobby();
            document.title = `Ristiseiska – pöytä ${state.table.code}`;
        }
    }

    function memberLabel(member, state) {
        const tags = [];
        if (member.id === state.you.id) tags.push('sinä');
        if (member.isCreator) tags.push('pöydän luoja');
        if (member.type === 'robot') tags.push('robotti');
        if (member.spectator) tags.push('katsoja');
        if (!member.connected) tags.push('yhteys katkennut');
        return tags.length ? `${member.name} – ${tags.join(', ')}` : member.name;
    }

    function renderLobby() {
        const state = ui.state;
        const t = state.table;
        $('lobby-heading').textContent = `Pöytä ${t.code} – ${t.seatedCount}/${t.maxPlayers} pelaajaa`;
        $('lobby-code').textContent = t.code;

        // Jos fokus on robotin Poista-painikkeessa, se palautetaan saman robotin painikkeeseen.
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
                remove.textContent = 'Poista';
                remove.setAttribute('aria-label', `Poista ${member.name}`);
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
        $('add-robot-button').textContent = full ? `Lisää robotti (pöytä täynnä, ${t.maxPlayers}/${t.maxPlayers})` : 'Lisää robotti';
        $('start-button').setAttribute('aria-disabled', t.seatedCount < t.minPlayers ? 'true' : 'false');
        $('robot-speed').value = t.robotSpeed;

        const me = state.members.find(m => m.id === state.you.id);
        if (isCreator) {
            $('lobby-info').textContent = t.seatedCount < t.minPlayers
                ? `Olet pöydän luoja. Peliin tarvitaan ${t.minPlayers}–${t.maxPlayers} pelaajaa: anna pöytäkoodi muille tai lisää robotti.`
                : 'Olet pöydän luoja. Voit lisätä robotteja tai aloittaa pelin.';
        } else {
            let text = `Odotetaan, että pöydän luoja ${t.creatorName || ''} aloittaa pelin.`;
            if (me && me.spectator) text += ' Pöytä on täynnä, joten olet katsoja.';
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

    function renderGame() {
        const g = game();
        const state = ui.state;
        const isPlayer = g.hand !== null;

        if (ui.selected && !selectedCard()) ui.selected = null;

        const myTurn = g.allowedActions.length > 0;
        const current = nameOf(g.currentId);

        const bar = $('turn-bar');
        bar.classList.toggle('is-yours', myTurn);
        if (g.phase === 'over') {
            bar.textContent = 'Peli päättyi.';
        } else if (g.phase === 'give') {
            const asker = nameOf(g.askerId);
            bar.textContent = g.giverId === myId()
                ? `▶ Anna kortti pelaajalle ${asker}`
                : `Vuorossa: ${nameOf(g.giverId)} antaa kortin pelaajalle ${asker}${isRobot(g.giverId) ? ' – miettii…' : ''}`;
        } else if (g.currentId === myId()) {
            bar.textContent = g.bonus ? '▶ Sinun vuorosi: voit jatkaa' : '▶ Sinun vuorosi';
        } else {
            bar.textContent = `Vuorossa: ${current}${isRobot(g.currentId) ? ' – miettii…' : ''}`;
        }
        document.title = myTurn ? '▶ Sinun vuorosi – Ristiseiska' : 'Ristiseiska';

        renderPlayers(g, state);
        renderTable(g);
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
                || (g.phase === 'give' && player.id === g.giverId);

            if (acting) {
                item.classList.add('is-current');
                const badge = document.createElement('span');
                badge.className = 'turn-badge';
                badge.textContent = g.phase === 'give' ? '▶ VUOROSSA – antaa kortin' : '▶ VUOROSSA';
                item.appendChild(badge);
            }
            if (player.out) item.classList.add('is-out');

            const name = document.createElement('span');
            name.className = 'player-name';
            name.textContent = player.id === myId() ? `${player.name} (sinä)` : player.name;

            const meta = document.createElement('span');
            meta.className = 'player-meta';
            const details = [];
            if (member && member.type === 'robot') details.push('robotti');
            if (player.id === g.dealerId) details.push('jakaja');
            if (player.out) {
                details.push(player.id === g.loserId ? 'hävisi' : `pois, sija ${player.place}`);
            } else {
                details.push(korttia(player.cardCount));
                if (g.phase === 'give' && player.id === g.askerId) details.push('pyysi korttia');
            }
            if (member && !member.connected) details.push('yhteys katkennut');
            meta.textContent = details.join(' · ');

            item.append(name, meta);
            list.appendChild(item);
        }
    }

    function pileCard(rank, suit, classes) {
        const element = document.createElement('span');
        element.className = `pcard suit-${suit} ${classes}`.trim();
        if (rank) {
            const symbol = document.createElement('span');
            symbol.className = 'pcard-suit';
            symbol.textContent = SUIT_SYMBOLS[suit];
            element.append(symbol, document.createTextNode(rank));
        }
        return element;
    }

    function nextChip(rank) {
        const element = document.createElement('span');
        element.className = rank ? 'next-chip' : 'next-chip none';
        element.textContent = rank || '';
        return element;
    }

    // Neljä saraketta: seuraava iso, isojen pino, seiska, pienten pino, seuraava pieni.
    function renderTable(g) {
        const last = g.lastPlay;
        $('table-heading').textContent = last
            ? `Pöytä – viimeksi ${last.playerId === myId() ? 'sinä' : last.name}: ${cardName(last.card)}`
            : 'Pöytä';

        const text = $('table-text');
        text.replaceChildren();
        const piles = $('piles');
        piles.replaceChildren();

        for (const suit of SUITS) {
            const item = document.createElement('li');
            item.textContent = suitTableText(suit);
            text.appendChild(item);

            const pile = g.table[suit];
            const next = g.nextCards[suit];
            const nextHigh = next.find(r => ORDER.indexOf(r) > SEVEN) || null;
            const nextLow = next.find(r => ORDER.indexOf(r) < SEVEN) || null;
            const isLast = r => last && last.card.suit === suit && last.card.rank === r ? ' is-last' : '';

            const col = document.createElement('div');
            col.className = 'pile-col';
            const head = document.createElement('span');
            head.className = `suit-head suit-${suit}`;
            head.textContent = `${SUIT_SYMBOLS[suit]} ${capitalize(SUIT_NAMES[suit])}`;
            col.appendChild(head);
            col.appendChild(nextChip(nextHigh));

            if (!pile) {
                col.append(pileCard(null, suit, 'empty'), pileCard('7', suit, 'next-seven'), pileCard(null, suit, 'empty'));
            } else {
                const highIndex = ORDER.indexOf(pile.high);
                const lowIndex = ORDER.indexOf(pile.low);
                col.appendChild(highIndex > SEVEN ? pileCard(pile.high, suit, `played${isLast(pile.high)}`) : pileCard(null, suit, 'empty'));
                col.appendChild(pileCard('7', suit, `played seven${isLast('7')}`));
                col.appendChild(lowIndex < SEVEN ? pileCard(pile.low, suit, `played${isLast(pile.low)}`) : pileCard(null, suit, 'empty'));
            }
            col.appendChild(nextChip(nextLow));
            piles.appendChild(col);
        }
    }

    function renderHand(g, isPlayer, myTurn) {
        const area = $('hand-area');
        const hand = $('hand');
        area.classList.toggle('is-current', myTurn);
        hand.replaceChildren();

        if (!isPlayer) {
            $('hand-heading').textContent = 'Katsot peliä';
            const note = document.createElement('p');
            note.className = 'hand-empty';
            note.textContent = 'Pääset mukaan seuraavaan peliin.';
            hand.appendChild(note);
            return;
        }

        const cards = myHand();
        const chosen = selectedCard();
        $('hand-heading').textContent = chosen
            ? `Oma käsi – ${korttia(cards.length)}, valittu ${cardName(chosen)}`
            : `Oma käsi – ${korttia(cards.length)}`;
        if (cards.length === 0) {
            const note = document.createElement('p');
            note.className = 'hand-empty';
            note.textContent = 'Kätesi on tyhjä.';
            hand.appendChild(note);
            return;
        }
        for (const suit of SUITS) {
            const ofSuit = cards.filter(c => c.suit === suit);
            if (ofSuit.length === 0) continue;
            const row = document.createElement('div');
            row.className = 'suit-row';
            for (const card of ofSuit) row.appendChild(createCardElement(card, { selectable: true }));
            hand.appendChild(row);
        }
    }

    function renderResult(g, state) {
        const section = $('result');
        section.hidden = g.phase !== 'over';
        if (g.phase !== 'over') return;
        $('result-loser').textContent = g.loserId === myId()
            ? 'Jäit viimeiseksi.'
            : `Häviäjä: ${nameOf(g.loserId)}`;
        const list = $('result-ranking');
        list.replaceChildren();
        for (const id of g.finishOrder) {
            const item = document.createElement('li');
            const name = nameOf(id);
            item.textContent = id === myId() ? `${name} (sinä)` : name;
            list.appendChild(item);
        }
        $('result-creator-tools').hidden = !state.you.isCreator;
        $('result-wait').textContent = state.you.isCreator
            ? 'Uusi peli alkaa samoilla pelaajilla, ja jakovuoro siirtyy seuraavalle. Odotushuoneessa voit lisätä tai poistaa robotteja.'
            : `Odotetaan, että pöydän luoja ${state.table.creatorName || ''} aloittaa uuden pelin.`;
    }

    function updateActionButton() {
        const g = game();
        const button = $('action-button');
        const isPlayer = g && g.hand !== null;
        button.hidden = !isPlayer;
        $('clear-button').hidden = !isPlayer;
        if (!isPlayer) return;

        // aria-disabled eikä disabled: painike pysyy fokusoitavana, joten fokus ei
        // katoa, kun vuoro vaihtuu. Painaminen kertoo, kenen vuoro on.
        // Pyydä näkyy vain, kun mitään ei voi lyödä. Lyö-painike on käytettävissä
        // vasta, kun kortti on valittu.
        const chosen = selectedCard();
        const actions = g.allowedActions;
        if (actions.includes('ask')) {
            button.setAttribute('aria-disabled', 'false');
            const target = askTarget(myId());
            button.textContent = target ? `Pyydä kortti pelaajalta ${target.name} (L)` : 'Pyydä kortti (L)';
        } else if (actions.includes('play') && chosen) {
            button.setAttribute('aria-disabled', 'false');
            button.textContent = 'Lyö valittu (L)';
        } else if (actions.includes('end-turn')) {
            button.setAttribute('aria-disabled', 'false');
            button.textContent = 'Lopeta vuoro (L)';
        } else if (actions.includes('play')) {
            button.setAttribute('aria-disabled', 'true');
            button.textContent = 'Lyö valittu (L)';
        } else if (actions.includes('give')) {
            button.setAttribute('aria-disabled', 'false');
            button.textContent = 'Anna valittu kortti (L)';
        } else {
            button.setAttribute('aria-disabled', 'true');
            button.textContent = g.phase === 'over' ? 'Peli päättyi' : 'Odota vuoroasi';
        }
    }

    function refreshSelection() {
        const g = game();
        if (!g) return;
        renderHand(g, g.hand !== null, g.allowedActions.length > 0);
        updateActionButton();
    }

    // ===== Toiminnot =====

    // Valittuna on enintään yksi kortti. Saman kortin valinta uudelleen poistaa sen.
    function toggleCard(suit, rank) {
        const g = game();
        if (!g || g.hand === null) return;
        const card = myHand().find(c => c.suit === suit && c.rank === rank);
        const name = cardName({ suit, rank });
        if (!card) {
            respond(`Sinulla ei ole korttia ${name}.`);
            return;
        }
        const id = cardId(card);
        ui.pendingEnd = false;
        if (ui.selected === id) {
            ui.selected = null;
            refreshSelection();
            respond(`Poistettu ${name}.`);
            return;
        }
        ui.selected = id;
        refreshSelection();
        respond(`Valittu ${name}.`);
    }

    function clearSelection() {
        const chosen = selectedCard();
        ui.selected = null;
        ui.pendingSuit = null;
        ui.pendingEnd = false;
        refreshSelection();
        respond(chosen ? `Valinta poistettu: ${cardName(chosen)}.` : 'Ei valittua korttia.');
    }

    function notYourTurnText(g) {
        if (g.phase === 'over') return 'Peli on päättynyt.';
        if (g.phase === 'give') return `Ei ole sinun vuorosi. ${nameOf(g.giverId)} antaa kortin pelaajalle ${nameOf(g.askerId)}.`;
        return `Ei ole sinun vuorosi. Vuorossa: ${nameOf(g.currentId)}.`;
    }

    function performAction(fromButton) {
        const g = game();
        if (!g || g.hand === null) return;
        const chosen = selectedCard();

        if (g.allowedActions.includes('ask')) {
            ui.selected = null;
            socket.emit('ask');
            return;
        }

        if (g.allowedActions.includes('play') && chosen) {
            ui.pendingEnd = false;
            socket.emit('play', { cardId: cardId(chosen) });
            ui.selected = null;
            return;
        }

        if (g.allowedActions.includes('end-turn')) {
            if (fromButton || ui.pendingEnd) {
                ui.pendingEnd = false;
                socket.emit('end-turn');
                return;
            }
            ui.pendingEnd = true;
            respond('Paina L uudelleen lopettaaksesi vuoron.');
            return;
        }

        if (g.allowedActions.includes('play')) {
            respond('Valitse ensin lyötävä kortti, esimerkiksi H ja 8.');
            return;
        }

        if (g.allowedActions.includes('give')) {
            if (!chosen) {
                respond('Valitse annettava kortti, esimerkiksi S ja 2.');
                return;
            }
            socket.emit('give', { cardId: cardId(chosen) });
            ui.selected = null;
            return;
        }

        respond(notYourTurnText(g));
    }

    // ===== Lukukomennot =====

    function requireHand() {
        const g = game();
        if (!g || g.hand === null) {
            respond('Sinulla ei ole korttikättä.');
            return null;
        }
        return g;
    }

    function readSuit(suit) {
        if (!requireHand()) return;
        // Luetaan ylhäältä alas kuten Bridgessä: kuningas ensin, ässä (alin) viimeisenä.
        const cards = myHand().filter(c => c.suit === suit).reverse();
        if (cards.length === 0) {
            respond(`${SUIT_NONE[suit]}.`);
            return;
        }
        const count = cards.length === 1 ? `1 ${SUIT_NAMES[suit]}` : `${cards.length} ${SUIT_PARTITIVES[suit]}`;
        const ranks = cards.map(c => rankName(c.rank) + (ui.selected === cardId(c) ? ' (valittu)' : '')).join(', ');
        respond(`${count}: ${ranks}.`);
    }

    function readHand() {
        if (!requireHand()) return;
        const cards = myHand();
        if (cards.length === 0) {
            respond('Kätesi on tyhjä.');
            return;
        }
        const parts = SUITS
            .map(suit => {
                const ofSuit = cards.filter(c => c.suit === suit).reverse();   // ylhäältä alas
                if (ofSuit.length === 0) return null;
                return `${capitalize(SUIT_NAMES[suit])}: ${ofSuit.map(c => rankName(c.rank)).join(', ')}`;
            })
            .filter(Boolean);
        respond(`${korttia(cards.length)}. ${parts.join('. ')}.`);
    }

    function readTableSuit(suit) {
        if (!game()) {
            respond('Peli ei ole käynnissä.');
            return;
        }
        respond(suitTableText(suit));
    }

    function readTable() {
        if (!game()) {
            respond('Peli ei ole käynnissä.');
            return;
        }
        respond(SUITS.map(suitTableText).join(' '));
    }

    function readTurn() {
        const g = game();
        if (!g) {
            respond('Peli ei ole käynnissä.');
            return;
        }
        if (g.phase === 'over') {
            respond('Peli on päättynyt.');
            return;
        }
        if (g.phase === 'give') {
            respond(g.giverId === myId()
                ? `Sinun pitää antaa kortti pelaajalle ${nameOf(g.askerId)}.`
                : `${nameOf(g.giverId)} antaa kortin pelaajalle ${nameOf(g.askerId)}.`);
            return;
        }
        if (g.currentId === myId()) {
            respond(g.bonus ? 'Sinun vuorosi, voit jatkaa.' : 'Sinun vuorosi.');
            return;
        }
        respond(g.bonus ? `Vuorossa: ${nameOf(g.currentId)}, jatkaa.` : `Vuorossa: ${nameOf(g.currentId)}.`);
    }

    // Korttimäärät vuorojärjestyksessä itsestä alkaen.
    function readCounts() {
        const g = game();
        if (!g) {
            respond('Peli ei ole käynnissä.');
            return;
        }
        const me = playerById(myId());
        const others = (me ? othersInOrder(me.id, 1) : g.players.filter(p => !p.out))
            .map(p => `${p.name}: ${korttia(p.cardCount)}`);
        const own = me ? `Sinulla ${korttia(me.cardCount)}. ` : '';
        respond(others.length > 0 ? `${own}${others.join(', ')}.` : own.trim());
    }

    // Keneltä pyydät ja kuka pyytää sinulta.
    function readAskDirection() {
        const g = game();
        if (!g || !playerById(myId()) || g.phase === 'over') {
            respond('Peli ei ole käynnissä.');
            return;
        }
        const target = askTarget(myId());
        const asker = othersInOrder(myId(), 1)[0];
        const parts = [target ? `Pyydät tarvittaessa pelaajalta ${target.name}.` : 'Kenelläkään ei ole annettavaa.'];
        if (asker) parts.push(`Sinulta pyytää ${asker.name}.`);
        respond(parts.join(' '));
    }

    function readSummary() {
        const g = game();
        if (!g) {
            respond('Peli ei ole käynnissä.');
            return;
        }
        const parts = [`Pöytä ${spellCode(ui.state.table.code)}.`];
        parts.push(`Jakaja: ${g.dealerId === myId() ? 'sinä' : nameOf(g.dealerId)}.`);
        const active = g.players.filter(p => !p.out)
            .map(p => `${p.id === myId() ? 'sinä' : p.name} ${korttia(p.cardCount)}`);
        if (active.length > 0) parts.push(`Pelissä: ${active.join(', ')}.`);
        const out = g.players.filter(p => p.out && p.id !== g.loserId)
            .sort((a, b) => a.place - b.place)
            .map(p => `${p.name} sija ${p.place}`);
        if (out.length > 0) parts.push(`Pois: ${out.join(', ')}.`);
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
            KeyP: readTable,
            KeyX: readCounts,
            KeyV: readTurn,
            KeyC: readAskDirection,
            KeyY: readSummary,
            KeyI: repeatLastAnnouncement
        };
        if (ALT_HAND_CODES[e.code]) {
            e.preventDefault();
            readSuit(ALT_HAND_CODES[e.code]);
            return;
        }
        if (ALT_TABLE_CODES[e.code]) {
            e.preventDefault();
            readTableSuit(ALT_TABLE_CODES[e.code]);
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
        if (!g || g.hand === null) return;
        const key = e.key.toLowerCase();

        if (key === 'escape') {
            e.preventDefault();
            clearSelection();
            return;
        }
        if (key === 'l') {
            e.preventDefault();
            ui.pendingSuit = null;
            performAction(false);
            return;
        }
        if (SUIT_KEYS[key]) {
            e.preventDefault();
            ui.pendingEnd = false;
            ui.pendingSuit = SUIT_KEYS[key];
            respond(`${capitalize(SUIT_NAMES[ui.pendingSuit])}, anna arvo.`);
            return;
        }
        if (ui.pendingSuit && RANK_KEYS[key]) {
            e.preventDefault();
            const suit = ui.pendingSuit;
            ui.pendingSuit = null;
            toggleCard(suit, RANK_KEYS[key]);
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

    const socket = io('/ristiseiska');

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
        announce('Yhteys palvelimeen katkesi. Yritetään uudelleen.');
    });

    socket.on('joined', (data) => {
        ui.myName = data.name;
        storage.set('ristiseiska-name', data.name);
        session.set({ code: data.code, token: data.token, name: data.name });
        $('start-error').textContent = '';
        try {
            history.replaceState(null, '', `?poyta=${data.code}`);
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
        ui.selected = null;
        render();
        try {
            history.replaceState(null, '', location.pathname);
        } catch (e) { /* ei haittaa */ }
        respond('Poistuit pöydästä.');
    });

    socket.on('replaced', () => {
        announce('Peli avattiin toisessa ikkunassa. Tämä ikkuna ei ole enää yhteydessä peliin.');
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
            showStartError('Kirjoita nimesi.');
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
            showStartError('Pöytäkoodissa on neljä numeroa.');
            $('join-code').focus();
            return;
        }
        if (!name) {
            showStartError('Kirjoita nimesi.');
            $('join-name').focus();
            return;
        }
        socket.emit('join-table', { code, name });
    });

    $('copy-link-button').addEventListener('click', async () => {
        const link = `${location.origin}${location.pathname}?poyta=${ui.state.table.code}`;
        try {
            await navigator.clipboard.writeText(link);
            respond(`Linkki kopioitu: ${link}`);
        } catch (e) {
            respond(`Kopiointi ei onnistunut. Linkki on ${link}`);
        }
    });

    $('add-robot-button').addEventListener('click', () => socket.emit('add-robot'));
    $('robot-speed').addEventListener('change', (e) => socket.emit('set-robot-speed', { speed: e.target.value }));
    $('start-button').addEventListener('click', () => socket.emit('start-game'));
    $('new-game-button').addEventListener('click', () => socket.emit('start-game'));
    $('to-lobby-button').addEventListener('click', () => socket.emit('to-lobby'));
    $('leave-button').addEventListener('click', async () => {
        if (await confirmDialog('Poistutaanko pöydästä?')) socket.emit('leave-table');
    });
    $('action-button').addEventListener('click', () => performAction(true));
    $('clear-button').addEventListener('click', clearSelection);
    $('abort-button').addEventListener('click', async () => {
        if (await confirmDialog('Keskeytetäänkö peli kaikilta pelaajilta?')) socket.emit('abort-game');
    });

    $('sound-toggle').checked = ui.soundOn;
    $('sound-toggle').addEventListener('change', (e) => {
        ui.soundOn = e.target.checked;
        storage.set('ristiseiska-sound', ui.soundOn ? 'on' : 'off');
        if (ui.soundOn) unlockAudio();
    });
    $('speech-toggle').checked = ui.speechOn;
    $('speech-toggle').addEventListener('change', (e) => {
        ui.speechOn = e.target.checked;
        storage.set('ristiseiska-speech', ui.speechOn ? 'on' : 'off');
        if (!ui.speechOn && 'speechSynthesis' in window) window.speechSynthesis.cancel();
    });

    // Selaimet sallivat äänet vasta käyttäjän toiminnon jälkeen.
    document.addEventListener('pointerdown', unlockAudio, { once: true });
    document.addEventListener('keydown', unlockAudio, { once: true });

    // Nimi muistetaan, ja jaetun linkin pöytäkoodi täytetään valmiiksi.
    $('create-name').value = ui.myName;
    $('join-name').value = ui.myName;
    const linkCode = new URLSearchParams(location.search).get('poyta');
    if (linkCode) $('join-code').value = linkCode;
    render();
})();
