/**
 * ENHANCED LOCAL AI - Monte Carlo Bidding System
 * Korvaa calculateAdvancedBid funktion server.js:ssä
 */

// Simulaatioparametrit tarjousvaiheelle
const BIDDING_MONTE_CARLO = {
  SIMULATIONS: 1000,        // Simulaatioita per tarjous
  CONFIDENCE_THRESHOLD: 0.6, // Minimi luottamus aggressiiviseen tarjoukseen
  MAX_BIDDING_ROUNDS: 20    // Maksimi tarjouskierroksia simulaatiossa
};

/**
 * Parannettu tarjousfunktio Monte Carlo -simulaatiolla
 * @param {Object} table - Table object
 * @param {string} position - Bidder position  
 * @param {Array} possibleBids - Available bids
 * @return {string} Calculated bid
 */
function calculateAdvancedBid(table, position, possibleBids) {
  const hand = table.gameState.hands[position];
  const bidHistory = table.biddingState.bidHistory;
  
  console.log(`🧠 Monte Carlo bidding analysis for ${position}...`);
  
  // Quick conventional responses (ei tarvitse simulaatiota)
  const quickResponse = checkQuickConventionalBids(table, position, hand, possibleBids);
  if (quickResponse) {
    console.log(`✅ Quick conventional bid: ${quickResponse}`);
    return quickResponse;
  }
  
  // Monte Carlo analyysi jokaiselle mahdolliselle tarjoukselle
  const bidEvaluations = [];
  
  for (const bid of possibleBids) {
    console.log(`   Evaluating bid: ${bid}`);
    const expectedValue = evaluateBidWithMonteCarlo(table, position, bid, hand, bidHistory);
    
    bidEvaluations.push({
      bid,
      expectedValue,
      confidence: expectedValue.confidence
    });
  }
  
  // Järjestä tulosten mukaan
  bidEvaluations.sort((a, b) => b.expectedValue.score - a.expectedValue.score);
  
  console.log(`📊 Bid evaluations for ${position}:`, 
    bidEvaluations.map(e => `${e.bid}: ${e.expectedValue.score.toFixed(3)}`).join(', ')
  );
  
  // Valitse paras tarjous (konservatiivinen lähestymistapa)
  const bestBid = bidEvaluations[0];
  
  // Varmista että luottamus on riittävä aggressiivisiin tarjouksiin
  if (isAggressiveBid(bestBid.bid, bidHistory) && 
      bestBid.confidence < BIDDING_MONTE_CARLO.CONFIDENCE_THRESHOLD) {
    
    console.log(`⚠️  ${bestBid.bid} too risky (confidence: ${bestBid.confidence.toFixed(2)}), choosing safer option`);
    
    // Etsi konservatiivisempi vaihtoehto
    for (const evaluation of bidEvaluations) {
      if (!isAggressiveBid(evaluation.bid, bidHistory) || 
          evaluation.confidence >= BIDDING_MONTE_CARLO.CONFIDENCE_THRESHOLD) {
        console.log(`✅ Conservative choice: ${evaluation.bid}`);
        return evaluation.bid;
      }
    }
  }
  
  console.log(`✅ Best bid for ${position}: ${bestBid.bid} (score: ${bestBid.expectedValue.score.toFixed(3)})`);
  return bestBid.bid;
}

/**
 * Monte Carlo evaluointi yksittäiselle tarjoukselle
 * @param {Object} table - Table object
 * @param {string} position - Bidder position
 * @param {string} candidateBid - Bid to evaluate
 * @param {Object} hand - Player's hand
 * @param {Array} bidHistory - Bidding history
 * @return {Object} Expected value and confidence
 */
