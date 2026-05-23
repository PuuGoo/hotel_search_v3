// Smart defaults — recommend best search engine based on query type and history

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const HISTORY_FILE = path.join(__dirname, "..", "search_history.json");
const PREFERENCES_FILE = path.join(__dirname, "..", "user_preferences.json");

function readJSON(filePath) {
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch { /* ignore */ }
  return [];
}

/**
 * Engine capabilities (what each engine is best at).
 */
const ENGINE_SPECIALTIES = {
  tavily: {
    strengths: ["hotel", "resort", "accommodation", "booking", "airbnb", "lodging"],
    queryTypes: ["specific", "brand", "location"],
    reliability: 0.95,
  },
  ddg: {
    strengths: ["general", "web", "information", "review", "comparison"],
    queryTypes: ["general", "broad"],
    reliability: 0.9,
  },
  google: {
    strengths: ["hotel", "resort", "travel", "tourism", "booking"],
    queryTypes: ["specific", "location", "brand"],
    reliability: 0.98,
  },
  searxng: {
    strengths: ["privacy", "meta", "aggregated"],
    queryTypes: ["general", "privacy"],
    reliability: 0.8,
  },
};

/**
 * Classify a query into a type.
 */
export function classifyQuery(query) {
  if (!query) return "general";
  const lower = query.toLowerCase();

  // Hotel/accommodation specific
  const hotelTerms = ["hotel", "resort", "motel", "hostel", "inn", "lodge", "airbnb", "villa", "apartment"];
  if (hotelTerms.some((t) => lower.includes(t))) return "hotel";

  // Location-specific (contains city/country patterns)
  const locationIndicators = ["in ", "near ", "at ", "around ", "beach", "downtown", "airport"];
  if (locationIndicators.some((t) => lower.includes(t))) return "location";

  // Brand-specific
  const brands = ["hilton", "marriott", "hyatt", "sheraton", "radisson", "novotel", "ibis", "holiday inn"];
  if (brands.some((b) => lower.includes(b))) return "brand";

  // Price-related
  const priceTerms = ["cheap", "budget", "luxury", "expensive", "affordable", "price", "cost"];
  if (priceTerms.some((t) => lower.includes(t))) return "price";

  // Comparison
  const compareTerms = ["vs", "versus", "compare", "better", "best", "worst"];
  if (compareTerms.some((t) => lower.includes(t))) return "comparison";

  return "general";
}

/**
 * Get the recommended engine for a query.
 * @param {string} query - search query
 * @param {string} userId - user ID (for personalized recommendations)
 * @returns {Object} - { recommended, alternatives, reason }
 */
export function getRecommendedEngine(query, userId) {
  const queryType = classifyQuery(query);
  const userHistory = getUserEnginePerformance(userId);

  // Score each engine
  const scores = {};
  for (const [engine, config] of Object.entries(ENGINE_SPECIALTIES)) {
    let score = config.reliability * 30; // Base reliability (0-30)

    // Query type match (0-30)
    if (config.queryTypes.includes(queryType)) score += 30;

    // Keyword match in specialties (0-20)
    const lower = query.toLowerCase();
    const matchCount = config.strengths.filter((s) => lower.includes(s)).length;
    score += Math.min(20, matchCount * 10);

    // User history bonus (0-20)
    if (userHistory[engine]) {
      const hist = userHistory[engine];
      const successRate = hist.searches > 0 ? hist.clicks / hist.searches : 0;
      score += successRate * 20;
    }

    scores[engine] = Math.round(score);
  }

  // Sort by score
  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const recommended = sorted[0][0];
  const alternatives = sorted.slice(1, 3).map(([engine, score]) => ({ engine, score }));

  // Generate reason
  let reason;
  if (queryType === "hotel") {
    reason = "Hotel/accommodation query detected — specialized engines recommended";
  } else if (queryType === "brand") {
    reason = "Brand-specific query — engines with brand databases recommended";
  } else if (queryType === "price") {
    reason = "Price-related query — engines with booking integration recommended";
  } else if (queryType === "location") {
    reason = "Location-based query — engines with geo-search recommended";
  } else {
    reason = "General query — using most reliable engine";
  }

  return {
    recommended,
    score: sorted[0][1],
    alternatives,
    queryType,
    reason,
    allScores: Object.fromEntries(sorted),
  };
}

/**
 * Analyze user's engine performance from search history.
 */
function getUserEnginePerformance(userId) {
  if (!userId) return {};

  const history = readJSON(HISTORY_FILE);
  const userHistory = Array.isArray(history) ? history.filter((h) => h.userId === userId) : [];
  const performance = {};

  for (const entry of userHistory) {
    const engine = entry.engine || "unknown";
    if (!performance[engine]) {
      performance[engine] = { searches: 0, clicks: 0, results: 0 };
    }
    performance[engine].searches++;
    performance[engine].results += entry.resultCount || 0;
  }

  return performance;
}

/**
 * Get user's preferred engine from preferences.
 */
export function getUserPreferredEngine(userId) {
  const prefs = readJSON(PREFERENCES_FILE);
  const userPref = Array.isArray(prefs) ? prefs.find((p) => p.userId === userId) : null;
  return userPref?.defaultEngine || null;
}

/**
 * Get smart defaults for a search (combines preference, history, and query analysis).
 */
export function getSmartDefaults(query, userId) {
  const preferred = getUserPreferredEngine(userId);
  const recommended = getRecommendedEngine(query, userId);

  return {
    engine: preferred || recommended.recommended,
    queryType: recommended.queryType,
    reason: preferred
      ? `Using your preferred engine: ${preferred}`
      : recommended.reason,
    recommendation: recommended,
  };
}
