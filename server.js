const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// CORS settings
app.use(cors());

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// GIB API proxy server
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
        console.error('Error from GIB service:', error.message);
        res.status(500).json({ error: 'Error from GIB service' });
    }
});

app.get('/api/gib/robot', async (req, res) => {
    try {
        // Pass all query parameters to GIB
        const response = await axios.get('http://gibrest.bridgebase.com/u_bm/robot.php', {
            params: req.query
        });
        
        res.set('Content-Type', 'application/xml');
        res.send(response.data);
    } catch (error) {
        console.error('Error from GIB service:', error.message);
        res.status(500).json({ error: 'Error from GIB service' });
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
        console.error('Error from GIB service:', error.message);
        res.status(500).json({ error: 'Error from GIB service' });
    }
});

// SPA fallback
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
