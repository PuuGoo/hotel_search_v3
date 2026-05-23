// Search result deduplication v2 — fuzzy matching with configurable thresholds
// Uses multiple similarity metrics to detect near-duplicate results

/**
 * Normalize a string for comparison.
 */
function normalize(str) {
  return (str || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Extract domain from URL.
 */
function getDomain(url) {
  try {
    return new URL(url).hostname.replace("www.", "").toLowerCase();
  } catch {
    return "";
  }
}

/**
 * Calculate Levenshtein distance between two strings.
 */
function levenshtein(a, b) {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }

  return matrix[a.length][b.length];
}

/**
 * Calculate string similarity (0 to 1) using Levenshtein.
 */
function stringSimilarity(a, b) {
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

/**
 * Calculate token-based Jaccard similarity.
 */
function jaccardSimilarity(a, b) {
  const tokensA = new Set(a.split(/\s+/).filter(Boolean));
  const tokensB = new Set(b.split(/\s+/).filter(Boolean));
  if (tokensA.size === 0 && tokensB.size === 0) return 1;

  const intersection = new Set([...tokensA].filter((x) => tokensB.has(x)));
  const union = new Set([...tokensA, ...tokensB]);
  return intersection.size / union.size;
}

/**
 * Calculate overall similarity between two results.
 */
function calculateSimilarity(a, b, options = {}) {
  const {
    titleWeight = 0.4,
    urlWeight = 0.3,
    snippetWeight = 0.2,
    domainWeight = 0.1,
  } = options;

  const titleA = normalize(a.title);
  const titleB = normalize(b.title);
  const urlA = (a.url || a.link || "").toLowerCase();
  const urlB = (b.url || b.link || "").toLowerCase();
  const snippetA = normalize(a.snippet || a.description || "");
  const snippetB = normalize(b.snippet || b.description || "");
  const domainA = getDomain(urlA);
  const domainB = getDomain(urlB);

  // Title similarity (combine Levenshtein and Jaccard)
  const titleSim = (stringSimilarity(titleA, titleB) + jaccardSimilarity(titleA, titleB)) / 2;

  // URL similarity
  const urlSim = stringSimilarity(urlA, urlB);

  // Snippet similarity
  const snippetSim = snippetA && snippetB
    ? jaccardSimilarity(snippetA, snippetB)
    : 0;

  // Domain similarity
  const domainSim = domainA === domainB ? 1 : 0;

  return {
    overall: titleSim * titleWeight + urlSim * urlWeight + snippetSim * snippetWeight + domainSim * domainWeight,
    title: titleSim,
    url: urlSim,
    snippet: snippetSim,
    domain: domainSim,
  };
}

/**
 * Deduplicate results using fuzzy matching.
 */
export function deduplicateResults(results, options = {}) {
  const { threshold = 0.7, keepFirst = true } = options;

  if (!results || results.length === 0) return { unique: [], duplicates: [] };

  const unique = [];
  const duplicates = [];
  const assigned = new Set();

  for (let i = 0; i < results.length; i++) {
    if (assigned.has(i)) continue;

    const group = [i];
    for (let j = i + 1; j < results.length; j++) {
      if (assigned.has(j)) continue;

      const similarity = calculateSimilarity(results[i], results[j], options);
      if (similarity.overall >= threshold) {
        group.push(j);
        assigned.add(j);
      }
    }

    // Keep the first (or best) result from the group
    const keptIndex = keepFirst ? group[0] : group[0];
    unique.push({
      ...results[keptIndex],
      _dedupGroup: group.length,
      _dedupIndices: group,
    });

    // Mark rest as duplicates
    for (const idx of group) {
      if (idx !== keptIndex) {
        duplicates.push({
          result: results[idx],
          similarTo: keptIndex,
          similarity: calculateSimilarity(results[keptIndex], results[idx], options),
        });
      }
    }
  }

  return { unique, duplicates };
}

/**
 * Find duplicates for a specific result in a list.
 */
export function findDuplicates(target, results, options = {}) {
  const { threshold = 0.7 } = options;
  const duplicates = [];

  for (let i = 0; i < results.length; i++) {
    const similarity = calculateSimilarity(target, results[i], options);
    if (similarity.overall >= threshold) {
      duplicates.push({
        index: i,
        result: results[i],
        similarity,
      });
    }
  }

  return duplicates.sort((a, b) => b.similarity.overall - a.similarity.overall);
}

/**
 * Get deduplication statistics.
 */
export function getDedupStats(results, options = {}) {
  const { unique, duplicates } = deduplicateResults(results, options);

  return {
    totalResults: results.length,
    uniqueResults: unique.length,
    duplicateCount: duplicates.length,
    deduplicationRate: results.length > 0 ? Math.round((duplicates.length / results.length) * 100) : 0,
    threshold: options.threshold || 0.7,
  };
}
