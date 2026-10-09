// Musta Maija – selainohjelma. Palvelin tarkistaa kaikki siirrot. Tämä tiedosto
// piirtää pelitilanteen, hoitaa näppäinkomennot ja ruudunlukijailmoitukset.
(function () {
    'use strict';

    const {
        SUITS, SUIT_SYMBOLS, SUIT_NAMES, SUIT_PARTITIVES, SUIT_NONE,
        cardId, cardName, rankName, formatCardList, isMaija, plural, capitalize
    } = window.Kortit;

    // Samat näppäimet kuin Accessible Bridgessä.
    const SUIT_KEYS = { s: 'spades', h: 'hearts', d: 'diamonds', c: 'clubs' };
    const RANK_KEYS = {
        a: 'A', k: 'K', q: 'Q', j: 'J', t: '10', '1': '10',
        '2': '2', '3': '3', '4': '4', '5': '5', '6': '6', '7': '7', '8': '8', '9': '9'
    };
    const ALT_SUIT_CODES = { KeyA: 'spades', KeyS: 'hearts', KeyD: 'diamonds', KeyF: 'clubs' };
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
                return JSON.parse(storage.get('maija-session', 'null'));
            } catch (e) {
                return null;
            }
        },
        set(value) {
            storage.set('maija-session', JSON.stringify(value));
        },
        clear() {
            storage.remove('maija-session');
        }
    };

    const ROBOT_SPEED_NAMES = { slow: 'hidas', normal: 'normaali', fast: 'nopea' };

    const ui = {
        state: null,
        myName: storage.get('maija-name', ''),
        selected: new Set(),
        pendingSuit: null,
        pendingPickup: false,
        lastAnnouncement: '',
        previousTurnKey: null,
        soundOn: storage.get('maija-sound', 'on') === 'on',
        speechOn: storage.get('maija-speech', 'off') === 'on'
    };

    // ===== Ilmoitukset (Accessible Bridgen announcementQueue) =====

    // Arvioitu lukuaika merkkiä kohden. Sama arvo on palvelimella robottien viiveessä
    // (maija/socket.js, estimateReadingMs).
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
        // Kesken oleva ilmoitus katkeaa, mutta jonossa odottavat säilyvät.
        // Useampi viesti (esim. oma lyönti ja "Pakka loppui") luetaan peräkkäin.
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
                // Arvio siitä, kauanko ruudunlukijalta kestää lukea viesti, jotta
                // seuraava ilmoitus ei ylikirjoita sitä kesken.
                const duration = Math.max(400, Math.min(5000, message.length * MS_PER_CHAR));
                this.timer = setTimeout(() => this.next(), duration);
            }, 50);
        },

        clear() {
            this.queue = [];
            clearTimeout(this.timer);
            clearTimeout(this.showTimer);
            this.timer = null;
            $('announcer').textContent = '';
            this.processing = false;
        }
    };

    // Pelitapahtumat: luetaan järjestyksessä.
    function announce(message) {
        announcer.add(message);
    }

    // Vastaus käyttäjän omaan toimintoon (lukukomennot, valinnat, virheet).
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

    function memberById(id) {
        return ui.state ? ui.state.members.find(m => m.id === id) || null : null;
    }

    function isRobot(id) {
        const member = memberById(id);
        return !!member && member.type === 'robot';
    }

    function myHand() {
        const g = game();
        return g && g.hand ? g.hand : [];
    }

    function selectedCards() {
        return myHand().filter(card => ui.selected.has(cardId(card)));
    }

    function korttia(count) {
        return plural(count, 'kortti', 'korttia');
    }

    // Akkusatiivi: "lyödä 1 kortin", "lyödä 3 korttia".
    function korttiaObj(count) {
        return plural(count, 'kortin', 'korttia');
    }

    function selectionSummary() {
        const cards = selectedCards();
        if (cards.length === 0) return 'Ei valittuja kortteja.';
        return `Valittuna ${korttia(cards.length)}: ${formatCardList(cards)}.`;
    }

    // Seuraava pelissä oleva pelaaja annetun jälkeen (pois päässeet ohitetaan).
    function nextActiveAfter(id) {
        const players = game().players;
        const start = players.findIndex(p => p.id === id);
        for (let step = 1; step < players.length; step++) {
            const candidate = players[(start + step) % players.length];
            if (!candidate.out) return candidate;
        }
        return null;
    }

    // ===== Tapahtumien tekstit =====

    function defenseText(e) {
        const me = isMe(e.defenderId, e.defenderName);
        const subject = me ? 'Kaadoit' : `${e.defenderName} kaatoi`;
        const total = e.pairs.length + e.pickedUp.length;
        const parts = [];

        if (e.pairs.length === 0) {
            parts.push(me ? 'Et kaatanut yhtään korttia.' : `${e.defenderName} ei kaatanut yhtään korttia.`);
        } else {
            const pairsText = e.pairs.map(p => `${cardName(p.attack)} kortilla ${cardName(p.defense)}`).join(', ');
            let amount;
            if (e.allBeaten) amount = total === 1 ? 'kortin' : `kaikki ${total} korttia`;
            else amount = korttiaObj(e.pairs.length);
            parts.push(`${subject} ${amount}: ${pairsText}.`);
        }

        if (e.pickedUp.length > 0) {
            const list = formatCardList(e.pickedUp);
            parts.push(me
                ? `Nostit käteesi ${korttiaObj(e.pickedUp.length)}: ${list}.`
                : `${e.defenderName} nosti ${korttiaObj(e.pickedUp.length)}: ${list}.`);
        }

        if (me && e.unused && e.unused.length > 0) {
            parts.push(e.unused.length === 1
                ? `Kortti ${cardName(e.unused[0])} ei kaatanut mitään ja jäi käteesi.`
                : `Kortit ${formatCardList(e.unused)} eivät kaataneet mitään ja jäivät käteesi.`);
        }

        if (me && e.drew > 0) parts.push(drawText(e));
        return parts.join(' ');
    }

    function drawText(e) {
        const list = e.drawn && e.drawn.length > 0 ? `: ${formatCardList(e.drawn)}` : '';
        return `Nostit pakasta ${korttiaObj(e.drew)}${list}.`;
    }

    function attackText(e) {
        const list = formatCardList(e.cards);
        const amount = korttiaObj(e.cards.length);
        if (isMe(e.attackerId, e.attackerName)) {
            let text = `Löit pelaajalle ${e.defenderName} ${amount}: ${list}.`;
            if (e.drew > 0) text += ` ${drawText(e)}`;
            return text;
        }
        if (isMe(e.defenderId, e.defenderName)) return `${e.attackerName} löi sinulle ${amount}: ${list}.`;
        return `${e.attackerName} löi pelaajalle ${e.defenderName} ${amount}: ${list}.`;
    }

    // Ruudunlukija lukee koodin numero kerrallaan: "4 7 1 2".
    function spellCode(code) {
        return String(code).split('').join(' ');
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
                text += isMe(e.starterId, e.starterName) ? ' Sinä aloitat.' : ` ${e.starterName} aloittaa.`;
                text += ` Valtti on ${SUIT_NAMES[e.trumpCard.suit]}, valttikortti ${cardName(e.trumpCard)}.`;
                return text;
            }
            case 'aborted':
                return `${e.name} keskeytti pelin.`;
            case 'attack':
                return attackText(e);
            case 'defend':
                return defenseText(e);
            case 'deck-empty':
                return 'Pakka loppui. Loppukiri alkaa: lyödä saa enintään niin monta korttia kuin vastaanottajalla on kädessä.';
            case 'out':
                return isMe(e.playerId, e.name)
                    ? `Pääsit pois pelistä sijalle ${e.place}!`
                    : `${e.name} pääsi pois pelistä sijalle ${e.place}.`;
            case 'over': {
                const ranking = e.ranking.map(r => `${r.place}. ${r.name}`).join(', ');
                const who = isMe(e.maijaId, e.maijaName)
                    ? 'Sinusta tuli Musta Maija.'
                    : `Musta Maija on ${e.maijaName}.`;
                return `Peli päättyi. ${who} Sijoitukset: ${ranking}.`;
            }
            default:
                return '';
        }
    }

    function isOwnMove(e) {
        return (e.type === 'attack' && isMe(e.attackerId, e.attackerName))
            || (e.type === 'defend' && isMe(e.defenderId, e.defenderName));
    }

    // Oman siirron tulos ja sen välittömät seuraukset (pakka loppui, pois pääsy,
    // pelin loppu ja seuraava vuoro) kerätään yhteen ja luetaan heti jonon kärjestä.
    // Palvelin lähettää siirron tapahtumat ja heti perään uuden tilan, jolloin ryhmä luetaan.
    const OWN_MOVE_FOLLOWUPS = ['deck-empty', 'out', 'over'];

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
                // Varmistus siltä varalta, ettei tila saavu: luetaan ryhmä silti.
                clearTimeout(ui.ownMoveTimer);
                ui.ownMoveTimer = setTimeout(() => flushOwnMove(null), 300);
            } else if (ui.ownMove && OWN_MOVE_FOLLOWUPS.includes(e.type)) {
                ui.ownMove.push(text);
            } else {
                announce(text);
            }
        }
        if (e.type === 'start') {
            ui.selected.clear();
            ui.previousTurnKey = null;
            playSound('deal');
        } else if (e.type === 'defend') {
            playSound(e.pickedUp.length > 0 ? 'nosta' : 'kaada');
        } else if (e.type === 'table-closed') {
            session.clear();
            ui.state = null;
            render();
        }
    }

    // Kun vuoro vaihtuu, kerrotaan kuka on vuorossa. Oma vuoro saa lisäksi äänen.
    // Palauttaa vuoroilmoituksen tekstin, jos vuoro vaihtui (muuten null).
    function turnChangeText() {
        const g = game();
        if (!g || g.phase === 'over') {
            ui.previousTurnKey = g ? 'over' : null;
            return null;
        }
        const key = `${g.phase}:${g.attackerId}:${g.defenderId}`;
        if (key === ui.previousTurnKey) return null;
        ui.previousTurnKey = key;
        ui.pendingPickup = false;

        const attacker = nameOf(g.attackerId);
        const defender = nameOf(g.defenderId);
        if (g.phase === 'attack') {
            if (g.attackerId === myId()) {
                playTurnCue();
                return `Sinun vuorosi lyödä pelaajalle ${defender}. Voit lyödä enintään ${korttiaObj(g.maxAttack)}.`;
            }
            return `Vuorossa: ${attacker} lyö pelaajalle ${defender}.`;
        }
        if (g.phase === 'defend' && g.defenderId === myId()) {
            playTurnCue();
            return 'Sinun vuorosi kaataa. Valitse kaatavat kortit ja paina L.';
        }
        return null;
    }

    // ===== Piirto =====

    function createCardElement(card, { selectable = false, extraText = '' } = {}) {
        const g = game();
        const id = cardId(card);
        const element = document.createElement('div');
        element.className = `card-display suit-${card.suit}`;
        element.dataset.card = id;
        const isTrump = g && card.suit === g.trump;
        const selected = selectable && ui.selected.has(id);
        if (isTrump) element.classList.add('is-trump');
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
        let text = cardName(card);
        if (isTrump) text += ', valtti';
        if (isMaija(card)) text += ', Musta Maija';
        if (selected) text += ', valittu';
        if (extraText) text += `, ${extraText}`;
        label.textContent = text;

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
        // Jos fokus oli piilotetussa näkymässä, siirretään se uuden näkymän otsikkoon,
        // ettei se putoa sivun alkuun.
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
            document.title = 'Musta Maija';
            return;
        }
        if (state.game) {
            showView('game');
            renderGame();
        } else {
            showView('lobby');
            renderLobby();
            document.title = `Musta Maija – pöytä ${state.table.code}`;
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
        // aria-disabled: painike pysyy fokusoitavana ja kertoo painettaessa syyn.
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
        // Poiston jälkeen fokus seuraavan robotin Poista-painikkeeseen tai Lisää robotti -painikkeeseen.
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

        // Poistetaan valinnoista kortit, jotka eivät enää ole kädessä.
        const handIds = new Set(myHand().map(cardId));
        for (const id of [...ui.selected]) {
            if (!handIds.has(id)) ui.selected.delete(id);
        }

        const attacker = nameOf(g.attackerId);
        const defender = nameOf(g.defenderId);
        const myTurn = g.allowedActions.length > 0;

        // Vuoropalkki ja sivun otsikko
        const bar = $('turn-bar');
        bar.classList.toggle('is-yours', myTurn);
        if (g.phase === 'over') {
            bar.textContent = 'Peli päättyi.';
        } else if (g.phase === 'attack') {
            bar.textContent = g.attackerId === myId()
                ? `▶ Sinun vuorosi: lyö pelaajalle ${defender} (enintään ${korttiaObj(g.maxAttack)})`
                : `Vuorossa: ${attacker} lyö pelaajalle ${defender}${isRobot(g.attackerId) ? ' – miettii…' : ''}`;
        } else {
            bar.textContent = g.defenderId === myId()
                ? `▶ Sinun vuorosi: kaada ${korttia(g.table.length)}`
                : `Vuorossa: ${defender} kaataa, ${attacker} löi${isRobot(g.defenderId) ? ' – miettii…' : ''}`;
        }
        document.title = myTurn ? '▶ Sinun vuorosi – Musta Maija' : 'Musta Maija';

        renderPlayers(g, state);
        renderTable(g, attacker, defender);
        renderDeck(g);
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
            const acting = (g.phase === 'attack' && player.id === g.attackerId)
                || (g.phase === 'defend' && player.id === g.defenderId);

            if (acting) {
                item.classList.add('is-current');
                const badge = document.createElement('span');
                badge.className = 'turn-badge';
                badge.textContent = g.phase === 'attack' ? '▶ VUOROSSA – lyö' : '▶ VUOROSSA – kaataa';
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
                details.push(player.id === g.maijaId ? 'Musta Maija' : `pois, sija ${player.place}`);
            } else {
                details.push(korttia(player.cardCount));
                if (g.phase === 'defend' && player.id === g.attackerId) details.push('löi');
                if (g.phase === 'attack' && player.id === g.defenderId) details.push('vastaanottaa');
            }
            if (member && !member.connected) details.push('yhteys katkennut');
            meta.textContent = details.join(' · ');

            item.append(name, meta);
            list.appendChild(item);
        }
    }

    function playedCard(labelText, card, extraText) {
        const box = document.createElement('div');
        box.className = 'played-card';
        const label = document.createElement('span');
        label.className = 'played-label';
        label.setAttribute('aria-hidden', 'true');
        label.textContent = labelText;
        box.append(label, createCardElement(card, { extraText }));
        return box;
    }

    function renderTable(g, attacker, defender) {
        const heading = $('table-heading');
        const container = $('table-cards');
        container.replaceChildren();
        const last = g.lastTableEvent;

        if (g.phase === 'defend') {
            heading.textContent = `Pöytä: ${attacker} löi, ${defender} kaataa`;
            for (const entry of g.table) {
                container.appendChild(playedCard('Löi', entry.card, 'lyöty'));
            }
        } else if (g.lastTable.length > 0 && last && last.type === 'defend') {
            heading.textContent = `Edellinen kaato: ${last.defenderName}, kaatui ${last.pairs.length}, nostettiin ${last.pickedUp.length}`;
            for (const entry of g.lastTable) {
                const column = document.createElement('div');
                column.className = 'played-card';
                const hitLabel = document.createElement('span');
                hitLabel.className = 'played-label';
                hitLabel.setAttribute('aria-hidden', 'true');
                hitLabel.textContent = 'Löi';
                column.append(hitLabel, createCardElement(entry.card, { extraText: entry.beatenBy ? 'kaatui' : 'nostettiin' }));
                const resultLabel = document.createElement('span');
                resultLabel.className = 'played-label';
                resultLabel.setAttribute('aria-hidden', 'true');
                if (entry.beatenBy) {
                    resultLabel.textContent = 'Kaatoi';
                    column.append(resultLabel, createCardElement(entry.beatenBy, { extraText: 'kaatava kortti' }));
                } else {
                    resultLabel.textContent = 'Nostettiin';
                    column.append(resultLabel);
                }
                container.appendChild(column);
            }
        } else {
            heading.textContent = 'Pöytä';
            const empty = document.createElement('p');
            empty.className = 'table-empty';
            empty.textContent = 'Pöytä on tyhjä.';
            container.appendChild(empty);
        }
    }

    function renderDeck(g) {
        $('deck-heading').textContent = `Valtti: ${SUIT_NAMES[g.trump]}`;
        const holder = $('trump-card');
        holder.replaceChildren(createCardElement(g.trumpCard, {
            extraText: g.trumpCardInDeck ? 'pakan pohjalla' : 'nostettu pakasta'
        }));
        holder.style.opacity = g.trumpCardInDeck ? '1' : '0.55';
        $('deck-count').textContent = g.deckCount > 0
            ? `Pakka: ${g.deckCount}`
            : 'Pakka loppu – loppukiri';
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
        const selectedCount = selectedCards().length;
        $('hand-heading').textContent = `Oma käsi – ${korttia(cards.length)}, ${selectedCount} valittu`;
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
        const maija = playerById(g.maijaId);
        $('result-maija').textContent = g.maijaId === myId()
            ? 'Sinusta tuli Musta Maija.'
            : `Musta Maija: ${maija ? maija.name : ''}`;
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
        if (g.allowedActions.includes('attack')) {
            button.setAttribute('aria-disabled', 'false');
            button.textContent = 'Lyö valitut (L)';
        } else if (g.allowedActions.includes('defend')) {
            button.setAttribute('aria-disabled', 'false');
            button.textContent = selectedCards().length > 0 ? 'Kaada valituilla (L)' : 'Nosta kaikki (L)';
        } else {
            button.setAttribute('aria-disabled', 'true');
            button.textContent = g.phase === 'over' ? 'Peli päättyi' : 'Odota vuoroasi';
        }
    }

    // Käden ja painikkeen päivitys valinnan jälkeen ilman koko näkymän piirtoa.
    function refreshSelection() {
        const g = game();
        if (!g) return;
        renderHand(g, g.hand !== null, g.allowedActions.length > 0);
        updateActionButton();
    }

    // ===== Toiminnot =====

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
        ui.pendingPickup = false;
        let text;
        if (ui.selected.has(id)) {
            ui.selected.delete(id);
            text = `Poistettu ${name}.`;
        } else {
            ui.selected.add(id);
            text = `Valittu ${name}.`;
        }
        refreshSelection();
        respond(`${text} ${selectionSummary()}`);
    }

    const SUIT_PLURALS = { spades: 'padat', hearts: 'hertat', diamonds: 'ruudut', clubs: 'ristit' };

    // Valitsee maan kaikki kortit. Jos ne ovat jo kaikki valittuina, valinta poistetaan.
    function toggleSuit(suit) {
        const g = game();
        if (!g || g.hand === null) return;
        const cards = myHand().filter(c => c.suit === suit);
        if (cards.length === 0) {
            respond(`${SUIT_NONE[suit]}.`);
            return;
        }
        const ids = cards.map(cardId);
        const allSelected = ids.every(id => ui.selected.has(id));
        ids.forEach(id => (allSelected ? ui.selected.delete(id) : ui.selected.add(id)));
        refreshSelection();
        const list = formatCardList(cards);
        respond(allSelected
            ? `Poistettu kaikki ${SUIT_PLURALS[suit]}: ${list}. ${selectionSummary()}`
            : `Valittu kaikki ${SUIT_PLURALS[suit]}: ${list}. ${selectionSummary()}`);
    }

    function clearSelection() {
        const count = selectedCards().length;
        ui.selected.clear();
        ui.pendingSuit = null;
        ui.pendingPickup = false;
        refreshSelection();
        respond(count > 0 ? `Valinnat nollattu, ${korttia(count)}.` : 'Ei valittuja kortteja.');
    }

    function notYourTurnText(g) {
        if (g.phase === 'over') return 'Peli on päättynyt.';
        if (g.phase === 'attack') return `Ei ole sinun vuorosi. Vuorossa: ${nameOf(g.attackerId)} lyö.`;
        return `Ei ole sinun vuorosi. Vuorossa: ${nameOf(g.defenderId)} kaataa.`;
    }

    async function performAction(fromButton) {
        const g = game();
        if (!g || g.hand === null) return;
        const cards = selectedCards();

        if (g.allowedActions.includes('attack')) {
            ui.pendingPickup = false;
            if (cards.length === 0) {
                respond('Valitse ensin lyötävät kortit. Esimerkiksi S ja 2 valitsee kortin pata 2.');
                return;
            }
            if (cards.some(c => c.suit !== cards[0].suit)) {
                respond(`Lyötävien korttien pitää olla samaa maata. ${selectionSummary()}`);
                return;
            }
            if (cards.length > g.maxAttack) {
                respond(`Voit lyödä enintään ${korttiaObj(g.maxAttack)}. Valittuna on ${cards.length}.`);
                return;
            }
            socket.emit('attack', { cardIds: cards.map(cardId) });
            ui.selected.clear();
            return;
        }

        if (g.allowedActions.includes('defend')) {
            if (cards.length > 0) {
                ui.pendingPickup = false;
                socket.emit('defend', { cardIds: cards.map(cardId) });
                ui.selected.clear();
                return;
            }
            const count = g.table.length;
            if (fromButton) {
                if (await confirmDialog(`Nostetaanko kaikki pöydän kortit (${count}) käteesi?`)) {
                    socket.emit('defend', { cardIds: [] });
                }
                return;
            }
            if (ui.pendingPickup) {
                ui.pendingPickup = false;
                socket.emit('defend', { cardIds: [] });
                return;
            }
            ui.pendingPickup = true;
            respond(count === 1
                ? 'Et valinnut kortteja. Paina L uudelleen nostaaksesi kortin.'
                : `Et valinnut kortteja. Paina L uudelleen nostaaksesi kaikki ${count} korttia.`);
            return;
        }

        respond(notYourTurnText(g));
    }

    // ===== Lukukomennot =====

    function readSuit(suit) {
        const g = game();
        if (!g || g.hand === null) {
            respond('Sinulla ei ole korttikättä.');
            return;
        }
        const cards = myHand().filter(c => c.suit === suit);
        if (cards.length === 0) {
            respond(`${SUIT_NONE[suit]}.`);
            return;
        }
        const count = cards.length === 1 ? `1 ${SUIT_NAMES[suit]}` : `${cards.length} ${SUIT_PARTITIVES[suit]}`;
        const ranks = cards.map(c => {
            let text = rankName(c.rank);
            if (isMaija(c)) text += ' (Musta Maija)';
            if (ui.selected.has(cardId(c))) text += ' (valittu)';
            return text;
        }).join(', ');
        let text = `${count}: ${ranks}.`;
        if (suit === g.trump) text += ` ${capitalize(SUIT_NAMES[suit])} on valtti.`;
        respond(text);
    }

    function readHand() {
        const g = game();
        if (!g || g.hand === null) {
            respond('Sinulla ei ole korttikättä.');
            return;
        }
        const cards = myHand();
        if (cards.length === 0) {
            respond('Kätesi on tyhjä.');
            return;
        }
        const parts = SUITS
            .map(suit => {
                const ofSuit = cards.filter(c => c.suit === suit);
                if (ofSuit.length === 0) return null;
                return `${capitalize(SUIT_NAMES[suit])}: ${ofSuit.map(c => rankName(c.rank)).join(', ')}`;
            })
            .filter(Boolean);
        respond(`${korttia(cards.length)}. ${parts.join('. ')}.`);
    }

    function readTable() {
        const g = game();
        if (!g || !g.lastTableEvent) {
            respond('Pöydässä ei ole vielä tapahtunut mitään.');
            return;
        }
        respond(eventText(g.lastTableEvent));
    }

    function readCount() {
        const g = game();
        if (!g || g.hand === null) {
            respond('Sinulla ei ole korttikättä.');
            return;
        }
        const cards = selectedCards();
        const total = myHand().length;
        const own = cards.length === 0
            ? `Sinulla on ${korttia(total)}, ei valittuja.`
            : `Sinulla on ${korttia(total)}, joista ${cards.length} valittu: ${formatCardList(cards)}.`;
        const deck = g.deckCount > 0 ? `Pakassa on ${korttia(g.deckCount)}.` : 'Pakka on loppu.';
        respond(`${own} ${deck}`);
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
        const attacker = nameOf(g.attackerId);
        const defender = nameOf(g.defenderId);
        if (g.phase === 'attack') {
            respond(g.attackerId === myId()
                ? `Sinun vuorosi lyödä pelaajalle ${defender}.`
                : `Vuorossa: ${attacker} lyö pelaajalle ${defender}.`);
            return;
        }
        const list = formatCardList(g.table.map(t => t.card));
        const amount = korttiaObj(g.table.length);
        respond(g.defenderId === myId()
            ? `Sinun vuorosi kaataa. ${attacker} löi sinulle ${amount}: ${list}.`
            : `Vuorossa: ${defender} kaataa. ${attacker} löi ${amount}: ${list}.`);
    }

    function readMaxAttack() {
        const g = game();
        if (!g) {
            respond('Peli ei ole käynnissä.');
            return;
        }
        if (g.phase === 'over') {
            respond('Peli on päättynyt.');
            return;
        }
        if (g.phase === 'attack') {
            const defender = playerById(g.defenderId);
            const who = g.attackerId === myId() ? 'Voit' : `${nameOf(g.attackerId)} voi`;
            respond(`${who} lyödä enintään ${korttiaObj(g.maxAttack)}. Pelaajalla ${defender.name} on ${korttia(defender.cardCount)}.`);
            return;
        }
        if (g.defenderId === myId()) {
            const next = nextActiveAfter(myId());
            if (next) {
                const max = Math.min(5, next.cardCount);
                respond(`Jos kaadat kaiken, lyöt seuraavaksi pelaajalle ${next.name}, jolla on ${korttia(next.cardCount)}. Voit silloin lyödä enintään ${korttiaObj(max)}.`);
                return;
            }
        }
        respond(`Nyt ${nameOf(g.defenderId)} kaataa. Pöydässä on ${korttia(g.table.length)}.`);
    }

    function readSummary() {
        const g = game();
        if (!g) {
            respond('Peli ei ole käynnissä.');
            return;
        }
        const parts = [`Pöytä ${spellCode(ui.state.table.code)}.`, `Valtti ${SUIT_NAMES[g.trump]}.`];
        parts.push(`Jakaja: ${g.dealerId === myId() ? 'sinä' : nameOf(g.dealerId)}.`);
        parts.push(g.trumpCardInDeck
            ? `Valttikortti ${cardName(g.trumpCard)} on pakan pohjalla. Pakassa ${korttia(g.deckCount)}.`
            : 'Pakka on loppu, loppukiri.');
        const active = g.players.filter(p => !p.out)
            .map(p => `${p.id === myId() ? 'sinä' : p.name} ${korttia(p.cardCount)}`);
        if (active.length > 0) parts.push(`Pelissä: ${active.join(', ')}.`);
        const out = g.players.filter(p => p.out && p.id !== g.maijaId)
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
            KeyX: readCount,
            KeyV: readTurn,
            KeyC: readMaxAttack,
            KeyY: readSummary,
            KeyI: repeatLastAnnouncement
        };
        if (ALT_SUIT_CODES[e.code]) {
            e.preventDefault();
            readSuit(ALT_SUIT_CODES[e.code]);
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
            ui.pendingPickup = false;
            // Sama maakirjain kahdesti (esim. S S) valitsee maan kaikki kortit.
            if (ui.pendingSuit === SUIT_KEYS[key]) {
                ui.pendingSuit = null;
                toggleSuit(SUIT_KEYS[key]);
                return;
            }
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

    // Oma nimiavaruus, jotta Maija voi toimia samassa palvelimessa Bridgen kanssa.
    const socket = io('/maija');

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
        storage.set('maija-name', data.name);
        session.set({ code: data.code, token: data.token, name: data.name });
        $('start-error').textContent = '';
        // Osoiteriville pöydän linkki, jotta sen voi jakaa tai tallentaa.
        try {
            history.replaceState(null, '', `?poyta=${data.code}`);
        } catch (e) { /* ei haittaa */ }
    });

    socket.on('join-error', (data) => {
        const saved = session.get();
        // Tallennettu pöytä on poistunut (esim. palvelin käynnistyi uudelleen).
        if (saved && data.missing && saved.code === data.code) session.clear();
        ui.state = null;
        render();
        showStartError(data.text);
    });

    socket.on('left-table', () => {
        session.clear();
        ui.state = null;
        ui.previousTurnKey = null;
        ui.selected.clear();
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
        storage.set('maija-sound', ui.soundOn ? 'on' : 'off');
        if (ui.soundOn) unlockAudio();
    });
    $('speech-toggle').checked = ui.speechOn;
    $('speech-toggle').addEventListener('change', (e) => {
        ui.speechOn = e.target.checked;
        storage.set('maija-speech', ui.speechOn ? 'on' : 'off');
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
