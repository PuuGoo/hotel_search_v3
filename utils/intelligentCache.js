// Intelligent cache — smart invalidation and warming for search results
// Tracks cache hit rates, invalidates stale entries, and pre-warms popular queries

import fs from "fs";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CACHE_FILE = path.join(__dirname, "..", "intelligent_cache.json");
const STATS_FILE = path.join(__dirname, "..", "cache_stats.json");
const HISTORY_FILE = path.join(__dirname, "..", "search_history.json");

const DEFAULT_TTL = 30 * 60 * 1000; // 30 minutes
const MAX_CACHE_SIZE = 1000;
const WARM_THRESHOLD = 3; // Warm cache for queries searched 3+ times

function readJSON(filePath) {
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch { /* ignore */ }
  return {};
}

function writeJSON(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  } catch { /* ignore */ }
}

/**
 * Generate cache key from query parameters.
 */
export function generateCacheKey(params) {
  const normalized = {
    query: (params.query || "").toLowerCase().trim(),
    engine: params.engine || "all",
    filters: params.filters || {},
    page: params.page || 1,
  };
  const hash = crypto.createHash("md5").update(JSON.stringify(normalized)).digest("hex");
  return `cache_${hash}`;
}

/**
 * Get cached result.
 */
export function getCached(key) {
  const cache = readJSON(CACHE_FILE);
  const entry = cache[key];

  if (!entry) {
    recordMiss(key);
    return null;
  }

  // Check TTL
  if (Date.now() - entry.cachedAt > entry.ttl) {
    delete cache[key];
    writeJSON(CACHE_FILE, cache);
    recordMiss(key);
    return null;
  }

  // Update access stats
  entry.lastAccess = Date.now();
  entry.accessCount = (entry.accessCount || 0) + 1;
  writeJSON(CACHE_FILE, cache);
  recordHit(key);

  return entry.data;
}

/**
 * Set cache entry.
 */
export function setCache(key, data, options = {}) {
  const cache = readJSON(CACHE_FILE);
  const ttl = options.ttl || DEFAULT_TTL;

  cache[key] = {
    data,
    cachedAt: Date.now(),
    lastAccess: Date.now(),
    ttl,
    accessCount: 0,
    query: options.query || "",
    engine: options.engine || "",
    size: JSON.stringify(data).length,
  };

  // Evict if over limit (LRU)
  const entries = Object.entries(cache);
  if (entries.length > MAX_CACHE_SIZE) {
    entries.sort((a, b) => a[1].lastAccess - b[1].lastAccess);
    const toRemove = entries.slice(0, entries.length - MAX_CACHE_SIZE);
    for (const [k] of toRemove) {
      delete cache[k];
    }
  }

  writeJSON(CACHE_FILE, cache);
}

/**
 * Invalidate cache entries matching a pattern.
 */
export function invalidateCache(pattern) {
  const cache = readJSON(CACHE_FILE);
  let invalidated = 0;

  if (typeof pattern === "string") {
    // Invalidate by query substring
    const lower = pattern.toLowerCase();
    for (const [key, entry] of Object.entries(cache)) {
      if (entry.query && entry.query.toLowerCase().includes(lower)) {
        delete cache[key];
        invalidated++;
      }
    }
  } else if (typeof pattern === "function") {
    // Invalidate by custom predicate
    for (const [key, entry] of Object.entries(cache)) {
      if (pattern(entry)) {
        delete cache[key];
        invalidated++;
      }
    }
  }

  writeJSON(CACHE_FILE, cache);
  return invalidated;
}

/**
 * Invalidate all expired entries.
 */
export function invalidateExpired() {
  const cache = readJSON(CACHE_FILE);
  let invalidated = 0;
  const now = Date.now();

  for (const [key, entry] of Object.entries(cache)) {
    if (now - entry.cachedAt > entry.ttl) {
      delete cache[key];
      invalidated++;
    }
  }

  writeJSON(CACHE_FILE, cache);
  return invalidated;
}

/**
 * Clear entire cache.
 */
export function clearCache() {
  writeJSON(CACHE_FILE, {});
}

/**
 * Warm cache for popular queries.
 * @param {Function} searchFn - async function to execute search
 * @param {Object} options - { maxQueries, minSearches }
 */
