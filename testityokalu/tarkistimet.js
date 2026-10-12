/**
 * Testityökalun tarkistimet. Puhtaita funktioita: ne saavat yhden jaon
 * tallenteen (simulaattori.js kokoaa sen) ja pöydän juoksevan tilan ja
 * palauttavat löydetyt poikkeamat. Säännöt on kirjoitettu tähän omina
 * toteutuksinaan eikä kopioitu server.js:stä, jotta palvelimen virhe ei
 * toistu tarkistimessa.
 *
 * Toimii sekä Nodessa (require) että selaimessa (window.Tarkistimet).
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.Tarkistimet = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const POSITIONS = ['north', 'east', 'south', 'west'];
    const SUITS = ['spades', 'hearts', 'diamonds', 'clubs'];
    const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
    const STRAINS = ['C', 'D', 'H', 'S', 'N'];
    const TRUMP_OF = { C: 'clubs', D: 'diamonds', H: 'hearts', S: 'spades', N: null };
    const HCP = { A: 4, K: 3, Q: 2, J: 1 };
    const MINI_GAME_LEVEL = { N: 3, S: 4, H: 4, D: 5, C: 5 };
    const VULNERABILITY = [
        'None', 'NS', 'EW', 'Both', 'NS', 'EW', 'Both', 'None',
        'EW', 'Both', 'None', 'NS', 'Both', 'None', 'NS', 'EW'
    ];
    const POS_FI = { north: 'pohjoinen', east: 'itä', south: 'etelä', west: 'länsi' };

    // Tarkistusten nimet raportissa (sama järjestys kuin suunnitelmassa)
    const CHECKS = {
        bidTurns: 'Tarjousvuorot',
        playTurns: 'Pelivuorot',
        followSuit: 'Maan seuraaminen',
        cards: 'Kortit',
        trickWinner: 'Tikin voittaja',
        sameResult: 'Sama tulos kaikille',
        contract: 'Sopimus ja pelinviejä',
        score: 'Pisteet',
        privacy: 'Tietosuoja',
        control: 'Ohjausoikeus',
        dealer: 'Jakaja ja jakonumero',
        rejected: 'Hylätyt siirrot',
        stall: 'Jumittuminen',
        serverError: 'Palvelimen virheet',
        bidRules: 'Tarjoussäännöt',
        mini: 'Minibridge',
        practice: 'Pelinviejäharjoitus'
    };

    const nextPos = (p, n = 1) => POSITIONS[(POSITIONS.indexOf(p) + n) % 4];
    const partnerOf = (p) => nextPos(p, 2);
    const sideOf = (p) => (p === 'north' || p === 'south') ? 'ns' : 'ew';
    const otherSide = (s) => s === 'ns' ? 'ew' : 'ns';
    const cardKey = (c) => `${c.suit}:${c.card}`;
    const cardText = (c) => `${c.suit} ${c.card}`;
    const isCall = (b) => b === 'P' || b === 'X' || b === 'XX';
    const fi = (p) => POS_FI[p] || p;

    function vulnerabilityFor(dealNumber) {
        const n = dealNumber && dealNumber > 0 ? dealNumber : 1;
        return VULNERABILITY[(n - 1) % 16];
    }

    // Jakaja kiertää myötäpäivään: etelä, länsi, pohjoinen, itä
    function nextDealer(dealer) {
        return nextPos(dealer, 1);
    }

    function countHcp(hand) {
        return SUITS.reduce((sum, s) => sum + (hand[s] || []).reduce((a, v) => a + (HCP[v] || 0), 0), 0);
    }

    function cloneHands(hands) {
        const out = {};
        for (const p of POSITIONS) {
            out[p] = {};
            for (const s of SUITS) out[p][s] = [...((hands[p] || {})[s] || [])];
        }
        return out;
    }

    function sameHand(a, b) {
        for (const s of SUITS) {
            const x = [...((a || {})[s] || [])].sort().join(',');
            const y = [...((b || {})[s] || [])].sort().join(',');
            if (x !== y) return false;
        }
        return true;
    }

    function bidOrder(bid) {
        return (parseInt(bid.charAt(0), 10) - 1) * 5 + STRAINS.indexOf(bid.charAt(1));
    }

    /**
     * Kutsujen sallittuus oikeiden sääntöjen mukaan. Palauttaa virheviestin
     * tai null. Kahdennus on sallittu vain vastustajan tarjouksen jälkeen, ja
     * vastakahdennus vain vastustajan kahdennuksen jälkeen.
     */
    function callError(history, player, bid) {
        if (bid === 'P') return null;
        let lastBid = null;
        let lastAction = null; // viimeinen muu kuin passi
        for (const b of history) {
            if (b.bid === 'P') continue;
            lastAction = b;
            if (!isCall(b.bid)) lastBid = b;
        }
        if (bid === 'X') {
            if (!lastAction || isCall(lastAction.bid) || sideOf(lastAction.player) === sideOf(player)) {
                return 'kahdennus ilman vastustajan tarjousta tai kahdennettuun tarjoukseen';
            }
            return null;
        }
        if (bid === 'XX') {
            if (!lastAction || lastAction.bid !== 'X' || sideOf(lastAction.player) === sideOf(player)) {
                return 'vastakahdennus ilman vastustajan kahdennusta';
            }
            return null;
        }
        if (!/^[1-7][CDHSN]$/.test(bid)) return `tuntematon tarjous ${bid}`;
        if (lastBid && bidOrder(bid) <= bidOrder(lastBid.bid)) {
            return `liian matala tarjous ${bid} tarjouksen ${lastBid.bid} jälkeen`;
        }
        return null;
    }

    /**
     * Sopimus ja pelinviejä tarjoushistoriasta: viimeinen tarjous ja sen
     * jälkeiset kahdennukset. Pelinviejä on sopimuspuolen pelaaja, joka nimesi
     * sopimuksen maan ensimmäisenä.
     */
    function computeContract(history) {
        let last = null;
        let doubled = false;
        let redoubled = false;
        for (const b of history) {
            if (b.bid === 'P') continue;
            if (b.bid === 'X') {
                if (last) { doubled = true; redoubled = false; }
            } else if (b.bid === 'XX') {
                if (doubled) { redoubled = true; doubled = false; }
            } else {
                last = b;
                doubled = false;
                redoubled = false;
            }
        }
        if (!last) return null;
        const strain = last.bid.charAt(1);
        const side = sideOf(last.player);
        const first = history.find(b => !isCall(b.bid) && b.bid.charAt(1) === strain && sideOf(b.player) === side);
        const declarer = first.player;
        return {
            contract: last.bid + (redoubled ? 'XX' : doubled ? 'X' : ''),
            level: parseInt(last.bid.charAt(0), 10),
            strain,
            declarer,
            dummy: partnerOf(declarer),
            trumpSuit: TRUMP_OF[strain],
            doubled,
            redoubled
        };
    }

    function trickWinner(trick, trumpSuit) {
        const lead = trick[0].suit;
        let best = trick[0];
        for (const c of trick.slice(1)) {
            const bestTrump = trumpSuit && best.suit === trumpSuit;
            const cTrump = trumpSuit && c.suit === trumpSuit;
            if (cTrump && !bestTrump) best = c;
            else if (c.suit === best.suit && RANKS.indexOf(c.card) > RANKS.indexOf(best.card)) best = c;
            else if (!bestTrump && !cTrump && c.suit === lead && best.suit !== lead) best = c;
        }
        return best.player;
    }

    /** Pelinviejäpuolen pisteet (negatiivinen = pietti, pisteet puolustajille). */
    function scoreBridge(contract, tricks, vulnerable) {
        const level = parseInt(contract.charAt(0), 10);
        const strain = contract.charAt(1);
        const redoubled = /XX$/.test(contract);
        const doubled = !redoubled && /X$/.test(contract);
        const mult = redoubled ? 4 : doubled ? 2 : 1;
        const need = level + 6;
        if (tricks < need) {
            const down = need - tricks;
            if (mult === 1) return -down * (vulnerable ? 100 : 50);
            let p = 0;
            for (let i = 1; i <= down; i++) {
                if (vulnerable) p += i === 1 ? 200 : 300;
                else p += i === 1 ? 100 : i <= 3 ? 200 : 300;
            }
            return -p * (mult / 2);
        }
        const first = strain === 'N' ? 40 : (strain === 'S' || strain === 'H') ? 30 : 20;
        const rest = strain === 'N' ? 30 : first;
        const trickScore = (first + rest * (level - 1)) * mult;
        let score = trickScore;
        score += trickScore >= 100 ? (vulnerable ? 500 : 300) : 50;
        if (level === 6) score += vulnerable ? 750 : 500;
        if (level === 7) score += vulnerable ? 1500 : 1000;
        const over = tricks - need;
        if (mult === 1) score += over * rest;
        else score += over * (vulnerable ? 200 : 100) * (mult / 2);
        if (doubled) score += 50;
        if (redoubled) score += 100;
        return score;
    }

    /** Minibridgen pisteet: ei kahdennuksia eikä vyöhykkeitä. */
    function scoreMini(contract, tricks) {
        const level = parseInt(contract.charAt(0), 10);
        const strain = contract.charAt(1);
        const need = level + 6;
        if (tricks < need) return -50 * (need - tricks);
        const first = strain === 'N' ? 40 : (strain === 'S' || strain === 'H') ? 30 : 20;
        const rest = strain === 'N' ? 30 : first;
        const trickScore = first + rest * (level - 1);
        return trickScore + (tricks - need) * rest + (trickScore >= 100 ? 300 : 50);
    }

    /** Pöydän juokseva tila tarkistusten välillä. */
    function createTableContext(table) {
        return {
            table,
            prevDealNumber: null,
            prevDealer: null,
            prevWasMiniRedeal: false,
            totals: { ns: 0, ew: 0 },
            practicePlayed: 0
        };
    }

    // Yhden asiakkaan tapahtumat (ajallisessa järjestyksessä)
    function eventsOf(deal, seat) {
        return (deal.clientEvents && deal.clientEvents[seat]) || [];
    }

    function firstEvent(events, name) {
        return events.find(e => e.event === name);
    }

    function allEvents(events, name) {
        return events.filter(e => e.event === name);
    }

    /**
     * Tarkistaa yhden jaon. Palauttaa listan { check, severity, message }.
     * severity: 'error' tai 'known' (tunnettu ongelma, ei kaada ajoa).
     */
    function checkDeal(deal, ctx) {
        const out = [];
        const add = (check, message, severity = 'error') => out.push({ check: CHECKS[check] || check, severity, message });
        const table = ctx.table;
        const record = deal.record;
        const mode = table.mode;

        // ---------- Jumittuminen ja palvelimen virheet ----------
        if (deal.outcome === 'stalled') {
            add('stall', `Peli ei edennyt ${Math.round((deal.stallMs || 0) / 1000)} sekuntiin. Tila: ${JSON.stringify(deal.stallState || {})}`);
        }
        for (const seat of table.humanSeats) {
            for (const e of allEvents(eventsOf(deal, seat), 'dealError')) {
                add('serverError', `dealError (${fi(seat)}): ${e.data && e.data.message}`);
            }
        }
        for (const u of deal.unexpectedErrors || []) {
            add('control', `Palvelin hylkäsi laillisen siirron (${fi(u.seat)}: ${u.action}): ${u.message}`);
        }
        for (const v of deal.clientViolations || []) {
            add(v.check || 'control', v.message);
        }

        // ---------- Hylätyt siirrot ----------
        for (const a of deal.attempts || []) {
            if (a.result === 'rejected') continue;
            const known = a.knownIssue;
            const what = a.result === 'accepted'
                ? 'palvelin hyväksyi laittoman siirron'
                : 'palvelin ei vastannut laittomaan siirtoon virheellä';
            add('rejected', `${what} (${fi(a.seat)}): ${a.description}`, known ? 'known' : 'error');
        }

        if (!record) {
            if (deal.outcome !== 'stalled') add('serverError', 'Jaon tiedot (testDealRecord) puuttuvat. Onko palvelin testitilassa?');
            return out;
        }

        // ---------- Jakaja ja jakonumero ----------
        checkDealerAndNumber(deal, ctx, add);

        if (deal.outcome === 'miniRedeal') {
            checkMiniRedeal(deal, add);
            ctx.prevWasMiniRedeal = true;
            ctx.prevDealNumber = record.dealNumber;
            ctx.prevDealer = record.dealer;
            return out;
        }
        ctx.prevWasMiniRedeal = false;
        ctx.prevDealNumber = record.dealNumber;
        ctx.prevDealer = record.dealer;

        // ---------- Kortit (jako) ----------
        const hands = record.hands;
        const seen = new Set();
        for (const p of POSITIONS) {
            const n = SUITS.reduce((a, s) => a + ((hands[p] || {})[s] || []).length, 0);
            if (n !== 13) add('cards', `Kädessä ${fi(p)} on ${n} korttia, pitäisi olla 13`);
            for (const s of SUITS) {
                for (const c of (hands[p] || {})[s] || []) {
                    const k = `${s}:${c}`;
                    if (seen.has(k)) add('cards', `Kortti ${s} ${c} on jaossa kahdesti`);
                    seen.add(k);
                }
            }
        }
        if (seen.size !== 52) add('cards', `Jaossa on ${seen.size} eri korttia, pitäisi olla 52`);

        // ---------- Tietosuoja ----------
        checkPrivacy(deal, ctx, add);

        // ---------- Tarjoaminen ----------
        let contractInfo = null;
        if (mode === 'bridge') {
            contractInfo = checkBidding(deal, ctx, add);
        } else if (mode === 'minibridge') {
            contractInfo = checkMiniContract(deal, ctx, add);
        } else if (mode === 'declarerPractice') {
            contractInfo = checkPracticeContract(deal, ctx, add);
        }

        // ---------- Pelaaminen ----------
        const play = checkPlay(deal, ctx, contractInfo, add);

        // ---------- Tulos ja pisteet ----------
        if (deal.outcome === 'end') {
            checkResult(deal, ctx, contractInfo, play, add);
        }

        return out;
    }

    function checkDealerAndNumber(deal, ctx, add) {
        const r = deal.record;
        const table = ctx.table;
        const start = deal.start && deal.start.data;
        if (start) {
            if (start.dealNumber !== r.dealNumber) add('dealer', `Aloitusviestin jakonumero ${start.dealNumber}, jaon tiedoissa ${r.dealNumber}`);
            if (start.dealer !== r.dealer) add('dealer', `Aloitusviestin jakaja ${fi(start.dealer)}, jaon tiedoissa ${fi(r.dealer)}`);
        }
        const practice = table.mode === 'declarerPractice';
        // Harjoituksessa pelinviejä jakaa aina, muuten jakaja kiertää
        if (practice && r.dealer !== table.creator) {
            add('dealer', `Harjoituksessa jakajan pitäisi olla pelinviejä (${fi(table.creator)}), oli ${fi(r.dealer)}`);
        }
        if (ctx.prevDealNumber === null) {
            if (r.dealNumber !== 1) add('dealer', `Ensimmäisen jaon numero on ${r.dealNumber}, pitäisi olla 1`);
            if (!practice && r.dealer !== 'south') add('dealer', `Ensimmäisen jaon jakaja on ${fi(r.dealer)}, pitäisi olla etelä`);
        } else if (ctx.prevWasMiniRedeal) {
            if (r.dealNumber !== ctx.prevDealNumber) add('dealer', `Uusintajaon jälkeen jakonumero muuttui ${ctx.prevDealNumber} → ${r.dealNumber}`);
            if (r.dealer !== nextDealer(ctx.prevDealer)) add('dealer', `Uusintajaon jälkeen jakajan pitäisi olla ${fi(nextDealer(ctx.prevDealer))}, oli ${fi(r.dealer)}`);
        } else {
            if (r.dealNumber !== ctx.prevDealNumber + 1) add('dealer', `Jakonumero ${ctx.prevDealNumber} → ${r.dealNumber}, pitäisi kasvaa yhdellä`);
            if (!practice && r.dealer !== nextDealer(ctx.prevDealer)) add('dealer', `Jakajan pitäisi olla ${fi(nextDealer(ctx.prevDealer))}, oli ${fi(r.dealer)}`);
        }
        if (r.vulnerable !== vulnerabilityFor(r.dealNumber)) {
            add('dealer', `Jaon ${r.dealNumber} vyöhyke on ${r.vulnerable}, pitäisi olla ${vulnerabilityFor(r.dealNumber)}`);
        }
    }

    function checkMiniRedeal(deal, add) {
        const r = deal.record;
        const p = {};
        for (const pos of POSITIONS) p[pos] = countHcp(r.hands[pos]);
        const ns = p.north + p.south;
        const ew = p.east + p.west;
        if (ns !== ew) add('mini', `Uusintajako, vaikka pisteet eivät olleet tasan (NS ${ns}, EW ${ew})`);
        const ev = deal.redealEvent && deal.redealEvent.data;
        if (ev && ev.points) {
            for (const pos of POSITIONS) {
                if (ev.points[pos] !== p[pos]) add('mini', `Ilmoitetut pisteet ${fi(pos)}: ${ev.points[pos]}, oikein ${p[pos]}`);
            }
        }
    }

    function checkPrivacy(deal, ctx, add) {
        const table = ctx.table;
        const r = deal.record;
        const types = table.seatTypes;
        const robotDeclarerHumanDummy = r.declarer && r.dummy && types[r.declarer] === 'robot' && types[r.dummy] === 'human';
        const allowed = new Set(['yourCards', 'dummyRevealed', 'declarerHandRevealed', 'testDealRecord']);
        // Sama tunnistevuoto raportoidaan pöydässä kerran viestityyppiä kohden
        const tokenLeakSeen = ctx.tokenLeakSeen || (ctx.tokenLeakSeen = new Set());

        for (const seat of table.humanSeats) {
            const events = eventsOf(deal, seat);
            let cardsPlayed = 0;
            let firstOwn = true;
            for (const e of events) {
                if (e.event === 'cardPlayed') cardsPlayed++;
                if (e.event === 'yourCards') {
                    if (e.data.position !== seat) {
                        add('privacy', `${fi(seat)} sai käden ${fi(e.data.position)} (yourCards)`);
                    } else if (firstOwn) {
                        firstOwn = false;
                        if (!sameHand(e.data.cards, r.hands[seat])) add('privacy', `${fi(seat)}: yourCards ei vastaa jaettua kättä`);
                    }
                } else if (e.event === 'dummyRevealed') {
                    if (table.mode !== 'minibridge' && cardsPlayed === 0) {
                        add('privacy', `${fi(seat)} näki lepääjän kortit ennen avauslähtöä`);
                    }
                    if (e.data.dummyPosition !== r.dummy) {
                        add('privacy', `Lepääjäksi paljastettiin ${fi(e.data.dummyPosition)}, lepääjä on ${fi(r.dummy)}`);
                    } else if (cardsPlayed <= 1 && !sameHand(e.data.dummyCards, r.hands[r.dummy])) {
                        add('privacy', `Paljastetut lepääjän kortit eivät vastaa lepääjän kättä`);
                    }
                } else if (e.event === 'declarerHandRevealed') {
                    if (!robotDeclarerHumanDummy || seat !== r.dummy) {
                        add('privacy', `${fi(seat)} sai pelinviejän ${fi(e.data.declarerPosition)} käden, vaikka ei ohjaa sitä`);
                    } else if (e.data.declarerPosition !== r.declarer) {
                        add('privacy', `declarerHandRevealed: väärä pelinviejä ${fi(e.data.declarerPosition)}`);
                    }
                } else if (!allowed.has(e.event)) {
                    const text = JSON.stringify(e.data || {});
                    if (text.includes('"hands"') || text.includes('"originalHands"')) {
                        add('privacy', `Viesti ${e.event} sisälsi käsiä (vastaanottaja ${fi(seat)})`);
                    }
                }
                // Salaiset paikkatunnisteet: pelaaja saa vain omansa (seatToken).
                // Toisen tunnisteella voisi ottaa hänen paikkansa ja nähdä kortit.
                if (e.event !== 'testDealRecord' && !tokenLeakSeen.has(e.event) && JSON.stringify(e.data || {}).includes('"token"')) {
                    tokenLeakSeen.add(e.event);
                    add('privacy', `Viesti ${e.event} sisälsi pelaajien salaiset paikkatunnisteet (token), vastaanottaja ${fi(seat)}`);
                }
            }
            // Robotin pelinviejän kättä ohjaava lepääjä tarvitsee sen käden
            if (robotDeclarerHumanDummy && seat === r.dummy && deal.outcome === 'end' &&
                !firstEvent(events, 'declarerHandRevealed')) {
                add('privacy', `Ihmislepääjä ${fi(seat)} ei saanut robottipelinviejän kättä, vaikka ohjaa sitä`);
            }
        }
    }

    function checkBidding(deal, ctx, add) {
        const r = deal.record;
        const table = ctx.table;
        const creatorEvents = eventsOf(deal, table.creator);
        const history = r.bidHistory || [];

        // Vuorot
        history.forEach((b, i) => {
            const expected = nextPos(r.dealer, i);
            if (b.player !== expected) add('bidTurns', `Tarjous ${i + 1} (${b.bid}): tarjosi ${fi(b.player)}, vuorossa oli ${fi(expected)}`);
        });
        const start = deal.start && deal.start.data;
        if (start && start.biddingState && start.biddingState.currentBidder !== r.dealer) {
            add('bidTurns', `Ensimmäinen tarjoaja ${fi(start.biddingState.currentBidder)}, jakaja on ${fi(r.dealer)}`);
        }
        // Havaitut bidMade-viestit vastaavat palvelimen historiaa
        const made = allEvents(creatorEvents, 'bidMade');
        made.forEach((e, i) => {
            const h = history[i];
            if (!h || h.player !== e.data.position || h.bid !== e.data.bid) {
                add('bidTurns', `bidMade ${i + 1} (${fi(e.data.position)} ${e.data.bid}) ei vastaa tarjoushistoriaa`);
            }
            if (e.data.nextBidder !== nextPos(e.data.position)) {
                add('bidTurns', `bidMade ${i + 1}: seuraava tarjoaja ${fi(e.data.nextBidder)}, pitäisi olla ${fi(nextPos(e.data.position))}`);
            }
        });

        // Tarjoussäännöt (palvelin ei saa hyväksyä laittomia kutsuja). Työkalun
        // omat laittomat kokeilut on jo raportoitu kohdassa Hylätyt siirrot.
        const accepted = (deal.attempts || []).filter(a => a.result === 'accepted' && a.event === 'makeBid');
        history.forEach((b, i) => {
            const err = callError(history.slice(0, i), b.player, b.bid);
            const ownAttempt = accepted.findIndex(a => a.data.position === b.player && a.data.bid === b.bid);
            if (err && ownAttempt >= 0) {
                accepted.splice(ownAttempt, 1);
            } else if (err) {
                add('bidRules', `Palvelin hyväksyi tarjouksen ${i + 1}, ${fi(b.player)} ${b.bid}: ${err}`);
            }
        });

        // Tarjoamisen päättyminen
        const passedOut = history.length === 4 && history.every(b => b.bid === 'P');
        if (deal.outcome === 'allPassed') {
            if (!passedOut) add('bidTurns', `allPassed, vaikka tarjoukset olivat: ${history.map(b => b.bid).join(' ')}`);
            const ev = firstEvent(creatorEvents, 'allPassed');
            if (!ev) add('bidTurns', 'Kaikki passasivat, mutta allPassed-viesti puuttui');
            else if (ev.data.bid !== 'P' || ev.data.position !== nextPos(r.dealer, 3)) add('bidTurns', 'allPassed-viestin neljäs passi on väärin');
            return null;
        }
        if (deal.outcome === 'abandoned' && !r.contract) return null;

        const computed = computeContract(history);
        if (!computed) {
            add('contract', 'Tarjoaminen päättyi ilman sopimusta, mutta jako jatkui');
            return null;
        }
        // Tarjoaminen päättyy kolmeen passiin tarjouksen jälkeen
        const tail = history.slice(-3);
        if (tail.length < 3 || tail.some(b => b.bid !== 'P')) {
            add('bidTurns', `Tarjoaminen päättyi ennen kolmea passia: ${history.map(b => b.bid).join(' ')}`);
        }
        const done = firstEvent(creatorEvents, 'biddingComplete');
        if (!done) {
            add('contract', 'biddingComplete-viesti puuttui');
            return computed;
        }
        const d = done.data;
        if (d.contract !== computed.contract) add('contract', `Sopimus ${d.contract}, pitäisi olla ${computed.contract} (tarjoukset ${history.map(b => b.bid).join(' ')})`);
        if (d.declarer !== computed.declarer) add('contract', `Pelinviejä ${fi(d.declarer)}, pitäisi olla ${fi(computed.declarer)} (tarjoukset ${history.map(b => `${b.player.charAt(0).toUpperCase()}:${b.bid}`).join(' ')})`);
        if (d.dummy !== partnerOf(d.declarer)) add('contract', `Lepääjä ${fi(d.dummy)} ei ole pelinviejän ${fi(d.declarer)} partneri`);
        if ((d.trumpSuit || null) !== computed.trumpSuit) add('contract', `Valtti ${d.trumpSuit}, pitäisi olla ${computed.trumpSuit}`);
        if (d.currentPlayer !== nextPos(d.declarer)) add('playTurns', `Avauslähdön vuorossa ${fi(d.currentPlayer)}, pitäisi olla ${fi(nextPos(d.declarer))}`);
        // Peli jatkuu palvelimen ilmoittamalla sopimuksella, joten pelin
        // tarkistukset tehdään sen mukaan
        return {
            contract: d.contract,
            declarer: d.declarer,
            dummy: d.dummy,
            trumpSuit: d.trumpSuit || null,
            computed
        };
    }

    function checkMiniContract(deal, ctx, add) {
        const r = deal.record;
        const creatorEvents = eventsOf(deal, ctx.table.creator);
        const points = {};
        for (const p of POSITIONS) points[p] = countHcp(r.hands[p]);
        const ns = points.north + points.south;
        const ew = points.east + points.west;
        const start = deal.start && deal.start.data;
        if (start && start.miniState && start.miniState.points) {
            for (const p of POSITIONS) {
                if (start.miniState.points[p] !== points[p]) add('mini', `Ilmoitetut pisteet ${fi(p)}: ${start.miniState.points[p]}, oikein ${points[p]}`);
            }
        }
        if (ns === ew) {
            add('mini', `Pisteet tasan (${ns}-${ew}), mutta uusintajakoa ei tehty`);
            return null;
        }
        let [a, b] = ns > ew ? ['north', 'south'] : ['east', 'west'];
        if (points[b] > points[a]) [a, b] = [b, a];
        else if (points[a] === points[b]) {
            // Tasapisteillä jakajasta myötäpäivään ensimmäinen
            for (let i = 0; i < 4; i++) {
                const p = nextPos(r.dealer, i);
                if (p === a || p === b) { if (p === b) [a, b] = [b, a]; break; }
            }
        }
        if (r.declarer !== a) add('mini', `Pelinviejä ${fi(r.declarer)}, pitäisi olla ${fi(a)} (pisteet ${JSON.stringify(points)})`);
        if (r.dummy !== partnerOf(r.declarer)) add('mini', `Lepääjä ${fi(r.dummy)} ei ole pelinviejän partneri`);

        if (!r.contract) return null;
        const level = parseInt(r.contract.charAt(0), 10);
        const strain = r.contract.charAt(1);
        if (level !== 1 && level !== MINI_GAME_LEVEL[strain]) add('mini', `Sopimustaso ${r.contract} ei ole osasopimus (1) eikä täyspeli (${MINI_GAME_LEVEL[strain]})`);
        if ((r.trumpSuit || null) !== TRUMP_OF[strain]) add('mini', `Valtti ${r.trumpSuit}, sopimus ${r.contract}`);
        const chosen = deal.miniChoice;
        if (chosen) {
            const expected = (chosen.type === 'game' ? MINI_GAME_LEVEL[chosen.strain] : 1) + chosen.strain;
            if (r.contract !== expected) add('mini', `Valittiin ${chosen.type} ${chosen.strain}, sopimukseksi tuli ${r.contract}`);
        }
        const done = firstEvent(creatorEvents, 'biddingComplete');
        if (done && done.data.currentPlayer !== nextPos(r.declarer)) {
            add('playTurns', `Avauslähdön vuorossa ${fi(done.data.currentPlayer)}, pitäisi olla ${fi(nextPos(r.declarer))}`);
        }
        return { contract: r.contract, declarer: r.declarer, dummy: r.dummy, trumpSuit: r.trumpSuit || null };
    }

    function checkPracticeContract(deal, ctx, add) {
        const r = deal.record;
        const creator = ctx.table.creator;
        const start = deal.start && deal.start.data;
        if ((r.bidHistory || []).length) add('practice', 'Harjoituksessa oli tarjouksia');
        if (r.declarer !== creator) add('practice', `Pelinviejä ${fi(r.declarer)}, pitäisi olla pöydän luoja ${fi(creator)}`);
        if (r.dummy !== partnerOf(creator)) add('practice', `Lepääjä ${fi(r.dummy)}, pitäisi olla ${fi(partnerOf(creator))}`);
        if (start && start.practice && start.practice.current) {
            if (start.practice.current.contract !== r.contract) add('practice', `Ilmoitettu sopimus ${start.practice.current.contract}, pelattiin ${r.contract}`);
        }
        if (!r.contract) return null;
        const strain = r.contract.charAt(1);
        if ((r.trumpSuit || null) !== TRUMP_OF[strain]) add('practice', `Valtti ${r.trumpSuit}, sopimus ${r.contract}`);
        return { contract: r.contract, declarer: r.declarer, dummy: r.dummy, trumpSuit: r.trumpSuit || null };
    }

    /**
     * Pelivuorot, maan seuraaminen, kortit, tikkien voittajat ja ohjausoikeus.
     * Palauttaa lasketut tikit { ns, ew, complete }.
     */
    function checkPlay(deal, ctx, contractInfo, add) {
        const table = ctx.table;
        const r = deal.record;
        const creatorEvents = eventsOf(deal, table.creator);
        const played = allEvents(creatorEvents, 'cardPlayed').map(e => ({ player: e.data.position, suit: e.data.suit, card: e.data.card }));
        const tricksOut = { ns: 0, ew: 0, complete: false };
        if (!contractInfo || !played.length) {
            if (deal.outcome === 'end') add('playTurns', 'Jako päättyi, mutta kortteja ei pelattu');
            return tricksOut;
        }

        // Palvelimen oma lista vastaa havaittuja viestejä
        const serverPlayed = r.playedCards || [];
        if (serverPlayed.length !== played.length || serverPlayed.some((c, i) => cardKey(c) !== cardKey(played[i]) || c.player !== played[i].player)) {
            add('cards', `Pelatut kortit (${played.length}) eivät vastaa palvelimen listaa (${serverPlayed.length})`);
        }

        const remaining = cloneHands(r.hands);
        const voids = {}; // pelaaja -> maat, joista hän on jo ollut seuraamatta
        const seen = new Set();
        const trickEvents = allEvents(creatorEvents, 'trickComplete');
        let leader = nextPos(contractInfo.declarer);
        let trick = [];
        let trickNo = 0;

        played.forEach((c, i) => {
            const expected = nextPos(leader, trick.length);
            if (c.player !== expected) add('playTurns', `Kortti ${i + 1} (${cardText(c)}): pelasi ${fi(c.player)}, vuorossa oli ${fi(expected)}`);
            const k = cardKey(c);
            if (seen.has(k)) add('cards', `Kortti ${cardText(c)} pelattiin kahdesti`);
            seen.add(k);
            const hand = remaining[c.player];
            if (!hand[c.suit].includes(c.card)) {
                add('cards', `${fi(c.player)} pelasi kortin ${cardText(c)}, jota hänellä ei ollut`);
            }
            if (trick.length > 0) {
                const lead = trick[0].suit;
                if (c.suit !== lead) {
                    if (hand[lead].length > 0) add('followSuit', `${fi(c.player)} ei seurannut maata ${lead} (pelasi ${cardText(c)}), vaikka hänellä oli ${hand[lead].join(' ')}`);
                    (voids[c.player] = voids[c.player] || new Set()).add(lead);
                }
            }
            if (voids[c.player] && voids[c.player].has(c.suit)) {
                add('followSuit', `${fi(c.player)} pelasi maata ${c.suit}, josta hän oli aiemmin ollut seuraamatta`);
            }
            hand[c.suit] = hand[c.suit].filter(x => x !== c.card);
            trick.push(c);
            if (trick.length === 4) {
                const winner = trickWinner(trick, contractInfo.trumpSuit);
                tricksOut[sideOf(winner)]++;
                const ev = trickEvents[trickNo];
                if (trickNo < 12) {
                    if (!ev) {
                        if (deal.outcome === 'end') add('trickWinner', `Tikin ${trickNo + 1} trickComplete-viesti puuttui`);
                    } else if (ev.data.winner !== winner) {
                        add('trickWinner', `Tikki ${trickNo + 1} (${trick.map(cardText).join(', ')}, valtti ${contractInfo.trumpSuit || 'NT'}): palvelin ${fi(ev.data.winner)}, oikein ${fi(winner)}`);
                    }
                }
                leader = winner;
                trick = [];
                trickNo++;
            }
        });

        if (deal.outcome === 'end') {
            if (played.length !== 52) add('cards', `Jaossa pelattiin ${played.length} korttia, pitäisi olla 52`);
            tricksOut.complete = played.length === 52;
        }

        // Ohjausoikeus: jokaisen kortin lähetti oikea pelaaja (13. tikki
        // pelataan automaattisesti, joten sitä ei tarkisteta)
        const types = table.seatTypes;
        const robotDeclarerHumanDummy = types[contractInfo.declarer] === 'robot' && types[contractInfo.dummy] === 'human';
        const emissions = (deal.emissions || []).filter(e => e.event === 'playCard' && e.legal);
        played.slice(0, 48).forEach((c, i) => {
            let controller = c.player;
            if (robotDeclarerHumanDummy && (c.player === contractInfo.declarer || c.player === contractInfo.dummy)) controller = contractInfo.dummy;
            else if (c.player === contractInfo.dummy) controller = contractInfo.declarer;
            const sent = emissions.find(e => e.data.position === c.player && e.data.suit === c.suit && e.data.card === c.card);
            if (types[controller] === 'human') {
                if (!sent) add('control', `Kortti ${i + 1} (${fi(c.player)} ${cardText(c)}) pelattiin, vaikka ohjaava ihminen ${fi(controller)} ei lähettänyt sitä`);
                else if (sent.seat !== controller) add('control', `Kortin ${cardText(c)} paikalta ${fi(c.player)} pelasi ${fi(sent.seat)}, ohjaaja on ${fi(controller)}`);
            } else if (sent) {
                add('control', `Ihminen ${fi(sent.seat)} pelasi robotin ohjaaman paikan ${fi(c.player)} kortin ${cardText(c)}`);
            }
        });

        return tricksOut;
    }

    function checkResult(deal, ctx, contractInfo, play, add) {
        const table = ctx.table;
        const r = deal.record;
        // Sama tulos kaikille ihmisille
        const overs = table.humanSeats.map(seat => ({ seat, ev: firstEvent(eventsOf(deal, seat), 'gameOver') }));
        const missing = overs.filter(o => !o.ev);
        for (const m of missing) add('sameResult', `${fi(m.seat)} ei saanut gameOver-viestiä`);
        const got = overs.filter(o => o.ev);
        if (!got.length) return;
        const base = JSON.stringify(got[0].ev.data);
        for (const o of got.slice(1)) {
            if (JSON.stringify(o.ev.data) !== base) add('sameResult', `${fi(o.seat)} sai eri lopputuloksen kuin ${fi(got[0].seat)}`);
        }
        const over = got[0].ev.data;
        if (!contractInfo) return;

        if (play.complete) {
            if (!over.tricks || over.tricks.ns !== play.ns || over.tricks.ew !== play.ew) {
                add('trickWinner', `Tikit lopussa NS ${over.tricks && over.tricks.ns} / EW ${over.tricks && over.tricks.ew}, oikein NS ${play.ns} / EW ${play.ew}`);
            }
        }
        const declSide = sideOf(contractInfo.declarer);
        const made = play.complete ? play[declSide] : (over.tricks ? over.tricks[declSide] : 0);

        if (table.mode === 'bridge') {
            const vul = vulnerabilityFor(r.dealNumber);
            if (over.vulnerable !== vul) add('score', `Vyöhyke ${over.vulnerable}, jaossa ${r.dealNumber} pitäisi olla ${vul}`);
            const declVul = vul === 'Both' || vul === declSide.toUpperCase();
            const expected = scoreBridge(contractInfo.contract, made, declVul);
            if (over.dealScore !== expected) {
                add('score', `${contractInfo.contract} ${declVul ? 'vyöhykkeessä' : 'ei vyöhykkeessä'}, ${made} tikkiä: pisteet ${over.dealScore}, pitäisi olla ${expected}`);
            }
            if (!r.isReplay) {
                if (expected >= 0) ctx.totals[declSide] += expected;
                else ctx.totals[otherSide(declSide)] += -expected;
            }
            checkTotals(over, ctx, add);
        } else if (table.mode === 'minibridge') {
            const expected = scoreMini(contractInfo.contract, made);
            if (over.dealScore !== expected) add('score', `Minibridge ${contractInfo.contract}, ${made} tikkiä: pisteet ${over.dealScore}, pitäisi olla ${expected}`);
            if (!r.isReplay) {
                if (expected >= 0) ctx.totals[declSide] += expected;
                else ctx.totals[otherSide(declSide)] += -expected;
            }
            checkTotals(over, ctx, add);
        } else if (table.mode === 'declarerPractice') {
            const p = over.practice;
            if (!p) {
                add('practice', 'gameOver-viestistä puuttui harjoituksen tulos');
                return;
            }
            const need = parseInt(contractInfo.contract.charAt(0), 10) + 6;
            if (p.made !== (made >= need)) add('practice', `Tulos ${p.made ? 'tehty' : 'pietti'}, ${made} tikkiä sopimuksessa ${contractInfo.contract}`);
            if (p.actualTricks !== made) add('practice', `Tikit ${p.actualTricks}, oikein ${made}`);
            ctx.practicePlayed++;
            if (p.stats && p.stats.played !== ctx.practicePlayed) add('practice', `Pelattuja jakoja ${p.stats.played}, pitäisi olla ${ctx.practicePlayed}`);
        }
    }

    function checkTotals(over, ctx, add) {
        const t = over.totalScore;
        if (!t || t.ns !== ctx.totals.ns || t.ew !== ctx.totals.ew) {
            add('score', `Kokonaispisteet NS ${t && t.ns} / EW ${t && t.ew}, pitäisi olla NS ${ctx.totals.ns} / EW ${ctx.totals.ew}`);
            // Jatketaan palvelimen luvuista, ettei yksi virhe toistu joka jaossa
            if (t) ctx.totals = { ns: t.ns, ew: t.ew };
        }
    }

    /** Kattavuuslaskurit yhdestä jaosta (yhteenvetoa varten). */
    function coverageOf(deal, table) {
        const r = deal.record;
        const c = {
            deals: 0, allPassed: 0, abandoned: 0, miniRedeals: 0, stalled: 0,
            doubled: 0, redoubled: 0, slams: 0, humanControlsRobot: 0,
            illegalAttempts: (deal.attempts || []).length
        };
        if (deal.outcome === 'miniRedeal') { c.miniRedeals = 1; return c; }
        c.deals = 1;
        if (deal.outcome === 'allPassed') c.allPassed = 1;
        if (deal.outcome === 'abandoned') c.abandoned = 1;
        if (deal.outcome === 'stalled') c.stalled = 1;
        if (r && r.contract) {
            if (/XX$/.test(r.contract)) c.redoubled = 1;
            else if (/X$/.test(r.contract)) c.doubled = 1;
            if (/^[67]/.test(r.contract)) c.slams = 1;
            if (table.seatTypes[r.declarer] === 'robot' && table.seatTypes[r.dummy] === 'human') c.humanControlsRobot = 1;
        }
        return c;
    }

    return {
        POSITIONS, SUITS, RANKS, CHECKS,
        nextPos, partnerOf, sideOf, nextDealer, vulnerabilityFor, countHcp,
        callError, computeContract, trickWinner, scoreBridge, scoreMini,
        createTableContext, checkDeal, coverageOf
    };
}));
