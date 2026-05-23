// Automation rules — trigger actions based on conditions (if-this-then-that)

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_FILE = path.join(__dirname, "..", "automation_rules.json");
const MAX_RULES = 100;
const MAX_EXECUTIONS = 2000;

function readJSON(filePath) {
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch { /* ignore */ }
  return { rules: [], executions: [] };
}

function writeJSON(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  } catch { /* ignore */ }
}

/**
 * Create an automation rule.
 */
export function createRule(options = {}) {
  const data = readJSON(DATA_FILE);
  if (!data.rules) data.rules = [];
  if (data.rules.length >= MAX_RULES) {
    return { error: "Max rules reached" };
  }

  const rule = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name: options.name || "Unnamed Rule",
    description: options.description || "",
    trigger: options.trigger || {}, // { event, conditions }
    actions: options.actions || [], // [{ type, config }]
    enabled: options.enabled !== false,
    createdBy: options.userId || "system",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    lastTriggered: null,
    triggerCount: 0,
  };

  data.rules.unshift(rule);
  writeJSON(DATA_FILE, data);
  return rule;
}

/**
 * Get all rules.
 */
export function getRules(options = {}) {
  const { enabled = null } = options;
  const data = readJSON(DATA_FILE);
  let rules = data.rules || [];

  if (enabled !== null) {
    rules = rules.filter((r) => r.enabled === enabled);
  }

  return rules.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    trigger: r.trigger,
    actions: r.actions,
    enabled: r.enabled,
    lastTriggered: r.lastTriggered,
    triggerCount: r.triggerCount,
    createdAt: r.createdAt,
  }));
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
  const rule = (data.rules || []).find((r) => r.id === ruleId);
  if (!rule) return null;

  for (const [key, value] of Object.entries(updates)) {
    if (key !== "id" && key !== "createdBy" && key !== "createdAt" && key !== "triggerCount") {
      rule[key] = value;
    }
  }
  rule.updatedAt = Date.now();

  writeJSON(DATA_FILE, data);
  return rule;
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
 * Evaluate a rule against an event context.
 */
function evaluateConditions(conditions, context) {
  if (!conditions || Object.keys(conditions).length === 0) return true;

  for (const [field, condition] of Object.entries(conditions)) {
    const value = context[field];

    if (typeof condition === "object") {
      if (condition.eq !== undefined && value !== condition.eq) return false;
      if (condition.ne !== undefined && value === condition.ne) return false;
      if (condition.gt !== undefined && !(value > condition.gt)) return false;
      if (condition.gte !== undefined && !(value >= condition.gte)) return false;
      if (condition.lt !== undefined && !(value < condition.lt)) return false;
      if (condition.lte !== undefined && !(value <= condition.lte)) return false;
      if (condition.contains !== undefined && !String(value).includes(condition.contains)) return false;
      if (condition.in !== undefined && !condition.in.includes(value)) return false;
      if (condition.regex !== undefined && !new RegExp(condition.regex).test(String(value))) return false;
    } else {
      if (value !== condition) return false;
    }
  }

  return true;
}

/**
 * Execute an action (simulated).
 */
function executeAction(action, context) {
  const result = {
    type: action.type,
    config: action.config,
    status: "executed",
    timestamp: Date.now(),
  };

  switch (action.type) {
    case "notify":
      result.output = `Notification sent: ${action.config?.message || "Rule triggered"}`;
      break;
    case "webhook":
      result.output = `Webhook called: ${action.config?.url || "unknown"}`;
      break;
    case "log":
      result.output = `Logged: ${action.config?.message || "Rule triggered"}`;
      break;
    case "transform":
      result.output = `Transform applied: ${action.config?.operation || "default"}`;
      break;
    default:
      result.output = `Action "${action.type}" executed`;
  }

  return result;
}

/**
 * Process an event through all enabled rules.
 */
export function processEvent(eventType, context = {}) {
  const data = readJSON(DATA_FILE);
  if (!data.executions) data.executions = [];

  const matchingRules = (data.rules || []).filter((r) =>
    r.enabled && r.trigger?.event === eventType
  );

  const results = [];

  for (const rule of matchingRules) {
    const conditionsMet = evaluateConditions(rule.trigger?.conditions, context);

    if (conditionsMet) {
      const actionResults = rule.actions.map((action) => executeAction(action, context));

      const execution = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        ruleId: rule.id,
        ruleName: rule.name,
        eventType,
        context,
        actionResults,
        timestamp: Date.now(),
      };

      data.executions.unshift(execution);
      if (data.executions.length > MAX_EXECUTIONS) data.executions.length = MAX_EXECUTIONS;

      rule.lastTriggered = Date.now();
      rule.triggerCount++;

      results.push(execution);
    }
  }

  writeJSON(DATA_FILE, data);
  return { triggered: results.length, executions: results };
}

/**
 * Get rule executions.
 */
export function getExecutions(options = {}) {
  const { ruleId = null, limit = 50 } = options;
  const data = readJSON(DATA_FILE);
  let executions = data.executions || [];

  if (ruleId) executions = executions.filter((e) => e.ruleId === ruleId);

  return { executions: executions.slice(0, limit), total: executions.length };
}

/**
 * Get automation statistics.
 */
export function getAutomationStats() {
  const data = readJSON(DATA_FILE);
  const rules = data.rules || [];
  const executions = data.executions || [];

  return {
    totalRules: rules.length,
    enabledRules: rules.filter((r) => r.enabled).length,
    totalExecutions: executions.length,
    rulesTriggered: rules.filter((r) => r.triggerCount > 0).length,
  };
}

/**
 * Clear automation data.
 */
export function clearAutomationData() {
  writeJSON(DATA_FILE, { rules: [], executions: [] });
}
