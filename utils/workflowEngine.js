// Workflow engine — define and execute multi-step workflows with branching

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_FILE = path.join(__dirname, "..", "workflow_engine.json");
const MAX_WORKFLOWS = 100;
const MAX_EXECUTIONS = 1000;

function readJSON(filePath) {
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch { /* ignore */ }
  return { workflows: [], executions: [] };
}

function writeJSON(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  } catch { /* ignore */ }
}

/**
 * Create a workflow definition.
 */
export function createWorkflow(options = {}) {
  const data = readJSON(DATA_FILE);
  if (!data.workflows) data.workflows = [];
  if (data.workflows.length >= MAX_WORKFLOWS) {
    return { error: "Max workflows reached" };
  }

  const workflow = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name: options.name || "Unnamed Workflow",
    description: options.description || "",
    steps: options.steps || [], // [{ id, name, type, config, next }]
    enabled: options.enabled !== false,
    createdBy: options.userId || "system",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    lastRun: null,
    runCount: 0,
  };

  data.workflows.unshift(workflow);
  writeJSON(DATA_FILE, data);
  return workflow;
}

/**
 * Get all workflows.
 */
export function getWorkflows(options = {}) {
  const { enabled = null } = options;
  const data = readJSON(DATA_FILE);
  let workflows = data.workflows || [];

  if (enabled !== null) {
    workflows = workflows.filter((w) => w.enabled === enabled);
  }

  return workflows.map((w) => ({
    id: w.id,
    name: w.name,
    description: w.description,
    steps: w.steps.length,
    enabled: w.enabled,
    lastRun: w.lastRun,
    runCount: w.runCount,
    createdAt: w.createdAt,
  }));
}

/**
 * Get a specific workflow.
 */
export function getWorkflow(workflowId) {
  const data = readJSON(DATA_FILE);
  return (data.workflows || []).find((w) => w.id === workflowId) || null;
}

/**
 * Update a workflow.
 */
export function updateWorkflow(workflowId, updates) {
  const data = readJSON(DATA_FILE);
  const workflow = (data.workflows || []).find((w) => w.id === workflowId);
  if (!workflow) return null;

  for (const [key, value] of Object.entries(updates)) {
    if (key !== "id" && key !== "createdBy" && key !== "createdAt" && key !== "runCount") {
      workflow[key] = value;
    }
  }
  workflow.updatedAt = Date.now();

  writeJSON(DATA_FILE, data);
  return workflow;
}

/**
 * Delete a workflow.
 */
export function deleteWorkflow(workflowId) {
  const data = readJSON(DATA_FILE);
  const index = (data.workflows || []).findIndex((w) => w.id === workflowId);
  if (index === -1) return false;

  data.workflows.splice(index, 1);
  writeJSON(DATA_FILE, data);
  return true;
}

/**
 * Execute a workflow.
 */
export function executeWorkflow(workflowId, options = {}) {
  const data = readJSON(DATA_FILE);
  if (!data.executions) data.executions = [];

  const workflow = (data.workflows || []).find((w) => w.id === workflowId);
  if (!workflow) return { error: "Workflow not found" };
  if (!workflow.enabled) return { error: "Workflow is disabled" };

  const execution = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    workflowId,
    workflowName: workflow.name,
    status: "running",
    steps: [],
    context: options.context || {},
    startedAt: Date.now(),
    completedAt: null,
    error: null,
    triggeredBy: options.userId || "system",
  };

  // Execute steps sequentially
  let currentStepId = workflow.steps.length > 0 ? workflow.steps[0].id : null;
  const visitedSteps = new Set();

  while (currentStepId && !visitedSteps.has(currentStepId)) {
    visitedSteps.add(currentStepId);
    const stepIndex = workflow.steps.findIndex((s) => s.id === currentStepId);
    const step = workflow.steps[stepIndex];
    if (!step) break;

    const stepResult = {
      id: step.id,
      name: step.name,
      type: step.type,
      status: "completed",
      startedAt: Date.now(),
      completedAt: Date.now(),
      output: `Step "${step.name}" executed`,
      input: execution.context,
    };

    // Simulate step execution based on type
    switch (step.type) {
      case "condition":
        stepResult.output = step.config?.condition === "true" ? "condition_met" : "condition_not_met";
        break;
      case "transform":
        stepResult.output = `Transformed with ${step.config?.operation || "default"}`;
        break;
      case "action":
        stepResult.output = `Action "${step.config?.action || "default"}" performed`;
        break;
      default:
        stepResult.output = `Step "${step.name}" completed`;
    }

    execution.steps.push(stepResult);

    // Determine next step
    if (step.type === "condition" && step.next) {
      currentStepId = stepResult.output === "condition_met" ? step.next.true : step.next.false;
    } else if (step.next) {
      currentStepId = step.next;
    } else {
      // Fall back to next step in array
      const nextIndex = stepIndex + 1;
      currentStepId = nextIndex < workflow.steps.length ? workflow.steps[nextIndex].id : null;
    }
  }

  execution.status = "completed";
  execution.completedAt = Date.now();

  // Update workflow stats
  workflow.lastRun = Date.now();
  workflow.runCount++;

  data.executions.unshift(execution);
  if (data.executions.length > MAX_EXECUTIONS) data.executions.length = MAX_EXECUTIONS;

  writeJSON(DATA_FILE, data);
  return execution;
}

/**
 * Get execution history.
 */
export function getExecutions(options = {}) {
  const { workflowId = null, status = null, limit = 50 } = options;
  const data = readJSON(DATA_FILE);
  let executions = data.executions || [];

  if (workflowId) executions = executions.filter((e) => e.workflowId === workflowId);
  if (status) executions = executions.filter((e) => e.status === status);

  return { executions: executions.slice(0, limit), total: executions.length };
}

/**
 * Get a specific execution.
 */
export function getExecution(executionId) {
  const data = readJSON(DATA_FILE);
  return (data.executions || []).find((e) => e.id === executionId) || null;
}

/**
 * Get workflow statistics.
 */
export function getWorkflowStats() {
  const data = readJSON(DATA_FILE);
  const workflows = data.workflows || [];
  const executions = data.executions || [];

  const statusCounts = {};
  for (const exec of executions) {
    statusCounts[exec.status] = (statusCounts[exec.status] || 0) + 1;
  }

  return {
    totalWorkflows: workflows.length,
    enabledWorkflows: workflows.filter((w) => w.enabled).length,
    totalExecutions: executions.length,
    statusCounts,
  };
}

/**
 * Clear workflow data.
 */
export function clearWorkflowData() {
  writeJSON(DATA_FILE, { workflows: [], executions: [] });
}
