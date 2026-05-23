// Fuzzy matching — detect similar hotel names for deduplication
// Uses Levenshtein distance, token overlap, and normalization

/**
 * Normalize a string for comparison.
 * Lowercase, remove accents, strip special chars, collapse whitespace.
 */
export function normalize(str) {
  if (!str) return "";
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // Remove accents
    .replace(/[^a-z0-9\s]/g, " ") // Remove special chars
    .replace(/\s+/g, " ") // Collapse whitespace
    .trim();
}

/**
 * Calculate Levenshtein distance between two strings.
 */
export function levenshtein(a, b) {
  if (!a || !b) return Math.max(a?.length || 0, b?.length || 0);
  if (a === b) return 0;

  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }

  return dp[m][n];
}

/**
 * Calculate similarity ratio (0-1) between two strings.
 * Combines Levenshtein distance with token overlap.
 */
export function similarity(a, b) {
  if (!a && !b) return 1;
  if (!a || !b) return 0;

  const normA = normalize(a);
  const normB = normalize(b);

  if (normA === normB) return 1;

  // Levenshtein-based similarity
  const maxLen = Math.max(normA.length, normB.length);
  const levDist = levenshtein(normA, normB);
  const levSim = 1 - levDist / maxLen;

  // Token overlap (Jaccard)
  const tokensA = new Set(normA.split(" "));
  const tokensB = new Set(normB.split(" "));
  const intersection = new Set([...tokensA].filter((t) => tokensB.has(t)));
  const union = new Set([...tokensA, ...tokensB]);
  const jaccardSim = union.size > 0 ? intersection.size / union.size : 0;

  // Weighted combination (favor token overlap for hotel names)
  return levSim * 0.4 + jaccardSim * 0.6;
}

/**
 * Check if two strings are likely duplicates.
 * @param {string} a - first string
 * @param {string} b - second string
 * @param {number} threshold - similarity threshold (default 0.7)
 * @returns {boolean}
 */
export function isDuplicate(a, b, threshold = 0.7) {
  return similarity(a, b) >= threshold;
}

/**
 * Find duplicates in an array of items.
 * @param {Array} items - array of objects with a `name` or `title` field
 * @param {Object} options - { threshold, nameField, urlField }
 * @returns {Array} groups of duplicates
 */
export function findDuplicates(items, options = {}) {
  const threshold = options.threshold ?? 0.7;
  const nameField = options.nameField || "name";
  const urlField = options.urlField || "url";

  if (!items || items.length === 0) return [];

  const groups = [];
  const assigned = new Set();

  for (let i = 0; i < items.length; i++) {
    if (assigned.has(i)) continue;

    const group = [items[i]];
    assigned.add(i);

    const nameI = items[i][nameField] || items[i].title || "";
    const urlI = normalizeUrl(items[i][urlField]);

    for (let j = i + 1; j < items.length; j++) {
      if (assigned.has(j)) continue;

      const nameJ = items[j][nameField] || items[j].title || "";
      const urlJ = normalizeUrl(items[j][urlField]);

      // Exact URL match
      if (urlI && urlJ && urlI === urlJ) {
        group.push(items[j]);
        assigned.add(j);
        continue;
      }

      // Fuzzy name match
      if (isDuplicate(nameI, nameJ, threshold)) {
        group.push(items[j]);
        assigned.add(j);
      }
    }

    if (group.length > 1) {
      groups.push(group);
    }
  }

  return groups;
}

/**
 * Merge duplicate items (keep the one with most data, combine tags).
 */
export function mergeDuplicates(group, nameField = "name") {
  if (!group || group.length === 0) return null;
  if (group.length === 1) return group[0];

  // Pick the "best" item (most fields filled, longest name)
  const best = group.reduce((a, b) => {
    const scoreA = Object.values(a).filter((v) => v != null && v !== "").length;
    const scoreB = Object.values(b).filter((v) => v != null && v !== "").length;
    return scoreA >= scoreB ? a : b;
  });

  // Merge tags from all items
  const allTags = new Set();
  for (const item of group) {
    if (Array.isArray(item.tags)) {
      item.tags.forEach((t) => allTags.add(t));
    }
  }

  return {
    ...best,
    tags: [...allTags],
    _mergedFrom: group.length,
    _mergedIds: group.map((g) => g.id).filter(Boolean),
  };
}

/**
 * Normalize URL for comparison.
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
