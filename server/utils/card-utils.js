// Korttien käsittelyyn liittyvät apufunktiot

// Luo uusi pakka kortteja
function createDeck() {
  const suits = ['spades', 'hearts', 'diamonds', 'clubs'];
  const values = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
  const deck = [];
  
  for (const suit of suits) {
    for (const value of values) {
      deck.push({ suit, value });
    }
  }
  
  return deck;
}

// Sekoittaa pakan
function shuffleDeck(deck) {
  const shuffled = [...deck];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

// Palauttaa kortin tekstiesityksen
function formatCard(card) {
  const suitSymbols = {
    'spades': '♠',
    'hearts': '♥',
    'diamonds': '♦',
    'clubs': '♣'
  };
  
  return `${card.value}${suitSymbols[card.suit]}`;
}

// Parillisuuden tarkistus
function getNSEW(index) {
  return ['north', 'east', 'south', 'west'][index % 4];
}

// Palauttaa kortin arvon numerona vertailua varten
function getCardValue(card) {
  const values = {'2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, 'T': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14};
  return values[card.value] || 0;
}

module.exports = {
  createDeck,
  shuffleDeck,
  formatCard,
  getNSEW,
  getCardValue
};