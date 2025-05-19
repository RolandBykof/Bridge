const axios = require('axios');
const DOMParser = require('xmldom').DOMParser;

// GIB API endpoints
const GIB_DEALER_URL = 'http://gibrest.bridgebase.com/u_dealer/u_dealer.php';
const GIB_ROBOT_URL = 'http://gibrest.bridgebase.com/u_bm/robot.php';
const GIB_MEANINGS_URL = 'http://gibrest.bridgebase.com/u_bm/u_bm.php';

// GIB API endpoint handlers for Express
async function getDealEndpoint(req, res) {
  try {
    const response = await axios.get(GIB_DEALER_URL, {
      params: {
        reuse: 'n',
        n: 1
      }
    });
    
    res.set('Content-Type', 'application/xml');
    res.send(response.data);
  } catch (error) {
    console.error('Error from GIB service:', error.message);
    res.status(500).json({ error: 'Error from GIB service' });
  }
}

async function getRobotMoveEndpoint(req, res) {
  try {
    // Pass all query parameters to GIB
    const response = await axios.get(GIB_ROBOT_URL, {
      params: req.query
    });
    
    res.set('Content-Type', 'application/xml');
    res.send(response.data);
  } catch (error) {
    console.error('Error from GIB service:', error.message);
    res.status(500).json({ error: 'Error from GIB service' });
  }
}

async function getBidMeaningsEndpoint(req, res) {
  try {
    const response = await axios.get(GIB_MEANINGS_URL, {
      params: req.query
    });
    
    res.set('Content-Type', 'application/xml');
    res.send(response.data);
  } catch (error) {
    console.error('Error from GIB service:', error.message);
    res.status(500).json({ error: 'Error from GIB service' });
  }
}

// Internal GIB service functions
async function getDeal() {
  try {
    const response = await axios.get(GIB_DEALER_URL, {
      params: {
        reuse: 'n',
        n: 1
      }
    });
    
    const text = response.data;
    const parser = new DOMParser();
    const xml = parser.parseFromString(text, "text/xml");
    
    const dealElement = xml.getElementsByTagName('sc_deal')[0];
    if (!dealElement) {
      throw new Error('No cards received');
    }
    
    // Get hands
    const north = dealElement.getAttribute('north');
    const east = dealElement.getAttribute('east');
    const south = dealElement.getAttribute('south');
    const west = dealElement.getAttribute('west');
    
    return { north, east, south, west };
  } catch (error) {
    console.error('Error fetching deal from GIB:', error);
    return null;
  }
}

async function getGIBMove(params) {
  try {
    const response = await axios.get(GIB_ROBOT_URL, {
      params: params
    });
    
    const text = response.data;
    const parser = new DOMParser();
    const xml = parser.parseFromString(text, "text/xml");
    
    // Check for errors
    const errorAttr = xml.documentElement.getAttribute('err');
    if (errorAttr && errorAttr !== '0') {
      throw new Error(`GIB API error: ${errorAttr}`);
    }
    
    // Get move information
    const rElement = xml.getElementsByTagName('r')[0];
    if (!rElement) {
      throw new Error('No suggestion received');
    }
    
    const type = rElement.getAttribute('type');
    let move = null;
    
    if (type === 'play') {
      move = {
        type: 'play',
        card: rElement.getAttribute('card')
      };
    } else if (type === 'bid') {
      move = {
        type: 'bid',
        bid: rElement.getAttribute('bid')
      };
    }
    
    return move;
  } catch (error) {
    console.error('Error fetching GIB move:', error);
    return null;
  }
}

async function getBidMeanings(bidSequence) {
  try {
    const response = await axios.get(GIB_MEANINGS_URL, {
      params: {
        t: 'g',
        s: bidSequence
      }
    });
    
    const text = response.data;
    const parser = new DOMParser();
    const xml = parser.parseFromString(text, "text/xml");
    
    // Check for errors
    const errorAttr = xml.documentElement.getAttribute('err');
    if (errorAttr && errorAttr !== '0') {
      throw new Error(`GIB API error: ${errorAttr}`);
    }
    
    // Get bid meanings
    const results = [];
    const rElements = xml.getElementsByTagName('r');
    
    for (let i = 0; i < rElements.length; i++) {
      const bid = rElements[i].getAttribute('b');
      const meaning = rElements[i].getAttribute('m');
      results.push({ bid, meaning });
    }
    
    return results;
  } catch (error) {
    console.error('Error fetching bid meanings:', error);
    return [];
  }
}

module.exports = {
  getDealEndpoint,
  getRobotMoveEndpoint,
  getBidMeaningsEndpoint,
  getDeal,
  getGIBMove,
  getBidMeanings
};