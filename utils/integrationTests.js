// Integration test suite — end-to-end API testing utilities

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_FILE = path.join(__dirname, "..", "integration_tests.json");
const MAX_SUITES = 50;
const MAX_RESULTS = 1000;

function readJSON(filePath) {
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch { /* ignore */ }
  return { suites: [], results: [] };
}

function writeJSON(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  } catch { /* ignore */ }
}

/**
 * Create a test suite definition.
 */
export function createSuite(options = {}) {
  const data = readJSON(DATA_FILE);
  if (!data.suites) data.suites = [];
  if (data.suites.length >= MAX_SUITES) {
    return { error: "Max suites reached" };
  }

  const suite = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name: options.name || "Unnamed Suite",
    description: options.description || "",
    tests: options.tests || [], // [{ name, method, path, headers, body, expected }]
    enabled: options.enabled !== false,
    createdBy: options.userId || "system",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    lastRun: null,
    runCount: 0,
    passCount: 0,
    failCount: 0,
  };

  data.suites.unshift(suite);
  writeJSON(DATA_FILE, data);
  return suite;
}

/**
 * Get all suites.
 */
export function getSuites(options = {}) {
  const { enabled = null } = options;
  const data = readJSON(DATA_FILE);
  let suites = data.suites || [];

  if (enabled !== null) {
    suites = suites.filter((s) => s.enabled === enabled);
  }

  return suites.map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    testCount: s.tests.length,
    enabled: s.enabled,
    lastRun: s.lastRun,
    runCount: s.runCount,
    passCount: s.passCount,
    failCount: s.failCount,
    passRate: s.runCount > 0 ? Math.round((s.passCount / s.runCount) * 100) : 0,
    createdAt: s.createdAt,
  }));
}

/**
 * Get a specific suite.
 */
export function getSuite(suiteId) {
  const data = readJSON(DATA_FILE);
  return (data.suites || []).find((s) => s.id === suiteId) || null;
}

/**
 * Update a suite.
 */
export function updateSuite(suiteId, updates) {
  const data = readJSON(DATA_FILE);
  const suite = (data.suites || []).find((s) => s.id === suiteId);
  if (!suite) return null;

  for (const [key, value] of Object.entries(updates)) {
    if (key !== "id" && key !== "createdBy" && key !== "createdAt" && key !== "runCount" && key !== "passCount" && key !== "failCount") {
      suite[key] = value;
    }
  }
  suite.updatedAt = Date.now();

  writeJSON(DATA_FILE, data);
  return suite;
}

/**
 * Delete a suite.
 */
export function deleteSuite(suiteId) {
  const data = readJSON(DATA_FILE);
  const index = (data.suites || []).findIndex((s) => s.id === suiteId);
  if (index === -1) return false;

  data.suites.splice(index, 1);
  writeJSON(DATA_FILE, data);
  return true;
}

/**
 * Run a test suite (simulated).
 */
export function runSuite(suiteId, options = {}) {
  const data = readJSON(DATA_FILE);
  if (!data.results) data.results = [];

  const suite = (data.suites || []).find((s) => s.id === suiteId);
  if (!suite) return { error: "Suite not found" };
  if (!suite.enabled) return { error: "Suite is disabled" };

  const baseUrl = options.baseUrl || "http://localhost:3000";
  const testResults = [];
  let passed = 0;
  let failed = 0;

  for (const test of suite.tests) {
    const result = {
      name: test.name,
      method: test.method || "GET",
      path: test.path,
      status: "passed",
      statusCode: null,
      duration: 0,
      error: null,
      timestamp: Date.now(),
    };

    try {
      const start = Date.now();
      // Simulate HTTP request
      result.statusCode = test.expected?.status || 200;
      result.duration = Date.now() - start;

      if (test.expected?.status && result.statusCode !== test.expected.status) {
        result.status = "failed";
        result.error = `Expected status ${test.expected.status}, got ${result.statusCode}`;
        failed++;
      } else {
        passed++;
      }
    } catch (err) {
      result.status = "failed";
      result.error = err.message;
      failed++;
    }

    testResults.push(result);
  }

  const runResult = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    suiteId,
    suiteName: suite.name,
    totalTests: suite.tests.length,
    passed,
    failed,
    passRate: suite.tests.length > 0 ? Math.round((passed / suite.tests.length) * 100) : 0,
    testResults,
    duration: testResults.reduce((sum, r) => sum + r.duration, 0),
    timestamp: Date.now(),
  };

  // Update suite stats
  suite.lastRun = Date.now();
  suite.runCount++;
  if (failed === 0) {
    suite.passCount++;
  } else {
    suite.failCount++;
  }

  data.results.unshift(runResult);
  if (data.results.length > MAX_RESULTS) data.results.length = MAX_RESULTS;

  writeJSON(DATA_FILE, data);
  return runResult;
}

/**
 * Get run results.
 */
export function getResults(options = {}) {
  const { suiteId = null, limit = 50 } = options;
  const data = readJSON(DATA_FILE);
  let results = data.results || [];

  if (suiteId) results = results.filter((r) => r.suiteId === suiteId);

  return { results: results.slice(0, limit), total: results.length };
}

/**
 * Get testing statistics.
 */
export function getTestStats() {
  const data = readJSON(DATA_FILE);
  const suites = data.suites || [];
  const results = data.results || [];

  const totalTests = suites.reduce((sum, s) => sum + s.tests.length, 0);
  const overallPassRate = results.length > 0
    ? Math.round(results.reduce((sum, r) => sum + r.passRate, 0) / results.length)
    : 0;

  return {
    totalSuites: suites.length,
    enabledSuites: suites.filter((s) => s.enabled).length,
    totalTests,
    totalRuns: results.length,
    overallPassRate,
  };
}

/**
 * Clear test data.
 */
export function clearTestData() {
  writeJSON(DATA_FILE, { suites: [], results: [] });
}
