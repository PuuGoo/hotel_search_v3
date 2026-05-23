/**
 * Result deduplication utility
 * Detects and merges duplicate results across search engines
 */

/**
 * Normalize a URL for comparison
 * Strips protocol, www, trailing slashes, query params, fragments
 */
export function normalizeUrl(url) {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    let normalized = parsed.hostname.replace(/^www\./, "") + parsed.pathname;
    normalized = normalized.replace(/\/+$/, "").toLowerCase();
    return normalized;
  } catch {
    return url.toLowerCase().trim();
  }
}

/**
 * Calculate similarity between two strings (Jaccard on bigrams)
 */
export function stringSimilarity(a, b) {
  if (!a || !b) return 0;
  const bigramsA = new Set();
  const bigramsB = new Set();
  const strA = a.toLowerCase();
  const strB = b.toLowerCase();

  for (let i = 0; i < strA.length - 1; i++) {
    bigramsA.add(strA.slice(i, i + 2));
  }
  for (let i = 0; i < strB.length - 1; i++) {
    bigramsB.add(strB.slice(i, i + 2));
  }

  let intersection = 0;
  for (const bg of bigramsA) {
    if (bigramsB.has(bg)) intersection++;
  }

  return intersection / (bigramsA.size + bigramsB.size - intersection);
}

/**
 * Find duplicate groups in results
 * Returns array of groups, each group is an array of indices that are duplicates
 */
export function findDuplicateGroups(results, threshold = 0.7) {
  const n = results.length;
  const visited = new Set();
  const groups = [];

  for (let i = 0; i < n; i++) {
    if (visited.has(i)) continue;

    const group = [i];
    visited.add(i);

    for (let j = i + 1; j < n; j++) {
      if (visited.has(j)) continue;

      if (areDuplicates(results[i], results[j], threshold)) {
        group.push(j);
        visited.add(j);
      }
    }

    if (group.length > 1) {
      groups.push(group);
    }
  }

  return groups;
}

/**
 * Check if two results are duplicates
 */
export function areDuplicates(a, b, threshold = 0.7) {
  // Exact URL match
  const urlA = normalizeUrl(a.url);
  const urlB = normalizeUrl(b.url);
  if (urlA && urlB && urlA === urlB) return true;

  // Title similarity
  const titleSim = stringSimilarity(a.title || a.name, b.title || b.name);
  if (titleSim >= threshold) return true;

  // Both URL and title somewhat similar
  if (urlA && urlB && titleSim >= 0.5) {
    const urlSim = stringSimilarity(urlA, urlB);
    if (urlSim >= 0.8) return true;
  }

  return false;
}

/**
 * Merge duplicate results into a single result
 * Keeps the best data from each source
 */
export function mergeDuplicates(group, results) {
  const items = group.map((i) => results[i]);

  // Pick the result with the most data as base
  let best = items[0];
  for (const item of items) {
    const score = (item.title ? 2 : 0) + (item.url ? 2 : 0) + (item.snippet || item.description ? 1 : 0) + (item.price ? 1 : 0);
    const bestScore = (best.title ? 2 : 0) + (best.url ? 2 : 0) + (best.snippet || best.description ? 1 : 0) + (best.price ? 1 : 0);
    if (score > bestScore) best = item;
  }

  // Merge engines
  const engines = new Set();
  for (const item of items) {
    if (item.engine) engines.add(item.engine);
    if (item._engines) item._engines.forEach((e) => engines.add(e));
  }

  // Merge scores (average)
  const scores = items.filter((i) => i.score != null).map((i) => i.score);
  const avgScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : null;

  return {
    ...best,
    _engines: Array.from(engines),
    _duplicateCount: items.length,
    score: avgScore != null ? Math.round(avgScore * 100) / 100 : best.score,
  };
}

/**
 * Deduplicate an array of results
 * Returns { deduplicated: [], duplicates: number, groups: number }
 */
export function deduplicateResults(results, threshold = 0.7) {
  if (!results || results.length === 0) {
    return { deduplicated: [], duplicates: 0, groups: 0 };
  }

  const groups = findDuplicateGroups(results, threshold);
  const mergedIndices = new Set();

  const deduplicated = [];

  // Process duplicate groups
  for (const group of groups) {
    const merged = mergeDuplicates(group, results);
    deduplicated.push(merged);
    group.forEach((i) => mergedIndices.add(i));
  }

  // Add non-duplicate results
  for (let i = 0; i < results.length; i++) {
    if (!mergedIndices.has(i)) {
      deduplicated.push(results[i]);
    }
  }

  const duplicateCount = groups.reduce((sum, g) => sum + g.length - 1, 0);

  return {
    deduplicated,
    duplicates: duplicateCount,
    groups: groups.length,
  };
}
