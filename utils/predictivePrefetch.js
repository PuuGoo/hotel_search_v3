// Predictive prefetch — prefetch likely next search results based on patterns
// Analyzes search sequences and pre-caches predicted queries

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PREFETCH_FILE = path.join(__dirname, "..", "prefetch_data.json");
const HISTORY_FILE = path.join(__dirname, "..", "search_history.json");
const MAX_PREFETCH_CACHE = 500;
const SEQUENCE_WINDOW_MS = 30 * 60 * 1000; // 30 min window for sequences

function readJSON(filePath) {
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch { /* ignore */ }
  return { cache: {}, predictions: {}, stats: { hits: 0, misses: 0, prefetched: 0 } };
}

function writeJSON(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  } catch { /* ignore */ }
}

function readHistory() {
  try {
    if (fs.existsSync(HISTORY_FILE)) return JSON.parse(fs.readFileSync(HISTORY_FILE, "utf8"));
  } catch { /* ignore */ }
  return [];
}

function generateKey(query, engine) {
  const normalized = (query || "").toLowerCase().trim();
  return crypto.createHash("md5").update(`${normalized}:${engine || "any"}`).digest("hex");
}

/**
 * Analyze search history to build transition probabilities.
 * Returns a map: query -> [{ nextQuery, probability, avgFollowTime }]
 */