function evaluateBidWithMonteCarlo(table, position, candidateBid, hand, bidHistory) {
  let totalScore = 0;
  let validSimulations = 0;
  const outcomes = [];
  
  for (let sim = 0; sim < BIDDING_MONTE_CARLO.SIMULATIONS; sim++) {
    try {
      // 1. Generoi käsijako joka on yhteensopiva tarjoushistorian kanssa
      const simulatedDeal = generateCompatibleDeal(hand, position, bidHistory);
      
      // 2. Simuloi tarjoussekvenssi loppuun
      const auctionResult = simulateAuctionSequence(
        table, position, candidateBid, simulatedDeal, bidHistory
      );
      
      if (!auctionResult || !auctionResult.finalContract) {
        continue; // Epäkelpo simulaatio
      }
      
      // 3. Arvioi lopullisen sopimuksen onnistuminen
      const contractResult = evaluateContractSuccess(
        auctionResult.finalContract, 
        auctionResult.declarer,
        simulatedDeal
      );
      
      // 4. Laske pistemäärä tämän simulaation perusteella
      const simScore = calculateBiddingScore(
        contractResult, position, auctionResult.declarer, table.gameState.vulnerability
      );
      
      totalScore += simScore;
      validSimulations++;
      outcomes.push(simScore);
      
    } catch (error) {
      console.error(`Simulation error for ${candidateBid}:`, error.message);
      continue;
    }
  }
  
  if (validSimulations === 0) {
    return { score: -999, confidence: 0 };
  }
  
  const averageScore = totalScore / validSimulations;
  const confidence = calculateConfidence(outcomes);
  
  return {
    score: averageScore,
    confidence,
    validSimulations
  };
}

/**
 * Generoi käsijako joka on yhteensopiva tarjoushistorian kanssa
 * @param {Object} knownHand - Tiedossa oleva käsi
 * @param {string} knownPosition - Tunnettu positio
 * @param {Array} bidHistory - Tarjoushistoria
 * @return {Object} Simuloitu käsijako
 */
function generateCompatibleDeal(knownHand, knownPosition, bidHistory) {
  const allCards = generateFullDeck();
  const usedCards = extractCardsFromHand(knownHand);
  const remainingCards = allCards.filter(card => 
    !usedCards.some(used => used.suit === card.suit && used.value === card.value)
  );
  
  // Shuffle remaining cards
  shuffleArray(remainingCards);
  
  // Create hands for other positions
  const positions = ['north', 'east', 'south', 'west'];
  const simulatedHands = {
    [knownPosition]: knownHand
  };
  
  let cardIndex = 0;
  for (const position of positions) {
    if (position === knownPosition) continue;
    
    simulatedHands[position] = {
      spades: [],
      hearts: [],
      diamonds: [],
      clubs: []
    };
    
    // Deal 13 cards to this position
    for (let i = 0; i < 13; i++) {
      if (cardIndex >= remainingCards.length) break;
      
      const card = remainingCards[cardIndex++];
      simulatedHands[position][card.suit].push(card.value);
    }
    
    // Sort each suit
    for (const suit of ['spades', 'hearts', 'diamonds', 'clubs']) {
      simulatedHands[position][suit].sort((a, b) => 
        ['2','3','4','5','6','7','8','9','10','J','Q','K','A'].indexOf(b) - 
        ['2','3','4','5','6','7','8','9','10','J','Q','K','A'].indexOf(a)
      );
    }
  }
  
  // Apply constraints based on bidding history
  applyBiddingConstraints(simulatedHands, bidHistory);
  
  return simulatedHands;
}

/**
 * Simuloi tarjoussekvenssi loppuun
 * @param {Object} table - Table object
 * @param {string} startPosition - Aloittava pelaaja
 * @param {string} firstBid - Ensimmäinen tarjous
 * @param {Object} simulatedHands - Simuloidut kädet
 * @param {Array} existingHistory - Olemassa oleva historia
 * @return {Object} Auction result
 */
