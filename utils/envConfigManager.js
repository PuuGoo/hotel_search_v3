// Environment config manager — manage and validate environment variables

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_FILE = path.join(__dirname, "..", "env_configs.json");
const MAX_ENVS = 20;
const MAX_HISTORY = 200;

function readJSON(filePath) {
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch { /* ignore */ }
  return { environments: {}, history: [] };
}

function writeJSON(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  } catch { /* ignore */ }
}

/**
 * Define an environment configuration.
 */
export function defineEnvironment(options = {}) {
  const data = readJSON(DATA_FILE);
  if (!data.environments) data.environments = {};

  const env = {
    name: options.name,
    description: options.description || "",
    variables: options.variables || {},
    requiredVars: options.requiredVars || [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  data.environments[options.name] = env;

  // Track history
  if (!data.history) data.history = [];
  data.history.unshift({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    action: "define",
    environment: options.name,
    userId: options.userId || "system",
    timestamp: Date.now(),
  });
  if (data.history.length > MAX_HISTORY) data.history.length = MAX_HISTORY;

  // Cap environments
  const envKeys = Object.keys(data.environments);
  if (envKeys.length > MAX_ENVS) {
    const oldest = envKeys.sort((a, b) => data.environments[a].createdAt - data.environments[b].createdAt)[0];
    delete data.environments[oldest];
  }

  writeJSON(DATA_FILE, data);
  return env;
}

/**
 * Get all environments.
 */
export function getEnvironments() {
  const data = readJSON(DATA_FILE);
  return Object.values(data.environments || {});
}

/**
 * Get a specific environment.
 */
export function getEnvironment(name) {
  const data = readJSON(DATA_FILE);
  return (data.environments || {})[name] || null;
}

/**
 * Update an environment.
 */
export function updateEnvironment(name, updates) {
  const data = readJSON(DATA_FILE);
  if (!data.environments || !data.environments[name]) return null;

  data.environments[name] = {
    ...data.environments[name],
    ...updates,
    name,
    updatedAt: Date.now(),
  };

  // Track history
  if (!data.history) data.history = [];
  data.history.unshift({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    action: "update",
    environment: name,
    userId: updates.userId || "system",
    timestamp: Date.now(),
  });
  if (data.history.length > MAX_HISTORY) data.history.length = MAX_HISTORY;

  writeJSON(DATA_FILE, data);
  return data.environments[name];
}

/**
 * Delete an environment.
 */
export function deleteEnvironment(name) {
  const data = readJSON(DATA_FILE);
  if (!data.environments || !data.environments[name]) return false;

  delete data.environments[name];

  // Track history
  if (!data.history) data.history = [];
  data.history.unshift({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    action: "delete",
    environment: name,
    timestamp: Date.now(),
  });
  if (data.history.length > MAX_HISTORY) data.history.length = MAX_HISTORY;

  writeJSON(DATA_FILE, data);
  return true;
}

/**
 * Validate environment variables against requirements.
 */
export function validateEnvironment(name) {
  const data = readJSON(DATA_FILE);
  const env = (data.environments || {})[name];
  if (!env) return { valid: false, error: "Environment not found" };

  const violations = [];
  const variables = env.variables || {};

  for (const requiredVar of env.requiredVars || []) {
    if (variables[requiredVar] === undefined || variables[requiredVar] === null || variables[requiredVar] === "") {
      violations.push({ variable: requiredVar, issue: "missing required variable" });
    }
  }

  return {
    valid: violations.length === 0,
    environment: name,
    violations,
    totalVars: Object.keys(variables).length,
    requiredVars: (env.requiredVars || []).length,
  };
}

/**
 * Compare two environments.
 */
export function compareEnvironments(env1Name, env2Name) {
  const data = readJSON(DATA_FILE);
  const env1 = (data.environments || {})[env1Name];
  const env2 = (data.environments || {})[env2Name];

  if (!env1 || !env2) return { error: "One or both environments not found" };

  const vars1 = env1.variables || {};
  const vars2 = env2.variables || {};
  const allKeys = new Set([...Object.keys(vars1), ...Object.keys(vars2)]);

  const onlyIn1 = [];
  const onlyIn2 = [];
  const different = [];
  const same = [];

  for (const key of allKeys) {
    const in1 = vars1[key] !== undefined;
    const in2 = vars2[key] !== undefined;

    if (in1 && !in2) onlyIn1.push(key);
    else if (!in1 && in2) onlyIn2.push(key);
    else if (vars1[key] !== vars2[key]) different.push(key);
    else same.push(key);
  }

  return {
    environment1: env1Name,
    environment2: env2Name,
    onlyIn1,
    onlyIn2,
    different,
    same,
  };
}

/**
 * Get config history.
 */
export function getConfigHistory(limit = 50) {
  const data = readJSON(DATA_FILE);
  return (data.history || []).slice(0, limit);
}

/**
 * Get config statistics.
 */
export function getConfigStats() {
  const data = readJSON(DATA_FILE);
  const environments = Object.values(data.environments || {});

  return {
    totalEnvironments: environments.length,
    totalVariables: environments.reduce((sum, e) => sum + Object.keys(e.variables || {}).length, 0),
    totalHistory: (data.history || []).length,
  };
}

/**
 * Clear config data.
 */
export function clearConfigData() {
  writeJSON(DATA_FILE, { environments: {}, history: [] });
}
