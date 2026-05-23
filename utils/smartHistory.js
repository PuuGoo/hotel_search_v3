// Smart search history — pattern-based query prediction
// Analyzes search patterns to predict likely next queries

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
 * Analyze search patterns for a user.
 * Identifies sequences, time patterns, and query relationships.
 */
export function analyzeSearchPatterns(userId, options = {}) {
  const { lookbackDays = 30, minPatternOccurrences = 2 } = options;

  const history = readJSON(HISTORY_FILE);
  const historyArray = Array.isArray(history) ? history : [];
  const cutoff = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);

  const userHistory = historyArray
    .filter((h) => h && h.userId === userId && h.query && h.timestamp)
    .filter((h) => new Date(h.timestamp) > cutoff)
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  if (userHistory.length < 3) {
    return {
      patterns: [],
      predictions: [],
      stats: { totalSearches: userHistory.length, patternsFound: 0 },
    };
  }

  // 1. Find sequential patterns (A followed by B)
  const sequences = {};
  for (let i = 0; i < userHistory.length - 1; i++) {
    const current = userHistory[i].query.toLowerCase();
    const next = userHistory[i + 1].query.toLowerCase();
    if (current !== next) {
      const key = `${current}|||${next}`;
      sequences[key] = (sequences[key] || 0) + 1;
    }
  }

  // 2. Find time-of-day patterns
  const timePatterns = {};
  for (const entry of userHistory) {
    const hour = new Date(entry.timestamp).getHours();
    const timeSlot = hour < 6 ? "night" : hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
    const query = entry.query.toLowerCase();
    if (!timePatterns[timeSlot]) timePatterns[timeSlot] = {};
    timePatterns[timeSlot][query] = (timePatterns[timeSlot][query] || 0) + 1;
  }

  // 3. Find day-of-week patterns
  const dayPatterns = {};
  for (const entry of userHistory) {
    const day = new Date(entry.timestamp).getDay();
    const dayName = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"][day];
    const query = entry.query.toLowerCase();
    if (!dayPatterns[dayName]) dayPatterns[dayName] = {};
    dayPatterns[dayName][query] = (dayPatterns[dayName][query] || 0) + 1;
  }

  // 4. Find query clusters (similar queries grouped together)
  const queryTokens = {};
  for (const entry of userHistory) {
    const tokens = entry.query.toLowerCase().split(/\s+/);
    for (const token of tokens) {
      if (token.length > 2) {
        if (!queryTokens[token]) queryTokens[token] = new Set();
        queryTokens[token].add(entry.query);
      }
    }
  }

  // Build patterns list
  const patterns = [];

  // Sequential patterns
  for (const [key, count] of Object.entries(sequences)) {
    if (count >= minPatternOccurrences) {
      const [from, to] = key.split("|||");
      patterns.push({
        type: "sequence",
        from,
        to,
        count,
        confidence: Math.min(0.95, count / userHistory.length),
      });
    }
  }

  // Time patterns
  for (const [timeSlot, queries] of Object.entries(timePatterns)) {
    const topQuery = Object.entries(queries).sort((a, b) => b[1] - a[1])[0];
    if (topQuery && topQuery[1] >= minPatternOccurrences) {
      patterns.push({
        type: "time",
        timeSlot,
        query: topQuery[0],
        count: topQuery[1],
        confidence: Math.min(0.95, topQuery[1] / Object.values(queries).reduce((a, b) => a + b, 0)),
      });
    }
  }

  // Sort patterns by confidence
  patterns.sort((a, b) => b.confidence - a.confidence);

  return {
    patterns,
    stats: {
      totalSearches: userHistory.length,
      patternsFound: patterns.length,
      uniqueQueries: new Set(userHistory.map((h) => h.query.toLowerCase())).size,
      timeSlots: Object.keys(timePatterns),
    },
  };
}

/**
 * Predict next likely queries based on patterns.
 * @param {string} userId - user ID
 * @param {string} currentQuery - current search query (optional)
 * @param {Object} options - { maxPredictions, lookbackDays }
 * @returns {Object[]} predictions with confidence scores
 */
