// Access control audit — audit and report on access control configurations

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_FILE = path.join(__dirname, "..", "access_control_audit.json");
const MAX_AUDITS = 500;
const MAX_RULES = 200;

function readJSON(filePath) {
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch { /* ignore */ }
  return { rules: [], audits: [] };
}

function writeJSON(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  } catch { /* ignore */ }
}

/**
 * Define an access control rule.
 */
export function defineRule(options = {}) {
  const data = readJSON(DATA_FILE);
  if (!data.rules) data.rules = [];

  const rule = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name: options.name,
    resource: options.resource,
    action: options.action || "read", // "read", "write", "delete", "admin", "*"
    roles: options.roles || [], // allowed roles
    description: options.description || "",
    enabled: options.enabled !== false,
    author: options.userId || "system",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  data.rules.unshift(rule);
  if (data.rules.length > MAX_RULES) data.rules.length = MAX_RULES;

  writeJSON(DATA_FILE, data);
  return rule;
}

/**
 * Get all rules.
 */
export function getRules(options = {}) {
  const { resource = null, enabled = null } = options;
  const data = readJSON(DATA_FILE);
  let rules = data.rules || [];

  if (resource) rules = rules.filter((r) => r.resource === resource);
  if (enabled !== null) rules = rules.filter((r) => r.enabled === enabled);

  return { rules, count: rules.length };
}

/**
 * Get a specific rule.
 */
export function getRule(ruleId) {
  const data = readJSON(DATA_FILE);
  return (data.rules || []).find((r) => r.id === ruleId) || null;
}

/**
 * Update a rule.
 */
export function updateRule(ruleId, updates) {
  const data = readJSON(DATA_FILE);
  const index = (data.rules || []).findIndex((r) => r.id === ruleId);
  if (index === -1) return null;

  data.rules[index] = {
    ...data.rules[index],
    ...updates,
    id: ruleId,
    updatedAt: Date.now(),
  };
  writeJSON(DATA_FILE, data);
  return data.rules[index];
}

/**
 * Delete a rule.
 */
export function deleteRule(ruleId) {
  const data = readJSON(DATA_FILE);
  const index = (data.rules || []).findIndex((r) => r.id === ruleId);
  if (index === -1) return false;

  data.rules.splice(index, 1);
  writeJSON(DATA_FILE, data);
  return true;
}

/**
 * Run access control audit.
 */
export function runAudit(options = {}) {
  const data = readJSON(DATA_FILE);
  const rules = (data.rules || []).filter((r) => r.enabled);
  const currentAccess = options.currentAccess || {};

  const findings = [];

  for (const rule of rules) {
    const actualRoles = currentAccess[rule.resource]?.[rule.action] || [];
    const missingRoles = rule.roles.filter((r) => !actualRoles.includes(r));
    const extraRoles = actualRoles.filter((r) => !rule.roles.includes(r));

    if (missingRoles.length > 0 || extraRoles.length > 0) {
      findings.push({
        ruleId: rule.id,
        ruleName: rule.name,
        resource: rule.resource,
        action: rule.action,
        expected: rule.roles,
        actual: actualRoles,
        missingRoles,
        extraRoles,
        compliant: false,
      });
    }
  }

  const audit = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    timestamp: Date.now(),
    totalRules: rules.length,
    compliant: findings.length === 0,
    findings,
    findingsCount: findings.length,
    auditedBy: options.userId || "system",
  };

  if (!data.audits) data.audits = [];
  data.audits.unshift(audit);
  if (data.audits.length > MAX_AUDITS) data.audits.length = MAX_AUDITS;

  writeJSON(DATA_FILE, data);
  return audit;
}

/**
 * Get audit history.
 */
export function getAuditHistory(limit = 50) {
  const data = readJSON(DATA_FILE);
  return { audits: (data.audits || []).slice(0, limit), total: (data.audits || []).length };
}

/**
 * Get access control statistics.
 */
export function getAccessControlStats() {
  const data = readJSON(DATA_FILE);
  const rules = data.rules || [];
  const audits = data.audits || [];

  const resourceCounts = {};
  const actionCounts = {};
  for (const r of rules) {
    resourceCounts[r.resource] = (resourceCounts[r.resource] || 0) + 1;
    actionCounts[r.action] = (actionCounts[r.action] || 0) + 1;
  }

  return {
    totalRules: rules.length,
    enabledRules: rules.filter((r) => r.enabled).length,
    totalAudits: audits.length,
    lastAuditCompliant: audits[0]?.compliant ?? null,
    lastAuditTime: audits[0]?.timestamp ?? null,
    resourceCounts,
    actionCounts,
  };
}

/**
 * Clear access control data.
 */
export function clearAccessControlData() {
  writeJSON(DATA_FILE, { rules: [], audits: [] });
}
