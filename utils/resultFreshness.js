// Result freshness scoring — prioritize recently updated results
// Scores results based on how recently they were published or updated

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CACHE_FILE = path.join(__dirname, "..", "freshness_cache.json");
const CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours

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
 * Extract date hints from result metadata.
 * Looks for dates in title, description, URL, and metadata fields.
 */
export function extractDateHints(result) {
  const hints = [];
  const now = new Date();

  // Check explicit date fields
  if (result.date) hints.push({ date: new Date(result.date), source: "date", confidence: 0.95 });
  if (result.publishedDate) hints.push({ date: new Date(result.publishedDate), source: "publishedDate", confidence: 0.95 });
  if (result.lastModified) hints.push({ date: new Date(result.lastModified), source: "lastModified", confidence: 0.9 });
  if (result.updatedAt) hints.push({ date: new Date(result.updatedAt), source: "updatedAt", confidence: 0.9 });

  // Extract dates from text using common patterns
  const textFields = [result.title, result.description, result.snippet].filter(Boolean).join(" ");

  // ISO date pattern (2024-01-15)
  const isoPattern = /(\d{4}-\d{2}-\d{2})/g;
  let match;
  while ((match = isoPattern.exec(textFields)) !== null) {
    const date = new Date(match[1]);
    if (!isNaN(date) && date <= now && date > new Date("2020-01-01")) {
      hints.push({ date, source: "text_iso", confidence: 0.7 });
    }
  }

  // Month Year pattern (January 2024, Jan 2024)
  const monthYearPattern = /(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{4})/gi;
  while ((match = monthYearPattern.exec(textFields)) !== null) {
    const date = new Date(match[0]);
    if (!isNaN(date) && date <= now && date > new Date("2020-01-01")) {
      hints.push({ date, source: "text_month_year", confidence: 0.6 });
    }
  }

  // URL year pattern (/2024/ or /24/)
  if (result.url) {
    const urlYearMatch = result.url.match(/\/(\d{4})\//);
    if (urlYearMatch) {
      const year = parseInt(urlYearMatch[1]);
      if (year >= 2020 && year <= now.getFullYear()) {
        hints.push({ date: new Date(year, 0, 1), source: "url_year", confidence: 0.4 });
      }
    }
  }

  // Filter out invalid dates
  return hints.filter((h) => !isNaN(h.date.getTime()));
}

/**
 * Calculate freshness score for a result.
 * Returns a score from 0-100 where 100 is most fresh.
 * @param {Object} result - search result
 * @param {Object} options - { maxAge, decayRate }
 * @returns {Object} { score, dateHints, bestDate, age }
 */
export function calculateFreshnessScore(result, options = {}) {
  const { maxAge = 365, decayRate = 0.01 } = options; // maxAge in days

  const dateHints = extractDateHints(result);

  if (dateHints.length === 0) {
    return {
      score: 50, // Neutral score when no date info
      dateHints: [],
      bestDate: null,
      age: null,
      source: "none",
    };
  }

  // Pick best date hint (highest confidence)
  const bestHint = dateHints.reduce((best, hint) =>
    hint.confidence > best.confidence ? hint : best
  );

  const now = new Date();
  const ageMs = now - bestHint.date;
  const ageDays = ageMs / (1000 * 60 * 60 * 24);

  // Exponential decay: score = 100 * e^(-decayRate * ageDays)
  const rawScore = 100 * Math.exp(-decayRate * ageDays);

  // Clamp to 0-100
  const score = Math.max(0, Math.min(100, Math.round(rawScore)));

  return {
    score,
    dateHints,
    bestDate: bestHint.date.toISOString(),
    age: Math.floor(ageDays),
    source: bestHint.source,
    confidence: bestHint.confidence,
  };
}

/**
 * Score and sort results by freshness.
 * @param {Object[]} results - search results
 * @param {Object} options - scoring options
 * @returns {Object[]} results with freshness info added
 */
export function scoreByFreshness(results, options = {}) {
  if (!Array.isArray(results)) return results;

  return results.map((result) => {
    const freshness = calculateFreshnessScore(result, options);
    return {
      ...result,
      freshness: {
        score: freshness.score,
        bestDate: freshness.bestDate,
        age: freshness.age,
        source: freshness.source,
        confidence: freshness.confidence,
      },
    };
  });
}

/**
 * Sort results by freshness score (highest first).
 */
export function sortByFreshness(results, direction = "desc") {
  const scored = scoreByFreshness(results);
  return scored.sort((a, b) =>
    direction === "desc"
      ? b.freshness.score - a.freshness.score
      : a.freshness.score - b.freshness.score
  );
}

/**
 * Filter results by minimum freshness threshold.
 */
export function filterByFreshness(results, minScore = 50, options = {}) {
  const scored = scoreByFreshness(results, options);
  return scored.filter((r) => r.freshness.score >= minScore);
}

/**
 * Get freshness statistics for a set of results.
 */
export function getFreshnessStats(results, options = {}) {
  const scored = scoreByFreshness(results, options);

  if (scored.length === 0) {
    return {
      total: 0,
      avgScore: 0,
      distribution: { fresh: 0, recent: 0, moderate: 0, stale: 0, unknown: 0 },
      dated: 0,
      undated: 0,
    };
  }

  const scores = scored.map((r) => r.freshness.score);
  const avgScore = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);

  const distribution = {
    fresh: scored.filter((r) => r.freshness.score >= 80).length,   // < ~22 days
    recent: scored.filter((r) => r.freshness.score >= 60 && r.freshness.score < 80).length,  // ~22-51 days
    moderate: scored.filter((r) => r.freshness.score >= 40 && r.freshness.score < 60).length, // ~51-91 days
    stale: scored.filter((r) => r.freshness.score < 40 && r.freshness.score > 0).length,      // > 91 days
    unknown: scored.filter((r) => r.freshness.score === 50 && r.freshness.source === "none").length,
  };

  const dated = scored.filter((r) => r.freshness.source !== "none").length;

  return {
    total: scored.length,
    avgScore,
    distribution,
    dated,
    undated: scored.length - dated,
    minScore: Math.min(...scores),
    maxScore: Math.max(...scores),
  };
}
