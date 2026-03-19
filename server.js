const express = require("express");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3000;
const CACHE_FILE = path.join(__dirname, "stock_cache.json");
const POLL_INTERVAL_MS = 2 * 60 * 1000;

app.use(cors());
app.use(express.static(path.join(__dirname, "public")));

function loadCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      return JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
    }
  } catch (e) {
    console.error("Failed to read cache:", e.message);
  }
  return { current: null, last: null, beforeLast: null, lastUpdated: null };
}

function saveCache(data) {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error("Failed to write cache:", e.message);
  }
}

let stockState = { current: null, last: null, beforeLast: null, lastUpdated: null };

function stockHasChanged(oldStock, newStock) {
  if (!oldStock) return true;
  if (!newStock) return false;
  return JSON.stringify(oldStock) !== JSON.stringify(newStock);
}

const FRUIT_PRICES = {
  "Blade": 30000, "Smoke": 100000, "Sand": 420000, "Magma": 850000,
  "Creation": 1400000, "Phoenix": 1400000, "Eagle": 75000, "Ghost": 0,
  "Spike": 180000, "Dark": 500000, "Ice": 350000, "Rubber": 750000,
  "Flame": 250000, "Light": 650000, "Bomb": 80000, "Rocket": 5000,
  "Spin": 7500, "Portal": 1900000, "Barrier": 800000, "Quake": 1000000,
  "Buddha": 1200000, "Love": 1200000, "Spider": 1500000, "Sound": 1800000,
  "Paw": 2300000, "Gravity": 2500000, "Mammoth": 2700000, "Shadow": 2900000,
  "Venom": 3000000, "Control": 3200000, "Blizzard": 2500000, "Dragon": 3500000,
  "Leopard": 5000000, "Kitsune": 0, "T-Rex": 0, "Human": 0,
  "Chop": 30000, "Spring": 60000, "Kilo": 5000, "Falcon": 75000,
  "Diamond": 600000, "Revive": 0,
};

// ── Source 1: Fast API ────────────────────────────────────────────────────────
async function fetchFromFastAPI() {
  console.log("Trying fast API...");
  try {
    const response = await axios.get(
      "https://blox-fruits-api.onrender.com/api/bloxfruits/stock",
      { timeout: 10000 }
    );
    const data = response.data;
    const items = data.stock || data;
    if (!items || Object.keys(items).length === 0) {
      console.log("Fast API returned empty stock.");
      return null;
    }

    const normal = [];
    for (const [name, info] of Object.entries(items)) {
      const price = typeof info === "object" ? (info.price || info.beliPrice || 0) : info;
      normal.push({ name, price: parseInt(price) || FRUIT_PRICES[name] || 0 });
    }

    console.log("Fast API success:", JSON.stringify(normal));
    return { normal, mirage: [] };
  } catch (err) {
    console.log("Fast API failed:", err.message);
    return null;
  }
}

// ── Source 2: Fandom Wiki (reliable but slower) ───────────────────────────────
async function fetchFromWiki() {
  console.log("Trying Fandom Wiki...");
  try {
    const response = await axios.get(
      "https://blox-fruits.fandom.com/api.php?action=parse&page=Blox_Fruits_%22Stock%22&prop=wikitext&format=json",
      {
        timeout: 15000,
        headers: { "User-Agent": "Mozilla/5.0 BloxFruitsStockTracker/1.0" }
      }
    );

    const wikitext = response.data?.parse?.wikitext?.["*"] || "";
    const currentMatch = wikitext.match(/\|Current\s*=\s*([^\n|]+)/);
    const lastMatch = wikitext.match(/\|Last\s*=\s*([^\n|]+)/);
    const beforeMatch = wikitext.match(/\|Before\s*=\s*([^\n|]+)/);

    function parseFruits(str) {
      if (!str) return [];
      return str.split(",")
        .map(s => s.trim())
        .filter(s => s.length > 0)
        .map(name => ({ name, price: FRUIT_PRICES[name] || 0 }));
    }

    const current = parseFruits(currentMatch?.[1]);
    const last = parseFruits(lastMatch?.[1]);
    const before = parseFruits(beforeMatch?.[1]);

    if (current.length === 0) {
      console.log("Wiki returned empty stock.");
      return null;
    }

    console.log("Wiki success — Current:", JSON.stringify(current));
    return {
      current: { normal: current, mirage: [] },
      last: { normal: last, mirage: [] },
      before: { normal: before, mirage: [] },
    };
  } catch (err) {
    console.log("Wiki failed:", err.message);
    return null;
  }
}

// ── Main fetch logic ──────────────────────────────────────────────────────────
async function fetchAndUpdateStock() {
  console.log(`[${new Date().toISOString()}] Polling stock...`);

  // Try fast API first
  const fastResult = await fetchFromFastAPI();
  if (fastResult) {
    if (!stockHasChanged(stockState.current, fastResult)) {
      console.log("Stock unchanged — skipping.");
      return;
    }
    console.log("New stock from fast API! Saving...");
    stockState.beforeLast = stockState.last;
    stockState.last = stockState.current;
    stockState.current = fastResult;
    stockState.lastUpdated = new Date().toISOString();
    saveCache(stockState);
    return;
  }

  // Fallback to wiki
  const wikiResult = await fetchFromWiki();
  if (wikiResult) {
    if (!stockHasChanged(stockState.current, wikiResult.current)) {
      console.log("Stock unchanged (wiki) — updating last/before only.");
      stockState.last = wikiResult.last;
      stockState.beforeLast = wikiResult.before;
      saveCache(stockState);
      return;
    }
    console.log("New stock from wiki! Saving...");
    stockState.current = wikiResult.current;
    stockState.last = wikiResult.last;
    stockState.beforeLast = wikiResult.before;
    stockState.lastUpdated = new Date().toISOString();
    saveCache(stockState);
    return;
  }

  console.log("Both sources failed — keeping existing cache.");
}

app.get("/api/stock", (req, res) => {
  if (!stockState.current) {
    return res.status(503).json({
      error: "Stock data not yet available.",
      lastUpdated: stockState.lastUpdated,
    });
  }
  res.json({
    current: stockState.current,
    last: stockState.last,
    beforeLast: stockState.beforeLast,
    lastUpdated: stockState.lastUpdated,
  });
});

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    hasData: !!stockState.current,
    lastUpdated: stockState.lastUpdated,
    uptime: Math.floor(process.uptime()) + "s",
  });
});

app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  await fetchAndUpdateStock();
  setInterval(fetchAndUpdateStock, POLL_INTERVAL_MS);
});
