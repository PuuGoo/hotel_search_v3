// Pipeline monitoring — track pipeline execution status and history with alerts

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_FILE = path.join(__dirname, "..", "pipeline_monitor.json");
const MAX_METRICS = 5000;
const MAX_ALERTS = 500;
const FAILURE_THRESHOLD = 3; // consecutive failures before alert

function readJSON(filePath) {
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch { /* ignore */ }
  return { metrics: [], alerts: [], pipelineStatus: {} };
}

function writeJSON(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  } catch { /* ignore */ }
}

/**
 * Record a pipeline execution metric.
 */
export function recordMetric(options = {}) {
  const data = readJSON(DATA_FILE);
  if (!data.metrics) data.metrics = [];
  if (!data.pipelineStatus) data.pipelineStatus = {};

  const metric = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    pipelineId: options.pipelineId,
    pipelineName: options.pipelineName || "Unknown",
    executionId: options.executionId,
    status: options.status, // "started", "completed", "failed"
    duration: options.duration || null,
    recordsProcessed: options.recordsProcessed || 0,
    error: options.error || null,
    timestamp: Date.now(),
  };

  data.metrics.unshift(metric);
  if (data.metrics.length > MAX_METRICS) data.metrics.length = MAX_METRICS;

  // Update pipeline status
  const pid = options.pipelineId;
  if (!data.pipelineStatus[pid]) {
    data.pipelineStatus[pid] = {
      pipelineId: pid,
      pipelineName: metric.pipelineName,
      lastExecution: null,
      lastStatus: null,
      consecutiveFailures: 0,
      totalExecutions: 0,
      totalFailures: 0,
      avgDuration: 0,
      totalDuration: 0,
    };
  }

  const status = data.pipelineStatus[pid];
  status.lastExecution = Date.now();
  status.lastStatus = metric.status;
  status.totalExecutions++;

  if (metric.status === "failed") {
    status.consecutiveFailures++;
    status.totalFailures++;

    // Generate alert on consecutive failures
    if (status.consecutiveFailures >= FAILURE_THRESHOLD) {
      if (!data.alerts) data.alerts = [];
      data.alerts.unshift({
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        pipelineId: pid,
        pipelineName: metric.pipelineName,
        type: "consecutive_failures",
        message: `Pipeline "${metric.pipelineName}" has failed ${status.consecutiveFailures} consecutive times`,
        severity: "high",
        acknowledged: false,
        timestamp: Date.now(),
      });
      if (data.alerts.length > MAX_ALERTS) data.alerts.length = MAX_ALERTS;
    }
  } else if (metric.status === "completed") {
    status.consecutiveFailures = 0;
    if (metric.duration) {
      status.totalDuration += metric.duration;
      status.avgDuration = Math.round(status.totalDuration / status.totalExecutions);
    }
  }

  writeJSON(DATA_FILE, data);
  return metric;
}

/**
 * Get metrics for a pipeline.
 */
export function getMetrics(pipelineId, limit = 50) {
  const data = readJSON(DATA_FILE);
  let metrics = data.metrics || [];
  if (pipelineId) metrics = metrics.filter((m) => m.pipelineId === pipelineId);
  return { metrics: metrics.slice(0, limit), total: metrics.length };
}

/**
 * Get all pipeline statuses.
 */
export function getPipelineStatuses() {
  const data = readJSON(DATA_FILE);
  return Object.values(data.pipelineStatus || {});
}

/**
 * Get status for a specific pipeline.
 */
export function getPipelineStatus(pipelineId) {
  const data = readJSON(DATA_FILE);
  return (data.pipelineStatus || {})[pipelineId] || null;
}

/**
 * Get alerts.
 */
export function getAlerts(options = {}) {
  const { acknowledged = null, severity = null, limit = 50 } = options;
  const data = readJSON(DATA_FILE);
  let alerts = data.alerts || [];

  if (acknowledged !== null) alerts = alerts.filter((a) => a.acknowledged === acknowledged);
  if (severity) alerts = alerts.filter((a) => a.severity === severity);

  return { alerts: alerts.slice(0, limit), total: alerts.length };
}

/**
 * Acknowledge an alert.
 */
export function acknowledgeAlert(alertId) {
  const data = readJSON(DATA_FILE);
  const alert = (data.alerts || []).find((a) => a.id === alertId);
  if (!alert) return null;

  alert.acknowledged = true;
  alert.acknowledgedAt = Date.now();
  writeJSON(DATA_FILE, data);
  return alert;
}

/**
 * Get monitoring statistics.
 */
export function getMonitorStats() {
  const data = readJSON(DATA_FILE);
  const metrics = data.metrics || [];
  const alerts = data.alerts || [];
  const statuses = Object.values(data.pipelineStatus || {});

  const statusCounts = {};
  for (const m of metrics) {
    statusCounts[m.status] = (statusCounts[m.status] || 0) + 1;
  }

  return {
    totalMetrics: metrics.length,
    totalAlerts: alerts.length,
    unacknowledgedAlerts: alerts.filter((a) => !a.acknowledged).length,
    pipelinesMonitored: statuses.length,
    pipelinesWithFailures: statuses.filter((s) => s.consecutiveFailures > 0).length,
    statusCounts,
  };
}

/**
 * Clear monitoring data.
 */
export function clearMonitorData() {
  writeJSON(DATA_FILE, { metrics: [], alerts: [], pipelineStatus: {} });
}
