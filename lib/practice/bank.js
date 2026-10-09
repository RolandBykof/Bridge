/**
 * The declarer practice deal bank: data/practice/<spec id>.json, written by
 * scripts/generate-practice-deals.js and committed with the code, so the
 * server never has to generate deals itself.
 *
 * File format:
 *   { "spec": "major-game", "label": "...", "generated": "2026-10-09",
 *     "deals": [ { "id": "major-game-0001", "pbn": "N:...", "contract": "4S",
 *                  "declarer": "south", "ddTricks": 10, "note": null } ] }
 */

const fs = require('fs');
const path = require('path');
const { parseDealString } = require('../deal');
const { parseContract } = require('./constraints');
const { MIXED_ID } = require('./specs');

const BANK_DIR = path.join(__dirname, '..', '..', 'data', 'practice');

function bankFilePath(dir, specId) {
  return path.join(dir, `${specId}.json`);
}

/** The bank file's contents, or null if there is none yet. */
function readBankFile(file) {
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/**
 * A bank file as text: one deal per line, so a git diff shows exactly which
 * deals were added, removed or annotated.
 */
function formatBankFile({ spec, label, generated, deals }) {
  const header = [
    `  "spec": ${JSON.stringify(spec)}`,
    `  "label": ${JSON.stringify(label)}`,
    `  "generated": ${JSON.stringify(generated)}`
  ];
  const lines = deals.map(entry => `    ${JSON.stringify(entry)}`);
  const dealsBlock = lines.length > 0 ? `[\n${lines.join(',\n')}\n  ]` : '[]';
  return `{\n${header.join(',\n')},\n  "deals": ${dealsBlock}\n}\n`;
}

/** Throws if a bank entry can't be played. */
function validateEntry(entry) {
  if (!entry || !entry.id) throw new Error('Deal has no id');
  parseDealString(entry.pbn);
  parseContract(entry.contract);
  if (!['north', 'east', 'south', 'west'].includes(entry.declarer)) {
    throw new Error(`${entry.id}: invalid declarer ${entry.declarer}`);
  }
  if (!Number.isInteger(entry.ddTricks) || entry.ddTricks < 0 || entry.ddTricks > 13) {
    throw new Error(`${entry.id}: invalid ddTricks ${entry.ddTricks}`);
  }
}

/**
 * Read every bank file in `dir`. Broken deals are left out with a warning
 * rather than stopping the server. Returns { specId: [entries] }.
 */
function loadBank(dir = BANK_DIR, { warn = console.warn } = {}) {
  const bank = {};
  if (!fs.existsSync(dir)) return bank;

  for (const name of fs.readdirSync(dir).filter(n => n.endsWith('.json')).sort()) {
    let data;
    try {
      data = readBankFile(path.join(dir, name));
    } catch (err) {
      warn(`Practice bank ${name}: ${err.message}`);
      continue;
    }
    const specId = (data && data.spec) || path.basename(name, '.json');
    const deals = [];
    for (const entry of (data && data.deals) || []) {
      try {
        validateEntry(entry);
        deals.push(entry);
      } catch (err) {
        warn(`Practice bank ${name}: ${err.message}`);
      }
    }
    if (deals.length > 0) bank[specId] = deals;
  }
  return bank;
}

/**
 * Deal picking on top of a loaded bank.
 *
 * pickDeal(specId, excludeIds, rng) returns a random deal of that type not in
 * excludeIds (ids already played at the table), with its hands parsed:
 * { id, pbn, contract, declarer, ddTricks, note, spec, hands, recycled }.
 * Once every deal has been played, it picks from all of them again and sets
 * recycled: true so the caller can start a new round. 'mixed' first picks a
 * type, weighting each by its remaining deals. Returns null for a type with
 * no deals.
 */
function createBank(dir = BANK_DIR, options) {
  const bank = loadBank(dir, options);

  function pickDeal(specId, excludeIds = [], rng = Math.random) {
    const excluded = new Set(excludeIds);
    const pools = specId === MIXED_ID
      ? Object.entries(bank)
      : (bank[specId] ? [[specId, bank[specId]]] : []);
    if (pools.length === 0) return null;

    let candidates = [];
    for (const [id, deals] of pools) {
      for (const entry of deals) {
        if (!excluded.has(entry.id)) candidates.push([id, entry]);
      }
    }
    const recycled = candidates.length === 0;
    if (recycled) {
      for (const [id, deals] of pools) {
        for (const entry of deals) candidates.push([id, entry]);
      }
    }

    const [spec, entry] = candidates[Math.floor(rng() * candidates.length)];
    return { ...entry, spec, hands: parseDealString(entry.pbn), recycled };
  }

  return {
    pickDeal,
    specIds: () => Object.keys(bank),
    count: (specId) => specId === MIXED_ID
      ? Object.values(bank).reduce((sum, deals) => sum + deals.length, 0)
      : (bank[specId] || []).length
  };
}

module.exports = { BANK_DIR, bankFilePath, readBankFile, formatBankFile, validateEntry, loadBank, createBank };
