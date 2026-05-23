// Search result scoring — rank results by relevance across engines
// Combines position score, keyword match, engine weight, and freshness

/**
 * Default engine weights (higher = more trusted).
 */
const DEFAULT_ENGINE_WEIGHTS = {
  tavily: 1.0,
  google: 0.95,
  ddg: 0.85,
  bing: 0.8,
  searxng: 0.7,
  crawlbase: 0.6,
};

/**
 * Score a single search result.
 * @param {Object} result - { title, description/snippet, url, engine, position, timestamp }
 * @param {string} query - original search query
 * @param {Object} options - { engineWeights, positionDecay, keywordBoost, freshnessBoost }
 * @returns {Object} result with added `relevanceScore` (0-100)
 */
export function scoreResult(result, query, options = {}) {
  const engineWeights = options.engineWeights || DEFAULT_ENGINE_WEIGHTS;
  const positionDecay = options.positionDecay ?? 0.95; // Each position down multiplies by this
  const keywordBoost = options.keywordBoost ?? 2.0; // Weight for keyword matches
  const freshnessBoost = options.freshnessBoost ?? 0.5; // Weight for recency

  let score = 0;

  // 1. Position score (0-40 points)
  const position = result.position || 1;
  const positionScore = 40 * Math.pow(positionDecay, position - 1);
  score += positionScore;

  // 2. Keyword match score (0-35 points)
  const queryTerms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 1);
  const title = (result.title || "").toLowerCase();
  const description = (result.description || result.snippet || "").toLowerCase();
  const combined = `${title} ${description}`;

  let keywordScore = 0;
  for (const term of queryTerms) {
    // Exact match in title (highest value)
    if (title.includes(term)) keywordScore += 3;
    // Exact match in description
    else if (description.includes(term)) keywordScore += 1.5;
    // Partial match
    else if (combined.includes(term.substring(0, Math.ceil(term.length * 0.7)))) keywordScore += 0.5;
  }
  // Normalize to 0-35
  const maxKeywordScore = queryTerms.length * 3;
  score += maxKeywordScore > 0 ? Math.min(35, (keywordScore / maxKeywordScore) * 35 * keywordBoost) : 0;

  // 3. Engine weight score (0-15 points)
  const engineWeight = engineWeights[result.engine?.toLowerCase()] || 0.5;
  score += engineWeight * 15;

  // 4. Freshness score (0-10 points)
  if (result.timestamp) {
    const ageHours = (Date.now() - new Date(result.timestamp).getTime()) / (1000 * 60 * 60);
    const freshness = Math.max(0, 1 - ageHours / (24 * 30)); // Decays over 30 days
    score += freshness * 10 * freshnessBoost;
  }

  // 5. Has URL bonus (0-5 points)
  if (result.url && result.url.startsWith("http")) {
    score += 5;
  }

  // Normalize to 0-100
  const finalScore = Math.min(100, Math.max(0, Math.round(score)));

  return { ...result, relevanceScore: finalScore };
}

/**
 * Score and sort an array of results.
 * @param {Array} results - array of search results
 * @param {string} query - original search query
 * @param {Object} options - scoring options
 * @returns {Array} results sorted by relevanceScore descending
 */
export function scoreAndRank(results, query, options = {}) {
  if (!results || !Array.isArray(results)) return [];

  return results
    .map((r, i) => scoreResult({ ...r, position: r.position || i + 1 }, query, options))
    .sort((a, b) => b.relevanceScore - a.relevanceScore);
}

/**
 * Merge results from multiple engines, scoring and deduplicating.
 * @param {Object} engineResults - { engine1: [results], engine2: [results] }
 * @param {string} query - original search query
 * @param {Object} options - scoring options
 * @returns {Array} merged, scored, deduplicated results
 */
export function mergeResults(engineResults, query, options = {}) {
  const all = [];

  for (const [engine, results] of Object.entries(engineResults)) {
    if (!Array.isArray(results)) continue;
    for (let i = 0; i < results.length; i++) {
      all.push({
        ...results[i],
        engine,
        position: i + 1,
      });
    }
  }

  // Deduplicate by URL (keep highest scoring)
  const scored = scoreAndRank(all, query, options);
  const seen = new Map();

  for (const result of scored) {
    const key = normalizeUrl(result.url);
    if (!key) {
      seen.set(`no-url-${seen.size}`, result);
      continue;
    }
    if (!seen.has(key) || seen.get(key).relevanceScore < result.relevanceScore) {
      seen.set(key, result);
    }
  }

  return [...seen.values()].sort((a, b) => b.relevanceScore - a.relevanceScore);
}

/**
 * Normalize URL for deduplication (strip protocol, www, trailing slash).
 */
function normalizeUrl(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    return (u.hostname.replace(/^www\./, "") + u.pathname.replace(/\/$/, "")).toLowerCase();
  } catch {
    return url.toLowerCase().replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");
  }
}

/**
 * Get scoring statistics for a set of results.
 */
export function getScoringStats(results) {
  if (!results || results.length === 0) {
    return { count: 0, avgScore: 0, minScore: 0, maxScore: 0, byEngine: {} };
  }

  const scores = results.map((r) => r.relevanceScore || 0);
  const byEngine = {};

  for (const r of results) {
    const engine = r.engine || "unknown";
    if (!byEngine[engine]) byEngine[engine] = { count: 0, avgScore: 0, totalScore: 0 };
    byEngine[engine].count++;
    byEngine[engine].totalScore += r.relevanceScore || 0;
  }

  for (const stats of Object.values(byEngine)) {
    stats.avgScore = Math.round(stats.totalScore / stats.count);
    delete stats.totalScore;
  }

  return {
    count: results.length,
    avgScore: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length),
    minScore: Math.min(...scores),
    maxScore: Math.max(...scores),
    byEngine,
  };
}