export function predictNextQueries(userId, currentQuery, options = {}) {
  const { maxPredictions = 5, lookbackDays = 30 } = options;

  const { patterns, stats } = analyzeSearchPatterns(userId, { lookbackDays });

  if (stats.totalSearches < 3) {
    return [];
  }

  const predictions = new Map();
  const currentHour = new Date().getHours();
  const currentTimeSlot = currentHour < 6 ? "night" : currentHour < 12 ? "morning" : currentHour < 18 ? "afternoon" : "evening";
  const currentDay = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"][new Date().getDay()];

  // 1. Sequential predictions (if currentQuery provided)
  if (currentQuery) {
    const lower = currentQuery.toLowerCase();
    for (const pattern of patterns) {
      if (pattern.type === "sequence" && pattern.from === lower) {
        predictions.set(pattern.to, {
          query: pattern.to,
          confidence: pattern.confidence,
          reason: `Often searched after "${currentQuery}"`,
          type: "sequence",
        });
      }
    }
  }

  // 2. Time-based predictions
  for (const pattern of patterns) {
    if (pattern.type === "time" && pattern.timeSlot === currentTimeSlot) {
      if (!predictions.has(pattern.query)) {
        predictions.set(pattern.query, {
          query: pattern.query,
          confidence: pattern.confidence * 0.8, // Lower weight for time-based
          reason: `Commonly searched in the ${currentTimeSlot}`,
          type: "time",
        });
      }
    }
  }

  // 3. Recent query boost
  const history = readJSON(HISTORY_FILE);
  const historyArray = Array.isArray(history) ? history : [];
  const recentQueries = historyArray
    .filter((h) => h && h.userId === userId && h.query)
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, 5);

  for (const entry of recentQueries) {
    const lower = entry.query.toLowerCase();
    if (!predictions.has(lower)) {
      predictions.set(lower, {
        query: entry.query,
        confidence: 0.5,
        reason: "Recently searched",
        type: "recent",
      });
    } else {
      // Boost confidence for recent + pattern match
      const existing = predictions.get(lower);
      existing.confidence = Math.min(0.95, existing.confidence + 0.2);
    }
  }

  // Sort by confidence and return top N
  return [...predictions.values()]
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, maxPredictions)
    .map((p) => ({
      ...p,
      confidence: Math.round(p.confidence * 100) / 100,
    }));
}

/**
 * Get search habit insights for a user.
 */
export function getSearchInsights(userId) {
  const history = readJSON(HISTORY_FILE);
  const historyArray = Array.isArray(history) ? history : [];
  const userHistory = historyArray
    .filter((h) => h && h.userId === userId && h.query && h.timestamp)
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  if (userHistory.length === 0) {
    return {
      totalSearches: 0,
      insights: [],
    };
  }

  const insights = [];

  // Most active time
  const hourCounts = {};
  for (const entry of userHistory) {
    const hour = new Date(entry.timestamp).getHours();
    hourCounts[hour] = (hourCounts[hour] || 0) + 1;
  }
  const peakHour = Object.entries(hourCounts).sort((a, b) => b[1] - a[1])[0];
  if (peakHour) {
    insights.push({
      type: "peak_time",
      message: `You search most often at ${peakHour[0]}:00`,
      value: parseInt(peakHour[0]),
      count: peakHour[1],
    });
  }

  // Favorite engines
  const engineCounts = {};
  for (const entry of userHistory) {
    if (entry.engine) {
      engineCounts[entry.engine] = (engineCounts[entry.engine] || 0) + 1;
    }
  }
  const topEngine = Object.entries(engineCounts).sort((a, b) => b[1] - a[1])[0];
  if (topEngine) {
    insights.push({
      type: "favorite_engine",
      message: `Your favorite search engine is ${topEngine[0]}`,
      value: topEngine[0],
      count: topEngine[1],
    });
  }

  // Search frequency
  const days = new Set(userHistory.map((h) => new Date(h.timestamp).toDateString())).size;
  const avgPerDay = Math.round(userHistory.length / Math.max(1, days) * 10) / 10;
  insights.push({
    type: "frequency",
    message: `You average ${avgPerDay} searches per day`,
    value: avgPerDay,
    totalDays: days,
  });

  // Query diversity
  const uniqueQueries = new Set(userHistory.map((h) => h.query.toLowerCase())).size;
  const diversity = Math.round((uniqueQueries / userHistory.length) * 100);
  insights.push({
    type: "diversity",
    message: `${diversity}% of your searches are unique`,
    value: diversity,
    uniqueQueries,
    totalSearches: userHistory.length,
  });

  return {
    totalSearches: userHistory.length,
    insights,
  };
}
