// Result ranking feedback — learn from user clicks to improve ranking
// Tracks click-through data and computes position-based ranking adjustments

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FEEDBACK_FILE = path.join(__dirname, "..", "ranking_feedback.json");
const MAX_ENTRIES = 50000;
const POSITION_BIAS_DECAY = 0.95; // Each lower position gets 5% less implicit credit

function readJSON(filePath) {
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch { /* ignore */ }
  return { clicks: [], urlScores: {} };
}

function writeJSON(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  } catch { /* ignore */ }
}

/**
 * Record a click on a search result.
 */
export function recordClick(entry) {
  const data = readJSON(FEEDBACK_FILE);
  if (!data.clicks) data.clicks = [];
  if (!data.urlScores) data.urlScores = {};

  const click = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    userId: entry.userId || null,
    query: entry.query || "",
    url: entry.url || "",
    title: entry.title || "",
    engine: entry.engine || "unknown",
    position: entry.position ?? 0,
    timestamp: Date.now(),
  };

  data.clicks.unshift(click);

  // Trim old entries
  if (data.clicks.length > MAX_ENTRIES) {
    data.clicks.length = MAX_ENTRIES;
  }

  // Update URL score with position-adjusted weight
  const positionWeight = Math.pow(POSITION_BIAS_DECAY, click.position);
  const url = click.url;
  if (!data.urlScores[url]) {
    data.urlScores[url] = { clicks: 0, weightedScore: 0, queries: [], lastClicked: 0 };
  }
  const score = data.urlScores[url];
  score.clicks++;
  score.weightedScore += positionWeight;
  score.lastClicked = click.timestamp;
  if (click.query) {
    if (!Array.isArray(score.queries)) score.queries = [];
    if (!score.queries.includes(click.query)) {
      score.queries.push(click.query);
    }
  }

  writeJSON(FEEDBACK_FILE, data);
  return click;
}

/**
 * Get ranking boost factors for a set of URLs based on click history.
 * Returns a map of url -> boost multiplier (1.0 = neutral, >1.0 = boosted).
 */
export function getRankingBoosts(urls, options = {}) {
  const { query = null, userId = null } = options;
  const data = readJSON(FEEDBACK_FILE);
  const urlScores = data.urlScores || {};

  const boosts = {};
  for (const url of urls) {
    const score = urlScores[url];
    if (!score || score.clicks === 0) {
      boosts[url] = 1.0;
      continue;
    }

    // Base boost from weighted click score (log scale to prevent runaway)
    let boost = 1.0 + Math.log1p(score.weightedScore) * 0.1;

    // Bonus if this URL was clicked for the same query
    if (query && Array.isArray(score.queries) && score.queries.includes(query.toLowerCase().trim())) {
      boost *= 1.15;
    }

    // Cap boost at 2.0
    boosts[url] = Math.min(boost, 2.0);
  }

  return boosts;
}

/**
 * Re-rank results using click feedback.
 */
export function rerankResults(results, options = {}) {
  const { query = null, boostWeight = 0.3 } = options;
  const urls = results.map((r) => r.url || r.link || "");
  const boosts = getRankingBoosts(urls, { query });

  return results.map((result, index) => {
    const url = result.url || result.link || "";
    const boost = boosts[url] || 1.0;
    const originalScore = result.score || result.relevance || 1.0;
    const boostedScore = originalScore * (1 + (boost - 1) * boostWeight);

    return {
      ...result,
      originalScore,
      boostedScore,
      clickBoost: boost,
      originalPosition: index,
    };
  }).sort((a, b) => b.boostedScore - a.boostedScore);
}

/**
 * Get click statistics.
 */
export function getClickStats(options = {}) {
  const { hours = 24, userId = null } = options;
  const data = readJSON(FEEDBACK_FILE);
  const clicks = data.clicks || [];
  const cutoff = Date.now() - hours * 60 * 60 * 1000;

  let filtered = clicks.filter((c) => c.timestamp > cutoff);
  if (userId) {
    filtered = filtered.filter((c) => c.userId === userId);
  }

  if (filtered.length === 0) {
    return { totalClicks: 0, uniqueUrls: 0, uniqueQueries: 0, topUrls: [], topQueries: [], positionDistribution: {} };
  }

  // Top URLs by clicks
  const urlCounts = {};
  for (const c of filtered) {
    urlCounts[c.url] = (urlCounts[c.url] || 0) + 1;
  }
  const topUrls = Object.entries(urlCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([url, count]) => ({ url, clicks: count }));

  // Top queries
  const queryCounts = {};
  for (const c of filtered) {
    if (c.query) queryCounts[c.query] = (queryCounts[c.query] || 0) + 1;
  }
  const topQueries = Object.entries(queryCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([query, count]) => ({ query, clicks: count }));

  // Position distribution
  const positionDist = {};
  for (const c of filtered) {
    const pos = c.position ?? 0;
    positionDist[pos] = (positionDist[pos] || 0) + 1;
  }

  const uniqueUrls = new Set(filtered.map((c) => c.url)).size;
  const uniqueQueries = new Set(filtered.map((c) => c.query)).size;

  return {
    totalClicks: filtered.length,
    uniqueUrls,
    uniqueQueries,
    topUrls,
    topQueries,
    positionDistribution: positionDist,
    timeRange: { hours, from: new Date(cutoff).toISOString(), to: new Date().toISOString() },
  };
}

/**
 * Get click history for a specific URL.
 */
export function getUrlClickHistory(url, options = {}) {
  const { limit = 50 } = options;
  const data = readJSON(FEEDBACK_FILE);
  const clicks = data.clicks || [];

  return clicks
    .filter((c) => c.url === url)
    .slice(0, limit);
}

/**
 * Clear all ranking feedback data.
 */
export function clearRankingFeedback() {
  writeJSON(FEEDBACK_FILE, { clicks: [], urlScores: {} });
}
