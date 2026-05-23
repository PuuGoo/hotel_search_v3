// Comparison export — export comparison data as CSV
// Generates downloadable CSV from comparison results

/**
 * Escape a CSV field (handle commas, quotes, newlines).
 */
function escapeCSV(value) {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Export comparison results as CSV string.
 */
export function exportComparisonCSV(comparison, options = {}) {
  const { includeMetadata = true, delimiter = "," } = options;

  if (!comparison || !comparison.results) {
    return "";
  }

  const engines = comparison.engines || Object.keys(comparison.results);
  const lines = [];

  // Header
  const headers = ["Engine", "Title", "URL", "Snippet", "Price", "Rating", "Position"];
  lines.push(headers.map(escapeCSV).join(delimiter));

  // Rows per engine
  for (const engine of engines) {
    const engineResults = comparison.results[engine] || [];
    if (Array.isArray(engineResults)) {
      engineResults.forEach((result, index) => {
        const row = [
          engine,
          result.title || "",
          result.url || result.link || "",
          result.snippet || result.description || "",
          result.price || result.minPrice || "",
          result.rating || "",
          index + 1,
        ];
        lines.push(row.map(escapeCSV).join(delimiter));
      });
    }
  }

  // Add metadata as comments if requested
  if (includeMetadata && comparison.query) {
    lines.unshift("");
    lines.unshift(`# Query: ${comparison.query}`);
    lines.unshift(`# Exported: ${new Date().toISOString()}`);
    lines.unshift(`# Engines: ${engines.join(", ")}`);
  }

  return lines.join("\n");
}

/**
 * Export multiple comparisons as CSV.
 */
export function exportBulkComparisonCSV(comparisons, options = {}) {
  if (!Array.isArray(comparisons) || comparisons.length === 0) {
    return "";
  }

  const lines = [];
  const headers = ["Comparison Date", "Query", "Engine", "Title", "URL", "Price", "Rating", "Position"];
  lines.push(headers.map(escapeCSV).join(options.delimiter || ","));

  for (const comparison of comparisons) {
    const engines = comparison.engines || Object.keys(comparison.results || {});
    const timestamp = comparison.timestamp ? new Date(comparison.timestamp).toISOString() : "";

    for (const engine of engines) {
      const engineResults = (comparison.results || {})[engine] || [];
      if (Array.isArray(engineResults)) {
        engineResults.forEach((result, index) => {
          const row = [
            timestamp,
            comparison.query || "",
            engine,
            result.title || "",
            result.url || result.link || "",
            result.price || result.minPrice || "",
            result.rating || "",
            index + 1,
          ];
          lines.push(row.map(escapeCSV).join(options.delimiter || ","));
        });
      }
    }
  }

  return lines.join("\n");
}

/**
 * Export comparison summary (one row per engine per comparison).
 */
export function exportComparisonSummary(comparison, options = {}) {
  if (!comparison || !comparison.results) return "";

  const engines = comparison.engines || Object.keys(comparison.results);
  const lines = [];
  const headers = ["Engine", "Result Count", "Avg Price", "Has Ratings", "Top Result"];
  lines.push(headers.map(escapeCSV).join(options.delimiter || ","));

  for (const engine of engines) {
    const engineResults = comparison.results[engine] || [];
    const results = Array.isArray(engineResults) ? engineResults : [];
    const prices = results.map((r) => r.price || r.minPrice || 0).filter((p) => p > 0);
    const avgPrice = prices.length > 0 ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length) : 0;
    const hasRatings = results.some((r) => r.rating);
    const topResult = results[0]?.title || "";

    const row = [engine, results.length, avgPrice || "", hasRatings ? "Yes" : "No", topResult];
    lines.push(row.map(escapeCSV).join(options.delimiter || ","));
  }

  return lines.join("\n");
}

/**
 * Generate CSV content for bookmark comparison.
 */
export function exportBookmarkComparisonCSV(bookmarks, options = {}) {
  if (!Array.isArray(bookmarks) || bookmarks.length === 0) return "";

  const lines = [];
  const headers = ["Title", "URL", "Tags", "Folder", "Notes", "Created"];
  lines.push(headers.map(escapeCSV).join(options.delimiter || ","));

  for (const bookmark of bookmarks) {
    const row = [
      bookmark.title || "",
      bookmark.url || "",
      (bookmark.tags || []).join("; "),
      bookmark.folder || "",
      bookmark.notes || "",
      bookmark.createdAt ? new Date(bookmark.createdAt).toISOString() : "",
    ];
    lines.push(row.map(escapeCSV).join(options.delimiter || ","));
  }

  return lines.join("\n");
}
