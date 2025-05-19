// Pelitilaan liittyvät apufunktiot

// Tarkistaa onko tikki täynnä
function isTrickComplete(trick) {
  return trick.length === 4;
}

// Laske pisteet korttien perusteella (high card points)
function calculateHCP(hand) {
  const values = {
    'A': 4,
    'K': 3,
    'Q': 2,
    'J': 1
  };
  
  let points = 0;
  for (const suit in hand) {
    for (const card of hand[suit]) {
      points += values[card] || 0;
    }
  }
  
  return points;
}

// Tarkista kuka voittaa tikin
function determineTrickWinner(trick, trumpSuit) {
  if (trick.length !== 4) return null;
  
  const values = {'2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, 'T': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14};
  const leadSuit = trick[0].suit;
  
  let winner = 0;
  let highValue = values[trick[0].card];
  let isHighTrump = trick[0].suit === trumpSuit;
  
  for (let i = 1; i < 4; i++) {
    const card = trick[i];
    // Trump voittaa ei-trumpin
    if (card.suit === trumpSuit && !isHighTrump) {
      winner = i;
      highValue = values[card.card];
      isHighTrump = true;
    }
    // Korkeampi trump voittaa alemman trumpin
    else if (card.suit === trumpSuit && isHighTrump && values[card.card] > highValue) {
      winner = i;
      highValue = values[card.card];
    }
    // Väriin tunnustaminen - korkeampi voittaa
    else if (card.suit === leadSuit && !isHighTrump && values[card.card] > highValue) {
      winner = i;
      highValue = values[card.card];
    }
  }
  
  return ['north', 'east', 'south', 'west'][winner];
}

// Palauttaa tarjouksen muotoiltuna
function formatBid(bid) {
  if (bid === 'P') return 'Pass';
  if (bid === 'X') return 'Double';
  if (bid === 'XX') return 'Redouble';
  
  const level = bid.charAt(0);
  const suit = bid.charAt(1);
  
  const suitSymbols = {
    'C': '♣',
    'D': '♦',
    'H': '♥',
    'S': '♠',
    'N': 'NT'
  };
  
  return `${level}${suitSymbols[suit] || suit}`;
}

module.exports = {
  isTrickComplete,
  calculateHCP,
  determineTrickWinner,
  formatBid
};