export function buildTransitions(userId, options = {}) {
  const { hours = 168, minCount = 2 } = options; // Default 7 days
  const history = readHistory();
  const cutoff = Date.now() - hours * 60 * 60 * 1000;

  let userHistory = history.filter((h) => h && h.userId === userId && new Date(h.timestamp).getTime() > cutoff);
  userHistory.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  const transitions = {};

  for (let i = 0; i < userHistory.length - 1; i++) {
    const current = (userHistory[i].query || "").toLowerCase().trim();
    const next = (userHistory[i + 1].query || "").toLowerCase().trim();
    const timeDiff = new Date(userHistory[i + 1].timestamp).getTime() - new Date(userHistory[i].timestamp).getTime();

    if (!current || !next || timeDiff > SEQUENCE_WINDOW_MS || timeDiff < 0) continue;

    if (!transitions[current]) {
      transitions[current] = {};
    }
    if (!transitions[current][next]) {
      transitions[current][next] = { count: 0, totalTime: 0 };
    }
    transitions[current][next].count++;
    transitions[current][next].totalTime += timeDiff;
  }

  // Convert to sorted arrays with probabilities
  const result = {};
  for (const [query, nexts] of Object.entries(transitions)) {
    const total = Object.values(nexts).reduce((sum, n) => sum + n.count, 0);
    result[query] = Object.entries(nexts)
      .filter(([, v]) => v.count >= minCount)
      .map(([nextQuery, data]) => ({
        nextQuery,
        count: data.count,
        probability: Math.round((data.count / total) * 100),
        avgFollowTime: Math.round(data.totalTime / data.count),
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5); // Top 5 predictions
  }

  return result;
}

/**
 * Get prefetch predictions for a given query.
 */
export function getPredictions(userId, currentQuery, options = {}) {
  const transitions = buildTransitions(userId, options);
  const normalized = (currentQuery || "").toLowerCase().trim();

  const predictions = transitions[normalized] || [];

  // Also check for prefix matches
  const prefixMatches = [];
  for (const [query, nexts] of Object.entries(transitions)) {
    if (query !== normalized && (query.startsWith(normalized) || normalized.startsWith(query))) {
      prefixMatches.push(...nexts);
    }
  }

  // Merge and deduplicate
  const seen = new Set(predictions.map((p) => p.nextQuery));
  for (const match of prefixMatches) {
    if (!seen.has(match.nextQuery)) {
      predictions.push({ ...match, probability: Math.round(match.probability * 0.5) }); // Lower confidence for prefix matches
      seen.add(match.nextQuery);
    }
  }

  return predictions.sort((a, b) => b.probability - a.probability).slice(0, 5);
}

/**
 * Store a prefetched result.
 */
export function storePrefetch(query, engine, results) {
  const data = readJSON(PREFETCH_FILE);
  if (!data.cache) data.cache = {};

  const key = generateKey(query, engine);
  data.cache[key] = {
    query: (query || "").toLowerCase().trim(),
    engine: engine || "any",
    results,
    prefetchedAt: Date.now(),
    accessCount: 0,
  };

  // Trim cache
  const keys = Object.keys(data.cache);
  if (keys.length > MAX_PREFETCH_CACHE) {
    // Remove oldest
    const sorted = keys.sort((a, b) => (data.cache[a].prefetchedAt || 0) - (data.cache[b].prefetchedAt || 0));
    for (let i = 0; i < sorted.length - MAX_PREFETCH_CACHE; i++) {
      delete data.cache[sorted[i]];
    }
  }

  if (!data.stats) data.stats = { hits: 0, misses: 0, prefetched: 0 };
  data.stats.prefetched++;

  writeJSON(PREFETCH_FILE, data);
}

/**
 * Check if a query has prefetched results.
 */
export function checkPrefetch(query, engine) {
  const data = readJSON(PREFETCH_FILE);
  if (!data.cache) return null;

  const key = generateKey(query, engine);
  const entry = data.cache[key];

  if (!entry) {
    if (!data.stats) data.stats = { hits: 0, misses: 0, prefetched: 0 };
    data.stats.misses++;
    writeJSON(PREFETCH_FILE, data);
    return null;
  }

  // Check if stale (older than 1 hour)
  if (Date.now() - entry.prefetchedAt > 60 * 60 * 1000) {
    delete data.cache[key];
    data.stats.misses++;
    writeJSON(PREFETCH_FILE, data);
    return null;
  }

  entry.accessCount++;
  data.stats.hits++;
  writeJSON(PREFETCH_FILE, data);

  return {
    results: entry.results,
    prefetchedAt: entry.prefetchedAt,
    accessCount: entry.accessCount,
    ageMs: Date.now() - entry.prefetchedAt,
  };
}

/**
 * Run prefetch for predicted queries.
 * searchFn: async (query, engine) => results
 */
export async function runPrefetch(userId, currentQuery, searchFn, options = {}) {
  const { engine = null, maxPrefetches = 3 } = options;
  const predictions = getPredictions(userId, currentQuery);

  const results = [];
  for (const prediction of predictions.slice(0, maxPrefetches)) {
    const key = generateKey(prediction.nextQuery, engine);
    const data = readJSON(PREFETCH_FILE);
    const existing = data.cache?.[key];

    // Skip if already cached and fresh
    if (existing && Date.now() - existing.prefetchedAt < 60 * 60 * 1000) {
      results.push({ query: prediction.nextQuery, status: "already_cached", probability: prediction.probability });
      continue;
    }

    try {
      const searchResults = await searchFn(prediction.nextQuery, engine);
      storePrefetch(prediction.nextQuery, engine, searchResults);
      results.push({ query: prediction.nextQuery, status: "prefetched", probability: prediction.probability });
    } catch (err) {
      results.push({ query: prediction.nextQuery, status: "error", error: err.message });
    }
  }

  return results;
}

/**
 * Get prefetch statistics.
 */
export function getPrefetchStats() {
  const data = readJSON(PREFETCH_FILE);
  const cache = data.cache || {};
  const stats = data.stats || { hits: 0, misses: 0, prefetched: 0 };

  const totalRequests = stats.hits + stats.misses;
  const hitRate = totalRequests > 0 ? Math.round((stats.hits / totalRequests) * 100) : 0;

  const entries = Object.values(cache);
  const freshEntries = entries.filter((e) => Date.now() - e.prefetchedAt < 60 * 60 * 1000);

  return {
    cacheSize: entries.length,
    freshEntries: freshEntries.length,
    hitRate,
    ...stats,
    totalRequests,
  };
}

/**
 * Clear prefetch cache.
 */
export function clearPrefetchCache() {
  writeJSON(PREFETCH_FILE, { cache: {}, stats: { hits: 0, misses: 0, prefetched: 0 } });
}