function simulateAuctionSequence(table, startPosition, firstBid, simulatedHands, existingHistory) {
  const auctionHistory = [...existingHistory];
  
  // Lisää ensimmäinen tarjous
  auctionHistory.push({
    player: startPosition,
    bid: firstBid,
    round: Math.floor(auctionHistory.length / 4) + 1
  });
  
  let currentPlayer = getNextPlayer(startPosition);
  let consecutivePasses = firstBid === 'P' ? 1 : 0;
  let rounds = 0;
  
  // Simuloi tarjoussekvenssi
  while (rounds < BIDDING_MONTE_CARLO.MAX_BIDDING_ROUNDS) {
    // Tarkista onko tarjousvaihe ohi
    if (isAuctionComplete(auctionHistory, consecutivePasses)) {
      break;
    }
    
    // Simuloi nykyisen pelaajan tarjous
    const simulatedBid = simulatePlayerBid(
      currentPlayer, 
      simulatedHands[currentPlayer], 
      auctionHistory,
      getHighestBid(auctionHistory)
    );
    
    auctionHistory.push({
      player: currentPlayer,
      bid: simulatedBid,
      round: Math.floor(auctionHistory.length / 4) + 1
    });
    
    // Update consecutive passes
    if (simulatedBid === 'P') {
      consecutivePasses++;
    } else {
      consecutivePasses = 0;
    }
    
    currentPlayer = getNextPlayer(currentPlayer);
    rounds++;
  }
  
  // Analysoi lopputulos
  const finalContract = determineFinalContract(auctionHistory);
  const declarer = finalContract ? determineDeclarer(auctionHistory, finalContract) : null;
  
  return {
    auctionHistory,
    finalContract,
    declarer,
    rounds
  };
}

/**
 * Simuloi yksittäisen pelaajan tarjous
 * @param {string} position - Player position
 * @param {Object} hand - Player's hand
 * @param {Array} auctionHistory - Current auction
 * @param {string} highestBid - Highest bid so far
 * @return {string} Simulated bid
 */
function simulatePlayerBid(position, hand, auctionHistory, highestBid) {
  const points = calculateBasicHCP(hand);
  const shape = analyzeHandShape(hand);
  const possibleBids = getPossibleBids(highestBid);
  
  // Yksinkertainen simulaatiologiikka (voidaan parantaa)
  
  // Pass if weak
  if (points < 6 && auctionHistory.length > 4) {
    return 'P';
  }
  
  // Check for conventional responses
  const conventionalBid = checkBiddingConventions(
    { gameState: { hands: { [position]: hand } }, biddingState: { bidHistory: auctionHistory } },
    position, hand, points, shape, auctionHistory, possibleBids
  );
  
  if (conventionalBid && possibleBids.includes(conventionalBid)) {
    return conventionalBid;
  }
  
  // Opening bid logic
  if (auctionHistory.length === 0 || auctionHistory.every(bid => bid.bid === 'P')) {
    return calculateOpeningBid(hand, points, shape, possibleBids);
  }
  
  // Simple response logic
  if (points >= 6) {
    const partnerBids = auctionHistory.filter(bid => bid.player === getPartnerPosition(position));
    if (partnerBids.length > 0 && partnerBids[partnerBids.length - 1].bid !== 'P') {
      return calculateResponseBid(hand, points, shape, partnerBids, possibleBids);
    }
  }
  
  // Conservative approach - pass more often in simulation
  if (Math.random() < 0.3) return 'P';
  
  return 'P';
}

/**
 * Arvioi sopimuksen onnistuminen double-dummy analyysillä
 * @param {string} contract - Final contract (e.g., "4H")
 * @param {string} declarer - Declarer position
 * @param {Object} allHands - All four hands
 * @return {Object} Contract result
 */
