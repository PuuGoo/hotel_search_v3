// Data pipeline orchestration — define and run data processing pipelines
// Manages pipeline definitions, execution, and state tracking

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_FILE = path.join(__dirname, "..", "data_pipeline.json");
const MAX_PIPELINES = 100;
const MAX_EXECUTIONS = 1000;

function readJSON(filePath) {
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch { /* ignore */ }
  return { pipelines: [], executions: [] };
}

function writeJSON(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  } catch { /* ignore */ }
}

/**
 * Create a pipeline definition.
 */
export function createPipeline(options = {}) {
  const data = readJSON(DATA_FILE);
  if (!data.pipelines) data.pipelines = [];
  if (data.pipelines.length >= MAX_PIPELINES) {
    return { error: "Max pipelines reached" };
  }

  const pipeline = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name: options.name || "Unnamed Pipeline",
    description: options.description || "",
    steps: options.steps || [], // [{ name, type, config }]
    schedule: options.schedule || null, // cron expression
    enabled: options.enabled !== false,
    createdBy: options.userId || "system",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    lastRun: null,
    runCount: 0,
  };

  data.pipelines.unshift(pipeline);
  writeJSON(DATA_FILE, data);
  return pipeline;
}

/**
 * Get all pipelines.
 */
export function getPipelines(options = {}) {
  const { enabled = null } = options;
  const data = readJSON(DATA_FILE);
  let pipelines = data.pipelines || [];

  if (enabled !== null) {
    pipelines = pipelines.filter((p) => p.enabled === enabled);
  }

  return pipelines.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    steps: p.steps.length,
    schedule: p.schedule,
    enabled: p.enabled,
    lastRun: p.lastRun,
    runCount: p.runCount,
    createdAt: p.createdAt,
  }));
}

/**
 * Get a specific pipeline.
 */
export function getPipeline(pipelineId) {
  const data = readJSON(DATA_FILE);
  return (data.pipelines || []).find((p) => p.id === pipelineId) || null;
}

/**
 * Update a pipeline.
 */
export function updatePipeline(pipelineId, updates) {
  const data = readJSON(DATA_FILE);
  const pipeline = (data.pipelines || []).find((p) => p.id === pipelineId);
  if (!pipeline) return null;

  for (const [key, value] of Object.entries(updates)) {
    if (key !== "id" && key !== "createdBy" && key !== "createdAt" && key !== "runCount") {
      pipeline[key] = value;
    }
  }
  pipeline.updatedAt = Date.now();

  writeJSON(DATA_FILE, data);
  return pipeline;
}

/**
 * Delete a pipeline.
 */
export function deletePipeline(pipelineId) {
  const data = readJSON(DATA_FILE);
  const index = (data.pipelines || []).findIndex((p) => p.id === pipelineId);
  if (index === -1) return false;

  data.pipelines.splice(index, 1);
  writeJSON(DATA_FILE, data);
  return true;
}

/**
 * Execute a pipeline.
 */
export function executePipeline(pipelineId, options = {}) {
  const data = readJSON(DATA_FILE);
  if (!data.executions) data.executions = [];

  const pipeline = (data.pipelines || []).find((p) => p.id === pipelineId);
  if (!pipeline) return { error: "Pipeline not found" };
  if (!pipeline.enabled) return { error: "Pipeline is disabled" };

  const execution = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    pipelineId,
    pipelineName: pipeline.name,
    status: "running",
    steps: [],
    startedAt: Date.now(),
    completedAt: null,
    error: null,
    triggeredBy: options.userId || "system",
  };

  // Simulate step execution
  for (const step of pipeline.steps) {
    const stepResult = {
      name: step.name,
      type: step.type,
      status: "completed",
      startedAt: Date.now(),
      completedAt: Date.now(),
      output: `Step "${step.name}" executed`,
    };
    execution.steps.push(stepResult);
  }

  execution.status = "completed";
  execution.completedAt = Date.now();

  // Update pipeline stats
  pipeline.lastRun = Date.now();
  pipeline.runCount++;

  data.executions.unshift(execution);
  if (data.executions.length > MAX_EXECUTIONS) data.executions.length = MAX_EXECUTIONS;

  writeJSON(DATA_FILE, data);
  return execution;
}

/**
 * Get execution history.
 */
export function getExecutions(options = {}) {
  const { pipelineId = null, status = null, limit = 50 } = options;
  const data = readJSON(DATA_FILE);
  let executions = data.executions || [];

  if (pipelineId) executions = executions.filter((e) => e.pipelineId === pipelineId);
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
 * Get pipeline statistics.
 */
export function getPipelineStats() {
  const data = readJSON(DATA_FILE);
  const pipelines = data.pipelines || [];
  const executions = data.executions || [];

  const statusCounts = {};
  for (const exec of executions) {
    statusCounts[exec.status] = (statusCounts[exec.status] || 0) + 1;
  }

  const avgDuration = executions
    .filter((e) => e.completedAt && e.startedAt)
    .map((e) => e.completedAt - e.startedAt);

  return {
    totalPipelines: pipelines.length,
    enabledPipelines: pipelines.filter((p) => p.enabled).length,
    totalExecutions: executions.length,
    statusCounts,
    avgDuration: avgDuration.length > 0
      ? Math.round(avgDuration.reduce((a, b) => a + b, 0) / avgDuration.length)
      : 0,
  };
}

/**
 * Clear pipeline data.
 */
export function clearPipelineData() {
  writeJSON(DATA_FILE, { pipelines: [], executions: [] });
}
