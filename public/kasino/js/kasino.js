// Kasino – selainohjelma. Palvelin tarkistaa kaikki siirrot ja laskee otot.
// Tämä tiedosto piirtää pelitilanteen, hoitaa näppäinkomennot ja
// ruudunlukijailmoitukset. Runko (ilmoitusjono, odotushuone, äänet) on sama kuin
// ristiseiskassa, ja tallennus, jaot ja pistetaulukko kuten hertassa.
// Peli ei kerro, mitä kannattaa pelata: pelaaja päättelee sen itse.
(function () {
    'use strict';

    const {
        SUITS, SUIT_SYMBOLS, SUIT_NAMES, SUIT_PARTITIVES, SUIT_NONE,
        cardId, cardName, rankName, formatCardList, plural, capitalize
    } = window.Kortit;
    const { GAME_END_SCORE } = window.Saannot;

    // Samat näppäimet kuin Accessible Bridgessä ja muissa korttipeleissä.
    const SUIT_KEYS = { s: 'spades', h: 'hearts', d: 'diamonds', c: 'clubs' };
    const RANK_KEYS = {
        a: 'A', k: 'K', q: 'Q', j: 'J', t: '10', '1': '10',
        '2': '2', '3': '3', '4': '4', '5': '5', '6': '6', '7': '7', '8': '8', '9': '9'
    };
    // Oma käsi: Alt+A S D F. Pöytä: suoraan yläpuolella Alt+Q W E R.
    const ALT_HAND_CODES = { KeyA: 'spades', KeyS: 'hearts', KeyD: 'diamonds', KeyF: 'clubs' };
    const ALT_TABLE_CODES = { KeyQ: 'spades', KeyW: 'hearts', KeyE: 'diamonds', KeyR: 'clubs' };
    // "Löit pata ässän" (genetiivi) ja "Otit pata ässällä" (adessiivi).
    const RANK_GENITIVES = { A: 'ässän', K: 'kuninkaan', Q: 'rouvan', J: 'jätkän' };
    const RANK_ADESSIVES = {
        A: 'ässällä', K: 'kuninkaalla', Q: 'rouvalla', J: 'jätkällä', '2': 'kakkosella',
        '3': 'kolmosella', '4': 'nelosella', '5': 'viitosella', '6': 'kuutosella', '7': 'seiskalla',
        '8': 'kahdeksikolla', '9': 'yhdeksiköllä', '10': 'kympillä'
    };
    const TAKEN_HIGHLIGHT_MS = 2000;
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
                return JSON.parse(storage.get('kasino-session', 'null'));
            } catch (e) {
                return null;
            }
        },
        set(value) {
            storage.set('kasino-session', JSON.stringify(value));
        },
        clear() {
            storage.remove('kasino-session');
        }
    };

    const ROBOT_SPEED_NAMES = { slow: 'hidas', normal: 'normaali', fast: 'nopea' };

    const ui = {
        state: null,
        claim: null,                // tallennetun pelin pelaajavalinta (choose-player)
        myName: storage.get('kasino-name', storage.get('ristiseiska-name', storage.get('maija-name', ''))),
        selected: null,             // valitun kortin id, enintään yksi
        pendingSuit: null,
        taken: null,                // { cards, until }: otetut kortit näytetään hetken pöydässä
        lastAnnouncement: '',
        previousTurnKey: null,
        soundOn: storage.get('kasino-sound', 'on') === 'on',
        speechOn: storage.get('kasino-speech', 'off') === 'on'
    };

    // ===== Ilmoitukset (Accessible Bridgen announcementQueue) =====

    // Arvioitu lukuaika merkkiä kohden. Sama arvo on palvelimella robottien viiveessä
    // (kasino/socket.js, estimateReadingMs).
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

    // "sinä" tai nimi.
    function who(id, name) {
        return isMe(id, name) ? 'sinä' : name;
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

    function pistetta(count) {
        return plural(count, 'piste', 'pistettä');
    }

    // "Liisa, Mikko ja Robotti 1"
    function listNames(names) {
        if (names.length <= 1) return names.join('');
        return `${names.slice(0, -1).join(', ')} ja ${names[names.length - 1]}`;
    }

    // "pata ässän", "hertta 10"
    function cardObject(card) {
        return `${SUIT_NAMES[card.suit]} ${RANK_GENITIVES[card.rank] || card.rank}`;
    }

    // "pata ässällä", "hertta kympillä"
    function cardWith(card) {
        return `${SUIT_NAMES[card.suit]} ${RANK_ADESSIVES[card.rank]}`;
    }

    // Ruudunlukija lukee koodin numero kerrallaan: "4 7 1 2".
    function spellCode(code) {
        return String(code).split('').join(' ');
    }

    function dateText(ms) {
        return new Date(ms).toLocaleString('fi-FI', {
            weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit'
        });
    }

    // ===== Pöydän ja pinojen tekstit =====

    // "Pöydässä 5 korttia: risti ässä, pata 3, hertta 3, ruutu 8, risti jätkä."
    // Palvelin lähettää pöydän arvojärjestyksessä.
    function tableText(table) {
        if (table.length === 0) return 'Pöytä on tyhjä.';
        return `Pöydässä ${korttia(table.length)}: ${table.map(cardName).join(', ')}.`;
    }

    // "Pöydässä 2 pataa: 3, kuningas."
    function tableSuitText(table, suit) {
        const cards = table.filter(c => c.suit === suit);
        if (cards.length === 0) return `Pöydässä ${SUIT_NONE[suit].toLowerCase()}.`;
        const count = cards.length === 1 ? `1 ${SUIT_NAMES[suit]}` : `${cards.length} ${SUIT_PARTITIVES[suit]}`;
        return `Pöydässä ${count}: ${cards.map(c => rankName(c.rank)).join(', ')}.`;
    }

    // "14 korttia, 5 pataa, 2 ässää, patakakkonen, 1 mökki"
    function pileText(player) {
        const pile = player.pile;
        const parts = [korttia(pile.cards), plural(pile.spades, 'pata', 'pataa')];
        if (pile.aces > 0) parts.push(plural(pile.aces, 'ässä', 'ässää'));
        if (pile.smallCasino) parts.push('patakakkonen');
        if (pile.bigCasino) parts.push('ruutukymppi');
        if (player.cabins > 0) parts.push(plural(player.cabins, 'mökki', 'mökkiä'));
        return parts.join(', ');
    }

    function deckText(g) {
        if (g.phase !== 'play') return `Jako ${g.round}`;
        if (g.lastHand) return `Jako ${g.round} · Viimeinen käsi – mökkejä ei lasketa`;
        return `Jako ${g.round} · Pakassa ${korttia(g.deckCount)}`;
    }

    // "Liisa otti hertta jätkällä risti jätkän, ruutu 8 ja pata 3." / "Liisa löi pöytään pata 6."
    function moveText(move, own) {
        if (move.type === 'lay') {
            return own ? `Löit pöytään ${cardObject(move.card)}.` : `${move.name} löi pöytään ${cardObject(move.card)}.`;
        }
        const taken = listNames(move.taken.map(cardObject));
        return own ? `Otit ${cardWith(move.card)} ${taken}.` : `${move.name} otti ${cardWith(move.card)} ${taken}.`;
    }

    // ===== Tapahtumien tekstit =====

    function takeText(e) {
        const own = isMe(e.playerId, e.name);
        let text = moveText({ type: 'take', name: e.name, card: e.card, taken: e.taken }, own);
        if (e.cabin === 'made') {
            text += own ? ' Mökki!' : ` ${e.name} teki mökin.`;
        } else if (e.cabin === 'knocked') {
            const whose = isMe(e.knockedId, e.knockedName) ? 'sinun mökkisi' : `pelaajan ${e.knockedName} mökin`;
            text += own ? ` Kaadoit ${whose}.` : ` ${e.name} kaatoi ${whose}.`;
        } else if (e.cabin === 'ignored') {
            text += ' Pöytä tyhjeni, mutta viimeisessä kädessä mökkejä ei lasketa.';
        }
        return text;
    }

    function dealText(e) {
        let text = e.lastHand
            ? 'Viimeiset kortit. Mökkejä ei enää lasketa.'
            : `Uudet kortit. Pakassa ${korttia(e.deckCount)}.`;
        if (e.hand) text += ` Sinulla: ${formatCardList(e.hand)}.`;
        return text;
    }

    function sweepText(e) {
        const to = isMe(e.playerId, e.name) ? 'sinulle' : `pelaajalle ${e.name}`;
        return `Pöytään jääneet ${korttia(e.cards.length)} menevät ${to}: ${e.cards.map(cardName).join(', ')}.`;
    }

    // Jaon erittely: korttivoitto, patavoitto, pistekortit, mökit, jaon pisteet ja yhteensä.
    function roundOverText(e) {
        const parts = [`Jako ${e.round} päättyi.`];
        const ofPlayer = id => e.results.find(r => r.id === id);
        if (e.cardWinner) {
            const r = ofPlayer(e.cardWinner.id);
            parts.push(`Korttivoitto: ${who(r.id, r.name)}, ${korttia(r.cards)}, ${pistetta(e.cardWinPoints)}.`);
        } else {
            parts.push(`Korttivoitto tasan, ${pistetta(e.cardWinPoints)} siirtyy seuraavaan jakoon.`);
        }
        if (e.spadeWinner) {
            const r = ofPlayer(e.spadeWinner.id);
            parts.push(`Patavoitto: ${who(r.id, r.name)}, ${plural(r.spades, 'pata', 'pataa')}, ${pistetta(e.spadeWinPoints)}.`);
        } else {
            parts.push(`Patavoitto tasan, ${pistetta(e.spadeWinPoints)} siirtyy seuraavaan jakoon.`);
        }
        const aces = e.results.filter(r => r.aces > 0).map(r => `${who(r.id, r.name)} ${r.aces}`);
        if (aces.length) parts.push(`Ässät: ${aces.join(', ')}.`);
        const big = e.results.find(r => r.bigCasino);
        if (big) parts.push(`Ruutukymppi: ${who(big.id, big.name)}.`);
        const small = e.results.find(r => r.smallCasino);
        if (small) parts.push(`Patakakkonen: ${who(small.id, small.name)}.`);
        const cabins = e.results.filter(r => r.cabins > 0).map(r => `${who(r.id, r.name)} ${r.cabins}`);
        if (cabins.length) parts.push(`Mökit: ${cabins.join(', ')}.`);
        parts.push(`Jaon pisteet: ${e.results.map(r => `${who(r.id, r.name)} ${r.points}`).join(', ')}.`);
        parts.push(`Yhteensä: ${e.results.map(r => `${who(r.id, r.name)} ${r.total}`).join(', ')}.`);
        return parts.join(' ');
    }

    function overText(e) {
        const iWon = e.winnerIds.includes(myId());
        const winner = iWon ? 'Voitit' : `Voittaja: ${e.winnerNames[0]}`;
        const ranking = e.ranking.map(r => `${r.place}. ${who(r.id, r.name)} ${r.score}`).join(', ');
        const early = e.early ? `${iWon ? 'Sinulla' : `Pelaajalla ${e.winnerNames[0]}`} on varmasti ${GAME_END_SCORE} pistettä. ` : '';
        return `${early}Peli päättyi. ${winner}, ${pistetta(e.winningScore)}. Sijoitukset: ${ranking}.`;
    }

    function startText(e, first) {
        const parts = [first
            ? `Peli alkoi. Pelaajat: ${e.playerNames.join(', ')}. Peli ${GAME_END_SCORE} pisteeseen. Jakaja: ${who(e.dealerId, e.dealerName)}.`
            : `Jako ${e.round} alkoi. Jakaja: ${who(e.dealerId, e.dealerName)}.`];
        parts.push(tableText(e.table));
        if (!isMe(e.starterId, e.starterName)) parts.push(`Vuorossa ${e.starterName}.`);
        return parts.join(' ');
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
                if (isMe(e.playerId, e.name)) return e.claimed ? `Palasit tallennettuun peliin pelaajana ${e.name}.` : 'Yhteys palautui.';
                return `${e.name} palasi.`;
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
                return e.saved
                    ? `Pöytä suljettiin, koska sitä ei käytetty. Peli on tallennettu: liity pöytäkoodilla ${spellCode(e.code)} jatkaaksesi.`
                    : 'Pöytä suljettiin, koska sitä ei käytetty.';
            case 'save-changed': {
                // Tallennus on pöydän luojan asia, joten muille ei ilmoiteta.
                if (!isMe(e.playerId, e.byName)) return '';
                if (!e.enabled) return 'Poistit tallennuksen. Tallennettu peli poistettiin.';
                const when = e.gameRunning
                    ? 'Pöytä tallennetaan jokaisen jaon jälkeen ja säilyy 5 vuorokautta.'
                    : 'Pöytä tallennetaan, kun peli alkaa.';
                return `Tallennus on päällä. ${when} Jatka myöhemmin pöytäkoodilla ${spellCode(e.code)}.`;
            }
            case 'resumed': {
                const scores = e.scores.map(s => `${who(s.id, s.name)} ${s.score}`).join(', ');
                return `Tallennettu peli jatkuu jaosta ${e.round}. Pisteet: ${scores}. ${startText(e, false).replace(/^Jako \d+ alkoi\. /, '')}`;
            }
            case 'start':
                return startText(e, true);
            case 'round-start':
                return startText(e, false);
            case 'aborted':
                return e.discarded
                    ? `${e.name} hylkäsi tallennetun pelin. Pöytä on nyt tavallinen odotushuone.`
                    : `${e.name} keskeytti pelin.`;
            case 'lay':
                return moveText(e, isMe(e.playerId, e.name));
            case 'take':
                return takeText(e);
            case 'deal':
                return dealText(e);
            case 'sweep':
                return sweepText(e);
            case 'round-over':
                return roundOverText(e);
            case 'over':
                return overText(e);
            default:
                return '';
        }
    }

    function isOwnMove(e) {
        return (e.type === 'lay' || e.type === 'take') && isMe(e.playerId, e.name);
    }

    // Oman siirron tulos ja sen välittömät seuraukset luetaan yhtenä ryhmänä heti
    // jonon kärjestä. Palvelin lähettää tapahtumat ja heti perään uuden tilan.
    const OWN_MOVE_FOLLOWUPS = ['deal', 'sweep', 'round-over', 'over'];

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
        if (e.type === 'start' || e.type === 'round-start' || e.type === 'resumed') {
            ui.selected = null;
            ui.taken = null;
            ui.previousTurnKey = null;
            playSound('deal');
        } else if (e.type === 'deal') {
            playSound('receive');
        } else if (e.type === 'lay') {
            playSound('play');
        } else if (e.type === 'take') {
            playSound('play');
            // Otetut kortit näytetään hetken korostettuina ennen kuin ne poistuvat pöydästä.
            ui.taken = { cards: e.taken, until: Date.now() + TAKEN_HIGHLIGHT_MS };
            clearTimeout(ui.takenTimer);
            ui.takenTimer = setTimeout(() => {
                ui.taken = null;
                if (game()) renderTable(game());
            }, TAKEN_HIGHLIGHT_MS);
        } else if (e.type === 'table-closed') {
            // Tallennetun pöydän tunniste säilytetään: sillä pääsee suoraan omalle paikalle.
            if (e.saved) $('join-code').value = e.code;
            else session.clear();
            ui.state = null;
            render();
        }
    }

    // Kun oma vuoro alkaa, kerrotaan vain se. Mitä kannattaa pelata, pelaaja päättelee itse.
    function turnChangeText() {
        const g = game();
        if (!g || g.phase === 'over') {
            ui.previousTurnKey = g ? 'over' : null;
            return null;
        }
        const key = `${g.round}:${g.phase}:${g.currentId}`;
        if (key === ui.previousTurnKey) return null;
        ui.previousTurnKey = key;

        if (g.phase === 'play' && g.currentId === myId()) {
            playTurnCue();
            return 'Sinun vuorosi.';
        }
        if (g.phase === 'round-over' && g.allowedActions.includes('next-round')) {
            return 'Paina L aloittaaksesi seuraavan jaon.';
        }
        return null;
    }

    // ===== Piirto =====

    function createCardElement(card, { selectable = false, classes = '' } = {}) {
        const id = cardId(card);
        const element = document.createElement('div');
        element.className = `card-display suit-${card.suit} ${classes}`.trim();
        element.dataset.card = id;
        const selected = selectable && ui.selected === id;
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
        label.textContent = selected ? `${cardName(card)}, valittu` : cardName(card);

        element.append(suit, rank, label);
        if (selectable) {
            element.addEventListener('click', () => toggleCard(card.suit, card.rank));
        }
        return element;
    }

    const VIEW_HEADINGS = { start: 'start-heading', claim: 'claim-heading', lobby: 'lobby-heading', game: 'game-heading' };
    let currentView = null;

    function showView(name) {
        $('start-view').hidden = name !== 'start';
        $('claim-view').hidden = name !== 'claim';
        $('lobby-view').hidden = name !== 'lobby';
        $('game-view').hidden = name !== 'game';
        $('log-section').hidden = name === 'start' || name === 'claim';
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
            if (ui.claim) {
                showView('claim');
                renderClaim();
                document.title = `Kasino – tallennettu pöytä ${ui.claim.code}`;
                return;
            }
            showView('start');
            document.title = 'Kasino';
            return;
        }
        if (state.game) {
            showView('game');
            renderGame();
        } else {
            showView('lobby');
            renderLobby();
            document.title = `Kasino – pöytä ${state.table.code}`;
        }
        renderSave(state, 'lobby');
        renderSave(state, 'game');
    }

    function memberLabel(member, state) {
        const tags = [];
        const resuming = state.table.resuming;
        const saved = resuming && resuming.players.find(p => p.id === member.id);
        if (member.id === state.you.id) tags.push('sinä');
        if (member.isCreator) tags.push('pöydän luoja');
        if (member.type === 'robot') tags.push('robotti');
        if (saved && Number.isFinite(saved.score)) tags.push(pistetta(saved.score));
        if (member.spectator) tags.push('katsoja');
        if (!member.connected) tags.push(saved ? 'ei vielä palannut' : 'yhteys katkennut');
        return tags.length ? `${member.name} – ${tags.join(', ')}` : member.name;
    }

    // ===== Tallennus =====

    function saveInfoText(state) {
        const save = state.table.save;
        const code = state.table.code;
        if (!save.enabled) return 'Pöytää ei tallenneta. Jos kaikki poistuvat, pisteet katoavat.';
        if (save.failed) return 'Tallennus epäonnistui palvelimella. Pisteet voivat kadota, jos kaikki poistuvat.';
        if (!save.expiresAt) return `Pöytä tallennetaan, kun peli alkaa. Jatka myöhemmin pöytäkoodilla ${code}.`;
        return `Tallennettu ${dateText(save.expiresAt)} asti. Jatka myöhemmin pöytäkoodilla ${code}. Kesken jäänyt jako jaetaan uudelleen.`;
    }

    // Tallennuksen valinta ja tila näkyvät vain pöydän luojalle.
    function renderSave(state, where) {
        $(`save-control-${where}`).hidden = !state.you.isCreator;
        $(`save-toggle-${where}`).checked = state.table.save.enabled;
        $(`save-info-${where}`).textContent = saveInfoText(state);
    }

    function renderClaim() {
        const claim = ui.claim;
        $('claim-heading').textContent = `Tallennettu peli – pöytä ${claim.code}, jako ${claim.round}`;
        const container = $('claim-options');
        const previous = container.querySelector('input:checked');
        const previousValue = previous ? previous.value : null;
        container.replaceChildren();

        const free = claim.players.filter(p => !p.robot && !p.connected);
        const typed = (claim.name || ui.myName || '').toLowerCase();
        const match = free.find(p => p.name.toLowerCase() === typed);
        const selectable = value => value === 'spectator' || free.some(p => p.id === value);
        const preselect = previousValue && selectable(previousValue)
            ? previousValue
            : (match ? match.id : free.length ? free[0].id : 'spectator');

        function option(value, text, disabled) {
            const label = document.createElement('label');
            const input = document.createElement('input');
            input.type = 'radio';
            input.name = 'claim';
            input.value = value;
            input.disabled = disabled;
            input.checked = !disabled && value === preselect;
            label.append(input, ` ${text}`);
            container.appendChild(label);
        }
        for (const p of claim.players.filter(p => !p.robot)) {
            const score = Number.isFinite(p.score) ? ` – ${pistetta(p.score)}` : '';
            option(p.id, `${p.name}${score}${p.connected ? ' (on jo pöydässä)' : ''}`, p.connected);
        }
        option('spectator', 'En ole kukaan näistä – katso peliä', false);

        const robots = claim.players.filter(p => p.robot)
            .map(p => (Number.isFinite(p.score) ? `${p.name} (${pistetta(p.score)})` : p.name));
        $('claim-robots').textContent = robots.length
            ? `${listNames(robots)} ${robots.length === 1 ? 'jatkaa' : 'jatkavat'} automaattisesti.`
            : '';
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
            if (member.type === 'robot' && state.you.isCreator && !t.resuming) {
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
        const me = state.members.find(m => m.id === state.you.id);
        if (t.resuming) {
            renderResumingLobby(state, me);
            return;
        }
        $('resume-tools').hidden = true;
        $('creator-tools').hidden = !isCreator;
        const full = t.seatedCount >= t.maxPlayers;
        $('add-robot-button').setAttribute('aria-disabled', full ? 'true' : 'false');
        $('add-robot-button').textContent = full ? `Lisää robotti (pöytä täynnä, ${t.maxPlayers}/${t.maxPlayers})` : 'Lisää robotti';
        $('start-button').setAttribute('aria-disabled', t.seatedCount < t.minPlayers ? 'true' : 'false');
        $('robot-speed').value = t.robotSpeed;

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

    // Herätetty tallennus: odotetaan pelaajia, ja pöydän luoja jatkaa pelin.
    function renderResumingLobby(state, me) {
        const t = state.table;
        const r = t.resuming;
        const isCreator = state.you.isCreator;
        $('lobby-heading').textContent = `Pöytä ${t.code} – tallennettu peli, jako ${r.round}`;
        $('creator-tools').hidden = true;
        $('resume-tools').hidden = !isCreator;
        const missing = r.players.filter(p => !p.robot && !p.connected).map(p => p.name);
        $('resume-button').setAttribute('aria-disabled', missing.length ? 'true' : 'false');
        let text;
        if (isCreator) {
            text = missing.length
                ? `Tallennettu peli. Odotetaan vielä: ${listNames(missing)}. Kun kaikki ovat palanneet, voit jatkaa peliä.`
                : 'Kaikki ovat palanneet. Paina Jatka tallennettua peliä, niin seuraava jako jaetaan.';
        } else {
            text = missing.length
                ? `Tallennettu peli. Odotetaan vielä: ${listNames(missing)}.`
                : `Kaikki ovat palanneet. Odotetaan, että pöydän luoja ${t.creatorName || ''} jatkaa peliä.`;
        }
        if (!(me && me.saved)) text += ' Katsot tätä peliä.';
        $('lobby-info').textContent = text;
    }

    function removeRobot(robotId) {
        const robots = ui.state.members.filter(m => m.type === 'robot');
        const index = robots.findIndex(r => r.id === robotId);
        const next = robots[index + 1] || robots[index - 1];
        ui.focusRobotAfterRender = next ? next.id : 'add-robot-button';
        socket.emit('remove-robot', { id: robotId });
    }

    function turnBarText(g) {
        if (g.phase === 'over') return 'Peli päättyi.';
        if (g.phase === 'round-over') return `Jako ${g.round} päättyi.`;
        if (g.currentId === myId()) return '▶ Sinun vuorosi';
        return `Vuorossa: ${nameOf(g.currentId)}${isRobot(g.currentId) ? ' – miettii…' : ''}`;
    }

    function renderGame() {
        const g = game();
        const state = ui.state;
        const isPlayer = g.hand !== null;

        if (ui.selected && !selectedCard()) ui.selected = null;

        const myTurn = g.allowedActions.includes('lay');
        const bar = $('turn-bar');
        bar.classList.toggle('is-yours', myTurn);
        bar.textContent = turnBarText(g);
        document.title = myTurn ? '▶ Sinun vuorosi – Kasino' : 'Kasino';

        renderPlayers(g, state);
        renderTable(g);
        renderHand(g, isPlayer, myTurn);
        updateActionButtons();

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
            if (g.phase === 'play' && player.id === g.currentId) {
                item.classList.add('is-current');
                const badge = document.createElement('span');
                badge.className = 'turn-badge';
                badge.textContent = '▶ VUOROSSA';
                item.appendChild(badge);
            }

            const name = document.createElement('span');
            name.className = 'player-name';
            name.textContent = player.id === myId() ? `${player.name} (sinä)` : player.name;

            const meta = document.createElement('span');
            meta.className = 'player-meta';
            const details = [];
            if (member && member.type === 'robot') details.push('robotti');
            if (player.id === g.dealerId) details.push('jakaja');
            if (g.phase === 'play') details.push(`kädessä ${player.cardCount}`);
            details.push(`kerätty ${pileText(player)}`);
            details.push(pistetta(player.score));
            if (member && !member.connected) details.push('yhteys katkennut');
            meta.textContent = details.join(' · ');

            item.append(name, meta);
            list.appendChild(item);
        }
    }

    function renderTable(g) {
        const last = g.lastMove;
        if (last) {
            const text = moveText(last, last.playerId === myId()).replace(/\.$/, '');
            const own = last.playerId === myId();
            $('table-heading').textContent = `Pöytä – viimeksi ${own ? text.charAt(0).toLowerCase() + text.slice(1) : text}`;
        } else {
            $('table-heading').textContent = 'Pöytä';
        }
        $('deck-info').textContent = deckText(g);

        const text = $('table-text');
        const item = document.createElement('li');
        item.textContent = tableText(g.table);
        text.replaceChildren(item);

        const row = $('table-cards');
        row.replaceChildren();
        const taken = ui.taken && ui.taken.until > Date.now() ? ui.taken.cards : [];
        const shown = g.table.map(card => ({ card, classes: '' }))
            .concat(taken.map(card => ({ card, classes: 'is-taken' })));
        if (shown.length === 0) {
            const empty = document.createElement('span');
            empty.className = 'table-empty';
            empty.textContent = 'Pöytä on tyhjä.';
            row.appendChild(empty);
            return;
        }
        for (const { card, classes } of shown) {
            const isLast = last && last.type === 'lay' && cardId(last.card) === cardId(card);
            row.appendChild(createCardElement(card, { classes: `${classes}${isLast ? ' is-last' : ''}` }));
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
        const show = g.phase === 'round-over' || g.phase === 'over';
        section.hidden = !show;
        if (!show) return;

        const over = g.phase === 'over';
        $('result-heading').textContent = over ? 'Peli päättyi' : `Jako ${g.round} päättyi`;
        if (over) {
            const winner = playerById(g.winnerIds[0]);
            $('result-winner').textContent = g.winnerIds[0] === myId()
                ? `Voitit, ${pistetta(winner.score)}.`
                : `Voittaja: ${winner.name}, ${pistetta(winner.score)}.`;
        } else {
            $('result-winner').textContent = `Peli päättyy, kun joku saavuttaa ${GAME_END_SCORE} pistettä.`;
        }
        const result = g.roundResult && g.roundResult.round === g.round ? g.roundResult : null;
        $('round-table').hidden = !result;
        if (result) renderRoundTable(result);
        const carry = [];
        if (g.carry.cards) carry.push(`korttivoittoon ${pistetta(g.carry.cards)}`);
        if (g.carry.spades) carry.push(`patavoittoon ${pistetta(g.carry.spades)}`);
        $('result-carry').textContent = !over && carry.length ? `Seuraavaan jakoon siirtyy ${carry.join(' ja ')}.` : '';
        renderScoreTable(g);

        const canNext = g.allowedActions.includes('next-round');
        $('next-round-button').hidden = !canNext;
        $('new-game-button').hidden = !(over && state.you.isCreator);
        $('to-lobby-button').hidden = !(over && state.you.isCreator);
        if (!over) {
            $('result-wait').textContent = canNext
                ? 'Olet pöydän luoja. Aloita seuraava jako, kun kaikki ovat nähneet tuloksen.'
                : `Odotetaan, että pöydän luoja ${state.table.creatorName || ''} aloittaa seuraavan jaon.`;
        } else {
            $('result-wait').textContent = state.you.isCreator
                ? 'Uusi peli alkaa samoilla pelaajilla. Odotushuoneessa voit lisätä tai poistaa robotteja.'
                : `Odotetaan, että pöydän luoja ${state.table.creatorName || ''} aloittaa uuden pelin.`;
        }
    }

    function tableRow(cells, header) {
        const row = document.createElement('tr');
        cells.forEach((text, i) => {
            const cell = document.createElement(header || i === 0 ? 'th' : 'td');
            if (header) cell.scope = 'col';
            else if (i === 0) cell.scope = 'row';
            cell.textContent = text;
            row.appendChild(cell);
        });
        return row;
    }

    function renderRoundTable(result) {
        const table = $('round-table');
        table.querySelector('thead').replaceChildren(tableRow(
            ['Pelaaja', 'Kortit', 'Padat', 'Ässät', 'Patakakkonen', 'Ruutukymppi', 'Mökit', 'Jaon pisteet', 'Yhteensä'], true));
        const body = table.querySelector('tbody');
        body.replaceChildren();
        for (const r of result.results) {
            const mark = (won, value) => (won ? `${value} (voitto)` : String(value));
            const row = tableRow([
                r.id === myId() ? `${r.name} (sinä)` : r.name,
                mark(result.cardWinner && result.cardWinner.id === r.id, r.cards),
                mark(result.spadeWinner && result.spadeWinner.id === r.id, r.spades),
                String(r.aces),
                r.smallCasino ? 'kyllä' : '–',
                r.bigCasino ? 'kyllä' : '–',
                String(r.cabins),
                String(r.points),
                String(r.total)
            ]);
            row.lastChild.className = 'total';
            body.appendChild(row);
        }
    }

    function renderScoreTable(g) {
        const table = $('score-table');
        table.querySelector('thead').replaceChildren(tableRow(
            ['Pelaaja', ...g.history.map(h => `Jako ${h.round}`), 'Yhteensä'], true));
        const body = table.querySelector('tbody');
        body.replaceChildren();
        g.players.forEach((player, i) => {
            const row = tableRow([
                player.id === myId() ? `${player.name} (sinä)` : player.name,
                ...g.history.map(h => String(h.points[i])),
                String(player.score)
            ]);
            row.lastChild.className = 'total';
            if (g.winnerIds.includes(player.id)) row.classList.add('is-winner');
            body.appendChild(row);
        });
    }

    // aria-disabled eikä disabled: painikkeet pysyvät fokusoitavina, joten fokus ei
    // katoa, kun vuoro vaihtuu. Painaminen kertoo, mitä pitää tehdä.
    function updateActionButtons() {
        const g = game();
        const isPlayer = g && g.hand !== null;
        for (const id of ['lay-button', 'take-button', 'clear-button']) $(id).hidden = !isPlayer;
        if (!isPlayer) return;
        const ready = g.allowedActions.includes('lay') && !!selectedCard();
        $('lay-button').setAttribute('aria-disabled', ready ? 'false' : 'true');
        $('take-button').setAttribute('aria-disabled', ready ? 'false' : 'true');
    }

    function refreshSelection() {
        const g = game();
        if (!g) return;
        renderHand(g, g.hand !== null, g.allowedActions.includes('lay'));
        updateActionButtons();
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
        refreshSelection();
        respond(chosen ? `Valinta poistettu: ${cardName(chosen)}.` : 'Ei valittua korttia.');
    }

    function notYourTurnText(g) {
        if (g.phase === 'over') return 'Peli on päättynyt.';
        if (g.phase === 'round-over') {
            return `Jako on päättynyt. Odotetaan, että pöydän luoja ${ui.state.table.creatorName || ''} aloittaa seuraavan jaon.`;
        }
        return `Ei ole sinun vuorosi. Vuorossa: ${nameOf(g.currentId)}.`;
    }

    // action: 'lay' (L) tai 'take' (O). Valinta säilyy, kunnes kortti lähtee kädestä,
    // joten hylätyn oton jälkeen kortin voi lyödä suoraan L:llä.
    function performAction(action) {
        const g = game();
        if (!g || g.hand === null) return;
        if (action === 'lay' && g.allowedActions.includes('next-round')) {
            socket.emit('next-round');
            return;
        }
        if (!g.allowedActions.includes('lay')) {
            respond(notYourTurnText(g));
            return;
        }
        const chosen = selectedCard();
        if (!chosen) {
            respond('Valitse ensin kortti, esimerkiksi S ja 2.');
            return;
        }
        socket.emit(action, { cardId: cardId(chosen) });
    }

    // ===== Lukukomennot =====

    function requireGame() {
        if (!game()) {
            respond('Peli ei ole käynnissä.');
            return null;
        }
        return game();
    }

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
        // Luetaan ylhäältä alas kuten Bridgessä: ässä ensin.
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

    function readTable() {
        const g = requireGame();
        if (g) respond(tableText(g.table));
    }

    function readTableSuit(suit) {
        const g = requireGame();
        if (g) respond(tableSuitText(g.table, suit));
    }

    function readLastMove() {
        const g = requireGame();
        if (!g) return;
        respond(g.lastMove ? moveText(g.lastMove, g.lastMove.playerId === myId()) : 'Tässä jaossa ei ole vielä pelattu.');
    }

    function readTurn() {
        const g = requireGame();
        if (!g) return;
        if (g.phase === 'play') {
            respond(g.currentId === myId() ? 'Sinun vuorosi.' : `Vuorossa: ${nameOf(g.currentId)}.`);
        } else if (g.phase === 'round-over') {
            respond(g.allowedActions.includes('next-round')
                ? `Jako ${g.round} päättyi. Paina L aloittaaksesi seuraavan jaon.`
                : notYourTurnText(g));
        } else {
            respond('Peli on päättynyt.');
        }
    }

    // Kerätyt kortit itsestä alkaen.
    function readPiles() {
        const g = requireGame();
        if (!g) return;
        const me = playerById(myId());
        const others = g.players.filter(p => p !== me).map(p => `${p.name}: ${pileText(p)}.`);
        respond([me ? `Sinulla ${pileText(me)}.` : null, ...others].filter(Boolean).join(' '));
    }

    function readScores() {
        const g = requireGame();
        if (!g) return;
        const scores = g.players.map(p => `${p.id === myId() ? 'sinä' : p.name} ${p.score}`).join(', ');
        const parts = [`Pisteet: ${scores}. Peli ${GAME_END_SCORE} pisteeseen.`];
        const carry = [];
        if (g.carry.cards) carry.push(`korttivoitto ${g.carry.cards}`);
        if (g.carry.spades) carry.push(`patavoitto ${g.carry.spades}`);
        if (carry.length) parts.push(`Siirtyvät pisteet: ${carry.join(', ')}.`);
        respond(parts.join(' '));
    }

    function readSummary() {
        const g = requireGame();
        if (!g) return;
        const parts = [`Pöytä ${spellCode(ui.state.table.code)}. Jako ${g.round}.`];
        parts.push(`Jakaja: ${g.dealerId === myId() ? 'sinä' : nameOf(g.dealerId)}.`);
        if (g.phase === 'play') {
            parts.push(g.lastHand ? 'Viimeinen käsi, pakka on tyhjä.' : `Pakassa ${korttia(g.deckCount)}.`);
            parts.push(`Kädessä: ${g.players.map(p => `${p.id === myId() ? 'sinä' : p.name} ${p.cardCount}`).join(', ')}.`);
        }
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
            KeyO: readLastMove,
            KeyX: readScores,
            KeyV: readTurn,
            KeyC: readPiles,
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
        if (key === 'l' || key === 'o') {
            e.preventDefault();
            ui.pendingSuit = null;
            performAction(key === 'l' ? 'lay' : 'take');
            return;
        }
        if (SUIT_KEYS[key]) {
            e.preventDefault();
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

    const socket = io('/kasino');

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
        ui.claim = null;
        ui.myName = data.name;
        storage.set('kasino-name', data.name);
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
        ui.claim = null;
        render();
        showStartError(data.text);
    });

    // Tallennettu pöytä: liittyjä valitsee, kuka pelaajista hän on.
    socket.on('choose-player', (data) => {
        ui.state = null;
        ui.claim = data;
        $('claim-error').textContent = data.taken ? 'Se pelaaja on jo pöydässä. Valitse uudelleen.' : '';
        render();
        const intro = data.taken ? 'Se pelaaja on jo pöydässä. ' : '';
        respond(`${intro}Pöydällä ${spellCode(data.code)} on tallennettu peli, jako ${data.round}. Valitse, kuka olet, ja paina Jatka.`);
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

    $('claim-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const claim = ui.claim;
        if (!claim) return;
        const chosen = $('claim-options').querySelector('input:checked');
        if (!chosen) {
            $('claim-error').textContent = 'Valitse, kuka olet.';
            respond('Valitse, kuka olet.');
            return;
        }
        const name = claim.name || ui.myName;
        if (chosen.value === 'spectator') {
            if (!name) {
                ui.claim = null;
                render();
                showStartError('Kirjoita nimesi ja liity uudelleen katsoaksesi.');
                return;
            }
            socket.emit('join-table', { code: claim.code, name, spectator: true });
        } else {
            socket.emit('join-table', { code: claim.code, name, claimId: chosen.value });
        }
    });

    $('claim-cancel').addEventListener('click', () => {
        ui.claim = null;
        render();
    });

    $('resume-button').addEventListener('click', () => socket.emit('resume-game'));
    $('discard-button').addEventListener('click', async () => {
        if (await confirmDialog('Hylätäänkö tallennettu peli? Pisteet poistetaan, ja pöytä muuttuu tavalliseksi odotushuoneeksi.')) {
            socket.emit('abort-game');
        }
    });
    for (const where of ['lobby', 'game']) {
        $(`save-toggle-${where}`).addEventListener('change', (e) => {
            socket.emit('set-save', { enabled: e.target.checked });
        });
    }

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
    $('next-round-button').addEventListener('click', () => socket.emit('next-round'));
    $('new-game-button').addEventListener('click', () => socket.emit('start-game'));
    $('to-lobby-button').addEventListener('click', () => socket.emit('to-lobby'));
    $('leave-button').addEventListener('click', async () => {
        if (await confirmDialog('Poistutaanko pöydästä?')) socket.emit('leave-table');
    });
    $('lay-button').addEventListener('click', () => performAction('lay'));
    $('take-button').addEventListener('click', () => performAction('take'));
    $('clear-button').addEventListener('click', clearSelection);
    $('abort-button').addEventListener('click', async () => {
        if (await confirmDialog('Keskeytetäänkö peli kaikilta pelaajilta?')) socket.emit('abort-game');
    });

    $('sound-toggle').checked = ui.soundOn;
    $('sound-toggle').addEventListener('change', (e) => {
        ui.soundOn = e.target.checked;
        storage.set('kasino-sound', ui.soundOn ? 'on' : 'off');
        if (ui.soundOn) unlockAudio();
    });
    $('speech-toggle').checked = ui.speechOn;
    $('speech-toggle').addEventListener('change', (e) => {
        ui.speechOn = e.target.checked;
        storage.set('kasino-speech', ui.speechOn ? 'on' : 'off');
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
