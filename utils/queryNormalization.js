// Query normalization — standardize queries for better caching and dedup
// Normalizes whitespace, casing, common abbreviations, and stop words

const STOP_WORDS = new Set([
  "a", "an", "the", "in", "on", "at", "to", "for", "of", "with", "by",
  "from", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "can", "shall",
]);

const ABBREVIATIONS = {
  "st": "street",
  "ave": "avenue",
  "blvd": "boulevard",
  "rd": "road",
  "dr": "drive",
  "ln": "lane",
  "ct": "court",
  "pl": "place",
  "hwy": "highway",
  "n": "north",
  "s": "south",
  "e": "east",
  "w": "west",
  "ne": "northeast",
  "nw": "northwest",
  "se": "southeast",
  "sw": "southwest",
  "intl": "international",
  "natl": "national",
  "govt": "government",
  "dept": "department",
  "mgr": "manager",
  "asst": "assistant",
  "dir": "director",
  "vp": "vice president",
  "ceo": "chief executive officer",
  "cto": "chief technology officer",
};

const SYNONYMS = {
  "hotel": "hotel",
  "hotels": "hotel",
  "motel": "hotel",
  "motels": "hotel",
  "inn": "hotel",
  "inns": "hotel",
  "resort": "resort",
  "resorts": "resort",
  "hostel": "hostel",
  "hostels": "hostel",
  "accommodation": "hotel",
  "accommodations": "hotel",
  "lodging": "hotel",
  "stay": "hotel",
  "cheap": "budget",
  "budget": "budget",
  "affordable": "budget",
  "economy": "budget",
  "luxury": "luxury",
  "premium": "luxury",
  "upscale": "luxury",
  "deluxe": "luxury",
  "5-star": "luxury",
  "5star": "luxury",
};

/**
 * Normalize a query string.
 */
export function normalizeQuery(query, options = {}) {
  const {
    lowercase = true,
    trimWhitespace = true,
    removeStopWords = false,
    expandAbbreviations = false,
    applySynonyms = false,
    removeExtraSpaces = true,
    removePunctuation = false,
  } = options;

  if (!query || typeof query !== "string") {
    return { original: query || "", normalized: "", changed: false };
  }

  let normalized = query;
  const original = query;

  // Lowercase
  if (lowercase) {
    normalized = normalized.toLowerCase();
  }

  // Trim
  if (trimWhitespace) {
    normalized = normalized.trim();
  }

  // Remove punctuation
  if (removePunctuation) {
    normalized = normalized.replace(/[^\w\s]/g, " ");
  }

  // Remove extra spaces
  if (removeExtraSpaces) {
    normalized = normalized.replace(/\s+/g, " ").trim();
  }

  // Expand abbreviations
  if (expandAbbreviations) {
    const words = normalized.split(/\s+/);
    normalized = words.map((w) => ABBREVIATIONS[w] || w).join(" ");
  }

  // Apply synonyms
  if (applySynonyms) {
    const words = normalized.split(/\s+/);
    normalized = words.map((w) => SYNONYMS[w] || w).join(" ");
  }

  // Remove stop words
  if (removeStopWords) {
    const words = normalized.split(/\s+/);
    normalized = words.filter((w) => !STOP_WORDS.has(w)).join(" ");
  }

  // Final cleanup
  normalized = normalized.replace(/\s+/g, " ").trim();

  return {
    original,
    normalized,
    changed: original !== normalized,
  };
}

/**
 * Generate a canonical cache key from a query.
 */
export function generateCacheKey(query, options = {}) {
  const { normalize = true } = options;

  let key = query || "";
  if (normalize) {
    key = normalizeQuery(key, {
      lowercase: true,
      trimWhitespace: true,
      removeExtraSpaces: true,
      removePunctuation: true,
      applySynonyms: true,
    }).normalized;
  }

  return key;
}

/**
 * Check if two queries are equivalent after normalization.
 */
export function areQueriesEquivalent(query1, query2, options = {}) {
  const key1 = generateCacheKey(query1, options);
  const key2 = generateCacheKey(query2, options);
  return key1 === key2;
}

/**
 * Batch normalize multiple queries.
 */
export function batchNormalize(queries, options = {}) {
  return queries.map((q) => normalizeQuery(q, options));
}

/**
 * Get normalization statistics for a list of queries.
 */
export function getNormalizationStats(queries, options = {}) {
  const results = batchNormalize(queries, options);
  const changed = results.filter((r) => r.changed).length;
  const unique = new Set(results.map((r) => r.normalized)).size;

  return {
    total: queries.length,
    changed,
    unchanged: queries.length - changed,
    unique,
    duplicateReduction: queries.length - unique,
  };
}

/**
 * Get available normalization options.
 */
export function getNormalizationOptions() {
  return {
    lowercase: "Convert to lowercase",
    trimWhitespace: "Trim leading/trailing whitespace",
    removeStopWords: "Remove common stop words",
    expandAbbreviations: "Expand abbreviations (st -> street)",
    applySynonyms: "Apply synonyms (hotels -> hotel)",
    removeExtraSpaces: "Collapse multiple spaces",
    removePunctuation: "Remove punctuation marks",
  };
}
