/**
 * Declarer practice types. Each type gets its own deal bank file,
 * data/practice/<id>.json, made by scripts/generate-practice-deals.js.
 *
 *   contracts            one is picked at random for each deal
 *   constraints          hand constraints for every contract (see constraints.js)
 *   suitConstraints      added for suit contracts only
 *   notrumpConstraints   added for no-trump contracts only
 *   dd                   double dummy tricks for declarer: a number of tricks,
 *                        'contract' (exactly the tricks needed) or e.g. 'contract+1'
 *
 * A new type needs only a new entry here and a run of the script.
 * 'mixed' is not listed: it picks a deal from any of these banks.
 */

const MIXED_ID = 'mixed';

const SPECS = [
  {
    id: 'partscore',
    label: 'Partscore: 2 or 3 of a suit, 1 no trump',
    contracts: ['2S', '2H', '3D', '3C', '1N'],
    constraints: {
      side: { hcp: [20, 24] }
    },
    suitConstraints: {
      side: { trumpLength: [8, 10] },
      declarer: { trumpLength: [4, 7] }
    },
    notrumpConstraints: {
      side: { noMajorFit: true },
      declarer: { balanced: true }
    },
    dd: { min: 'contract', max: 'contract' }
  },
  {
    id: 'notrump-game',
    label: '3 no trump',
    contracts: ['3N'],
    constraints: {
      side: { hcp: [24, 28], maxSuitLength: 6, noMajorFit: true },
      declarer: { balanced: true, hcp: [12, 19] }
    },
    dd: { min: 'contract', max: 'contract' }
  },
  {
    id: 'major-game',
    label: '4 hearts or 4 spades',
    contracts: ['4S', '4H'],
    constraints: {
      side: { hcp: [23, 29], trumpLength: [8, 9] },
      declarer: { trumpLength: [4, 6] },
      dummy: { trumpLength: [3, 5] }
    },
    dd: { min: 'contract', max: 'contract' }
  },
  {
    id: 'minor-game',
    label: '5 clubs or 5 diamonds',
    contracts: ['5C', '5D'],
    constraints: {
      side: { hcp: [26, 31], trumpLength: [9, 11], noMajorFit: true },
      declarer: { trumpLength: [4, 7] }
    },
    dd: { min: 'contract', max: 'contract' }
  },
  {
    id: 'slam',
    label: 'Small slam: 6 of a suit or 6 no trump',
    contracts: ['6S', '6H', '6D', '6C', '6N'],
    constraints: {
      side: { hcp: [31, 36] }
    },
    suitConstraints: {
      side: { trumpLength: [8, 11] },
      declarer: { trumpLength: [4, 7] }
    },
    notrumpConstraints: {
      side: { noMajorFit: true },
      declarer: { balanced: true }
    },
    dd: { min: 'contract', max: 'contract' }
  }
];

function getSpec(id) {
  return SPECS.find(spec => spec.id === id) || null;
}

module.exports = { SPECS, MIXED_ID, getSpec };
