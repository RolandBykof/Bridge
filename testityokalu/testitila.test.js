'use strict';
// Palvelimen testitila: testisivu vastaa vain testitilassa, ROBOT_BIDDER toimii
// vain testitilassa, ja lyhyt simulaatio pelaa jakoja ilman virheitä.
const test = require('node:test');
const assert = require('node:assert');
const net = require('net');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const { io } = require('socket.io-client');
const Simulaattori = require('./simulaattori');

const SERVER = path.join(__dirname, '..', 'server.js');

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

async function startServer(extraEnv) {
    const port = await freePort();
    const env = { ...process.env, PORT: String(port) };
    delete env.TEST_MODE;
    delete env.ROBOT_BIDDER;
    delete env.TEST_DELAYS;
    Object.assign(env, extraEnv);
    const child = spawn(process.execPath, [SERVER], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stderr.on('data', (chunk) => { output += String(chunk); });
    await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Palvelin ei käynnistynyt')), 15000);
        child.stdout.on('data', (chunk) => {
            output += String(chunk);
            if (output.includes('running on port')) {
                clearTimeout(timer);
                resolve();
            }
        });
        child.once('exit', (code) => reject(new Error(`Palvelin pysähtyi: ${code}`)));
    });
    return { url: `http://localhost:${port}`, child, output: () => output };
}

function get(url) {
    return new Promise((resolve, reject) => {
        http.get(url, (res) => {
            res.resume();
            res.on('end', () => resolve(res.statusCode));
        }).on('error', reject);
    });
}

test('testisivu ei vastaa ilman testitilaa', async () => {
    const server = await startServer({});
    try {
        assert.strictEqual(await get(`${server.url}/testityokalu/`), 404);
        assert.strictEqual(await get(`${server.url}/testityokalu/simulaattori.js`), 404);
        assert.ok(!server.output().includes('TEST MODE'));
    } finally {
        server.child.kill();
    }
});

test('ROBOT_BIDDER toimii vain testitilassa', () => {
    const robot = require('../lib/robot');
    const saved = { mode: process.env.TEST_MODE, bidder: process.env.ROBOT_BIDDER };
    try {
        delete process.env.TEST_MODE;
        process.env.ROBOT_BIDDER = 'local';
        assert.strictEqual(robot.bidderMode(), 'gib');
        process.env.TEST_MODE = '1';
        assert.strictEqual(robot.bidderMode(), 'local');
        delete process.env.ROBOT_BIDDER;
        assert.strictEqual(robot.bidderMode(), 'gib');
    } finally {
        if (saved.mode === undefined) delete process.env.TEST_MODE; else process.env.TEST_MODE = saved.mode;
        if (saved.bidder === undefined) delete process.env.ROBOT_BIDDER; else process.env.ROBOT_BIDDER = saved.bidder;
    }
});

test('testitilassa testisivu vastaa ja lyhyt simulaatio menee läpi', async () => {
    const server = await startServer({ TEST_MODE: '1', ROBOT_BIDDER: 'local' });
    try {
        assert.strictEqual(await get(`${server.url}/testityokalu/`), 200);
        assert.strictEqual(await get(`${server.url}/testityokalu/tarkistimet.js`), 200);
        assert.ok(server.output().includes('TEST MODE'));

        // Passaavat ihmiset ja paikallisesti tarjoavat robotit, ja paljon
        // laittomia siirtoja (myös kahdennuksia ilman tarjousta, jotka
        // aiemmin jumittivat jaon).
        const run = Simulaattori.createRun({
            url: server.url,
            connect: (u) => io(u, { transports: ['websocket'], forceNew: true, reconnection: false }),
            configs: [0, 1, 3],
            deals: 2,
            parallel: 3,
            style: 'passer',
            illegal: true,
            illegalRate: 0.3,
            stallMs: 15000,
            seed: 42
        });
        const report = await run.start();
        const errors = report.findings.filter(f => f.severity === 'error');
        // Palvelimen loki mukaan, jotta epäonnistumisen syy näkyy
        assert.deepStrictEqual(errors.map(f => `${f.check}: ${f.message}`), [],
            errors.length ? `Palvelimen loki:\n${server.output().split('\n').filter(l => /Error|failed/.test(l)).slice(0, 20).join('\n')}` : undefined);
        for (const s of report.summary) assert.strictEqual(s.deals, 2, `kokoonpano ${s.robots}`);
        assert.ok(report.summary.some(s => s.illegalAttempts > 0), 'laittomia siirtoja kokeiltiin');
    } finally {
        server.child.kill();
    }
});