export async function warmCache(searchFn, options = {}) {
  const { maxQueries = 10, minSearches = WARM_THRESHOLD } = options;

  const history = readJSON(HISTORY_FILE);
  const historyArray = Array.isArray(history) ? history : [];

  // Count query frequency
  const queryCounts = {};
  for (const entry of historyArray) {
    if (entry && entry.query) {
      const q = entry.query.toLowerCase().trim();
      queryCounts[q] = (queryCounts[q] || 0) + 1;
    }
  }

  // Get top queries above threshold
  const popularQueries = Object.entries(queryCounts)
    .filter(([, count]) => count >= minSearches)
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxQueries)
    .map(([query]) => query);

  const results = [];
  for (const query of popularQueries) {
    const key = generateCacheKey({ query });
    const cached = getCached(key);

    if (!cached) {
      try {
        const data = await searchFn(query);
        setCache(key, data, { query, ttl: 60 * 60 * 1000 }); // 1 hour for warmed entries
        results.push({ query, status: "warmed" });
      } catch (err) {
        results.push({ query, status: "failed", error: err.message });
      }
    } else {
      results.push({ query, status: "already_cached" });
    }
  }

  return {
    warmed: results.filter((r) => r.status === "warmed").length,
    alreadyCached: results.filter((r) => r.status === "already_cached").length,
    failed: results.filter((r) => r.status === "failed").length,
    results,
  };
}

/**
 * Record cache hit.
 */
function recordHit(key) {
  const stats = readJSON(STATS_FILE);
  if (!stats.hits) stats.hits = {};
  stats.hits[key] = (stats.hits[key] || 0) + 1;
  stats.totalHits = (stats.totalHits || 0) + 1;
  stats.lastUpdated = Date.now();
  writeJSON(STATS_FILE, stats);
}

/**
 * Record cache miss.
 */
function recordMiss(key) {
  const stats = readJSON(STATS_FILE);
  if (!stats.misses) stats.misses = {};
  stats.misses[key] = (stats.misses[key] || 0) + 1;
  stats.totalMisses = (stats.totalMisses || 0) + 1;
  stats.lastUpdated = Date.now();
  writeJSON(STATS_FILE, stats);
}

/**
 * Get cache statistics.
 */
export function getCacheStats() {
  const cache = readJSON(CACHE_FILE);
  const stats = readJSON(STATS_FILE);
  const entries = Object.values(cache);

  const totalSize = entries.reduce((sum, e) => sum + (e.size || 0), 0);
  const totalHits = stats.totalHits || 0;
  const totalMisses = stats.totalMisses || 0;
  const hitRate = totalHits + totalMisses > 0
    ? Math.round((totalHits / (totalHits + totalMisses)) * 100)
    : 0;

  const now = Date.now();
  const expired = entries.filter((e) => now - e.cachedAt > e.ttl).length;
  const active = entries.length - expired;

  // Most accessed entries
  const topEntries = entries
    .sort((a, b) => (b.accessCount || 0) - (a.accessCount || 0))
    .slice(0, 10)
    .map((e) => ({
      query: e.query,
      accessCount: e.accessCount || 0,
      age: Math.round((now - e.cachedAt) / 1000 / 60), // minutes
    }));

  return {
    totalEntries: entries.length,
    activeEntries: active,
    expiredEntries: expired,
    totalSizeBytes: totalSize,
    totalSizeKB: Math.round(totalSize / 1024),
    hitRate,
    totalHits,
    totalMisses,
    topEntries,
    lastUpdated: stats.lastUpdated,
  };
}

/**
 * Get cache entries for debugging.
 */
export function getCacheEntries(options = {}) {
  const { limit = 50, offset = 0 } = options;
  const cache = readJSON(CACHE_FILE);
  const entries = Object.entries(cache)
    .slice(offset, offset + limit)
    .map(([key, entry]) => ({
      key,
      query: entry.query,
      engine: entry.engine,
      cachedAt: new Date(entry.cachedAt).toISOString(),
      lastAccess: new Date(entry.lastAccess).toISOString(),
      ttl: entry.ttl,
      accessCount: entry.accessCount || 0,
      size: entry.size,
      expired: Date.now() - entry.cachedAt > entry.ttl,
    }));

  return { entries, total: Object.keys(cache).length };
}
