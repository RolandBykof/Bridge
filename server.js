const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// CORS-asetukset
app.use(cors());

// Staattiset tiedostot
app.use(express.static(path.join(__dirname, 'public')));

// GIB API -välityspalvelin
app.get('/api/gib/deal', async (req, res) => {
    try {
        const response = await axios.get('http://gibrest.bridgebase.com/u_dealer/u_dealer.php', {
            params: {
                reuse: 'n',
                n: 1
            }
        });
        
        res.set('Content-Type', 'application/xml');
        res.send(response.data);
    } catch (error) {
        console.error('Virhe GIB-palvelusta:', error.message);
        res.status(500).json({ error: 'Virhe GIB-palvelusta' });
    }
});

app.get('/api/gib/robot', async (req, res) => {
    try {
        // Välitetään kaikki query-parametrit GIB:lle
        const response = await axios.get('http://gibrest.bridgebase.com/u_bm/robot.php', {
            params: req.query
        });
        
        res.set('Content-Type', 'application/xml');
        res.send(response.data);
    } catch (error) {
        console.error('Virhe GIB-palvelusta:', error.message);
        res.status(500).json({ error: 'Virhe GIB-palvelusta' });
    }
});

app.get('/api/gib/bid-meanings', async (req, res) => {
    try {
        const response = await axios.get('http://gibrest.bridgebase.com/u_bm/u_bm.php', {
            params: req.query
        });
        
        res.set('Content-Type', 'application/xml');
        res.send(response.data);
    } catch (error) {
        console.error('Virhe GIB-palvelusta:', error.message);
        res.status(500).json({ error: 'Virhe GIB-palvelusta' });
    }
});

// SPA fallback
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Palvelin käynnissä portissa ${PORT}`);
});