function evaluateContractSuccess(contract, declarer, allHands) {
  if (!contract || contract === 'P') {
    return { made: false, tricks: 0, target: 0 };
  }
  
  const level = parseInt(contract.charAt(0));
  const suit = contract.charAt(1);
  const target = level + 6;
  
  // Yksinkertainen double-dummy simulaatio
  // (Tämä voitaisiin korvata oikealla double-dummy algoritmilla)
  const declarerSide = declarer === 'north' || declarer === 'south' ? 'ns' : 'ew';
  
  // Arvio pisteiden perusteella
  const declarerPoints = calculateBasicHCP(allHands[declarer]);
  const dummyPosition = getPartnerPosition(declarer);
  const dummyPoints = calculateBasicHCP(allHands[dummyPosition]);
  const totalPoints = declarerPoints + dummyPoints;
  
  // Arvio fit:in perusteella
  const trumpSuit = suit === 'N' ? null : getSuitFromSymbol(suit);
  let trumpLength = 0;
  if (trumpSuit) {
    trumpLength = allHands[declarer][trumpSuit].length + allHands[dummyPosition][trumpSuit].length;
  }
  
  // Yksinkertainen onnistumisarvio
  let estimatedTricks = 6; // Base tricks
  
  // Pisteiden perusteella
  estimatedTricks += Math.floor(totalPoints / 4);
  
  // Trump fit bonus
  if (trumpSuit && trumpLength >= 8) {
    estimatedTricks += (trumpLength - 7);
  }
  
  // NT bonus for balanced hands
  if (!trumpSuit && totalPoints >= 25) {
    estimatedTricks += 1;
  }
  
  // Satunnaisuus simuloimaan taktista peliä
  estimatedTricks += Math.floor(Math.random() * 3) - 1; // -1 to +1
  
  const made = estimatedTricks >= target;
  const overtricks = Math.max(0, estimatedTricks - target);
  const undertricks = Math.max(0, target - estimatedTricks);
  
  return {
    made,
    tricks: estimatedTricks,
    target,
    overtricks,
    undertricks,
    declarerSide
  };
}

/**
 * Laske pistemäärä tarjous-simulaatiolle
 * @param {Object} contractResult - Contract result
 * @param {string} playerPosition - Player's position
 * @param {string} declarer - Declarer position
 * @param {string} vulnerability - Vulnerability
 * @return {number} Score for this simulation
 */
function calculateBiddingScore(contractResult, playerPosition, declarer, vulnerability) {
  if (!contractResult || !declarer) {
    return 0; // No contract
  }
  
  const isPlayerDeclarerSide = 
    (playerPosition === declarer) || 
    (playerPosition === getPartnerPosition(declarer));
  
  let score = 0;
  
  if (contractResult.made) {
    if (isPlayerDeclarerSide) {
      // Player's side made contract
      score = 100; // Base success score
      score += contractResult.overtricks * 10; // Bonus for overtricks
      
      // Game bonus
      if (contractResult.target >= 10) { // 4-level or higher
        score += 50;
      }
      
      // NT bonus
      if (contractResult.target >= 9 && contractResult.target < 10) { // 3NT
        score += 30;
      }
    } else {
      // Opponents made contract - bad for player
      score = -50;
      score -= contractResult.overtricks * 5;
    }
  } else {
    if (isPlayerDeclarerSide) {
      // Player's side failed
      score = -100;
      score -= contractResult.undertricks * 20; // Penalty for going down
    } else {
      // Opponents failed - good for player
      score = 75;
      score += contractResult.undertricks * 15; // Bonus for defeating contract
    }
  }
  
  // Vulnerability adjustments
  if (vulnerability && vulnerability !== '-') {
    if (contractResult.made && isPlayerDeclarerSide) {
      score += 20; // Vulnerable game bonus
    } else if (!contractResult.made && isPlayerDeclarerSide) {
      score -= 30; // Vulnerable penalty
    }
  }
  
  return score;
}

/**
 * Helper functions
 */

function checkQuickConventionalBids(table, position, hand, possibleBids) {
  // Nopeat konventionaaliset vastaukset joita ei tarvitse simuloida
  const bidHistory = table.biddingState.bidHistory;
  const partnerBids = bidHistory.filter(bid => bid.player === getPartnerPosition(position));
  
  if (partnerBids.length === 0) return null;
  
  const lastPartnerBid = partnerBids[partnerBids.length - 1].bid;
  
  // Stayman responses (automatic)
  if (lastPartnerBid === '2C' && bidHistory.some(bid => bid.player === position && bid.bid === '1N')) {
    if (hand.spades.length >= 4 && possibleBids.includes('2S')) return '2S';
    if (hand.hearts.length >= 4 && possibleBids.includes('2H')) return '2H';
    if (possibleBids.includes('2D')) return '2D';
  }
  
  return null;
}

