// Query suggestions — context-aware autocomplete for search queries
// Combines user history, popular queries, and prefix matching

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const HISTORY_FILE = path.join(__dirname, "..", "search_history.json");

function readJSON(filePath) {
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch { /* ignore */ }
  return [];
}

/**
 * Common hotel search modifiers for query expansion.
 */
const MODIFIERS = {
  prefixes: ["best", "top", "cheap", "budget", "luxury", "near", "nearby", "close to"],
  suffixes: ["hotel", "hotels", "resort", "resorts", "motel", "hostel", "inn", "lodge", "apartment", "villa"],
  connectors: ["in", "near", "at", "around", "with", "for", "close to", "next to"],
  amenities: ["pool", "spa", "gym", "parking", "wifi", "breakfast", "restaurant", "bar", "garden", "beach"],
};

/**
 * Get query suggestions based on prefix and user history.
 * @param {string} prefix - partial query
 * @param {string} userId - user ID for personalized suggestions
 * @param {Object} options - { limit, includeHistory, includePopular, includeModifiers }
 * @returns {Array} suggestions
 */
export function getSuggestions(prefix, userId, options = {}) {
  const {
    limit = 10,
    includeHistory = true,
    includePopular = true,
    includeModifiers = true,
  } = options;

  if (!prefix || prefix.length < 2) return [];

  const lower = prefix.toLowerCase().trim();
  const suggestions = new Map(); // query -> { source, score }

  // 1. User history matches
  if (includeHistory && userId) {
    const history = readJSON(HISTORY_FILE);
    const userHistory = Array.isArray(history)
      ? history.filter((h) => h && h.userId === userId && h.query)
      : [];

    for (const entry of userHistory) {
      const q = entry.query.toLowerCase();
      if (q.startsWith(lower) || q.includes(lower)) {
        const existing = suggestions.get(entry.query);
        const score = q.startsWith(lower) ? 100 : 50;
        if (!existing || existing.score < score) {
          suggestions.set(entry.query, { source: "history", score });
        }
      }
    }
  }

  // 2. Popular queries (from all users)
  if (includePopular) {
    const history = readJSON(HISTORY_FILE);
    const historyArray = Array.isArray(history) ? history : [];
    const queryCounts = {};

    for (const entry of historyArray) {
      if (entry && entry.query) {
        const q = entry.query.toLowerCase();
        if (q.startsWith(lower) || q.includes(lower)) {
          queryCounts[entry.query] = (queryCounts[entry.query] || 0) + 1;
        }
      }
    }

    for (const [query, count] of Object.entries(queryCounts)) {
      const existing = suggestions.get(query);
      const score = Math.min(80, count * 10);
      if (!existing || existing.score < score) {
        suggestions.set(query, { source: "popular", score });
      }
    }
  }

  // 3. Modifier-based suggestions
  if (includeModifiers) {
    const words = lower.split(" ");
    const lastWord = words[words.length - 1];

    // Suggest completions for the last word
    const allModifiers = [
      ...MODIFIERS.prefixes,
      ...MODIFIERS.suffixes,
      ...MODIFIERS.connectors,
      ...MODIFIERS.amenities,
    ];

    for (const mod of allModifiers) {
      if (mod.startsWith(lastWord) && mod !== lastWord) {
        const suggestion = words.slice(0, -1).concat(mod).join(" ");
        if (!suggestions.has(suggestion)) {
          suggestions.set(suggestion, { source: "modifier", score: 30 });
        }
      }
    }

    // Suggest adding common suffixes
    if (!MODIFIERS.suffixes.some((s) => lower.endsWith(s))) {
      for (const suffix of MODIFIERS.suffixes) {
        const suggestion = `${prefix} ${suffix}`;
        if (!suggestions.has(suggestion)) {
          suggestions.set(suggestion, { source: "suffix", score: 20 });
        }
      }
    }
  }

  // Sort by score and return top N
  return [...suggestions.entries()]
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, limit)
    .map(([query, { source, score }]) => ({ query, source, score }));
}

/**
 * Expand a query with common abbreviations and synonyms.
 */
export function expandQuery(query) {
  if (!query) return query;

  const expansions = {
    "nyc": "new york city",
    "la": "los angeles",
    "sf": "san francisco",
    "uk": "united kingdom",
    "us": "united states",
    "usa": "united states",
    "eu": "europe",
    "wifi": "wireless internet",
    "ac": "air conditioning",
    "b&b": "bed and breakfast",
    "bnb": "bed and breakfast",
    "all-inclusive": "all inclusive",
    "pet-friendly": "pet friendly",
    "kid-friendly": "kid friendly",
    "family-friendly": "family friendly",
    "sea view": "sea view room",
    "ocean view": "ocean view room",
    "city center": "city center location",
    "downtown": "downtown location",
  };

  let expanded = query.toLowerCase();
  for (const [abbrev, full] of Object.entries(expansions)) {
    const regex = new RegExp(`\\b${abbrev}\\b`, "gi");
    expanded = expanded.replace(regex, full);
  }

  return expanded;
}

/**
 * Get trending queries (most searched in recent hours).
 */
export function getTrendingQueries(hours = 24, limit = 10) {
  const history = readJSON(HISTORY_FILE);
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);

  const recentQueries = Array.isArray(history)
    ? history.filter((h) => h && h.query && new Date(h.timestamp) > cutoff)
    : [];

  const counts = {};
  for (const entry of recentQueries) {
    counts[entry.query] = (counts[entry.query] || 0) + 1;
  }

  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([query, count]) => ({ query, count }));
}
