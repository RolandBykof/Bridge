#!/usr/bin/env node
'use strict';
/**
 * Testityökalun komentorivi. Esimerkki:
 *
 *   npm run simuloi -- --robotit 0-3 --jakoja 100
 *
 * Ilman --url-valitsinta käynnistää oman palvelimen testitilassa vapaaseen
 * porttiin (robotit tarjoavat paikallisesti, ellei anneta --gib). Kirjoittaa
 * tuloksen JSON-tiedostoon ja palauttaa virhekoodin 1, jos virheitä löytyi.
 */
const path = require('path');
const fs = require('fs');
const net = require('net');
const { spawn } = require('child_process');
const { io } = require('socket.io-client');
const Simulaattori = require('./simulaattori');

const HELP = `Bridgen testityökalu

Käyttö: npm run simuloi -- [valitsimet]

  --robotit 0-3          Kokoonpanot: robottien määrä, esim. 0-3, 3 tai 0,2 (oletus 0-3)
  --jakoja N             Jakoja kokoonpanoa kohden, 1-1000 (oletus 100)
  --rinnakkain N         Rinnakkaiset pöydät, 1-8 (oletus 4)
  --pelimuoto M          bridge, minibridge tai harjoitus (oletus bridge)
  --harjoitustyyppi T    Pelinviejäharjoituksen tyyppi (oletus mixed)
  --tyyli T              sekoitus, satunnainen, passaaja, kahdentaja, kiipeaja,
                         keskeyttaja (oletus sekoitus)
  --paikat S,W           Ihmisten paikat (kaikille kokoonpanoille, joissa
                         ihmisiä on sama määrä). Oletus: vaihtelee pöydittäin.
  --jakoja-poydassa N    Jakoja yhdessä pöydässä ennen uutta pöytää (oletus 10)
  --ei-laittomia         Älä kokeile laittomia siirtoja
  --siemen N             Satunnaisluvun siemen ajon toistamiseen
  --tulos tiedosto.json  Tulostiedosto (oletus testityokalu/tulokset/ajo-<aika>.json)
  --url http://...       Käytä jo käynnissä olevaa palvelinta (TEST_MODE=1)
  --gib                  Robotit tarjoavat GIB-palvelulla (vain omalle palvelimelle)
  --normaalit-odotukset  Oma palvelin normaaleilla odotuksilla (hidas)
  --tunnetut-virheiksi   Myös tunnetut ongelmat antavat virhekoodin
  --hiljaa               Tulosta vain yhteenveto
  --apua                 Tämä ohje
`;

const STYLE_IDS = {
    sekoitus: 'mixed', satunnainen: 'random', passaaja: 'passer',
    kahdentaja: 'doubler', kiipeaja: 'climber', 'kiipeäjä': 'climber',
    keskeyttaja: 'aborter', 'keskeyttäjä': 'aborter'
};
const MODE_IDS = { bridge: 'bridge', minibridge: 'minibridge', harjoitus: 'declarerPractice', declarerPractice: 'declarerPractice' };
const POSITION_IDS = { s: 'south', n: 'north', w: 'west', e: 'east', south: 'south', north: 'north', west: 'west', east: 'east', etela: 'south', pohjoinen: 'north', lansi: 'west', ita: 'east' };

function parseArgs(argv) {
    const args = {};
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (!a.startsWith('--')) continue;
        const key = a.slice(2);
        const next = argv[i + 1];
        if (next === undefined || next.startsWith('--')) args[key] = true;
        else { args[key] = next; i++; }
    }
    return args;
}

function parseConfigs(text) {
    const out = new Set();
    for (const part of String(text).split(',')) {
        const m = /^\s*(\d)\s*(?:-\s*(\d))?\s*$/.exec(part);
        if (!m) throw new Error(`Virheellinen --robotit: ${text}`);
        const a = Number(m[1]);
        const b = m[2] === undefined ? a : Number(m[2]);
        for (let i = Math.min(a, b); i <= Math.max(a, b); i++) {
            if (i < 0 || i > 3) throw new Error('Robotteja voi olla 0-3');
            out.add(i);
        }
    }
    return [...out].sort();
}

function clampInt(value, min, max, name) {
    const n = Number(value);
    if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${name} pitää olla ${min}-${max}`);
    return n;
}

function freePort() {
    return new Promise((resolve, reject) => {
        const probe = net.createServer();
        probe.once('error', reject);
        probe.listen(0, () => {
            const { port } = probe.address();
            probe.close(() => resolve(port));
        });
    });
}

async function startServer(args) {
    const port = await freePort();
    const env = { ...process.env, PORT: String(port), TEST_MODE: '1' };
    if (!args.gib) env.ROBOT_BIDDER = 'local';
    if (args['normaalit-odotukset']) env.TEST_DELAYS = 'normal';
    const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
        env, stdio: ['ignore', 'pipe', 'pipe']
    });
    const log = [];
    const keep = (chunk) => { log.push(String(chunk)); if (log.length > 200) log.shift(); };
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Palvelin ei käynnistynyt 20 sekunnissa')), 20000);
        child.stdout.on('data', (chunk) => {
            if (String(chunk).includes('running on port')) { clearTimeout(timer); resolve(); }
        });
        child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Palvelin pysähtyi (koodi ${code}): ${log.join('')}`)); });
    });
    return { url: `http://localhost:${port}`, child, log };
}

