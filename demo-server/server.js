// tools/demo-server/server.js
//
// Lammio Readerin DAISY Online -demopalvelin App Store -tarkastusta varten.
//
// Toteuttaa DAISY Online Delivery Protocol v1:stä vain ne operaatiot, joita
// sovellus käyttää (lib/services/daisy_online/daisy_online_client_v1.dart):
// logOn, getServiceAttributes, setReadingSystemAttributes, getContentList,
// getContentMetadata, issueContent, getContentResources, returnContent ja
// logOff. Kirjat tarjoillaan samalta palvelimelta kansiosta books/.
//
// Ei npm-riippuvuuksia: pelkät Noden sisäänrakennetut moduulit, jotta
// käyttöönotto Azureen on pelkkä tiedostojen kopiointi.
//
// Lainojen malli on tavallinen kirjasto: käyttöön otettu kirja siirtyy
// "Saatavilla"-listalta "Lainassa"-listalle, ja palautettu kirja palaa
// takaisin "Saatavilla"-listalle. Kirja ei siis koskaan katoa palvelimelta.
// Tila pidetään muistissa ja palautuu alkutilaan, kun palvelinta ei ole
// käytetty STATE_RESET_HOURS tuntiin tai kun palvelin käynnistyy uudelleen.

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ─── Asetukset ympäristömuuttujista ─────────────────────────────────────────

const PORT = Number(process.env.PORT) || 8080;
const DEMO_USERNAME = process.env.DEMO_USERNAME || 'demo';
const DEMO_PASSWORD = process.env.DEMO_PASSWORD || 'demo';
const BOOKS_DIR = path.resolve(process.env.BOOKS_DIR || path.join(__dirname, 'books'));
// Julkinen perusosoite, esim. "https://lammio-demo.azurewebsites.net". Jos
// tyhjä, päätellään pyynnön otsakkeista (Azure välittää X-Forwarded-Proton).
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '');
const LOAN_DAYS = Number(process.env.LOAN_DAYS) || 30;
const STATE_RESET_HOURS = Number(process.env.STATE_RESET_HOURS) || 12;
const SESSION_IDLE_MINUTES = Number(process.env.SESSION_IDLE_MINUTES) || 120;
// Montako kirjaa on alkutilassa valmiiksi lainassa. Näin tarkastaja voi
// kokeilla palautusta heti, vaikka ei ensin lainaisi mitään.
const INITIAL_LOANS = process.env.INITIAL_LOANS === undefined
  ? 1
  : Math.max(0, Number(process.env.INITIAL_LOANS) || 0);

const SERVICE_PATH = '/daisyonline/service';
const BOOKS_PATH = '/books/';
const NS = 'http://www.daisy.org/ns/daisy-online/';

if (!process.env.DEMO_PASSWORD) {
  console.warn('VAROITUS: DEMO_PASSWORD puuttuu, käytetään oletussalasanaa "demo". ' +
    'Aseta oma salasana ennen julkaisua.');
}

// ─── Kirjaluettelo ─────────────────────────────────────────────────────────

const MIME_TYPES = {
  '.html': 'text/html',
  '.htm': 'text/html',
  '.xhtml': 'application/xhtml+xml',
  '.smil': 'application/smil+xml',
  '.smi': 'application/smil+xml',
  '.mp3': 'audio/mpeg',
  '.mp2': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.css': 'text/css',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.xml': 'application/xml',
  '.opf': 'application/oebps-package+xml',
  '.ncx': 'application/x-dtbncx+xml',
  '.res': 'application/x-dtbresource+xml',
  '.epub': 'application/epub+zip',
  '.zip': 'application/zip',
  '.txt': 'text/plain',
};

function mimeTypeOf(file) {
  return MIME_TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
}

// Palauttaa kansion kaikki tiedostot suhteellisina polkuina (vinoviivoin).
function listFilesRecursive(dir, base = dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listFilesRecursive(full, base));
    } else if (entry.isFile()) {
      out.push(path.relative(base, full).split(path.sep).join('/'));
    }
  }
  return out;
}

function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

