const express = require("express");
const fs = require("fs");
const path = require("path");
const cors = require("cors");
const { Client, GatewayIntentBits } = require("discord.js");

const app = express();
const PORT = process.env.PORT || 3000;
const CACHE_FILE = path.join(__dirname, "stock_cache.json");
const POLL_INTERVAL_MS = 2 * 60 * 1000;

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const CHANNEL_ID = "1484061478695735317";

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

const discordClient = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

async function fetchStockFromDiscord() {
  console.log(`[${new Date().toISOString()}] Fetching from Discord...`);
  try {
    const channel = await discordClient.channels.fetch(CHANNEL_ID);
    if (!channel) { console.error("Channel not found!"); return; }

    const msgs = await channel.messages.fetch({ limit: 10 });
    console.log(`Found ${msgs.size} messages`);

    for (const msg of msgs.values()) {
      console.log("---");
      console.log(`Author: ${msg.author.tag}`);
      console.log(`Content: ${msg.content.slice(0, 100)}`);
      console.log(`Embeds: ${msg.embeds.length}`);
      console.log(`Components: ${msg.components.length}`);
      if (msg.embeds.length > 0) {
        console.log(`Embed[0] full:`, JSON.stringify(msg.embeds[0]).slice(0, 500));
      }
      if (msg.components.length > 0) {
        console.log(`Components full:`, JSON.stringify(msg.components).slice(0, 500));
      }
    }

  } catch (err) {
    console.error("Discord fetch failed:", err.message);
  }
}

app.get("/api/stock", (req, res) => {
  if (!stockState.current) {
    return res.status(503).json({ error: "Stock data not yet available." });
  }
  res.json(stockState);
});

app.get("/health", (req, res) => {
  res.json({ status: "ok", hasData: !!stockState.current, uptime: Math.floor(process.uptime()) + "s" });
});

discordClient.once("clientReady", async () => {
  console.log(`Bot logged in as ${discordClient.user.tag}`);
  await fetchStockFromDiscord();
  setInterval(fetchStockFromDiscord, POLL_INTERVAL_MS);
});

discordClient.login(DISCORD_TOKEN).catch(err => {
  console.error("Login failed:", err.message);
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
