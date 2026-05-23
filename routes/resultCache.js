import { Router } from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { checkAuthenticated } from "../middleware/auth.js";
import crypto from "crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CACHE_FILE = path.join(__dirname, "..", "result_cache.json");

const router = Router();

function readCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      return JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
    }
  } catch (e) {
    console.error("Error reading cache:", e.message);
  }
  return {};
}

function writeCache(cache) {
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
}

function makeCacheKey(query, engine) {
  const normalized = `${(query || "").trim().toLowerCase()}|${engine || "tavily"}`;
  return crypto.createHash("md5").update(normalized).digest("hex");
}

// Get cached results
router.get("/api/cache", checkAuthenticated, (req, res) => {
  const { query, engine } = req.query;
  if (!query) {
    return res.status(400).json({ error: "query is required" });
  }

  const key = makeCacheKey(query, engine);
  const cache = readCache();
  const entry = cache[key];

  if (!entry) {
    return res.json({ cached: false });
  }

  // Check TTL (default 1 hour)
  const ttlSeconds = req.query.ttl !== undefined ? parseInt(req.query.ttl) : 3600;
  const ttlMs = (isNaN(ttlSeconds) ? 3600 : ttlSeconds) * 1000;
  const age = Date.now() - new Date(entry.timestamp).getTime();
  if (age > ttlMs) {
    return res.json({ cached: false, expired: true });
  }

  res.json({
    cached: true,
    results: entry.results,
    timestamp: entry.timestamp,
    query: entry.query,
    engine: entry.engine,
    resultCount: entry.results.length,
    ageMs: age,
  });
});

// Store results in cache
router.post("/api/cache", checkAuthenticated, (req, res) => {
  const { query, engine, results } = req.body;

  if (!query || !Array.isArray(results)) {
    return res.status(400).json({ error: "query and results array required" });
  }

  const key = makeCacheKey(query, engine);
  const cache = readCache();

  cache[key] = {
    query: query.trim(),
    engine: engine || "tavily",
    results,
    timestamp: new Date().toISOString(),
    userId: req.session.user.id,
  };

  // Limit cache size to 500 entries
  const keys = Object.keys(cache);
  if (keys.length > 500) {
    const sorted = keys.sort((a, b) =>
      new Date(cache[a].timestamp) - new Date(cache[b].timestamp)
    );
    for (let i = 0; i < sorted.length - 500; i++) {
      delete cache[sorted[i]];
    }
  }

  writeCache(cache);
  res.json({ success: true, key });
});

// Clear cache
router.delete("/api/cache", checkAuthenticated, (req, res) => {
  writeCache({});
  res.json({ success: true });
});

// Get cache stats
router.get("/api/cache/stats", checkAuthenticated, (req, res) => {
  const cache = readCache();
  const entries = Object.values(cache);
  const total = entries.length;

  // Calculate total results cached
  const totalResults = entries.reduce((sum, e) => sum + (e.results?.length || 0), 0);

  // By engine
  const byEngine = {};
  for (const e of entries) {
    byEngine[e.engine || "unknown"] = (byEngine[e.engine || "unknown"] || 0) + 1;
  }

  res.json({ total, totalResults, byEngine });
});

export default router;
