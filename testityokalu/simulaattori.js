/**
 * Testityökalun simulaatiomoottori. Pelaa jakoja palvelinta vastaan
 * Socket.IO-yhteyksillä: jokainen ihmispelaaja on oma yhteytensä, joka
 * lähettää samat viestit kuin oikea selain (createTable, selectPosition,
 * startGame, makeBid, chooseMiniContract, playCard, requestNextDeal) ja näkee
 * vain ne kortit, jotka palvelin sille lähettää. Tyhjät paikat palvelin
 * täyttää roboteilla.
 *
 * Jokaisen jaon tapahtumat kootaan tallenteeksi, jonka tarkistimet.js
 * tarkistaa. Palvelimen on oltava testitilassa (TEST_MODE=1), jotta se
 * lähettää jaon tiedot (testDealRecord) jaon päätyttyä.
 *
 * Toimii sekä Nodessa (require) että selaimessa (window.Simulaattori).
 * Yhteyden avaava funktio annetaan asetuksissa (connect), joten moduuli ei
 * itse riipu socket.io-clientin lataustavasta.
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('./tarkistimet'));
    } else {
        root.Simulaattori = factory(root.Tarkistimet);
    }
}(typeof self !== 'undefined' ? self : this, function (T) {
    'use strict';

    const POSITIONS = T.POSITIONS;
    const SUITS = T.SUITS;
    const RANKS = T.RANKS;
    const STRAINS = ['C', 'D', 'H', 'S', 'N'];
    const MINI_STRAINS = ['S', 'H', 'D', 'C', 'N'];

    const STYLES = {
        random: 'Satunnainen',
        passer: 'Passaaja',
        doubler: 'Kahdentaja',
        climber: 'Kiipeäjä',
        aborter: 'Keskeyttäjä'
    };
    const MIXED_WEIGHTS = [['random', 0.45], ['passer', 0.12], ['doubler', 0.16], ['climber', 0.17], ['aborter', 0.10]];

    const MODES = {
        bridge: 'Bridge',
        minibridge: 'Minibridge',
        declarerPractice: 'Pelinviejäharjoitus'
    };

    const DEFAULTS = {
        configs: [0, 1, 2, 3],
        deals: 100,
        parallel: 4,
        mode: 'bridge',
        practiceType: 'mixed',
        style: 'mixed',
        illegal: true,
        illegalRate: 0.04,
        // Kokeillaanko myös laittomia siirtoja, jotka on merkitty palvelimen
        // tunnetuiksi ongelmiksi (knownIssue). Nyt tällaisia ei ole.
        tryKnownIssues: true,
        abortRate: 0.12,
        seats: 'vaihtele',
        dealsPerTable: 10,
        stallMs: 30000,
        // Robottien laskenta voi varata palvelimen sekunneiksi, joten vastausta
        // odotetaan pitkään; todellinen vastausaika tallentuu yritykseen.
        responseMs: 15000,
        seed: null
    };

    // ---------- Apufunktiot ----------

    function mulberry32(seed) {
        let a = seed >>> 0;
        return function () {
            a = (a + 0x6D2B79F5) >>> 0;
            let t = a;
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    const now = () => Date.now();
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const pick = (rng, list) => list[Math.floor(rng() * list.length)];
    const sideOf = T.sideOf;
    const nextPos = T.nextPos;

    function weighted(rng, pairs) {
        let x = rng() * pairs.reduce((a, p) => a + p[1], 0);
        for (const [value, w] of pairs) {
            if ((x -= w) < 0) return value;
        }
        return pairs[pairs.length - 1][0];
    }

    function cloneHand(hand) {
        const out = {};
        for (const s of SUITS) out[s] = [...((hand || {})[s] || [])];
        return out;
    }

    function combinations(list, k) {
        if (k === 0) return [[]];
        if (list.length < k) return [];
        const [first, ...rest] = list;
        return combinations(rest, k - 1).map(c => [first, ...c]).concat(combinations(rest, k));
    }

    function allBids() {
        const out = [];
        for (let l = 1; l <= 7; l++) for (const s of STRAINS) out.push(`${l}${s}`);
        return out;
    }
    const ALL_BIDS = allBids();
    const bidIndex = (b) => ALL_BIDS.indexOf(b);

    function highestBidOf(history) {
        let h = null;
        for (const b of history) if (!['P', 'X', 'XX'].includes(b.bid)) h = b.bid;
        return h;
    }

    function higherBids(history) {
        const h = highestBidOf(history);
        return ALL_BIDS.slice(h ? bidIndex(h) + 1 : 0);
    }

    /** Ihmisen paikkayhdistelmät kokoonpanolle (robottien määrä). */
    function seatLayouts(robots, seatsOption) {
        const humans = 4 - robots;
        if (seatsOption && seatsOption !== 'vaihtele') {
            const fixed = Array.isArray(seatsOption) ? seatsOption : seatsOption[robots];
            if (fixed && fixed.length === humans) return [fixed];
        }
        // Etelä mukana ensin, jotta tavallisin tilanne (oma paikka etelässä)
        // tulee testatuksi heti ensimmäisissä pöydissä
        const combos = combinations(['south', 'north', 'west', 'east'], humans);
        return combos.sort((a, b) => (b.includes('south') ? 1 : 0) - (a.includes('south') ? 1 : 0));
    }

    // ---------- Ajo ----------

    function createRun(userOptions) {
        const options = Object.assign({}, DEFAULTS, userOptions || {});
        if (options.seed === null || options.seed === undefined || options.seed === '') {
            options.seed = Math.floor(Math.random() * 1e9);
        }
        options.seed = Number(options.seed) >>> 0;
        if (typeof options.connect !== 'function') throw new Error('connect-funktio puuttuu asetuksista');

        const run = {
            options,
            startedAt: null,
            finishedAt: null,
            stopping: false,
            findings: [],
            summary: {},
            tables: [],
            tablesRunning: 0,
            listeners: options
        };

        for (const robots of options.configs) {
            run.summary[robots] = {
                robots,
                target: options.deals,
                deals: 0, allPassed: 0, abandoned: 0, miniRedeals: 0, stalled: 0,
                doubled: 0, redoubled: 0, slams: 0, humanControlsRobot: 0,
                illegalAttempts: 0,
                errors: 0, known: 0,
                totalDealMs: 0, timedDeals: 0
            };
        }

        run.start = () => startRun(run);
        run.stop = () => { run.stopping = true; emitProgress(run, 'Pysäytetään: pelataan meneillään olevat jaot loppuun.'); };
        run.report = () => buildReport(run);
        return run;
    }

    function emitProgress(run, text, extra) {
        if (typeof run.options.onProgress === 'function') {
            run.options.onProgress(Object.assign({ text, summary: run.summary, tablesRunning: run.tablesRunning }, extra || {}));
        }
    }

    async function startRun(run) {
        const o = run.options;
        run.startedAt = now();
        const rng = mulberry32(o.seed);

        // Jaetaan jaot pöytiin: kukin pöytä pelaa enintään dealsPerTable jakoa
        // yhdellä paikkayhdistelmällä, ja yhdistelmät vaihtuvat pöydittäin.
        // Jumittuneen pöydän loput jaot lisätään jonoon uudeksi pöydäksi.
        const queue = run.queue = [];
        for (const robots of o.configs) {
            const layouts = seatLayouts(robots, o.seats);
            let left = o.deals;
            let i = 0;
            while (left > 0) {
                const n = Math.min(o.dealsPerTable, left);
                const humanSeats = layouts[i % layouts.length];
                queue.push({
                    robots,
                    deals: n,
                    humanSeats,
                    creator: pick(rng, humanSeats),
                    seed: Math.floor(rng() * 4294967296)
                });
                left -= n;
                i++;
            }
        }

        emitProgress(run, `Ajo alkaa. Siemen ${o.seed}, ${queue.length} pöytää.`);

        let next = 0;
        const worker = async () => {
            while (next < queue.length && !run.stopping) {
                const spec = queue[next++];
                spec.index = next;
                run.tablesRunning++;
                try {
                    await runTable(run, spec);
                } catch (err) {
                    addFinding(run, spec, null, {
                        check: 'Palvelimen virheet',
                        severity: 'error',
                        message: `Pöytää ei voitu pelata: ${err && err.message}`
                    });
                } finally {
                    run.tablesRunning--;
                }
            }
        };
        const workers = [];
        for (let i = 0; i < Math.max(1, o.parallel); i++) workers.push(worker());
        await Promise.all(workers);

        run.finishedAt = now();
        emitProgress(run, run.stopping ? 'Ajo pysäytettiin.' : 'Ajo valmis.', { finished: true });
        return buildReport(run);
    }

    function addFinding(run, spec, deal, f) {
        const s = run.summary[spec.robots];
        if (f.severity === 'known') s.known++;
        else s.errors++;
        const finding = {
            robots: spec.robots,
            mode: run.options.mode,
            table: spec.code || null,
            humanSeats: spec.humanSeats,
            creator: spec.creator,
            dealNumber: deal && deal.record ? deal.record.dealNumber : (deal && deal.start ? deal.start.data.dealNumber : null),
            check: f.check,
            severity: f.severity,
            message: f.message,
            deal: deal ? compactDeal(deal, spec) : null
        };
        run.findings.push(finding);
        if (typeof run.options.onFinding === 'function') run.options.onFinding(finding);
    }

    function compactDeal(deal, spec) {
        const r = deal.record || {};
        const creatorEvents = (deal.clientEvents[spec.creator] || []).map(e => ({ t: e.t, event: e.event, data: e.data }));
        return {
            outcome: deal.outcome,
            dealNumber: r.dealNumber,
            dealer: r.dealer,
            vulnerable: r.vulnerable,
            hands: r.hands,
            bidHistory: r.bidHistory,
            contract: r.contract,
            declarer: r.declarer,
            dummy: r.dummy,
            playedCards: r.playedCards,
            seatTypes: spec.seatTypes,
            attempts: deal.attempts,
            emissions: deal.emissions,
            events: creatorEvents
        };
    }

    // ---------- Yksi pöytä ----------

    async function runTable(run, spec) {
        const o = run.options;
        const rng = mulberry32(spec.seed);
        spec.seatTypes = {};
        for (const p of POSITIONS) spec.seatTypes[p] = spec.humanSeats.includes(p) ? 'human' : 'robot';

        const tr = {
            run, spec, rng,
            code: null,
            clients: {},
            deals: [],
            counted: 0,
            done: false,
            lastEventAt: now(),
            checkChain: Promise.resolve(),
            checkedUpTo: -1,
            ctx: null,
            finish: null
        };
        const table = {
            mode: o.mode,
            creator: spec.creator,
            humanSeats: spec.humanSeats,
            seatTypes: spec.seatTypes
        };
        tr.table = table;
        tr.ctx = T.createTableContext(table);

        const finished = new Promise(resolve => { tr.finish = resolve; });

        // Yhteydet
        for (const seat of spec.humanSeats) {
            tr.clients[seat] = createClient(tr, seat, seat === spec.creator);
        }
        try {
            await Promise.all(Object.values(tr.clients).map(c => waitConnected(c, 10000)));

            // Pöydän luonti ja paikat
            const creator = tr.clients[spec.creator];
            creator.socket.emit('createTable', {
                playerName: creator.name,
                position: spec.creator,
                tableName: `Testi ${spec.robots} robottia`,
                gameMode: o.mode,
                practiceType: o.practiceType
            });
            const created = await waitFor(creator, ev => ev.event === 'tableCreated' || ev.event === 'error', 10000, 'pöydän luonti');
            if (created.event === 'error') throw new Error(`createTable: ${created.data && created.data.message}`);
            tr.code = created.data.tableCode;
            spec.code = tr.code;

            for (const seat of spec.humanSeats) {
                if (seat === spec.creator) continue;
                const c = tr.clients[seat];
                const from = c.allEvents.length;
                c.socket.emit('selectPosition', { tableCode: tr.code, position: seat, playerName: c.name });
                const info = await waitFor(c, ev => ev.event === 'tableInfo' || ev.event === 'error', 10000, `paikka ${seat}`, from);
                if (info.event === 'error') throw new Error(`selectPosition ${seat}: ${info.data && info.data.message}`);
            }

            emitProgress(run, `Pöytä ${tr.code} (${spec.robots} robottia, ihmiset ${spec.humanSeats.join(', ')}) aloittaa.`);
            tr.lastEventAt = now();
            creator.socket.emit('startGame', { tableCode: tr.code });

            // Jumittumisen vahti
            const watchdog = setInterval(() => {
                if (tr.done) return;
                if (now() - tr.lastEventAt > o.stallMs) markStalled(tr);
            }, 1000);

            await finished;
            clearInterval(watchdog);
            await tr.checkChain;

            const left = spec.deals - tr.counted;
            if (tr.stalled && left > 0 && !run.stopping) {
                run.queue.push({
                    robots: spec.robots,
                    deals: left,
                    humanSeats: spec.humanSeats,
                    creator: spec.creator,
                    seed: Math.floor(rng() * 4294967296),
                    replacementFor: tr.code
                });
                emitProgress(run, `Pöytä ${tr.code} jumittui. Loput ${left} jakoa pelataan uudessa pöydässä.`);
            }
        } finally {
            tr.done = true;
            for (const c of Object.values(tr.clients)) {
                try { if (tr.code) c.socket.emit('leaveTable'); } catch (e) { /* yhteys jo poikki */ }
            }
            await sleep(50);
            for (const c of Object.values(tr.clients)) {
                if (c.actTimer) clearTimeout(c.actTimer);
                try { c.socket.close(); } catch (e) { /* ohitetaan */ }
            }
        }
    }

    function createClient(tr, seat, isCreator) {
        const socket = tr.run.options.connect(tr.run.options.url);
        const c = {
            seat,
            isCreator,
            name: `Testi-${seat}`,
            socket,
            rng: mulberry32(Math.floor(tr.rng() * 4294967296)),
            allEvents: [],
            waiters: [],
            dealIndex: -1,
            st: freshState(),
            style: 'random',
            queue: Promise.resolve(),
            actTimer: null,
            lastActedKey: null,
            pendingAttempt: null,
            lastLegal: null,
            sent: [],
            connected: false
        };
        socket.on('connect', () => { c.connected = true; });
        socket.onAny((event, data) => onEvent(tr, c, event, data));
        return c;
    }

    function waitConnected(c, ms) {
        if (c.connected || c.socket.connected) return Promise.resolve();
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error(`Yhteys palvelimeen epäonnistui (${c.seat})`)), ms);
            c.socket.once('connect', () => { clearTimeout(timer); resolve(); });
            c.socket.once('connect_error', (err) => { clearTimeout(timer); reject(new Error(`Yhteysvirhe: ${err && err.message}`)); });
        });
    }

    function waitFor(c, test, ms, what, from = 0) {
        const found = c.allEvents.slice(from).find(test);
        if (found) return Promise.resolve(found);
        return new Promise((resolve, reject) => {
            const w = { test, resolve, timer: null };
            w.timer = setTimeout(() => {
                c.waiters = c.waiters.filter(x => x !== w);
                reject(new Error(`Aikakatkaisu: ${what}`));
            }, ms);
            c.waiters.push(w);
        });
    }

    function freshState() {
        return {
            phase: null,
            dealer: null,
            bidHistory: [],
            currentBidder: null,
            contract: null,
            declarer: null,
            dummy: null,
            trump: null,
            currentPlayer: null,
            trickLen: 0,
            tricksDone: 0,
            plays: 0,
            known: {},
            ownBids: 0
        };
    }

    // ---------- Tapahtumat ----------

    function onEvent(tr, c, event, data) {
        const ev = { t: now(), event, data };
        c.allEvents.push(ev);
        for (const w of [...c.waiters]) {
            if (w.test(ev)) {
                clearTimeout(w.timer);
                c.waiters = c.waiters.filter(x => x !== w);
                w.resolve(ev);
            }
        }
        tr.lastEventAt = ev.t;

        // Jaon raja: jokainen asiakas laskee jakonsa itse, joten k:s jako on
        // sama kaikille, vaikka viestit saapuvat eri yhteyksille eri tahtiin.
        // Kun pöytä on valmis, uusia jakoja ei enää kirjata, mutta viimeisen
        // jaon myöhässä saapuvat viestit kirjataan vielä tarkistusta varten.
        if (event === 'gameStarted' || event === 'newDealStarted' || event === 'miniRedeal') {
            if (tr.done) {
                c.dealIndex = -1;
                return;
            }
            c.dealIndex++;
            const deal = ensureDeal(tr, c.dealIndex);
            if (event === 'miniRedeal') {
                if (!deal.redealEvent) deal.redealEvent = ev;
                deal.kind = 'miniRedeal';
            } else if (!deal.start) {
                deal.start = ev;
                deal.startedAt = ev.t;
            }
            c.st = freshState();
            if (event !== 'miniRedeal') startDealForClient(tr, c, deal, data);
        }

        const deal = c.dealIndex >= 0 ? tr.deals[c.dealIndex] : null;
        if (deal) deal.clientEvents[c.seat].push(ev);

        // Laittoman siirron vastaus
        if (c.pendingAttempt) {
            const result = c.pendingAttempt.match(event, data);
            if (result) {
                const p = c.pendingAttempt;
                c.pendingAttempt = null;
                p.resolve({ result, message: data && data.message });
            }
        }

        if (event === 'error' && deal) {
            // Hylätyn jaon aikana lähetetty siirto voi saapua palvelimelle vasta
            // uuden jaon alettua, jolloin sen hylkääminen on oikein. Uuden jaon
            // ensimmäinen siirto on silloin usein jo lähetetty, joten vanha
            // siirto etsitään lähetyslokista eikä viimeisestä siirrosta.
            const stale = c.justResolvedError ? null : [...c.sent].reverse().find(s => {
                if (s.answered || s.dealIndex === c.dealIndex || now() - s.t > 5000) return false;
                const prev = tr.deals[s.dealIndex];
                return !!prev && (prev.outcome === 'abandoned' || prev.abortRequested);
            });
            if (stale) {
                stale.answered = true;
                deal.staleRejections = (deal.staleRejections || 0) + 1;            }
            if (!c.justResolvedError && !stale) {
                deal.unexpectedErrors.push({
                    seat: c.seat,
                    action: c.lastLegal ? c.lastLegal.desc : '(ei siirtoa)',
                    message: data && data.message
                });
            }
        }
        c.justResolvedError = false;

        updateState(tr, c, event, data);

        if (event === 'testDealRecord' && deal) {
            if (!deal.record) deal.record = data;
            if (c.isCreator && !tr.done) onDealRecord(tr, deal, data);
        }

        if (tr.done) return;
        if (c.isCreator && deal) maybeAbort(tr, c, deal);
        scheduleAct(tr, c);
    }

    function ensureDeal(tr, index) {
        if (!tr.deals[index]) {
            const clientEvents = {};
            for (const seat of tr.spec.humanSeats) clientEvents[seat] = [];
            tr.deals[index] = {
                index,
                kind: 'deal',
                start: null,
                redealEvent: null,
                startedAt: now(),
                clientEvents,
                emissions: [],
                attempts: [],
                unexpectedErrors: [],
                clientViolations: [],
                record: null,
                outcome: null,
                miniChoice: null,
                abortAt: null,
                abortRequested: false
            };
        }
        return tr.deals[index];
    }

    function startDealForClient(tr, c, deal, data) {
        const o = tr.run.options;
        c.style = o.style === 'mixed' ? weighted(c.rng, MIXED_WEIGHTS) : o.style;
        c.lastActedKey = null;
        if (c.isCreator && deal.abortAt === null) {
            const aborting = c.style === 'aborter' && c.rng() < Math.max(o.abortRate * 4, 0.3);
            deal.abortAt = aborting ? 1 + Math.floor(c.rng() * 45) : -1;
        }
    }

    function updateState(tr, c, event, data) {
        const st = c.st;
        switch (event) {
            case 'gameStarted':
            case 'newDealStarted': {
                const gs = data.gameState || {};
                st.phase = gs.gamePhase;
                st.dealer = data.dealer;
                st.bidHistory = (data.biddingState && data.biddingState.bidHistory) || [];
                st.currentBidder = data.biddingState ? data.biddingState.currentBidder : null;
                st.declarer = gs.declarer || null;
                st.dummy = gs.dummy || null;
                break;
            }
            case 'yourCards':
                st.known[data.position] = cloneHand(data.cards);
                break;
            case 'dummyRevealed':
                st.known[data.dummyPosition] = cloneHand(data.dummyCards);
                break;
            case 'declarerHandRevealed':
                st.known[data.declarerPosition] = cloneHand(data.declarerCards);
                break;
            case 'bidMade':
                st.bidHistory = (data.biddingState && data.biddingState.bidHistory) || st.bidHistory;
                st.currentBidder = data.nextBidder;
                break;
            case 'allPassed':
                st.phase = 'passed';
                break;
            case 'biddingComplete':
                st.phase = 'play';
                st.contract = data.contract;
                st.declarer = data.declarer;
                st.dummy = data.dummy;
                st.trump = data.trumpSuit || null;
                st.currentPlayer = data.currentPlayer;
                st.trickLen = 0;
                break;
            case 'cardPlayed': {
                const hand = st.known[data.position];
                if (hand && hand[data.suit]) hand[data.suit] = hand[data.suit].filter(x => x !== data.card);
                st.trickLen = (data.currentTrick || []).length;
                st.plays++;
                // Seuraava pelaaja selviää vasta nextPlayer- tai
                // trickComplete-viestistä, joka voi saapua myöhemmin
                st.currentPlayer = null;
                break;
            }
            case 'nextPlayer':
                st.currentPlayer = data.currentPlayer;
                break;
            case 'trickComplete':
                st.tricksDone = (data.tricks.ns || 0) + (data.tricks.ew || 0);
                st.trickLen = 0;
                st.currentPlayer = data.nextPlayer;
                break;
            case 'gameOver':
                st.phase = 'end';
                break;
            case 'miniRedeal':
                st.phase = 'redeal';
                break;
            default:
                break;
        }
    }

    function onDealRecord(tr, deal, record) {
        const run = tr.run;
        deal.outcome = record.reason;
        deal.finishedAt = now();
        if (record.reason !== 'miniRedeal') tr.counted++;

        queueCheck(tr, deal);

        if (record.reason === 'miniRedeal') return;
        const target = tr.spec.deals;
        if (tr.counted >= target || run.stopping) {
            finishTable(tr);
            return;
        }
        // Kaikki passasivat tai jako hylättiin: palvelin aloittaa itse uuden.
        // Hylätyn jaon jälkeen uusi on jo alkanut.
        if (record.reason === 'end' && !deal.abortRequested) {
            const creator = tr.clients[tr.spec.creator];
            setTimeout(() => {
                if (tr.done) return;
                creator.lastLegal = { desc: 'requestNextDeal' };
                creator.socket.emit('requestNextDeal', { tableCode: tr.code });
            }, 5);
        }
    }

    function finishTable(tr) {
        if (tr.done) return;
        tr.done = true;
        tr.finish();
    }

    function markStalled(tr) {
        const creator = tr.clients[tr.spec.creator];
        const deal = creator.dealIndex >= 0 ? tr.deals[creator.dealIndex] : ensureDeal(tr, 0);
        if (!deal.outcome) {
            deal.outcome = 'stalled';
            deal.stallMs = now() - tr.lastEventAt;
            const state = {};
            for (const c of Object.values(tr.clients)) {
                state[c.seat] = {
                    phase: c.st.phase,
                    currentBidder: c.st.currentBidder,
                    currentPlayer: c.st.currentPlayer,
                    trickLen: c.st.trickLen,
                    tricksDone: c.st.tricksDone,
                    plays: c.st.plays,
                    bids: c.st.bidHistory.length,
                    pendingAttempt: !!c.pendingAttempt
                };
            }
            deal.stallState = state;
            tr.stalled = true;
            tr.counted++;
            queueCheck(tr, deal);
        }
        finishTable(tr);
    }

    /**
     * Tarkistetaan jaot järjestyksessä. Odotetaan hetki, että kaikki
     * ihmispelaajat ovat saaneet jaon viimeiset viestit.
     */
    function queueCheck(tr, deal) {
        tr.checkChain = tr.checkChain.then(async () => {
            const start = now();
            while (now() - start < 1500 && deal.outcome !== 'stalled') {
                const ready = tr.spec.humanSeats.every(seat =>
                    deal.clientEvents[seat].some(e => e.event === 'testDealRecord'));
                if (ready) break;
                await sleep(10);
            }
            await sleep(20); // mahdolliset viimeiset virheviestit
            runChecks(tr, deal);
        }).catch(err => {
            addFinding(tr.run, tr.spec, deal, { check: 'Palvelimen virheet', severity: 'error', message: `Tarkistin kaatui: ${err && err.stack || err}` });
        });
    }

    function runChecks(tr, deal) {
        const run = tr.run;
        const s = run.summary[tr.spec.robots];
        const findings = T.checkDeal(deal, tr.ctx);
        for (const f of findings) addFinding(run, tr.spec, deal, f);
        const cov = T.coverageOf(deal, tr.table);
        for (const k of Object.keys(cov)) if (typeof s[k] === 'number') s[k] += cov[k];
        if (deal.outcome !== 'miniRedeal' && deal.startedAt && deal.finishedAt) {
            s.totalDealMs += deal.finishedAt - deal.startedAt;
            s.timedDeals++;
        }
        if (deal.outcome !== 'miniRedeal') {
            const errs = findings.filter(f => f.severity === 'error').length;
            const label = `${tr.spec.robots} robottia: ${s.deals}/${s.target} jakoa, ${s.errors} virhettä`;
            emitProgress(run, label, { robots: tr.spec.robots, dealDone: true, newErrors: errs });
        }
    }

    // ---------- Keskeyttäjä ----------

    function maybeAbort(tr, c, deal) {
        if (deal.abortRequested || deal.abortAt === null || deal.abortAt < 0 || deal.outcome) return;
        if (c.st.phase === 'end' || c.st.phase === 'passed' || c.st.phase === 'redeal') return;
        const progress = c.st.bidHistory.length + c.st.plays;
        if (progress < deal.abortAt) return;
        deal.abortRequested = true;
        c.lastLegal = { desc: 'requestNextDeal kesken jaon' };
        deal.emissions.push({ t: now(), seat: c.seat, event: 'requestNextDeal', data: { tableCode: tr.code }, legal: true });
        c.socket.emit('requestNextDeal', { tableCode: tr.code });
    }

    // ---------- Vuorot ----------

    function controllerOf(tr, st, handToPlay) {
        const types = tr.spec.seatTypes;
        if (st.declarer && st.dummy && types[st.declarer] === 'robot' && types[st.dummy] === 'human' &&
            (handToPlay === st.declarer || handToPlay === st.dummy)) {
            return st.dummy;
        }
        if (handToPlay === st.dummy) return st.declarer;
        return handToPlay;
    }

    function decideAction(tr, c) {
        const st = c.st;
        const mode = tr.run.options.mode;
        if (st.phase === 'bidding' && mode === 'bridge' && st.currentBidder === c.seat) {
            return { kind: 'bid', key: `b${st.bidHistory.length}` };
        }
        if (st.phase === 'contract' && mode === 'minibridge') {
            const types = tr.spec.seatTypes;
            const controller = types[st.declarer] === 'robot' && types[st.dummy] === 'human' ? st.dummy : st.declarer;
            if (controller === c.seat) return { kind: 'mini', key: 'mini' };
        }
        if (st.phase === 'play' && st.trickLen < 4 && st.tricksDone < 12 && st.currentPlayer &&
            controllerOf(tr, st, st.currentPlayer) === c.seat) {
            return { kind: 'play', hand: st.currentPlayer, key: `p${st.plays}` };
        }
        return null;
    }

    function scheduleAct(tr, c) {
        if (c.actTimer || tr.done) return;
        c.actTimer = setTimeout(() => {
            c.actTimer = null;
            c.queue = c.queue.then(() => act(tr, c)).catch(err => {
                const deal = tr.deals[c.dealIndex];
                if (deal) deal.clientViolations.push({ check: 'control', message: `Simuloitu pelaaja ${c.seat} kaatui: ${err && err.message}` });
            });
        }, 1);
    }

    async function act(tr, c) {
        if (tr.done || c.pendingAttempt) return;
        const deal = tr.deals[c.dealIndex];
        if (!deal || deal.outcome) return;
        let action = decideAction(tr, c);
        if (!action) return;
        const actKey = `${c.dealIndex}:${action.key}`;
        if (c.lastActedKey === actKey) return;

        // Palvelin lähettää lepääjän kortit vasta nextPlayer-viestin jälkeen,
        // joten ohjattava käsi voi puuttua hetken. Odotetaan sitä ennen kuin
        // tehdään mitään (myös laiton kokeilu tarvitsee käden tiedot).
        if (action.kind === 'play' && !c.st.known[action.hand]) {
            if (!c.handWait || c.handWait.key !== actKey) c.handWait = { key: actKey, since: now(), reported: false };
            if (now() - c.handWait.since > 3000) {
                if (!c.handWait.reported) {
                    c.handWait.reported = true;
                    deal.clientViolations.push({
                        check: 'privacy',
                        message: `${c.seat} ohjaa kättä ${action.hand}, mutta ei ole saanut sen kortteja`
                    });
                }
                return;
            }
            setTimeout(() => scheduleAct(tr, c), 50);
            return;
        }

        const o = tr.run.options;
        if (o.illegal && c.rng() < o.illegalRate) {
            await tryIllegal(tr, c, deal, action);
            if (tr.done || deal.outcome) return;
            action = decideAction(tr, c);
            if (!action || `${c.dealIndex}:${action.key}` !== actKey) return; // laiton siirto hyväksyttiin vuoron siirtona
        }
        c.lastActedKey = actKey;

        if (action.kind === 'bid') {
            const bid = chooseBid(c);
            send(tr, c, deal, 'makeBid', { tableCode: tr.code, position: c.seat, bid }, `tarjous ${bid}`);
            if (!['P', 'X', 'XX'].includes(bid)) c.st.ownBids++;
        } else if (action.kind === 'mini') {
            const type = c.rng() < 0.5 ? 'game' : 'partscore';
            const strain = pick(c.rng, MINI_STRAINS);
            deal.miniChoice = { type, strain };
            send(tr, c, deal, 'chooseMiniContract', { tableCode: tr.code, type, strain }, `minibridgen sopimus ${type} ${strain}`);
        } else if (action.kind === 'play') {
            const card = chooseCard(tr, c, deal, action.hand);
            if (!card) return;
            send(tr, c, deal, 'playCard', { tableCode: tr.code, position: action.hand, suit: card.suit, card: card.card }, `kortti ${action.hand} ${card.suit} ${card.card}`);
        }
    }

    function logSent(c, desc) {
        const entry = { desc, t: now(), dealIndex: c.dealIndex, answered: false };
        c.sent.push(entry);
        if (c.sent.length > 30) c.sent.shift();
        return entry;
    }

    function send(tr, c, deal, event, data, desc) {
        c.lastLegal = { desc, t: now(), dealIndex: c.dealIndex };
        logSent(c, desc);
        deal.emissions.push({ t: now(), seat: c.seat, event, data, legal: true });
        c.socket.emit(event, data);
    }

    // ---------- Tarjoustyylit ----------

    function legalCalls(c) {
        const history = c.st.bidHistory;
        const calls = { bids: higherBids(history), X: false, XX: false };
        calls.X = T.callError(history, c.seat, 'X') === null;
        calls.XX = T.callError(history, c.seat, 'XX') === null;
        return calls;
    }

    function stepBid(c, bids, maxStep) {
        if (!bids.length) return 'P';
        const step = Math.floor(Math.pow(c.rng(), 2) * Math.min(maxStep, bids.length));
        return bids[step];
    }

    function chooseBid(c) {
        const rng = c.rng;
        const calls = legalCalls(c);
        const history = c.st.bidHistory;
        const anyBid = !!highestBidOf(history);
        const highLevel = anyBid ? parseInt(highestBidOf(history).charAt(0), 10) : 0;

        switch (c.style) {
            case 'passer':
                return 'P';
            case 'doubler':
                if (calls.XX) return 'XX';
                if (calls.X) return 'X';
                if (!anyBid || rng() < 0.4) return stepBid(c, calls.bids, 2);
                return 'P';
            case 'climber':
                if (c.st.ownBids >= 2 || !calls.bids.length) return 'P';
                if (rng() < 0.35) {
                    const slams = calls.bids.filter(b => b.charAt(0) === '6' || b.charAt(0) === '7');
                    if (slams.length) return pick(rng, slams.slice(0, 6));
                }
                return stepBid(c, calls.bids, 4);
            default: {
                if (calls.XX && rng() < 0.08) return 'XX';
                if (calls.X && rng() < 0.07) return 'X';
                const passChance = highLevel >= 5 ? 0.85 : anyBid ? 0.55 : 0.4;
                if (rng() < passChance || !calls.bids.length) return 'P';
                return stepBid(c, calls.bids, 6);
            }
        }
    }

    // ---------- Kortin valinta ----------

    function legalCardsFor(st, hand) {
        const h = st.known[hand];
        if (!h) return null;
        const cards = [];
        for (const s of SUITS) for (const card of h[s] || []) cards.push({ suit: s, card });
        return cards;
    }

    function chooseCard(tr, c, deal, handToPlay) {
        const st = c.st;
        const all = legalCardsFor(st, handToPlay);
        if (!all || !all.length) return null;
        const lastTrick = currentTrickFromEvents(c, deal);
        let legal = all;
        if (lastTrick.length > 0 && lastTrick.length < 4) {
            const lead = lastTrick[0].suit;
            const follow = all.filter(x => x.suit === lead);
            if (follow.length) legal = follow;
        }
        return pick(c.rng, legal);
    }

    function currentTrickFromEvents(c, deal) {
        const events = deal.clientEvents[c.seat];
        for (let i = events.length - 1; i >= 0; i--) {
            const e = events[i];
            if (e.event === 'trickComplete' || e.event === 'biddingComplete') return [];
            if (e.event === 'cardPlayed') {
                const t = e.data.currentTrick || [];
                return t.length === 4 ? [] : t;
            }
        }
        return [];
    }

    // ---------- Laittomat siirrot ----------

    function randomCardNotIn(c, hand) {
        const h = hand || {};
        const options = [];
        for (const s of SUITS) for (const r of RANKS) if (!(h[s] || []).includes(r)) options.push({ suit: s, card: r });
        return pick(c.rng, options);
    }

    function illegalCandidates(tr, c, deal, action) {
        const st = c.st;
        const out = [];
        const code = tr.code;
        if (action.kind === 'bid') {
            const high = highestBidOf(st.bidHistory);
            if (high) {
                const lower = ALL_BIDS.slice(0, bidIndex(high) + 1);
                const bid = pick(c.rng, lower);
                out.push({ event: 'makeBid', data: { tableCode: code, position: c.seat, bid }, description: `liian matala tarjous ${bid} (korkein ${high})`, target: c.seat });
            }
            const other = nextPos(c.seat);
            out.push({ event: 'makeBid', data: { tableCode: code, position: other, bid: 'P' }, description: `tarjous toisen pelaajan (${other}) paikalta`, target: other });
            const own = legalCardsFor(st, c.seat);
            if (own && own.length) {
                const card = pick(c.rng, own);
                out.push({ event: 'playCard', data: { tableCode: code, position: c.seat, suit: card.suit, card: card.card }, description: 'kortti tarjousvaiheessa', target: c.seat });
            }
            if (T.callError(st.bidHistory, c.seat, 'X')) {
                out.push({ event: 'makeBid', data: { tableCode: code, position: c.seat, bid: 'X' }, description: `kahdennus ilman vastustajan tarjousta (${st.bidHistory.map(b => b.bid).join(' ') || 'ei tarjouksia'})`, target: c.seat });
            }
            if (T.callError(st.bidHistory, c.seat, 'XX')) {
                out.push({ event: 'makeBid', data: { tableCode: code, position: c.seat, bid: 'XX' }, description: `vastakahdennus ilman vastustajan kahdennusta (${st.bidHistory.map(b => b.bid).join(' ') || 'ei tarjouksia'})`, target: c.seat });
            }
        } else if (action.kind === 'play') {
            const hand = action.hand;
            const known = st.known[hand];
            const missing = randomCardNotIn(c, known);
            // Kortti, jota ei ole pelattu eikä ole kädessä
            if (missing) out.push({ event: 'playCard', data: { tableCode: code, position: hand, suit: missing.suit, card: missing.card }, description: `kortti ${missing.suit} ${missing.card}, jota ei ole kädessä ${hand}`, target: hand });
            const trick = currentTrickFromEvents(c, deal);
            if (known && trick.length > 0 && trick.length < 4) {
                const lead = trick[0].suit;
                if ((known[lead] || []).length) {
                    const others = SUITS.filter(s => s !== lead && (known[s] || []).length);
                    if (others.length) {
                        const s = pick(c.rng, others);
                        const card = pick(c.rng, known[s]);
                        out.push({ event: 'playCard', data: { tableCode: code, position: hand, suit: s, card }, description: `maan ${lead} seuraamatta jättäminen (${s} ${card})`, target: hand });
                    }
                }
            }
            const other = nextPos(hand);
            const oc = randomCardNotIn(c, {});
            out.push({ event: 'playCard', data: { tableCode: code, position: other, suit: oc.suit, card: oc.card }, description: `kortti väärällä vuorolla paikalta ${other}`, target: other });
            out.push({ event: 'makeBid', data: { tableCode: code, position: c.seat, bid: 'P' }, description: 'tarjous pelivaiheessa', target: c.seat });
        } else if (action.kind === 'mini') {
            out.push({ event: 'chooseMiniContract', data: { tableCode: code, type: 'game', strain: 'Z' }, description: 'tuntematon minibridgen sopimusmaa', target: c.seat });
            out.push({ event: 'makeBid', data: { tableCode: code, position: c.seat, bid: '1C' }, description: 'tarjous minibridgessä', target: c.seat });
        }
        return out;
    }

    function acceptanceMatcher(attempt) {
        const d = attempt.data;
        return (event, data) => {
            if (event === 'error') return 'rejected';
            if (attempt.event === 'makeBid') {
                if ((event === 'bidMade' || event === 'allPassed') && data.position === d.position && data.bid === d.bid) return 'accepted';
                if (event === 'biddingComplete' && d.bid === 'P') return 'accepted';
            }
            if (attempt.event === 'playCard' && event === 'cardPlayed' &&
                data.position === d.position && data.suit === d.suit && data.card === d.card) return 'accepted';
            if (attempt.event === 'chooseMiniContract' && event === 'biddingComplete') return 'accepted';
            return null;
        };
    }

    async function tryIllegal(tr, c, deal, action) {
        const candidates = illegalCandidates(tr, c, deal, action)
            .filter(a => tr.run.options.tryKnownIssues || !a.knownIssue);
        if (!candidates.length) return;
        const attempt = pick(c.rng, candidates);
        const entry = {
            seat: c.seat,
            event: attempt.event,
            data: attempt.data,
            description: attempt.description,
            knownIssue: !!attempt.knownIssue,
            result: null,
            message: null
        };
        deal.attempts.push(entry);
        deal.emissions.push({ t: now(), seat: c.seat, event: attempt.event, data: attempt.data, legal: false });
        const sentEntry = logSent(c, attempt.description);
        const sentAt = now();
        const outcome = await new Promise(resolve => {
            const timer = setTimeout(() => {
                if (c.pendingAttempt && c.pendingAttempt.resolve === done) c.pendingAttempt = null;
                resolve({ result: 'noResponse' });
            }, tr.run.options.responseMs);
            function done(v) { clearTimeout(timer); resolve(v); }
            c.pendingAttempt = { match: acceptanceMatcher(attempt), resolve: (v) => { c.justResolvedError = v.result === 'rejected'; done(v); } };
            c.socket.emit(attempt.event, attempt.data);
        });
        entry.result = outcome.result;
        entry.message = outcome.message || null;
        entry.responseMs = now() - sentAt;
        if (outcome.result !== 'noResponse') sentEntry.answered = true;
    }

    // ---------- Raportti ----------

    function buildReport(run) {
        const summary = Object.values(run.summary).map(s => Object.assign({}, s, {
            averageDealMs: s.timedDeals ? Math.round(s.totalDealMs / s.timedDeals) : null
        }));
        const errors = run.findings.filter(f => f.severity === 'error').length;
        const known = run.findings.filter(f => f.severity === 'known').length;
        const o = run.options;
        return {
            tool: 'Bridgen testityökalu',
            version: 1,
            options: {
                url: o.url, configs: o.configs, deals: o.deals, parallel: o.parallel, mode: o.mode,
                practiceType: o.practiceType, style: o.style, illegal: o.illegal, seats: o.seats,
                dealsPerTable: o.dealsPerTable, seed: o.seed
            },
            startedAt: run.startedAt ? new Date(run.startedAt).toISOString() : null,
            finishedAt: run.finishedAt ? new Date(run.finishedAt).toISOString() : null,
            durationMs: run.startedAt ? (run.finishedAt || now()) - run.startedAt : 0,
            stopped: run.stopping,
            errors,
            known,
            summary,
            findings: run.findings
        };
    }

    return { createRun, STYLES, MODES, DEFAULTS, seatLayouts, mulberry32 };
}));
