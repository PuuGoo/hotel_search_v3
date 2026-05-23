// A/B testing framework — manage experiments and assign users to variants
// Uses deterministic hashing so users always get the same variant

import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, "..", "ab_experiments.json");

function readData() {
  try {
    if (fs.existsSync(DATA_FILE)) return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch { /* ignore */ }
  return { experiments: [] };
}

function writeData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

/**
 * Create a new experiment.
 * @param {Object} experiment - { name, description, variants, trafficSplit }
 * variants: [{ name, weight }] (weight = percentage, must sum to 100)
 */
export function createExperiment(experiment) {
  const { name, description, variants, trafficSplit } = experiment;

  if (!name || !variants || variants.length < 2) {
    throw new Error("Experiment needs a name and at least 2 variants");
  }

  const totalWeight = variants.reduce((sum, v) => sum + (v.weight || 0), 0);
  if (Math.abs(totalWeight - 100) > 0.01) {
    throw new Error(`Variant weights must sum to 100, got ${totalWeight}`);
  }

  const data = readData();
  const existing = data.experiments.find((e) => e.name === name);
  if (existing) {
    throw new Error(`Experiment "${name}" already exists`);
  }

  const exp = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name,
    description: description || "",
    variants,
    trafficSplit: trafficSplit ?? 100, // % of users to include
    status: "active", // active, paused, completed
    createdAt: new Date().toISOString(),
    assignments: {}, // userId -> variantName
  };

  data.experiments.push(exp);
  writeData(data);
  return exp;
}

/**
 * Get all experiments.
 */
export function getExperiments() {
  return readData().experiments;
}

/**
 * Get a specific experiment by name or ID.
 */
export function getExperiment(nameOrId) {
  const data = readData();
  return data.experiments.find((e) => e.name === nameOrId || e.id === nameOrId);
}

/**
 * Assign a user to a variant (deterministic based on userId + experiment).
 * @param {string} experimentName
 * @param {string} userId
 * @returns {string} variant name
 */
export function assignVariant(experimentName, userId) {
  const data = readData();
  const experiment = data.experiments.find((e) => e.name === experimentName);

  if (!experiment) throw new Error(`Experiment "${experimentName}" not found`);
  if (experiment.status !== "active") return experiment.variants[0].name;

  // Check if already assigned
  if (experiment.assignments[userId]) {
    return experiment.assignments[userId];
  }

  // Check traffic split
  const trafficHash = hashValue(`${userId}:traffic:${experimentName}`);
  if (trafficHash > experiment.trafficSplit) {
    return experiment.variants[0].name; // Default to first variant
  }

  // Deterministic variant assignment
  const variantHash = hashValue(`${userId}:${experimentName}`);
  let cumulative = 0;
  for (const variant of experiment.variants) {
    cumulative += variant.weight;
    if (variantHash <= cumulative) {
      experiment.assignments[userId] = variant.name;
      writeData(data);
      return variant.name;
    }
  }

  // Fallback
  const fallback = experiment.variants[0].name;
  experiment.assignments[userId] = fallback;
  writeData(data);
  return fallback;
}

/**
 * Record an experiment event (conversion, click, etc.).
 */
export function recordEvent(experimentName, userId, eventName, value = 1) {
  const data = readData();
  const experiment = data.experiments.find((e) => e.name === experimentName);
  if (!experiment) return;

  if (!experiment.events) experiment.events = [];
  experiment.events.push({
    userId,
    eventName,
    value,
    variant: experiment.assignments[userId] || "unknown",
    timestamp: new Date().toISOString(),
  });

  // Keep last 5000 events per experiment
  if (experiment.events.length > 5000) {
    experiment.events = experiment.events.slice(-5000);
  }

  writeData(data);
}

/**
 * Get experiment results (conversion rates by variant).
 */
export function getExperimentResults(experimentName) {
  const experiment = getExperiment(experimentName);
  if (!experiment) throw new Error(`Experiment "${experimentName}" not found`);

  const results = {};
  for (const variant of experiment.variants) {
    results[variant.name] = {
      assigned: Object.values(experiment.assignments).filter((v) => v === variant.name).length,
      events: {},
    };
  }

  if (experiment.events) {
    for (const event of experiment.events) {
      const variant = event.variant;
      if (!results[variant]) continue;
      if (!results[variant].events[event.eventName]) {
        results[variant].events[event.eventName] = { count: 0, totalValue: 0 };
      }
      results[variant].events[event.eventName].count++;
      results[variant].events[event.eventName].totalValue += event.value;
    }
  }

  return {
    experiment: experiment.name,
    status: experiment.status,
    totalAssignments: Object.keys(experiment.assignments).length,
    variants: results,
  };
}

/**
 * Update experiment status.
 */
export function updateExperimentStatus(experimentName, status) {
  const data = readData();
  const experiment = data.experiments.find((e) => e.name === experimentName);
  if (!experiment) throw new Error(`Experiment "${experimentName}" not found`);

  experiment.status = status;
  writeData(data);
  return experiment;
}

/**
 * Delete an experiment.
 */
export function deleteExperiment(experimentName) {
  const data = readData();
  const idx = data.experiments.findIndex((e) => e.name === experimentName);
  if (idx === -1) throw new Error(`Experiment "${experimentName}" not found`);

  data.experiments.splice(idx, 1);
  writeData(data);
}

/**
 * Hash a string to a 0-100 value (deterministic).
 */
function hashValue(input) {
  const hash = crypto.createHash("md5").update(input).digest("hex");
  return parseInt(hash.substring(0, 8), 16) % 101;
}
