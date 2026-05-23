// Search A/B testing — test different search configurations per user
// Manages search-specific experiments: engine, result count, sorting, filters

import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const EXPERIMENTS_FILE = path.join(__dirname, "..", "search_ab_experiments.json");
const RESULTS_FILE = path.join(__dirname, "..", "search_ab_results.json");
const MAX_RESULTS = 100000;

function readJSON(filePath) {
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch { /* ignore */ }
  return { experiments: [], results: [] };
}

function writeJSON(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  } catch { /* ignore */ }
}

function hashAssign(userId, experimentId, variantCount) {
  const hash = crypto.createHash("md5").update(`${userId}:${experimentId}`).digest("hex");
  return parseInt(hash.slice(0, 8), 16) % variantCount;
}

/**
 * Create a search experiment.
 * config: { name, description, variants: [{ name, config: { engine?, resultCount?, sortBy?, filters? } }], trafficSplit? }
 */
export function createExperiment(experiment) {
  const { name, description, variants, trafficSplit = [] } = experiment;

  if (!name || !Array.isArray(variants) || variants.length < 2) {
    throw new Error("Need a name and at least 2 variants");
  }

  const data = readJSON(EXPERIMENTS_FILE);
  if (!data.experiments) data.experiments = [];

  if (data.experiments.some((e) => e.name === name)) {
    throw new Error(`Experiment "${name}" already exists`);
  }

  const exp = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name,
    description: description || "",
    variants: variants.map((v, i) => ({
      name: v.name,
      config: v.config || {},
      weight: trafficSplit[i] || Math.round(100 / variants.length),
    })),
    active: true,
    createdAt: Date.now(),
    totalAssignments: 0,
  };

  data.experiments.push(exp);
  writeJSON(EXPERIMENTS_FILE, data);
  return exp;
}

/**
 * Get all experiments.
 */
export function getExperiments() {
  const data = readJSON(EXPERIMENTS_FILE);
  return data.experiments || [];
}

/**
 * Get a specific experiment.
 */
export function getExperiment(experimentId) {
  const experiments = getExperiments();
  return experiments.find((e) => e.id === experimentId) || null;
}

/**
 * Assign a user to a variant for an experiment.
 */
export function assignVariant(userId, experimentId) {
  const experiments = getExperiments();
  const experiment = experiments.find((e) => e.id === experimentId);

  if (!experiment || !experiment.active) {
    return null;
  }

  const variantIndex = hashAssign(userId, experimentId, experiment.variants.length);
  experiment.totalAssignments++;
  writeJSON(EXPERIMENTS_FILE, { experiments });

  return {
    experimentId,
    experimentName: experiment.name,
    variant: experiment.variants[variantIndex],
    variantIndex,
  };
}

/**
 * Get the search config for a user based on active experiments.
 * Returns merged config from all active experiments.
 */
export function getSearchConfig(userId) {
  const experiments = getExperiments();
  const activeExperiments = experiments.filter((e) => e.active);
  const config = {};
  const assignments = [];

  for (const exp of activeExperiments) {
    const variantIndex = hashAssign(userId, exp.id, exp.variants.length);
    const variant = exp.variants[variantIndex];

    if (variant.config) {
      Object.assign(config, variant.config);
    }

    assignments.push({
      experimentId: exp.id,
      experimentName: exp.name,
      variantName: variant.name,
      variantIndex,
    });
  }

  return { config, assignments };
}

/**
 * Record a search A/B test result.
 */
export function recordSearchResult(entry) {
  const data = readJSON(RESULTS_FILE);
  if (!data.results) data.results = [];

  const result = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    userId: entry.userId || null,
    experimentId: entry.experimentId || null,
    variantIndex: entry.variantIndex ?? -1,
    query: entry.query || "",
    engine: entry.engine || "",
    resultCount: entry.resultCount || 0,
    duration: entry.duration || 0,
    clicked: entry.clicked || false,
    timestamp: Date.now(),
  };

  data.results.unshift(result);

  if (data.results.length > MAX_RESULTS) {
    data.results.length = MAX_RESULTS;
  }

  writeJSON(RESULTS_FILE, data);
  return result;
}

/**
 * Get experiment analytics.
 */
export function getExperimentAnalytics(experimentId, options = {}) {
  const { hours = 168 } = options; // Default 7 days

  const experiments = getExperiments();
  const experiment = experiments.find((e) => e.id === experimentId);
  if (!experiment) return null;

  const data = readJSON(RESULTS_FILE);
  const results = data.results || [];
  const cutoff = Date.now() - hours * 60 * 60 * 1000;

  const filtered = results.filter((r) => r.experimentId === experimentId && r.timestamp > cutoff);

  const variantStats = experiment.variants.map((variant, index) => {
    const variantResults = filtered.filter((r) => r.variantIndex === index);
    const clicks = variantResults.filter((r) => r.clicked).length;
    const durations = variantResults.map((r) => r.duration).sort((a, b) => a - b);
    const avgDuration = durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0;
    const resultCounts = variantResults.map((r) => r.resultCount);
    const avgResults = resultCounts.length > 0 ? Math.round(resultCounts.reduce((a, b) => a + b, 0) / resultCounts.length) : 0;

    return {
      variantName: variant.name,
      config: variant.config,
      searches: variantResults.length,
      clicks,
      clickThroughRate: variantResults.length > 0 ? Math.round((clicks / variantResults.length) * 100) : 0,
      avgDuration,
      avgResults,
    };
  });

  return {
    experimentId,
    experimentName: experiment.name,
    active: experiment.active,
    totalAssignments: experiment.totalAssignments,
    timeRange: { hours, from: new Date(cutoff).toISOString(), to: new Date().toISOString() },
    variants: variantStats,
  };
}

/**
 * Toggle experiment active state.
 */
export function toggleExperiment(experimentId) {
  const experiments = getExperiments();
  const experiment = experiments.find((e) => e.id === experimentId);
  if (!experiment) return null;

  experiment.active = !experiment.active;
  writeJSON(EXPERIMENTS_FILE, { experiments });
  return experiment;
}

/**
 * Delete an experiment.
 */
export function deleteExperiment(experimentId) {
  const data = readJSON(EXPERIMENTS_FILE);
  const experiments = data.experiments || [];
  const index = experiments.findIndex((e) => e.id === experimentId);
  if (index === -1) return false;

  experiments.splice(index, 1);
  writeJSON(EXPERIMENTS_FILE, { experiments });

  // Also clean up results
  const resultData = readJSON(RESULTS_FILE);
  resultData.results = (resultData.results || []).filter((r) => r.experimentId !== experimentId);
  writeJSON(RESULTS_FILE, resultData);

  return true;
}

/**
 * Clear all experiment results (keep experiments).
 */
export function clearResults() {
  writeJSON(RESULTS_FILE, { results: [] });
}
