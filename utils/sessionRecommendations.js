// Session-based recommendations — recommend based on current session context
// Analyzes the current search session to suggest relevant next queries and results

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const HISTORY_FILE = path.join(__dirname, "..", "search_history.json");
const BOOKMARKS_FILE = path.join(__dirname, "..", "bookmarks.json");
const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

function readJSON(filePath) {
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch { /* ignore */ }
  return [];
}

/**
 * Get the current session's search history (queries within timeout window).
 */
export function getSessionHistory(userId) {
  const history = readJSON(HISTORY_FILE);
  if (!Array.isArray(history)) return [];

  const now = Date.now();
  const userHistory = history
    .filter((h) => h && h.userId === userId && (now - new Date(h.timestamp).getTime()) < SESSION_TIMEOUT_MS)
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  return userHistory;
}

/**
 * Extract session context (topics, locations, engines used).
 */
export function getSessionContext(userId) {
  const sessionHistory = getSessionHistory(userId);

  if (sessionHistory.length === 0) {
    return {
      active: false,
      queries: [],
      topics: [],
      locations: [],
      engines: [],
      queryCount: 0,
    };
  }

  const queries = sessionHistory.map((h) => h.query).filter(Boolean);
  const engineCounts = {};
  const wordCounts = {};

  for (const entry of sessionHistory) {
    if (entry.engine) {
      engineCounts[entry.engine] = (engineCounts[entry.engine] || 0) + 1;
    }
    if (entry.query) {
      const words = entry.query.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
      for (const word of words) {
        wordCounts[word] = (wordCounts[word] || 0) + 1;
      }
    }
  }

  const topics = Object.entries(wordCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([word, count]) => ({ word, count }));

  const engines = Object.entries(engineCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([engine, count]) => ({ engine, count }));

  // Detect locations from queries
  const locationPatterns = [
    /\b(in|at|near|around)\s+([a-z\s]+?)(?:\s+for|\s+with|\s+from|\s+in\s+\d|$)/i,
    /\b(hotel|hostel|resort|inn)\s+(?:in|at|near)\s+([a-z\s]+?)(?:\s+for|\s+with|$)/i,
  ];
  const locations = new Set();
  for (const query of queries) {
    for (const pattern of locationPatterns) {
      const match = query.match(pattern);
      if (match && match[2]) {
        locations.add(match[2].trim().toLowerCase());
      }
    }
  }

  return {
    active: true,
    queries,
    topics,
    locations: [...locations],
    engines,
    queryCount: queries.length,
    durationMs: sessionHistory.length > 1
      ? new Date(sessionHistory[sessionHistory.length - 1].timestamp).getTime() - new Date(sessionHistory[0].timestamp).getTime()
      : 0,
  };
}

/**
 * Generate recommendations based on session context.
 */
export function getSessionRecommendations(userId, options = {}) {
  const { maxRecommendations = 5 } = options;
  const context = getSessionContext(userId);
  const history = readJSON(HISTORY_FILE);
  const bookmarksData = readJSON(BOOKMARKS_FILE);
  const bookmarks = Array.isArray(bookmarksData) ? {} : bookmarksData;

  if (!context.active || context.queries.length === 0) {
    return { recommendations: [], context };
  }

  const lastQuery = context.queries[context.queries.length - 1].toLowerCase();
  const recommendations = [];

  // 1. Related queries from other users who searched similar things
  const allHistory = Array.isArray(history) ? history : [];
  const relatedQueries = {};
  for (const entry of allHistory) {
    if (!entry || !entry.query || entry.userId === userId) continue;
    const entryQuery = entry.query.toLowerCase();
    // Check if query shares words with session topics
    const sharedWords = context.topics.filter((t) => entryQuery.includes(t.word));
    if (sharedWords.length > 0) {
      relatedQueries[entryQuery] = (relatedQueries[entryQuery] || 0) + 1;
    }
  }

  const related = Object.entries(relatedQueries)
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxRecommendations)
    .map(([query, count]) => ({ query, type: "related", confidence: Math.min(count * 10, 90) }));

  recommendations.push(...related);

  // 2. Refinement suggestions based on last query
  const refinements = [];
  if (!lastQuery.includes("cheap") && !lastQuery.includes("budget")) {
    refinements.push({ query: `cheap ${lastQuery}`, type: "refinement", confidence: 60 });
  }
  if (!lastQuery.includes("luxury") && !lastQuery.includes("5 star")) {
    refinements.push({ query: `luxury ${lastQuery}`, type: "refinement", confidence: 50 });
  }
  if (context.locations.length > 0) {
    refinements.push({ query: `${lastQuery} near ${context.locations[0]}`, type: "refinement", confidence: 70 });
  }

  recommendations.push(...refinements.slice(0, 2));

  // 3. Bookmarked queries related to session
  const userBookmarks = bookmarks[userId] || [];
  const bookmarkSuggestions = userBookmarks
    .filter((b) => {
      const title = (b.title || "").toLowerCase();
      return context.topics.some((t) => title.includes(t.word));
    })
    .slice(0, 2)
    .map((b) => ({ query: b.title, url: b.url, type: "bookmark", confidence: 80 }));

  recommendations.push(...bookmarkSuggestions);

  // Deduplicate and limit
  const seen = new Set();
  const unique = recommendations
    .filter((r) => {
      if (seen.has(r.query)) return false;
      seen.add(r.query);
      return true;
    })
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, maxRecommendations);

  return { recommendations: unique, context };
}

/**
 * Get session statistics.
 */
export function getSessionStats(userId) {
  const context = getSessionContext(userId);
  return {
    active: context.active,
    queryCount: context.queryCount,
    topics: context.topics.slice(0, 3).map((t) => t.word),
    locations: context.locations,
    engines: context.engines.map((e) => e.engine),
    durationMinutes: Math.round(context.durationMs / 60000),
  };
}
