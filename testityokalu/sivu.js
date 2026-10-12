/* Testisivun käyttöliittymä: lomake, edistyminen, tulokset ja löydökset.
   Varsinainen työ tehdään simulaattori.js:ssä ja tarkistimet.js:ssä. */
(function () {
    'use strict';

    const POS_FI = { north: 'pohjoinen', east: 'itä', south: 'etelä', west: 'länsi' };
    const POS_CAP = { north: 'Pohjoinen', east: 'Itä', south: 'Etelä', west: 'Länsi' };
    const SUIT_SYMBOL = { spades: '♠', hearts: '♥', diamonds: '♦', clubs: '♣' };
    const SUIT_FI = { spades: 'pata', hearts: 'hertta', diamonds: 'ruutu', clubs: 'risti' };
    const OUTCOME_FI = { end: 'pelattu loppuun', allPassed: 'kaikki passasivat', abandoned: 'hylätty kesken', stalled: 'jumittui', miniRedeal: 'minibridgen uusintajako' };
    const ROBOTS_FI = ['Ei robotteja', 'Yksi robotti', 'Kaksi robottia', 'Kolme robottia'];
    const LIVE_INTERVAL_MS = 5000;

    const $ = (id) => document.getElementById(id);
    const els = {
        form: $('settings'),
        start: $('start'),
        stop: $('stop'),
        formError: $('form-error'),
        status: $('status-text'),
        progressList: $('progress-list'),
        live: $('live'),
        summaryBody: $('summary-body'),
        download: $('download'),
        findingsCount: $('findings-count'),
        findingsList: $('findings-list'),
        details: $('details'),
        detailsHeading: $('details-heading'),
        detailsBody: $('details-body')
    };

    let run = null;
    let report = null;
    let findings = [];
    let lastLive = 0;
    let pendingLive = null;
    let pendingLiveTimer = null;
    const MAX_LISTED = 500;

    // ---------- Teema ----------
    const themeBtn = $('theme-toggle');
    function applyTheme(theme) {
        if (theme) document.documentElement.setAttribute('data-theme', theme);
        else document.documentElement.removeAttribute('data-theme');
        const dark = theme === 'dark' || (!theme && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
        themeBtn.setAttribute('aria-pressed', dark ? 'true' : 'false');
    }
    try { applyTheme(localStorage.getItem('testityokalu-teema')); } catch (e) { applyTheme(null); }
    themeBtn.addEventListener('click', () => {
        const dark = themeBtn.getAttribute('aria-pressed') !== 'true';
        const theme = dark ? 'dark' : 'light';
        applyTheme(theme);
        try { localStorage.setItem('testityokalu-teema', theme); } catch (e) { /* ei tallennusta */ }
    });

    // ---------- Paikkavalinnat ----------
    function seatLabel(seats) {
        const names = seats.map(s => POS_FI[s]).join(' + ');
        if (seats.length === 2) {
            const partners = (seats.includes('north') && seats.includes('south')) || (seats.includes('east') && seats.includes('west'));
            return `${names} (${partners ? 'partnerit' : 'vastustajat'})`;
        }
        return names;
    }

    const seatFields = $('seat-fields');
    for (const robots of [1, 2, 3]) {
        const id = `seats-${robots}`;
        const wrap = document.createElement('div');
        wrap.className = 'field';
        const label = document.createElement('label');
        label.htmlFor = id;
        label.textContent = `${ROBOTS_FI[robots]}: ihmisten paikat`;
        const select = document.createElement('select');
        select.id = id;
        const vary = document.createElement('option');
        vary.value = 'vaihtele';
        vary.textContent = 'Vaihtele kaikkia yhdistelmiä';
        select.appendChild(vary);
        for (const layout of Simulaattori.seatLayouts(robots, 'vaihtele')) {
            const o = document.createElement('option');
            o.value = layout.join(',');
            o.textContent = seatLabel(layout);
            select.appendChild(o);
        }
        wrap.appendChild(label);
        wrap.appendChild(select);
        seatFields.appendChild(wrap);
    }

    const modeSelect = $('mode');
    modeSelect.addEventListener('change', () => {
        $('practice-field').hidden = modeSelect.value !== 'declarerPractice';
    });

    // ---------- Ruudunlukijailmoitukset ----------
    // Ilmoitetaan harvakseltaan, ettei puhetta tule liikaa. Kiireellinen
    // (virhe tai valmistuminen) ohittaa odotuksen.
    function announce(text, urgent) {
        const t = Date.now();
        if (urgent || t - lastLive >= LIVE_INTERVAL_MS) {
            clearTimeout(pendingLiveTimer);
            pendingLive = null;
            lastLive = t;
            els.live.textContent = text;
        } else {
            pendingLive = text;
            if (!pendingLiveTimer) {
                pendingLiveTimer = setTimeout(() => {
                    pendingLiveTimer = null;
                    if (pendingLive) announce(pendingLive, true);
                }, LIVE_INTERVAL_MS - (t - lastLive));
            }
        }
    }

    // ---------- Lomake ----------
    function readOptions() {
        const configs = [...document.querySelectorAll('input[name="configs"]:checked')].map(i => Number(i.value));
        if (!configs.length) throw new Error('Valitse vähintään yksi kokoonpano.');
        const deals = Number($('deals').value);
        if (!Number.isInteger(deals) || deals < 1 || deals > 1000) throw new Error('Jakojen määrän pitää olla 1–1000.');
        const parallel = Number($('parallel').value);
        if (!Number.isInteger(parallel) || parallel < 1 || parallel > 8) throw new Error('Rinnakkaisia pöytiä voi olla 1–8.');
        const seedText = $('seed').value.trim();
        if (seedText && !/^\d+$/.test(seedText)) throw new Error('Siemenen pitää olla kokonaisluku.');
        const seats = {};
        for (const robots of [1, 2, 3]) {
            const v = $(`seats-${robots}`).value;
            if (v !== 'vaihtele') seats[robots] = v.split(',');
        }
        return {
            url: window.location.origin,
            connect: (url) => io(url, { transports: ['websocket'], forceNew: true, reconnection: false }),
            configs,
            deals,
            parallel,
            mode: modeSelect.value,
            practiceType: $('practice-type').value,
            style: $('style').value,
            illegal: $('illegal').checked,
            seats: Object.keys(seats).length ? seats : 'vaihtele',
            seed: seedText ? Number(seedText) : null
        };
    }

    function setRunning(running) {
        for (const fs of els.form.querySelectorAll('fieldset')) fs.disabled = running;
        els.start.disabled = running;
        els.stop.disabled = !running;
    }

    function buildProgress(configs, deals) {
        els.progressList.innerHTML = '';
        for (const robots of configs) {
            const row = document.createElement('div');
            row.className = 'progress-row';
            const label = document.createElement('div');
            label.className = 'label';
            label.id = `prog-label-${robots}`;
            label.textContent = `${ROBOTS_FI[robots]}: 0/${deals} jakoa, 0 virhettä`;
            const bar = document.createElement('progress');
            bar.id = `prog-${robots}`;
            bar.max = deals;
            bar.value = 0;
            bar.setAttribute('aria-labelledby', label.id);
            row.appendChild(label);
            row.appendChild(bar);
            els.progressList.appendChild(row);
        }
    }

    els.form.addEventListener('submit', async (e) => {
        e.preventDefault();
        els.formError.textContent = '';
        let options;
        try {
            options = readOptions();
        } catch (err) {
            els.formError.textContent = err.message;
            return;
        }
        findings = [];
        report = null;
        els.findingsList.innerHTML = '';
        els.findingsCount.textContent = 'Ei löydöksiä.';
        els.details.hidden = true;
        els.download.disabled = true;
        buildProgress(options.configs, options.deals);
        setRunning(true);

        options.onProgress = onProgress;
        options.onFinding = onFinding;
        try {
            run = Simulaattori.createRun(options);
        } catch (err) {
            els.formError.textContent = err.message;
            setRunning(false);
            return;
        }
        els.status.textContent = `Käynnissä. Siemen ${run.options.seed}.`;
        announce(`Ajo käynnistyi. ${options.configs.length} kokoonpanoa, ${options.deals} jakoa kussakin.`, true);
        try {
            report = await run.start();
        } catch (err) {
            els.formError.textContent = `Ajo keskeytyi: ${err.message}`;
            report = run.report();
        }
        setRunning(false);
        renderSummary(report);
        els.download.disabled = false;
        const total = report.summary.reduce((a, s) => a + s.deals, 0);
        const msg = `${report.stopped ? 'Ajo pysäytetty' : 'Ajo valmis'}: ${total} jakoa, ${report.errors} virhettä, ${report.known} tunnettua ongelmaa. Kesto ${Math.round(report.durationMs / 1000)} s.`;
        els.status.textContent = msg;
        announce(msg, true);
    });

    els.stop.addEventListener('click', () => {
        if (!run) return;
        run.stop();
        els.stop.disabled = true;
        els.status.textContent = 'Pysäytetään: meneillään olevat jaot pelataan loppuun.';
        announce(els.status.textContent, true);
    });

    function onProgress(p) {
        if (p.summary) renderSummary({ summary: Object.values(p.summary).map(s => Object.assign({}, s, { averageDealMs: s.timedDeals ? Math.round(s.totalDealMs / s.timedDeals) : null })) });
        if (!p.dealDone) return;
        const s = p.summary[p.robots];
        const bar = $(`prog-${p.robots}`);
        const label = $(`prog-label-${p.robots}`);
        const text = `${ROBOTS_FI[p.robots]}: ${s.deals}/${s.target} jakoa, ${s.errors} virhettä`;
        if (bar) bar.value = s.deals;
        if (label) label.textContent = text;
        if (s.deals % 10 === 0 || s.deals === s.target) announce(text, false);
    }

    function onFinding(f) {
        findings.push(f);
        const errors = findings.filter(x => x.severity === 'error').length;
        const known = findings.length - errors;
        els.findingsCount.textContent = `${findings.length} löydöstä: ${errors} virhettä, ${known} tunnettua ongelmaa.` +
            (findings.length > MAX_LISTED ? ` Listassa näytetään ${MAX_LISTED} ensimmäistä, kaikki ovat ladattavassa tiedostossa.` : '');
        if (f.severity === 'error') announce(`Virhe: ${f.check}, ${ROBOTS_FI[f.robots].toLowerCase()}. Virheitä yhteensä ${errors}.`, false);
        if (findings.length > MAX_LISTED) return;
        const li = document.createElement('li');
        const btn = document.createElement('button');
        btn.type = 'button';
        const badge = document.createElement('span');
        badge.className = `badge ${f.severity}`;
        badge.textContent = f.severity === 'error' ? 'Virhe' : 'Tunnettu';
        btn.appendChild(badge);
        btn.appendChild(document.createTextNode(`${f.check}, ${ROBOTS_FI[f.robots].toLowerCase()}, jako ${f.dealNumber || '-'}: ${f.message}`));
        btn.addEventListener('click', () => showDetails(f, btn));
        li.appendChild(btn);
        els.findingsList.appendChild(li);
    }

    // ---------- Yhteenveto ----------
    function formatMs(ms) {
        if (ms === null || ms === undefined) return '–';
        return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1).replace('.', ',')} s`;
    }

    function renderSummary(r) {
        if (!r || !r.summary || !r.summary.length) return;
        els.summaryBody.innerHTML = '';
        for (const s of r.summary) {
            const tr = document.createElement('tr');
            const th = document.createElement('th');
            th.scope = 'row';
            th.textContent = ROBOTS_FI[s.robots];
            tr.appendChild(th);
            const cells = [
                `${s.deals}/${s.target}`, s.errors, s.known, formatMs(s.averageDealMs), s.allPassed, s.abandoned,
                s.doubled, s.redoubled, s.slams, s.humanControlsRobot, s.miniRedeals, s.illegalAttempts, s.stalled
            ];
            for (const v of cells) {
                const td = document.createElement('td');
                td.className = 'num';
                td.textContent = String(v);
                tr.appendChild(td);
            }
            els.summaryBody.appendChild(tr);
        }
    }

    // ---------- Löydöksen tiedot ----------
    function handText(hand) {
        if (!hand) return '–';
        return ['spades', 'hearts', 'diamonds', 'clubs']
            .map(s => `${SUIT_SYMBOL[s]} ${(hand[s] || []).join(' ') || '–'}`).join('   ');
    }

    function addRow(dl, term, value) {
        const dt = document.createElement('dt');
        dt.textContent = term;
        const dd = document.createElement('dd');
        dd.textContent = value;
        dl.appendChild(dt);
        dl.appendChild(dd);
    }

    function addPre(title, text) {
        const h = document.createElement('h4');
        h.textContent = title;
        const pre = document.createElement('pre');
        pre.textContent = text;
        els.detailsBody.appendChild(h);
        els.detailsBody.appendChild(pre);
    }

    function showDetails(f, btn) {
        for (const b of els.findingsList.querySelectorAll('button[aria-current]')) b.removeAttribute('aria-current');
        btn.setAttribute('aria-current', 'true');
        els.detailsBody.innerHTML = '';
        const d = f.deal || {};

        const dl = document.createElement('dl');
        addRow(dl, 'Tarkistus', f.check);
        addRow(dl, 'Vakavuus', f.severity === 'error' ? 'Virhe' : 'Tunnettu ongelma');
        addRow(dl, 'Selitys', f.message);
        addRow(dl, 'Kokoonpano', `${ROBOTS_FI[f.robots]}, ihmiset: ${(f.humanSeats || []).map(s => POS_FI[s]).join(', ')}, pöydän luoja ${POS_FI[f.creator] || '-'}`);
        addRow(dl, 'Pöytä', f.table || '–');
        addRow(dl, 'Jako', `${d.dealNumber || f.dealNumber || '–'}, ${OUTCOME_FI[d.outcome] || d.outcome || '–'}`);
        if (d.dealer) addRow(dl, 'Jakaja ja vyöhyke', `${POS_FI[d.dealer]}, ${d.vulnerable}`);
        if (d.contract) addRow(dl, 'Sopimus', `${d.contract}, pelinviejä ${POS_FI[d.declarer]}, lepääjä ${POS_FI[d.dummy]}`);
        els.detailsBody.appendChild(dl);

        if (d.hands) {
            addPre('Kädet', ['north', 'east', 'south', 'west']
                .map(p => `${POS_CAP[p]} (${d.seatTypes && d.seatTypes[p] === 'robot' ? 'robotti' : 'ihminen'}): ${handText(d.hands[p])}`).join('\n'));
        }
        if (d.bidHistory && d.bidHistory.length) {
            addPre('Tarjoukset', d.bidHistory.map((b, i) => `${i + 1}. ${POS_CAP[b.player]}: ${b.bid}`).join('\n'));
        }
        if (d.playedCards && d.playedCards.length) {
            const lines = [];
            for (let i = 0; i < d.playedCards.length; i += 4) {
                lines.push(`Tikki ${i / 4 + 1}: ` + d.playedCards.slice(i, i + 4)
                    .map(c => `${POS_FI[c.player]} ${SUIT_FI[c.suit]} ${c.card}`).join(', '));
            }
            addPre('Pelatut kortit', lines.join('\n'));
        }
        if (d.attempts && d.attempts.length) {
            addPre('Laittomat yritykset', d.attempts
                .map(a => `${POS_FI[a.seat]}: ${a.description} → ${a.result === 'rejected' ? `hylättiin (${a.message})` : a.result === 'accepted' ? 'HYVÄKSYTTIIN' : 'ei vastausta'}`).join('\n'));
        }
        const raw = document.createElement('details');
        const sum = document.createElement('summary');
        sum.textContent = 'Koko jaon tapahtumaloki (JSON)';
        const pre = document.createElement('pre');
        pre.textContent = JSON.stringify(d, null, 2);
        raw.appendChild(sum);
        raw.appendChild(pre);
        els.detailsBody.appendChild(raw);

        els.details.hidden = false;
        els.detailsHeading.focus();
    }

    // ---------- Lataus ----------
    els.download.addEventListener('click', () => {
        if (!report) return;
        const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `testiajo-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    });
}());
