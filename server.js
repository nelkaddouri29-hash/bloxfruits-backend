const express = require("express");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3000;
const CACHE_FILE = path.join(__dirname, "stock_cache.json");
const POLL_INTERVAL_MS = 2 * 60 * 1000; // Elke 2 minuten checken

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Prijslijst voor validatie en fallback
const FRUIT_PRICES = {
    "Rocket": 5000, "Spin": 7500, "Spring": 60000, "Bomb": 80000,
    "Smoke": 100000, "Spike": 180000, "Flame": 250000, "Ice": 350000,
    "Sand": 420000, "Dark": 500000, "Ghost": 550000, "Diamond": 600000,
    "Light": 650000, "Rubber": 750000, "Magma": 850000, "Quake": 1000000,
    "Buddha": 1200000, "Love": 1300000, "Spider": 1500000, "Sound": 1700000,
    "Phoenix": 1800000, "Portal": 1900000, "Rumble": 2100000, "Blizzard": 2400000,
    "Gravity": 2500000, "Mammoth": 2700000, "T-Rex": 2700000, "Dough": 2800000,
    "Shadow": 2900000, "Venom": 3000000, "Control": 3200000, "Spirit": 3400000,
    "Leopard": 5000000, "Kitsune": 8000000, "Dragon": 10000000
};

let stockState = { current: null, last: null, beforeLast: null, lastUpdated: null };

// --- HELPERS ---
function saveCache(data) {
    try { fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2)); } catch (e) {}
}

function stockHasChanged(oldStock, newStock) {
    if (!oldStock || !newStock) return true;
    return JSON.stringify(oldStock.normal) !== JSON.stringify(newStock.normal);
}

// --- DATA FETCHING ---

// Prioriteit 1: De "Fast API" (of je eigen hoofdbron)
async function fetchFromMainSource() {
    console.log("Checking Main API source...");
    try {
        // Tip: Gebruik een bron die direct uit Roblox data haalt indien beschikbaar
        const response = await axios.get("https://blox-fruits-api.onrender.com/api/bloxfruits/stock", { timeout: 8000 });
        const data = response.data.stock || response.data;
        
        if (!data || Object.keys(data).length < 2) return null;

        const normal = Object.entries(data).map(([name, info]) => ({
            name,
            price: info.price || FRUIT_PRICES[name] || 0
        }));
        return { normal, mirage: [] };
    } catch (err) {
        console.log("Main source down, switching to Wiki fallback...");
        return null;
    }
}

// Fallback: Wiki Scraper met Vandalisme Check
async function fetchFromWikiFallback() {
    console.log("Fetching from Fandom Wiki (Fallback)...");
    try {
        const response = await axios.get(
            "https://blox-fruits.fandom.com/api.php?action=parse&page=Blox_Fruits_%22Stock%22&prop=wikitext&format=json",
            { timeout: 10000, headers: { "User-Agent": "Mozilla/5.0 Tracker/1.0" } }
        );
        const wikitext = response.data?.parse?.wikitext?.["*"] || "";
        const currentMatch = wikitext.match(/\|Current\s*=\s*([^\n|]+)/);
        
        if (!currentMatch) return null;

        const fruits = currentMatch[1].split(",")
            .map(s => s.trim())
            .filter(name => FRUIT_PRICES[name]); // Alleen vruchten die we kennen (tegen vandalisme)

        // Als de wiki minder dan 3 bekende vruchten geeft, is er waarschijnlijk iets mis
        if (fruits.length < 3) {
            console.log("Wiki data looks suspicious (too few fruits). Ignoring.");
            return null;
        }

        const normal = fruits.map(name => ({ name, price: FRUIT_PRICES[name] }));
        return { normal, mirage: [] };
    } catch (err) {
        console.log("Wiki fallback failed as well.");
        return null;
    }
}

async function updateStock() {
    console.log(`[${new Date().toLocaleTimeString()}] Updating stock data...`);
    
    let newStock = await fetchFromMainSource();
    
    if (!newStock) {
        newStock = await fetchFromWikiFallback();
    }

    if (newStock && stockHasChanged(stockState.current, newStock)) {
        console.log("Stock change detected! Updating state.");
        stockState.beforeLast = stockState.last;
        stockState.last = stockState.current;
        stockState.current = newStock;
        stockState.lastUpdated = new Date().toISOString();
        saveCache(stockState);
    } else {
        console.log("No changes or fetch failed.");
    }
}

// --- ROUTES ---
app.get("/api/stock", (req, res) => {
    res.json(stockState.current ? stockState : { error: "No data" });
});

app.get("/health", (req, res) => {
    res.json({ status: "up", lastUpdated: stockState.lastUpdated });
});

// STARTUP
app.listen(PORT, async () => {
    console.log(`Server active on port ${PORT}`);
    await updateStock();
    setInterval(updateStock, POLL_INTERVAL_MS);
});
