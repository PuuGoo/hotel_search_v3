// Compliance checker — verify system compliance with security policies

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_FILE = path.join(__dirname, "..", "compliance_checker.json");
const MAX_POLICIES = 100;
const MAX_CHECKS = 1000;

function readJSON(filePath) {
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch { /* ignore */ }
  return { policies: [], checks: [] };
}

function writeJSON(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  } catch { /* ignore */ }
}

/**
 * Define a compliance policy.
 */
export function definePolicy(options = {}) {
  const data = readJSON(DATA_FILE);
  if (!data.policies) data.policies = [];

  const policy = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name: options.name,
    category: options.category || "general", // "general", "security", "data", "access", "network"
    description: options.description || "",
    rules: options.rules || [], // array of { name, check, expected, severity }
    enabled: options.enabled !== false,
    author: options.userId || "system",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  data.policies.unshift(policy);
  if (data.policies.length > MAX_POLICIES) data.policies.length = MAX_POLICIES;

  writeJSON(DATA_FILE, data);
  return policy;
}

/**
 * Get all policies.
 */
export function getPolicies(options = {}) {
  const { category = null, enabled = null } = options;
  const data = readJSON(DATA_FILE);
  let policies = data.policies || [];

  if (category) policies = policies.filter((p) => p.category === category);
  if (enabled !== null) policies = policies.filter((p) => p.enabled === enabled);

  return { policies, count: policies.length };
}

/**
 * Get a specific policy.
 */
export function getPolicy(policyId) {
  const data = readJSON(DATA_FILE);
  return (data.policies || []).find((p) => p.id === policyId) || null;
}

/**
 * Update a policy.
 */
export function updatePolicy(policyId, updates) {
  const data = readJSON(DATA_FILE);
  const index = (data.policies || []).findIndex((p) => p.id === policyId);
  if (index === -1) return null;

  data.policies[index] = {
    ...data.policies[index],
    ...updates,
    id: policyId,
    updatedAt: Date.now(),
  };
  writeJSON(DATA_FILE, data);
  return data.policies[index];
}

/**
 * Delete a policy.
 */
export function deletePolicy(policyId) {
  const data = readJSON(DATA_FILE);
  const index = (data.policies || []).findIndex((p) => p.id === policyId);
  if (index === -1) return false;

  data.policies.splice(index, 1);
  writeJSON(DATA_FILE, data);
  return true;
}

/**
 * Run compliance check against system state.
 */
export function runComplianceCheck(options = {}) {
  const data = readJSON(DATA_FILE);
  const policies = (data.policies || []).filter((p) => p.enabled);

  const results = [];
  let passed = 0;
  let failed = 0;
  let warnings = 0;

  for (const policy of policies) {
    const policyResults = [];
    for (const rule of policy.rules || []) {
      const systemValue = options.systemState?.[rule.check];
      let compliant = false;

      if (rule.check === "https_enabled") compliant = systemValue === true;
      else if (rule.check === "csp_configured") compliant = systemValue === true;
      else if (rule.check === "auth_required") compliant = systemValue === true;
      else if (rule.check === "rate_limiting") compliant = systemValue === true;
      else if (rule.check === "logging_enabled") compliant = systemValue === true;
      else if (rule.check === "backup_configured") compliant = systemValue === true;
      else if (rule.check === "encryption_at_rest") compliant = systemValue === true;
      else if (rule.check === "session_timeout") compliant = systemValue > 0;
      else if (rule.check === "password_min_length") compliant = systemValue >= (rule.expected || 8);
      else compliant = systemValue === rule.expected;

      if (compliant) passed++;
      else if (rule.severity === "warning") warnings++;
      else failed++;

      policyResults.push({
        rule: rule.name,
        check: rule.check,
        expected: rule.expected,
        actual: systemValue,
        compliant,
        severity: rule.severity || "error",
      });
    }
    results.push({
      policyId: policy.id,
      policyName: policy.name,
      category: policy.category,
      results: policyResults,
      passed: policyResults.filter((r) => r.compliant).length,
      failed: policyResults.filter((r) => !r.compliant && r.severity === "error").length,
      warnings: policyResults.filter((r) => !r.compliant && r.severity === "warning").length,
    });
  }

  const check = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    timestamp: Date.now(),
    totalPolicies: policies.length,
    passed,
    failed,
    warnings,
    compliant: failed === 0,
    results,
    systemState: options.systemState || {},
  };

  // Store check result
  if (!data.checks) data.checks = [];
  data.checks.unshift(check);
  if (data.checks.length > MAX_CHECKS) data.checks.length = MAX_CHECKS;

  writeJSON(DATA_FILE, data);
  return check;
}

/**
 * Get compliance check history.
 */
export function getCheckHistory(limit = 50) {
  const data = readJSON(DATA_FILE);
  return { checks: (data.checks || []).slice(0, limit), total: (data.checks || []).length };
}

/**
 * Get compliance statistics.
 */
export function getComplianceStats() {
  const data = readJSON(DATA_FILE);
  const policies = data.policies || [];
  const checks = data.checks || [];

  const latestCheck = checks[0] || null;
  const categoryCounts = {};
  for (const p of policies) {
    categoryCounts[p.category] = (categoryCounts[p.category] || 0) + 1;
  }

  return {
    totalPolicies: policies.length,
    enabledPolicies: policies.filter((p) => p.enabled).length,
    totalChecks: checks.length,
    lastCheckCompliant: latestCheck?.compliant ?? null,
    lastCheckTime: latestCheck?.timestamp ?? null,
    categoryCounts,
  };
}

/**
 * Clear compliance data.
 */
export function clearComplianceData() {
  writeJSON(DATA_FILE, { policies: [], checks: [] });
}
