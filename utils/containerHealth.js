// Container health monitoring — track container status and resource usage

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_FILE = path.join(__dirname, "..", "container_health.json");
const MAX_CONTAINERS = 100;
const MAX_METRICS = 5000;

function readJSON(filePath) {
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch { /* ignore */ }
  return { containers: [], metrics: [] };
}

function writeJSON(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  } catch { /* ignore */ }
}

/**
 * Register a container.
 */
export function registerContainer(options = {}) {
  const data = readJSON(DATA_FILE);
  if (!data.containers) data.containers = [];

  const container = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name: options.name,
    image: options.image || "",
    status: options.status || "running", // "running", "stopped", "unhealthy", "unknown"
    host: options.host || "localhost",
    ports: options.ports || [],
    environment: options.environment || "production",
    healthCheck: options.healthCheck || null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  data.containers.unshift(container);
  if (data.containers.length > MAX_CONTAINERS) data.containers.length = MAX_CONTAINERS;

  writeJSON(DATA_FILE, data);
  return container;
}

/**
 * Get all containers.
 */
export function getContainers(options = {}) {
  const { status = null, environment = null } = options;
  const data = readJSON(DATA_FILE);
  let containers = data.containers || [];

  if (status) containers = containers.filter((c) => c.status === status);
  if (environment) containers = containers.filter((c) => c.environment === environment);

  return { containers, count: containers.length };
}

/**
 * Get a specific container.
 */
export function getContainer(containerId) {
  const data = readJSON(DATA_FILE);
  return (data.containers || []).find((c) => c.id === containerId) || null;
}

/**
 * Update a container.
 */
export function updateContainer(containerId, updates) {
  const data = readJSON(DATA_FILE);
  const index = (data.containers || []).findIndex((c) => c.id === containerId);
  if (index === -1) return null;

  data.containers[index] = {
    ...data.containers[index],
    ...updates,
    id: containerId,
    updatedAt: Date.now(),
  };
  writeJSON(DATA_FILE, data);
  return data.containers[index];
}

/**
 * Delete a container.
 */
export function deleteContainer(containerId) {
  const data = readJSON(DATA_FILE);
  const index = (data.containers || []).findIndex((c) => c.id === containerId);
  if (index === -1) return false;

  data.containers.splice(index, 1);
  writeJSON(DATA_FILE, data);
  return true;
}

/**
 * Record container metrics.
 */
export function recordMetrics(options = {}) {
  const data = readJSON(DATA_FILE);
  if (!data.metrics) data.metrics = [];

  const metric = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    containerId: options.containerId,
    cpu: options.cpu || 0, // percentage
    memory: options.memory || 0, // MB
    memoryLimit: options.memoryLimit || 0, // MB
    networkIn: options.networkIn || 0, // bytes
    networkOut: options.networkOut || 0, // bytes
    diskRead: options.diskRead || 0, // bytes
    diskWrite: options.diskWrite || 0, // bytes
    pids: options.pids || 0,
    timestamp: Date.now(),
  };

  data.metrics.unshift(metric);
  if (data.metrics.length > MAX_METRICS) data.metrics.length = MAX_METRICS;

  writeJSON(DATA_FILE, data);
  return metric;
}

/**
 * Get metrics for a container.
 */
export function getContainerMetrics(containerId, limit = 50) {
  const data = readJSON(DATA_FILE);
  const metrics = (data.metrics || [])
    .filter((m) => m.containerId === containerId)
    .slice(0, limit);
  return { metrics, total: metrics.length };
}

/**
 * Get latest metrics for all containers.
 */
export function getLatestMetrics() {
  const data = readJSON(DATA_FILE);
  const metrics = data.metrics || [];
  const containers = data.containers || [];

  const latest = {};
  for (const metric of metrics) {
    if (!latest[metric.containerId]) {
      latest[metric.containerId] = metric;
    }
  }

  return containers.map((c) => ({
    container: c,
    metrics: latest[c.id] || null,
  }));
}

/**
 * Get health overview.
 */
export function getHealthOverview() {
  const data = readJSON(DATA_FILE);
  const containers = data.containers || [];

  return {
    total: containers.length,
    running: containers.filter((c) => c.status === "running").length,
    stopped: containers.filter((c) => c.status === "stopped").length,
    unhealthy: containers.filter((c) => c.status === "unhealthy").length,
    unknown: containers.filter((c) => c.status === "unknown").length,
    environments: [...new Set(containers.map((c) => c.environment))],
  };
}

/**
 * Clear all data.
 */
export function clearContainerData() {
  writeJSON(DATA_FILE, { containers: [], metrics: [] });
}
