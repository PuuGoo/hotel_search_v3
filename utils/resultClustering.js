// Search result clustering — group similar results by topic, location, or type
// Uses text similarity to cluster related results

import crypto from "crypto";

/**
 * Extract features (tokens) from a result for clustering.
 */
function extractFeatures(result) {
  const text = [
    result.title || "",
    result.snippet || result.description || "",
    result.location || "",
    (result.tags || []).join(" "),
  ].join(" ").toLowerCase();

  const words = text
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2);

  return new Set(words);
}

/**
 * Calculate Jaccard similarity between two feature sets.
 */
function jaccardSimilarity(setA, setB) {
  const intersection = new Set([...setA].filter((x) => setB.has(x)));
  const union = new Set([...setA, ...setB]);
  return union.size === 0 ? 0 : intersection.size / union.size;
}

/**
 * Cluster results using agglomerative clustering with Jaccard similarity.
 */
export function clusterResults(results, options = {}) {
  const { threshold = 0.15, maxClusters = 10 } = options;

  if (!results || results.length === 0) return [];

  // Extract features for each result
  const features = results.map((r) => extractFeatures(r));

  // Initialize: each result is its own cluster
  let clusters = results.map((r, i) => ({
    id: `cluster_${i}`,
    results: [{ ...r, originalIndex: i }],
    features: features[i],
    label: r.title || `Result ${i + 1}`,
  }));

  // Agglomerative clustering: merge most similar clusters
  while (clusters.length > 1) {
    let bestI = -1;
    let bestJ = -1;
    let bestSim = -1;

    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        // Average linkage: average similarity between all pairs
        let totalSim = 0;
        let count = 0;
        for (const ri of clusters[i].results) {
          for (const rj of clusters[j].results) {
            const fi = features[ri.originalIndex];
            const fj = features[rj.originalIndex];
            totalSim += jaccardSimilarity(fi, fj);
            count++;
          }
        }
        const avgSim = count > 0 ? totalSim / count : 0;
        if (avgSim > bestSim) {
          bestSim = avgSim;
          bestI = i;
          bestJ = j;
        }
      }
    }

    if (bestSim < threshold) break;

    // Merge clusters
    const merged = {
      id: `cluster_${clusters.length}`,
      results: [...clusters[bestI].results, ...clusters[bestJ].results],
      features: new Set([...clusters[bestI].features, ...clusters[bestJ].features]),
      label: clusters[bestI].label,
    };

    clusters = clusters.filter((_, idx) => idx !== bestI && idx !== bestJ);
    clusters.push(merged);
  }

  // Generate cluster labels from common terms, limit to maxClusters
  return clusters.slice(0, maxClusters).map((cluster, index) => {
    const termCounts = {};
    for (const result of cluster.results) {
      const words = (result.title || "").toLowerCase().split(/\s+/).filter((w) => w.length > 2);
      for (const word of words) {
        termCounts[word] = (termCounts[word] || 0) + 1;
      }
    }

    const topTerm = Object.entries(termCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([term]) => term)[0];

    return {
      id: `cluster_${index}`,
      label: topTerm || cluster.label || `Group ${index + 1}`,
      count: cluster.results.length,
      results: cluster.results.map(({ originalIndex, ...rest }) => rest),
    };
  });
}

/**
 * Cluster results by location.
 */
export function clusterByLocation(results) {
  const locationGroups = {};

  for (const result of results) {
    const location = result.location || result.city || result.country || "Unknown";
    const key = location.toLowerCase().trim();
    if (!locationGroups[key]) {
      locationGroups[key] = { location, results: [] };
    }
    locationGroups[key].results.push(result);
  }

  return Object.entries(locationGroups)
    .sort((a, b) => b[1].results.length - a[1].results.length)
    .map(([key, group], index) => ({
      id: `location_${index}`,
      label: group.location,
      count: group.results.length,
      results: group.results,
    }));
}

/**
 * Cluster results by price range.
 */
export function clusterByPrice(results, ranges = [
  { label: "Budget", min: 0, max: 50 },
  { label: "Mid-range", min: 50, max: 150 },
  { label: "Premium", min: 150, max: 300 },
  { label: "Luxury", min: 300, max: Infinity },
]) {
  const groups = ranges.map((range, i) => ({
    id: `price_${i}`,
    label: range.label,
    count: 0,
    results: [],
    range: { min: range.min, max: range.max === Infinity ? "∞" : range.max },
  }));

  for (const result of results) {
    const price = result.price || result.minPrice || 0;
    const group = groups.find((g) => price >= g.range.min && price < (g.range.max === "∞" ? Infinity : g.range.max));
    if (group) {
      group.count++;
      group.results.push(result);
    }
  }

  return groups.filter((g) => g.count > 0);
}

/**
 * Get clustering statistics.
 */
export function getClusteringStats(results, options = {}) {
  const textClusters = clusterResults(results, options);
  const locationClusters = clusterByLocation(results);
  const priceClusters = clusterByPrice(results);

  return {
    totalResults: results.length,
    textClusters: textClusters.length,
    locationClusters: locationClusters.length,
    priceClusters: priceClusters.length,
    largestTextCluster: textClusters.reduce((max, c) => c.count > max ? c.count : max, 0),
    largestLocationCluster: locationClusters.reduce((max, c) => c.count > max ? c.count : max, 0),
  };
}
