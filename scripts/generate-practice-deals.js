#!/usr/bin/env node
/**
 * Adds new deals to the declarer practice bank (data/practice/<id>.json).
 *
 *   node scripts/generate-practice-deals.js --spec major-game --count 100
 *   node scripts/generate-practice-deals.js --all --count 50
 *   npm run practice:generate -- --count 20
 *
 * Options:
 *   --spec <id>    practice type; repeat or separate with commas for several
 *   --all          every practice type
 *   --count <n>    new deals per type (default 50)
 *   --time <s>     time limit per type in seconds (default 300)
 *   --dir <path>   bank directory (default data/practice)
 *
 * Existing deals are kept and duplicates skipped. Commit the changed files to
 * get the new deals to the server.
 */

const fs = require('fs');
const path = require('path');
const { SPECS, getSpec } = require('../lib/practice/specs');
const { generateDeals } = require('../lib/practice/generator');
const { BANK_DIR, bankFilePath, readBankFile, formatBankFile } = require('../lib/practice/bank');
const { formatDealString, parseDealString } = require('../lib/deal');

const USAGE = `Usage:
  node scripts/generate-practice-deals.js --spec <id>[,<id>...] [--count 50] [--time 300] [--dir data/practice]
  node scripts/generate-practice-deals.js --all [--count 50] [--time 300]

Practice types:
${SPECS.map(spec => `  ${spec.id.padEnd(14)} ${spec.label}`).join('\n')}`;

function parseArgs(argv) {
  const args = { specs: [], all: false, count: 50, time: 300, dir: BANK_DIR };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => {
      if (i + 1 >= argv.length) throw new Error(`${arg} needs a value`);
      return argv[++i];
    };
    if (arg === '--spec') args.specs.push(...value().split(',').map(s => s.trim()).filter(Boolean));
    else if (arg === '--all') args.all = true;
    else if (arg === '--count') args.count = Number(value());
    else if (arg === '--time') args.time = Number(value());
    else if (arg === '--dir') args.dir = path.resolve(value());
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  if (!Number.isInteger(args.count) || args.count < 1) throw new Error('--count must be a positive whole number');
  if (!(args.time > 0)) throw new Error('--time must be a positive number of seconds');
  return args;
}

function today() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function nextNumber(specId, deals) {
  let max = 0;
  for (const entry of deals) {
    const match = new RegExp(`^${specId}-(\\d+)$`).exec(entry.id || '');
    if (match) max = Math.max(max, Number(match[1]));
  }
  return max + 1;
}

function formatStats(stats) {
  return `dealt ${stats.dealt}, passed constraints ${stats.passedConstraints}, ` +
    `needed technique ${stats.passedInterest}, solved ${stats.solved}, accepted ${stats.accepted}, ` +
    `${(stats.ms / 1000).toFixed(1)} s`;
}

async function generateForSpec(spec, args) {
  const file = bankFilePath(args.dir, spec.id);
  const existing = readBankFile(file) || { deals: [] };
  const oldDeals = existing.deals || [];
  // Compare in one canonical form, whatever form a hand-edited file uses.
  const skip = new Set(oldDeals.map(entry => formatDealString(parseDealString(entry.pbn))));

  console.log(`${spec.id}: generating ${args.count} deals (${oldDeals.length} in the bank)...`);
  let lastPrint = Date.now();
  const { deals, stats } = await generateDeals(spec, {
    count: args.count,
    timeLimitMs: args.time * 1000,
    skip,
    onProgress: (progress) => {
      if (Date.now() - lastPrint >= 5000) {
        lastPrint = Date.now();
        console.log(`  ${formatStats(progress)}`);
      }
    }
  });

  let number = nextNumber(spec.id, oldDeals);
  const newEntries = deals.map(deal => ({
    id: `${spec.id}-${String(number++).padStart(4, '0')}`,
    pbn: deal.pbn,
    contract: deal.contract,
    declarer: deal.declarer,
    ddTricks: deal.ddTricks,
    note: null
  }));

  if (newEntries.length > 0) {
    fs.mkdirSync(args.dir, { recursive: true });
    fs.writeFileSync(file, formatBankFile({
      spec: spec.id,
      label: spec.label,
      generated: today(),
      deals: [...oldDeals, ...newEntries]
    }));
  }

  console.log(`${spec.id}: ${newEntries.length} new deals, ${oldDeals.length + newEntries.length} in total. ${formatStats(stats)}`);
  if (newEntries.length < args.count) {
    console.log(`  Time limit reached before ${args.count} deals. Use a longer --time or loosen the constraints in lib/practice/specs.js.`);
  }
  return newEntries.length;
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`${err.message}\n\n${USAGE}`);
    process.exit(1);
  }
  if (args.help || (!args.all && args.specs.length === 0)) {
    console.log(USAGE);
    process.exit(args.help ? 0 : 1);
  }

  const specs = args.all ? SPECS : args.specs.map(id => getSpec(id) || id);
  const unknown = specs.filter(spec => typeof spec === 'string');
  if (unknown.length > 0) {
    console.error(`Unknown practice type: ${unknown.join(', ')}\n\n${USAGE}`);
    process.exit(1);
  }

  let total = 0;
  for (const spec of specs) total += await generateForSpec(spec, args);
  console.log(`Done: ${total} new deals in ${path.relative(process.cwd(), args.dir) || '.'}.`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