function formatMs(ms) {
    if (ms === null || ms === undefined) return '-';
    return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

function printSummary(report) {
    const rows = [['Robotteja', 'Jakoja', 'Virheitä', 'Tunnettuja', 'Kesto/jako', 'Passattu', 'Hylätty', 'X', 'XX', 'Slammi', 'Ihminen ohjasi robottia', 'Uusintajako', 'Laittomia yrityksiä', 'Jumittui']];
    for (const s of report.summary) {
        rows.push([s.robots, `${s.deals}/${s.target}`, s.errors, s.known, formatMs(s.averageDealMs), s.allPassed, s.abandoned, s.doubled, s.redoubled, s.slams, s.humanControlsRobot, s.miniRedeals, s.illegalAttempts, s.stalled].map(String));
    }
    const widths = rows[0].map((_, i) => Math.max(...rows.map(r => String(r[i]).length)));
    for (const r of rows) console.log(r.map((v, i) => String(v).padEnd(widths[i])).join('  '));
}

function printFindings(report, max = 30) {
    if (!report.findings.length) return;
    // Ryhmitellään samat viestit, ettei sama virhe täytä ruutua
    const groups = new Map();
    for (const f of report.findings) {
        const key = `${f.severity}|${f.check}|${f.message.replace(/\d+/g, '#')}`;
        if (!groups.has(key)) groups.set(key, { f, count: 0 });
        groups.get(key).count++;
    }
    console.log('');
    console.log(`Löydökset (${report.findings.length}, ${groups.size} erilaista):`);
    let shown = 0;
    for (const { f, count } of groups.values()) {
        if (shown++ >= max) { console.log(`... ja ${groups.size - max} muuta erilaista, ks. tulostiedosto`); break; }
        const tag = f.severity === 'known' ? 'TUNNETTU' : 'VIRHE';
        console.log(`- [${tag}] ${f.check} (${f.robots} robottia, pöytä ${f.table}, jako ${f.dealNumber}${count > 1 ? `, ${count} kertaa` : ''}): ${f.message}`);
    }
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.apua || args.help) {
        console.log(HELP);
        return 0;
    }

    const style = STYLE_IDS[String(args.tyyli || 'sekoitus').toLowerCase()];
    if (!style) throw new Error(`Tuntematon tyyli: ${args.tyyli}`);
    const mode = MODE_IDS[String(args.pelimuoto || 'bridge')];
    if (!mode) throw new Error(`Tuntematon pelimuoto: ${args.pelimuoto}`);
    let seats = 'vaihtele';
    if (args.paikat && args.paikat !== true) {
        const list = String(args.paikat).split(',').map(s => POSITION_IDS[s.trim().toLowerCase()]);
        if (list.some(p => !p) || new Set(list).size !== list.length) throw new Error(`Virheelliset paikat: ${args.paikat}`);
        seats = { [4 - list.length]: list };
    }

    let server = null;
    let url = args.url && args.url !== true ? String(args.url) : null;
    if (!url) {
        server = await startServer(args);
        url = server.url;
        if (!args.hiljaa) console.log(`Testipalvelin käynnissä: ${url}${args.gib ? ' (GIB)' : ' (robotit tarjoavat paikallisesti)'}`);
    }

    const quiet = !!args.hiljaa;
    const options = {
        url,
        connect: (u) => io(u, { transports: ['websocket'], forceNew: true, reconnection: false }),
        configs: parseConfigs(args.robotit === undefined ? '0-3' : args.robotit),
        deals: clampInt(args.jakoja === undefined ? 100 : args.jakoja, 1, 1000, '--jakoja'),
        parallel: clampInt(args.rinnakkain === undefined ? 4 : args.rinnakkain, 1, 8, '--rinnakkain'),
        dealsPerTable: clampInt(args['jakoja-poydassa'] === undefined ? 10 : args['jakoja-poydassa'], 1, 1000, '--jakoja-poydassa'),
        mode,
        practiceType: args.harjoitustyyppi && args.harjoitustyyppi !== true ? String(args.harjoitustyyppi) : 'mixed',
        style,
        illegal: !args['ei-laittomia'],
        seats,
        seed: args.siemen === undefined ? null : Number(args.siemen),
        onProgress: (p) => {
            if (quiet) return;
            if (p.dealDone) {
                const s = p.summary[p.robots];
                if (p.newErrors || s.deals % 10 === 0 || s.deals === s.target) console.log(p.text);
            } else {
                console.log(p.text);
            }
        },
        onFinding: (f) => {
            if (!quiet && f.severity === 'error') console.log(`  VIRHE: ${f.check}: ${f.message}`);
        }
    };

    const run = Simulaattori.createRun(options);
    let interrupted = false;
    process.on('SIGINT', () => {
        if (interrupted) process.exit(130);
        interrupted = true;
        console.log('\nPysäytetään (paina Ctrl+C uudelleen keskeyttääksesi heti)...');
        run.stop();
    });

    let report;
    try {
        report = await run.start();
    } finally {
        if (server) server.child.kill();
    }

    const file = args.tulos && args.tulos !== true
        ? path.resolve(String(args.tulos))
        : path.join(__dirname, 'tulokset', `ajo-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(report, null, 2));

    console.log('');
    console.log(`Valmis ${formatMs(report.durationMs)}. Siemen ${report.options.seed}.`);
    printSummary(report);
    printFindings(report);
    console.log('');
    console.log(`Tulos: ${file}`);

    const failing = report.errors + (args['tunnetut-virheiksi'] ? report.known : 0);
    return failing > 0 ? 1 : 0;
}

main().then(code => process.exit(code), err => {
    console.error(`Virhe: ${err && err.message}`);
    process.exit(2);
});