function isAggressiveBid(bid, bidHistory) {
  if (bid === 'P') return false;
  
  const level = parseInt(bid.charAt(0));
  
  // Game level or higher is aggressive
  if (level >= 4) return true;
  
  // Jumping levels is aggressive
  const highestBid = getHighestBid(bidHistory);
  if (highestBid) {
    const highestLevel = parseInt(highestBid.charAt(0));
    if (level > highestLevel + 1) return true;
  }
  
  return false;
}

function calculateConfidence(outcomes) {
  if (outcomes.length === 0) return 0;
  
  const mean = outcomes.reduce((sum, val) => sum + val, 0) / outcomes.length;
  const variance = outcomes.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / outcomes.length;
  const stdDev = Math.sqrt(variance);
  
  // Lower standard deviation = higher confidence
  return Math.max(0, Math.min(1, 1 - (stdDev / 200)));
}

function generateFullDeck() {
  const deck = [];
  const suits = ['spades', 'hearts', 'diamonds', 'clubs'];
  const values = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
  
  for (const suit of suits) {
    for (const value of values) {
      deck.push({ suit, value });
    }
  }
  
  return deck;
}

function extractCardsFromHand(hand) {
  const cards = [];
  for (const suit of ['spades', 'hearts', 'diamonds', 'clubs']) {
    for (const value of hand[suit] || []) {
      cards.push({ suit, value });
    }
  }
  return cards;
}

function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
}

function applyBiddingConstraints(hands, bidHistory) {
  // Yksinkertainen rajoitusten soveltaminen
  // Tämä voitaisiin kehittää paljon pidemmälle
  
  for (const bid of bidHistory) {
    const position = bid.player;
    const bidValue = bid.bid;
    
    // Jos pelaaja on avannut 1NT, rajoita käsi balanced + 15-17 HCP
    if (bidValue === '1N') {
      // Voitaisiin säätää simuloitua kättä vastaamaan 1NT avausta
      // Mutta tämä on monimutkaista, jätetään yksinkertaiseksi nyt
    }
  }
}

function isAuctionComplete(auctionHistory, consecutivePasses) {
  if (auctionHistory.length < 4) return false;
  
  // Four passes at start
  if (auctionHistory.length === 4 && 
      auctionHistory.every(bid => bid.bid === 'P')) {
    return true;
  }
  
  // Three passes after someone bid
  if (consecutivePasses >= 3 && auctionHistory.length > 4) {
    const hasNonPass = auctionHistory.some(bid => bid.bid !== 'P');
    return hasNonPass;
  }
  
  return false;
}

function getHighestBid(auctionHistory) {
  for (let i = auctionHistory.length - 1; i >= 0; i--) {
    const bid = auctionHistory[i].bid;
    if (bid !== 'P' && bid !== 'X' && bid !== 'XX') {
      return bid;
    }
  }
  return null;
}

function determineFinalContract(auctionHistory) {
  let highestBid = null;
  let doubled = false;
  let redoubled = false;
  
  for (const bidInfo of auctionHistory) {
    if (!['P', 'X', 'XX'].includes(bidInfo.bid)) {
      highestBid = bidInfo.bid;
      doubled = false;
      redoubled = false;
    } else if (bidInfo.bid === 'X' && highestBid) {
      doubled = true;
      redoubled = false;
    } else if (bidInfo.bid === 'XX' && doubled) {
      redoubled = true;
      doubled = false;
    }
  }
  
  if (!highestBid) return null;
  
  let contract = highestBid;
  if (doubled) contract += 'X';
  if (redoubled) contract += 'XX';
  
  return contract;
}

function determineDeclarer(auctionHistory, finalContract) {
  if (!finalContract) return null;
  
  const contractSuit = finalContract.charAt(1);
  const partnerships = {
    'north-south': ['north', 'south'],
    'east-west': ['east', 'west']
  };
  
  // Find first player to bid this suit
  for (const bidInfo of auctionHistory) {
    if (bidInfo.bid.charAt(1) === contractSuit && !['P', 'X', 'XX'].includes(bidInfo.bid)) {
      return bidInfo.player;
    }
  }
  
  return 'south'; // Fallback
}