// Lukee tekstitiedoston merkistö huomioiden. Vanhoissa DAISY 2.02 -kirjoissa
// ncc.html on usein ISO-8859-1-muodossa.
function readTextFile(file) {
  const buf = fs.readFileSync(file);
  const head = buf.subarray(0, 1024).toString('latin1');
  const m = head.match(/(?:encoding|charset)\s*=\s*["']?([\w-]+)/i);
  const charset = m ? m[1].toLowerCase() : 'utf-8';
  if (['iso-8859-1', 'iso-8859-15', 'windows-1252', 'latin1'].includes(charset)) {
    return buf.toString('latin1');
  }
  return buf.toString('utf8');
}

// Lukee DAISY 2.02 -kirjan metatiedot ncc.html:n meta-elementeistä.
function readNccMetadata(file) {
  const text = readTextFile(file);
  const meta = {};
  for (const tag of text.match(/<meta\b[^>]*>/gi) || []) {
    const name = tag.match(/\bname\s*=\s*["']([^"']*)["']/i);
    const content = tag.match(/\bcontent\s*=\s*["']([^"']*)["']/i);
    if (name && content) {
      meta[name[1].toLowerCase()] = decodeEntities(content[1]).trim();
    }
  }
  if (!meta['dc:title']) {
    const t = text.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (t) meta['dc:title'] = decodeEntities(t[1]).trim();
  }
  return {
    title: meta['dc:title'],
    creator: meta['dc:creator'],
    publisher: meta['dc:publisher'],
    language: meta['dc:language'],
    date: meta['dc:date'],
    identifier: meta['dc:identifier'],
    format: 'Daisy 2.02',
  };
}

// Lukee kirjat kansiosta books/. Jokainen alikansio on yksi kirja, ja sen
// nimi on kirjan tunniste (contentID). Kansiossa on oltava ncc.html
// (DAISY 2.02), .opf-tiedosto (DAISY 3) tai yksi .epub-tiedosto.
// Valinnainen book.json korvaa automaattisesti luetut metatiedot.
function loadCatalog() {
  const books = new Map();
  if (!fs.existsSync(BOOKS_DIR)) {
    console.warn(`VAROITUS: kirjakansiota ei löydy: ${BOOKS_DIR}`);
    return books;
  }
  for (const entry of fs.readdirSync(BOOKS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const id = entry.name;
    if (!/^[A-Za-z0-9_-]+$/.test(id)) {
      console.warn(`Ohitetaan kansio "${id}": nimessä saa olla vain kirjaimia a-z, ` +
        'numeroita, - ja _.');
      continue;
    }
    const dir = path.join(BOOKS_DIR, id);
    const files = listFilesRecursive(dir).filter((f) => f.toLowerCase() !== 'book.json');
    const lower = files.map((f) => f.toLowerCase());

    let meta;
    let resources = files;
    const nccIndex = lower.findIndex((f) => /(^|\/)ncc\.html?$/.test(f));
    const epubIndex = lower.findIndex((f) => f.endsWith('.epub'));
    const opfIndex = lower.findIndex((f) => f.endsWith('.opf'));
    if (nccIndex >= 0) {
      meta = readNccMetadata(path.join(dir, files[nccIndex]));
    } else if (epubIndex >= 0) {
      meta = { format: 'EPUB' };
      resources = [files[epubIndex]];
    } else if (opfIndex >= 0) {
      meta = { format: 'ANSI/NISO Z39.86-2005' };
    } else {
      console.warn(`Ohitetaan kansio "${id}": ei ncc.html-, .opf- eikä .epub-tiedostoa.`);
      continue;
    }

    const jsonFile = path.join(dir, 'book.json');
    if (fs.existsSync(jsonFile)) {
      try {
        Object.assign(meta, JSON.parse(fs.readFileSync(jsonFile, 'utf8')));
      } catch (e) {
        console.warn(`Virheellinen ${jsonFile}: ${e.message}`);
      }
    }
    if (!meta.title) meta.title = id;

    const resourceInfo = resources.map((rel) => {
      const stat = fs.statSync(path.join(dir, rel));
      return { rel, size: stat.size, mtime: stat.mtime, mimeType: mimeTypeOf(rel) };
    });
    const size = resourceInfo.reduce((sum, r) => sum + r.size, 0);
    const lastModified = new Date(Math.max(...resourceInfo.map((r) => r.mtime.getTime())));
    books.set(id, { id, meta, resources: resourceInfo, size, lastModified });
  }
  return books;
}

const catalog = loadCatalog();
console.log(`Kirjoja luettelossa: ${catalog.size}`);
for (const b of catalog.values()) {
  console.log(`  ${b.id}: ${b.meta.title} (${b.resources.length} tiedostoa)`);
}

// ─── Tila: lainat ja istunnot ──────────────────────────────────────────────

// contentID → { returnBy: Date }. Demossa on yksi käyttäjä, joten lainat ovat
// palvelimen laajuisia.
let loans = new Map();
let lastActivity = Date.now();
// istuntotunniste → viimeisin käyttöhetki (ms)
const sessions = new Map();

function sortedBookIds() {
  return [...catalog.values()]
    .sort((a, b) => a.meta.title.localeCompare(b.meta.title, 'fi'))
    .map((b) => b.id);
}

function resetState() {
  loans = new Map();
  for (const id of sortedBookIds().slice(0, INITIAL_LOANS)) {
    loans.set(id, { returnBy: new Date(Date.now() + LOAN_DAYS * 86400000) });
  }
  console.log(`Lainatila alkutilaan. Lainassa: ${[...loans.keys()].join(', ') || '-'}`);
}

resetState();

function touchState() {
  const now = Date.now();
  if (now - lastActivity > STATE_RESET_HOURS * 3600000) resetState();
  lastActivity = now;
}

function sessionFrom(req) {
  const cookie = req.headers.cookie || '';
  const m = cookie.match(/(?:^|;\s*)DOSESSION=([A-Za-z0-9]+)/);
  if (!m) return null;
  const last = sessions.get(m[1]);
  if (last === undefined) return null;
  if (Date.now() - last > SESSION_IDLE_MINUTES * 60000) {
    sessions.delete(m[1]);
    return null;
  }
  sessions.set(m[1], Date.now());
  return m[1];
}

// ─── XML-apurit ────────────────────────────────────────────────────────────

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function isoDate(d) {
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

// Lukee pyynnön elementin tekstin paikallisnimellä (etuliitteestä riippumatta).
function param(body, name) {
  const m = body.match(new RegExp(`<(?:[\\w-]+:)?${name}\\b[^>]*>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>`));
  return m ? decodeEntities(m[1]).trim() : null;
}

function envelope(inner) {
  return '<?xml version="1.0" encoding="UTF-8"?>' +
    '<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/">' +
    `<SOAP-ENV:Body>${inner}</SOAP-ENV:Body>` +
    '</SOAP-ENV:Envelope>';
}

function label(text, lang = 'en') {
  return `<label xml:lang="${lang}"><text>${esc(text)}</text></label>`;
}

class SoapFault extends Error {
  constructor(faultName, message) {
    super(message);
    this.faultName = faultName;
  }
}

function faultXml(fault) {
  return envelope(
    '<SOAP-ENV:Fault>' +
    '<faultcode>SOAP-ENV:Server</faultcode>' +
    `<faultstring>${esc(fault.message)}</faultstring>` +
    `<detail><${fault.faultName} xmlns="${NS}"><reason>${esc(fault.message)}</reason>` +
    `</${fault.faultName}></detail>` +
    '</SOAP-ENV:Fault>');
}

// Palvelun juuriosoite. Kun palvelin on liitetty toisen Express-sovelluksen
// alle (esim. app.use('/daisy-demo', ...)), req.baseUrl sisältää liitospolun.
// Azuren Windows-palvelimella (IIS/iisnode) HTTPS näkyy x-arr-ssl-otsakkeena.
function baseUrl(req) {
  const mount = req.baseUrl || '';
  if (PUBLIC_BASE_URL) return PUBLIC_BASE_URL + mount;
  const forwarded = req.headers['x-forwarded-proto'];
  const proto = forwarded
    ? forwarded.split(',')[0].trim()
    : (req.headers['x-arr-ssl'] || req.connection.encrypted ? 'https' : 'http');
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}${mount}`;
}

function encodePath(rel) {
  return rel.split('/').map(encodeURIComponent).join('/');
}

function requireBook(body) {
  const id = param(body, 'contentID');
  const book = id && catalog.get(id);
  if (!book) throw new SoapFault('invalidParameterFault', `Unknown contentID: ${id}`);
  return book;
}

// ─── Operaatiot ────────────────────────────────────────────────────────────

const operations = {
  logOn(body, ctx) {
    const ok = param(body, 'username') === DEMO_USERNAME &&
      param(body, 'password') === DEMO_PASSWORD;
    if (ok) {
      const token = crypto.randomBytes(16).toString('hex');
      sessions.set(token, Date.now());
      const secure = baseUrl(ctx.req).startsWith('https:') ? '; Secure' : '';
      ctx.headers['Set-Cookie'] = `DOSESSION=${token}; Path=/; HttpOnly${secure}`;
    }
    return `<logOnResponse xmlns="${NS}"><logOnResult>${ok}</logOnResult></logOnResponse>`;
  },

  logOff(body, ctx) {
    sessions.delete(ctx.session);
    return `<logOffResponse xmlns="${NS}"><logOffResult>true</logOffResult></logOffResponse>`;
  },

  getServiceAttributes() {
    return `<getServiceAttributesResponse xmlns="${NS}"><serviceAttributes>` +
      `<serviceProvider id="lammio-reader">${label('Lammio Reader')}</serviceProvider>` +
      `<service id="lammio-reader-demo">${label('Lammio Reader Demo Library')}</service>` +
      '<supportedContentSelectionMethods><method>OUT_OF_BAND</method></supportedContentSelectionMethods>' +
      '<supportsServerSideBack>false</supportsServerSideBack>' +
      '<supportsSearch>false</supportsSearch>' +
      '<supportedUplinkAudioCodecs/>' +
      '<supportsAudioLabels>false</supportsAudioLabels>' +
      '<supportedOptionalOperations/>' +
      '</serviceAttributes></getServiceAttributesResponse>';
  },

  setReadingSystemAttributes() {
    return `<setReadingSystemAttributesResponse xmlns="${NS}">` +
      '<setReadingSystemAttributesResult>true</setReadingSystemAttributesResult>' +
      '</setReadingSystemAttributesResponse>';
  },

  getContentList(body) {
    const id = param(body, 'id');
    let ids;
    if (id === 'issued') {
      ids = sortedBookIds().filter((b) => loans.has(b));
    } else if (id === 'new') {
      ids = sortedBookIds().filter((b) => !loans.has(b));
    } else if (id === 'expired') {
      ids = [];
    } else {
      throw new SoapFault('invalidParameterFault', `Unknown list id: ${id}`);
    }

    const total = ids.length;
    const first = Math.max(0, Number(param(body, 'firstItem')) || 0);
    const lastParam = Number(param(body, 'lastItem'));
    const last = Number.isFinite(lastParam) && lastParam >= 0
      ? Math.min(lastParam, total - 1)
      : total - 1;
    const page = ids.slice(first, last + 1);

    const range = page.length > 0
      ? ` firstItem="${first}" lastItem="${first + page.length - 1}"`
      : '';
    const items = page.map((bookId) => {
      const b = catalog.get(bookId);
      return `<contentItem id="${esc(b.id)}" lastModifiedDate="${isoDate(b.lastModified)}">` +
        `${label(b.meta.title, b.meta.language || 'fi')}</contentItem>`;
    }).join('');
    return `<getContentListResponse xmlns="${NS}">` +
      `<contentList id="${esc(id)}" totalItems="${total}"${range}>${items}</contentList>` +
      '</getContentListResponse>';
  },

  getContentMetadata(body) {
    const b = requireBook(body);
    const m = b.meta;
    const opt = (tag, value) => (value ? `<dc:${tag}>${esc(value)}</dc:${tag}>` : '');
    return `<getContentMetadataResponse xmlns="${NS}">` +
      '<contentMetadata requiresReturn="true">' +
      '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">' +
      `<dc:title>${esc(m.title)}</dc:title>` +
      `<dc:identifier>${esc(b.id)}</dc:identifier>` +
      opt('publisher', m.publisher || 'Lammio Reader Demo') +
      opt('format', m.format) +
      opt('date', m.date) +
      opt('language', m.language) +
      opt('creator', m.creator) +
      `<size>${b.size}</size>` +
      '</metadata></contentMetadata></getContentMetadataResponse>';
  },

  issueContent(body) {
    const b = requireBook(body);
    if (!loans.has(b.id)) {
      loans.set(b.id, { returnBy: new Date(Date.now() + LOAN_DAYS * 86400000) });
      console.log(`Lainattu: ${b.id}`);
    }
    return `<issueContentResponse xmlns="${NS}"><issueContentResult>true</issueContentResult>` +
      '</issueContentResponse>';
  },

  getContentResources(body, ctx) {
    const b = requireBook(body);
    const loan = loans.get(b.id);
    if (!loan) {
      throw new SoapFault('invalidOperationFault', 'Content is not issued');
    }
    const base = `${baseUrl(ctx.req)}${BOOKS_PATH}${encodeURIComponent(b.id)}/`;
    const resources = b.resources.map((r) =>
      `<resource uri="${esc(base + encodePath(r.rel))}" mimeType="${esc(r.mimeType)}" ` +
      `size="${r.size}" localURI="${esc(encodePath(r.rel))}" ` +
      `lastModifiedDate="${isoDate(r.mtime)}"/>`).join('');
    return `<getContentResourcesResponse xmlns="${NS}">` +
      `<resources lastModifiedDate="${isoDate(b.lastModified)}" returnBy="${isoDate(loan.returnBy)}">` +
      `${resources}</resources></getContentResourcesResponse>`;
  },

  returnContent(body) {
    const b = requireBook(body);
    const ok = loans.delete(b.id);
    if (ok) console.log(`Palautettu: ${b.id}`);
    return `<returnContentResponse xmlns="${NS}"><returnContentResult>${ok}</returnContentResult>` +
      '</returnContentResponse>';
  },
};

// ─── HTTP ──────────────────────────────────────────────────────────────────

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 1024 * 1024) {
        reject(new Error('Request too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function handleSoap(req, res) {
  const body = await readBody(req);
  // Operaatio luetaan Body-elementin ensimmäisestä lapsesta. SOAPAction
  // (esim. "/logOn") on varalla, jos runko on poikkeuksellinen.
  const bodyMatch = body.match(/<(?:[\w-]+:)?Body\b[^>]*>\s*<(?:[\w-]+:)?(\w+)/);
  const action = (req.headers.soapaction || '').replace(/["\s]/g, '').split('/').pop();
  const opName = bodyMatch ? bodyMatch[1] : action;

  const ctx = { req, headers: {}, session: null };
  let xml;
  let status = 200;
  try {
    touchState();
    const op = Object.prototype.hasOwnProperty.call(operations, opName) && operations[opName];
    if (!op) throw new SoapFault('invalidOperationFault', `Unsupported operation: ${opName}`);
    if (opName !== 'logOn') {
      ctx.session = sessionFrom(req);
      if (!ctx.session) throw new SoapFault('noActiveSessionFault', 'No active session');
    }
    xml = envelope(op(body, ctx));
  } catch (e) {
    if (!(e instanceof SoapFault)) {
      console.error(e);
      e = new SoapFault('internalServerErrorFault', 'Internal server error');
    }
    status = 500;
    xml = faultXml(e);
  }
  console.log(`${new Date().toISOString()} ${opName} → ${status}`);
  res.writeHead(status, { 'Content-Type': 'text/xml; charset=utf-8', ...ctx.headers });
  res.end(xml);
}

// Tarjoilee kirjan tiedoston. Range-tuki on välttämätön: iOS:n äänisoitin
// pyytää striimattavan äänen paloina.
function handleBookFile(req, res, urlPath) {
  let rel;
  try {
    rel = decodeURIComponent(urlPath.slice(BOOKS_PATH.length));
  } catch {
    res.writeHead(400).end();
    return;
  }
  const file = path.resolve(BOOKS_DIR, rel);
  if (!file.startsWith(BOOKS_DIR + path.sep) || path.basename(file).toLowerCase() === 'book.json') {
    res.writeHead(404).end();
    return;
  }
  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404).end();
      return;
    }
    const headers = {
      'Content-Type': mimeTypeOf(file),
      'Accept-Ranges': 'bytes',
      'Last-Modified': stat.mtime.toUTCString(),
    };
    let start = 0;
    let end = stat.size - 1;
    let status = 200;
    const range = req.headers.range && req.headers.range.match(/^bytes=(\d*)-(\d*)$/);
    if (range && (range[1] || range[2])) {
      if (range[1]) {
        start = Number(range[1]);
        if (range[2]) end = Math.min(Number(range[2]), stat.size - 1);
      } else {
        start = Math.max(0, stat.size - Number(range[2]));
      }
      if (start > end || start >= stat.size) {
        res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }).end();
        return;
      }
      status = 206;
      headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`;
    }
    headers['Content-Length'] = end - start + 1;
    res.writeHead(status, headers);
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    fs.createReadStream(file, { start, end }).pipe(res);
  });
}

