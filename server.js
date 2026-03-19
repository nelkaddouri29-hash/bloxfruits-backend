const express = require("express");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const cors = require("cors");
const cheerio = require("cheerio");

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

async function fetchAndUpdateStock() {
  console.log(`[${new Date().toISOString()}] Scraping fruityblox.com...`);
  try {
    const response = await axios.get("https://fruityblox.com/stock", {
      timeout: 15000,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      }
    });

    const $ = cheerio.load(response.data);
    const result = { normal: [], mirage: [] };

    console.log("Page loaded, parsing...");

    // FruityBlox renders stock in sections
    // Try multiple selectors to find fruit data
    $("*").each((i, el) => {
      const text = $(el).text().trim();
      // Look for fruit name patterns with prices
    });

    // Parse based on the page structure
    const pageText = $("body").text();
    console.log("Page text sample:", pageText.slice(0, 500));

    // Look for Normal and Mirage sections
    const normalMatch = pageText.match(/Normal[\s\S]*?(?=Mirage|$)/i);
    const mirageMatch = pageText.match(/Mirage[\s\S]*/i);

    const fruitPattern = /([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)\s*\$\s*([\d,]+)/g;

    if (normalMatch) {
      let match;
      const normalText = normalMatch[0];
      while ((match = fruitPattern.exec(normalText)) !== null) {
        const name = match[1].trim();
        const price = parseInt(match[2].replace(/,/g, ""));
        if (name !== "Normal" && name !== "Mirage" && name !== "Next" && price > 0) {
          result.normal.push({ name, price });
        }
      }
    }

    fruitPattern.lastIndex = 0;

    if (mirageMatch) {
      let match;
      const mirageText = mirageMatch[0];
      while ((match = fruitPattern.exec(mirageText)) !== null) {
        const name = match[1].trim();
        const price = parseInt(match[2].replace(/,/g, ""));
        if (name !== "Normal" && name !== "Mirage" && name !== "Next" && price > 0) {
          result.mirage.push({ name, price });
        }
      }
    }

    console.log("Parsed result:", JSON.stringify(result));

    if (result.normal.length === 0 && result.mirage.length === 0) {
      console.log("No fruits found — site may use JavaScript rendering");
      return;
    }

    if (!stockHasChanged(stockState.current, result)) {
      console.log("Stock unchanged — skipping.");
      return;
    }

    console.log("New stock detected! Saving...");
    stockState.beforeLast = stockState.last;
    stockState.last = stockState.current;
    stockState.current = result;
    stockState.lastUpdated = new Date().toISOString();
    saveCache(stockState);
    console.log("Saved:", JSON.stringify(result));

  } catch (err) {
    console.error("Scrape failed:", err.message);
  }
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
