// Load testing utilities — simulate concurrent users and measure throughput

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_FILE = path.join(__dirname, "..", "load_tests.json");
const MAX_CONFIGS = 50;
const MAX_RESULTS = 500;

function readJSON(filePath) {
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch { /* ignore */ }
  return { configs: [], results: [] };
}

function writeJSON(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  } catch { /* ignore */ }
}

/**
 * Create a load test configuration.
 */
export function createConfig(options = {}) {
  const data = readJSON(DATA_FILE);
  if (!data.configs) data.configs = [];
  if (data.configs.length >= MAX_CONFIGS) {
    return { error: "Max configs reached" };
  }

  const config = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name: options.name || "Unnamed Config",
    description: options.description || "",
    target: options.target || {}, // { url, method, headers, body }
    scenario: options.scenario || {}, // { duration, concurrency, rampUp }
    enabled: options.enabled !== false,
    createdBy: options.userId || "system",
    createdAt: Date.now(),
  };

  data.configs.unshift(config);
  writeJSON(DATA_FILE, data);
  return config;
}

/**
 * Get all configs.
 */
export function getConfigs() {
  const data = readJSON(DATA_FILE);
  return data.configs || [];
}

/**
 * Get a specific config.
 */
export function getConfig(configId) {
  const data = readJSON(DATA_FILE);
  return (data.configs || []).find((c) => c.id === configId) || null;
}

/**
 * Delete a config.
 */
export function deleteConfig(configId) {
  const data = readJSON(DATA_FILE);
  const index = (data.configs || []).findIndex((c) => c.id === configId);
  if (index === -1) return false;

  data.configs.splice(index, 1);
  writeJSON(DATA_FILE, data);
  return true;
}

/**
 * Simulate a load test run.
 */
export function runLoadTest(configId, options = {}) {
  const data = readJSON(DATA_FILE);
  if (!data.results) data.results = [];

  const config = (data.configs || []).find((c) => c.id === configId);
  if (!config) return { error: "Config not found" };

  const concurrency = config.scenario?.concurrency || 10;
  const duration = config.scenario?.duration || 10; // seconds
  const totalRequests = concurrency * duration;

  // Simulate load test results
  const latencies = [];
  const statusCodes = {};
  let errors = 0;

  for (let i = 0; i < totalRequests; i++) {
    // Simulate latency (normal distribution around 50ms)
    const latency = Math.max(1, Math.round(50 + (Math.random() - 0.5) * 40));
    latencies.push(latency);

    // Simulate status codes (95% success)
    const statusCode = Math.random() < 0.95 ? 200 : (Math.random() < 0.5 ? 500 : 429);
    statusCodes[statusCode] = (statusCodes[statusCode] || 0) + 1;
    if (statusCode >= 400) errors++;
  }

  latencies.sort((a, b) => a - b);

  const result = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    configId,
    configName: config.name,
    totalRequests,
    successfulRequests: totalRequests - errors,
    failedRequests: errors,
    errorRate: Math.round((errors / totalRequests) * 100),
    throughput: Math.round(totalRequests / duration),
    duration,
    concurrency,
    latency: {
      min: latencies[0],
      max: latencies[latencies.length - 1],
      avg: Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length),
      p50: latencies[Math.floor(latencies.length * 0.5)],
      p90: latencies[Math.floor(latencies.length * 0.9)],
      p95: latencies[Math.floor(latencies.length * 0.95)],
      p99: latencies[Math.floor(latencies.length * 0.99)],
    },
    statusCodes,
    timestamp: Date.now(),
  };

  data.results.unshift(result);
  if (data.results.length > MAX_RESULTS) data.results.length = MAX_RESULTS;

  writeJSON(DATA_FILE, data);
  return result;
}

/**
 * Get load test results.
 */
export function getResults(options = {}) {
  const { configId = null, limit = 50 } = options;
  const data = readJSON(DATA_FILE);
  let results = data.results || [];

  if (configId) results = results.filter((r) => r.configId === configId);

  return { results: results.slice(0, limit), total: results.length };
}

/**
 * Get load testing statistics.
 */
export function getLoadTestStats() {
  const data = readJSON(DATA_FILE);
  const configs = data.configs || [];
  const results = data.results || [];

  const avgThroughput = results.length > 0
    ? Math.round(results.reduce((sum, r) => sum + r.throughput, 0) / results.length)
    : 0;

  const avgLatency = results.length > 0
    ? Math.round(results.reduce((sum, r) => sum + r.latency.avg, 0) / results.length)
    : 0;

  return {
    totalConfigs: configs.length,
    totalRuns: results.length,
    avgThroughput,
    avgLatency,
  };
}

/**
 * Clear load test data.
 */
export function clearLoadTestData() {
  writeJSON(DATA_FILE, { configs: [], results: [] });
}