// Pyyntöjen käsittelijä. Toimii sekä omana palvelimenaan että liitettynä
// Express-sovellukseen: app.use('/daisy-demo', require('./demo-server/server')).
// Express poistaa liitospolun req.url:sta, joten polut ovat samat molemmissa.
function handler(req, res) {
  const urlPath = (req.url || '/').split('?')[0];
  // Demo ei saa näkyä hakukoneissa.
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  if (req.method === 'POST' && urlPath.replace(/\/+$/, '') === SERVICE_PATH) {
    handleSoap(req, res).catch((e) => {
      console.error(e);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  } else if ((req.method === 'GET' || req.method === 'HEAD') && urlPath.startsWith(BOOKS_PATH)) {
    handleBookFile(req, res, urlPath);
  } else if (req.method === 'GET' && urlPath === '/') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`Lammio Reader DAISY Online demo server\nBooks: ${catalog.size}\n` +
      `Service address: ${baseUrl(req)}${SERVICE_PATH}/\n`);
  } else {
    res.writeHead(404).end();
  }
}

module.exports = handler;

if (require.main === module) {
  http.createServer(handler).listen(PORT, () => {
    console.log(`Demopalvelin kuuntelee porttia ${PORT}. Palvelun polku: ${SERVICE_PATH}/`);
  });
}
