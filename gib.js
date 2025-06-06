const express = require('express');
const axios = require('axios');
const path = require('path');
const app = express();
const PORT = 3000;

// Middleware
app.use(express.json());
app.use(express.static('.'));

// CORS headers
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    next();
});

// Bid Meanings API proxy
app.get('/api/bid-meanings', async (req, res) => {
    try {
        const { t = 'g', s = 'P-P-P-1s' } = req.query;
        
        const response = await axios.get('http://gibrest.bridgebase.com/u_bm/u_bm.php', {
            params: { t, s },
            timeout: 10000
        });
        
        res.set('Content-Type', 'application/xml');
        res.send(response.data);
    } catch (error) {
        console.error('Bid meanings error:', error.message);
        res.status(500).json({ 
            error: 'Failed to fetch bid meanings', 
            details: error.message 
        });
    }
});

// Dealer API proxy
app.get('/api/dealer', async (req, res) => {
    try {
        const { reuse = 'y', n = '1', c = '', cb = '' } = req.query;
        
        const response = await axios.get('http://gibrest.bridgebase.com/u_dealer/u_dealer.php', {
            params: { reuse, n, c, cb },
            timeout: 10000
        });
        
        res.set('Content-Type', 'application/xml');
        res.send(response.data);
    } catch (error) {
        console.error('Dealer error:', error.message);
        res.status(500).json({ 
            error: 'Failed to fetch dealer', 
            details: error.message 
        });
    }
});

// Robot API proxy
app.get('/api/robot', async (req, res) => {
    try {
        const { 
            sc = 'tp', 
            pov = 'N', 
            d = 'N', 
            v = '-',
            s = 'akq86.ak3.4.ak63',
            w = 'jt7.qt82.kt9.qt7',
            n = '952.j976.aj876.9',
            e = '43.54.q532.j8542',
            h = 'p-p-1s-2n-p-p-p'
        } = req.query;
        
        const response = await axios.get('http://gibrest.bridgebase.com/u_bm/robot.php', {
            params: { sc, pov, d, v, s, w, n, e, h },
            timeout: 10000
        });
        
        res.set('Content-Type', 'application/xml');
        res.send(response.data);
    } catch (error) {
        console.error('Robot error:', error.message);
        res.status(500).json({ 
            error: 'Failed to fetch robot response', 
            details: error.message 
        });
    }
});

// Serve index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
    console.log('Available endpoints:');
    console.log('- GET /api/bid-meanings?t=g&s=P-P-P-1s');
    console.log('- GET /api/dealer?reuse=y&n=1');
    console.log('- GET /api/robot?pov=N&d=N&s=akq86.ak3.4.ak63&w=jt7.qt82.kt9.qt7&n=952.j976.aj876.9&e=43.54.q532.j8542&h=p-p-1s-2n-p-p-p');
});