// ETL job scheduler — schedule and manage extract-transform-load jobs

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_FILE = path.join(__dirname, "..", "etl_scheduler.json");
const MAX_JOBS = 100;
const MAX_RUNS = 1000;

function readJSON(filePath) {
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch { /* ignore */ }
  return { jobs: [], runs: [] };
}

function writeJSON(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  } catch { /* ignore */ }
}

/**
 * Create an ETL job definition.
 */
export function createJob(options = {}) {
  const data = readJSON(DATA_FILE);
  if (!data.jobs) data.jobs = [];
  if (data.jobs.length >= MAX_JOBS) {
    return { error: "Max jobs reached" };
  }

  const job = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name: options.name || "Unnamed Job",
    description: options.description || "",
    source: options.source || null, // { type, config }
    transform: options.transform || null, // { type, config }
    destination: options.destination || null, // { type, config }
    schedule: options.schedule || null, // cron expression
    enabled: options.enabled !== false,
    createdBy: options.userId || "system",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    lastRun: null,
    runCount: 0,
  };

  data.jobs.unshift(job);
  writeJSON(DATA_FILE, data);
  return job;
}

/**
 * Get all jobs.
 */
export function getJobs(options = {}) {
  const { enabled = null } = options;
  const data = readJSON(DATA_FILE);
  let jobs = data.jobs || [];

  if (enabled !== null) {
    jobs = jobs.filter((j) => j.enabled === enabled);
  }

  return jobs.map((j) => ({
    id: j.id,
    name: j.name,
    description: j.description,
    source: j.source,
    transform: j.transform,
    destination: j.destination,
    schedule: j.schedule,
    enabled: j.enabled,
    lastRun: j.lastRun,
    runCount: j.runCount,
    createdAt: j.createdAt,
  }));
}

/**
 * Get a specific job.
 */
export function getJob(jobId) {
  const data = readJSON(DATA_FILE);
  return (data.jobs || []).find((j) => j.id === jobId) || null;
}

/**
 * Update a job.
 */
export function updateJob(jobId, updates) {
  const data = readJSON(DATA_FILE);
  const job = (data.jobs || []).find((j) => j.id === jobId);
  if (!job) return null;

  for (const [key, value] of Object.entries(updates)) {
    if (key !== "id" && key !== "createdBy" && key !== "createdAt" && key !== "runCount") {
      job[key] = value;
    }
  }
  job.updatedAt = Date.now();

  writeJSON(DATA_FILE, data);
  return job;
}

/**
 * Delete a job.
 */
export function deleteJob(jobId) {
  const data = readJSON(DATA_FILE);
  const index = (data.jobs || []).findIndex((j) => j.id === jobId);
  if (index === -1) return false;

  data.jobs.splice(index, 1);
  writeJSON(DATA_FILE, data);
  return true;
}

/**
 * Execute a job (simulate ETL run).
 */
export function executeJob(jobId, options = {}) {
  const data = readJSON(DATA_FILE);
  if (!data.runs) data.runs = [];

  const job = (data.jobs || []).find((j) => j.id === jobId);
  if (!job) return { error: "Job not found" };
  if (!job.enabled) return { error: "Job is disabled" };

  const run = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    jobId,
    jobName: job.name,
    status: "running",
    stages: [],
    recordsExtracted: 0,
    recordsTransformed: 0,
    recordsLoaded: 0,
    startedAt: Date.now(),
    completedAt: null,
    error: null,
    triggeredBy: options.userId || "system",
  };

  // Simulate extract stage
  const extractResult = {
    name: "extract",
    status: "completed",
    startedAt: Date.now(),
    completedAt: Date.now(),
    records: Math.floor(Math.random() * 100) + 1,
    output: `Extracted from ${job.source?.type || "unknown"}`,
  };
  run.stages.push(extractResult);
  run.recordsExtracted = extractResult.records;

  // Simulate transform stage
  const transformResult = {
    name: "transform",
    status: "completed",
    startedAt: Date.now(),
    completedAt: Date.now(),
    records: run.recordsExtracted,
    output: `Transformed ${run.recordsExtracted} records`,
  };
  run.stages.push(transformResult);
  run.recordsTransformed = transformResult.records;

  // Simulate load stage
  const loadResult = {
    name: "load",
    status: "completed",
    startedAt: Date.now(),
    completedAt: Date.now(),
    records: run.recordsTransformed,
    output: `Loaded to ${job.destination?.type || "unknown"}`,
  };
  run.stages.push(loadResult);
  run.recordsLoaded = loadResult.records;

  run.status = "completed";
  run.completedAt = Date.now();

  // Update job stats
  job.lastRun = Date.now();
  job.runCount++;

  data.runs.unshift(run);
  if (data.runs.length > MAX_RUNS) data.runs.length = MAX_RUNS;

  writeJSON(DATA_FILE, data);
  return run;
}

/**
 * Get run history.
 */
export function getRuns(options = {}) {
  const { jobId = null, status = null, limit = 50 } = options;
  const data = readJSON(DATA_FILE);
  let runs = data.runs || [];

  if (jobId) runs = runs.filter((r) => r.jobId === jobId);
  if (status) runs = runs.filter((r) => r.status === status);

  return { runs: runs.slice(0, limit), total: runs.length };
}

/**
 * Get a specific run.
 */
export function getRun(runId) {
  const data = readJSON(DATA_FILE);
  return (data.runs || []).find((r) => r.id === runId) || null;
}

/**
 * Get scheduler statistics.
 */
export function getSchedulerStats() {
  const data = readJSON(DATA_FILE);
  const jobs = data.jobs || [];
  const runs = data.runs || [];

  const statusCounts = {};
  for (const run of runs) {
    statusCounts[run.status] = (statusCounts[run.status] || 0) + 1;
  }

  const totalRecords = runs.reduce(
    (acc, r) => ({
      extracted: acc.extracted + (r.recordsExtracted || 0),
      transformed: acc.transformed + (r.recordsTransformed || 0),
      loaded: acc.loaded + (r.recordsLoaded || 0),
    }),
    { extracted: 0, transformed: 0, loaded: 0 }
  );

  return {
    totalJobs: jobs.length,
    enabledJobs: jobs.filter((j) => j.enabled).length,
    totalRuns: runs.length,
    statusCounts,
    totalRecords,
  };
}

/**
 * Clear all scheduler data.
 */
export function clearSchedulerData() {
  writeJSON(DATA_FILE, { jobs: [], runs: [] });
}
