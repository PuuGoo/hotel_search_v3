// Filter utilities for search results

/**
 * Filter results by various criteria
 * @param {Array} results - Array of search result objects
 * @param {Object} filters - Filter criteria
 * @returns {Array} Filtered results
 */
export function applyFilters(results, filters = {}) {
  if (!Array.isArray(results) || !filters) return results;

  return results.filter((item) => {
    // Text search (title, snippet, url)
    if (filters.q) {
      const query = filters.q.toLowerCase();
      const title = (item.title || "").toLowerCase();
      const snippet = (item.snippet || item.content || "").toLowerCase();
      const url = (item.url || "").toLowerCase();
      if (!title.includes(query) && !snippet.includes(query) && !url.includes(query)) {
        return false;
      }
    }

    // Domain filter
    if (filters.domain) {
      const url = item.url || "";
      if (!url.includes(filters.domain.toLowerCase())) {
        return false;
      }
    }

    // Exclude domains
    if (filters.excludeDomains && filters.excludeDomains.length) {
      const url = (item.url || "").toLowerCase();
      if (filters.excludeDomains.some((d) => url.includes(d.toLowerCase()))) {
        return false;
      }
    }

    // Minimum score
    if (filters.minScore != null) {
      const score = item.score || item.percentage || 0;
      if (score < filters.minScore) {
        return false;
      }
    }

    // Maximum results
    // (applied after filter, not per-item)

    return true;
  });
}

/**
 * Sort results by various criteria
 * @param {Array} results - Array of search result objects
 * @param {string} sortBy - Sort field (score, title, url)
 * @param {string} order - Sort order (asc, desc)
 * @returns {Array} Sorted results
 */
export function sortResults(results, sortBy = "score", order = "desc") {
  if (!Array.isArray(results)) return results;

  const sorted = [...results];
  const dir = order === "asc" ? 1 : -1;

  sorted.sort((a, b) => {
    switch (sortBy) {
      case "score": {
        const sa = a.score || a.percentage || 0;
        const sb = b.score || b.percentage || 0;
        return (sa - sb) * dir;
      }
      case "title":
        return ((a.title || "").localeCompare(b.title || "")) * dir;
      case "url":
        return ((a.url || "").localeCompare(b.url || "")) * dir;
      default:
        return 0;
    }
  });

  return sorted;
}

/**
 * Extract domains from results for faceted filtering
 * @param {Array} results - Array of search result objects
 * @returns {Array} Sorted unique domains with counts
 */
export function extractDomains(results) {
  if (!Array.isArray(results)) return [];
  const counts = {};
  for (const item of results) {
    try {
      const domain = new URL(item.url || "").hostname;
      counts[domain] = (counts[domain] || 0) + 1;
    } catch {}
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([domain, count]) => ({ domain, count }));
}
