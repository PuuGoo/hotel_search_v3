// Service dependency map — visualize service dependencies and health

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_FILE = path.join(__dirname, "..", "service_dependencies.json");
const MAX_SERVICES = 200;
const MAX_HEALTH_RECORDS = 2000;

function readJSON(filePath) {
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch { /* ignore */ }
  return { services: [], healthRecords: [] };
}

function writeJSON(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  } catch { /* ignore */ }
}

/**
 * Register a service.
 */
export function registerService(options = {}) {
  const data = readJSON(DATA_FILE);
  if (!data.services) data.services = [];

  const service = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name: options.name,
    type: options.type || "microservice", // "microservice", "database", "cache", "queue", "external", "gateway"
    url: options.url || "",
    description: options.description || "",
    dependencies: options.dependencies || [], // array of service names
    tags: options.tags || [],
    healthEndpoint: options.healthEndpoint || null,
    author: options.userId || "system",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  data.services.unshift(service);
  if (data.services.length > MAX_SERVICES) data.services.length = MAX_SERVICES;

  writeJSON(DATA_FILE, data);
  return service;
}

/**
 * Get all services.
 */
export function getServices(options = {}) {
  const { type = null, tag = null } = options;
  const data = readJSON(DATA_FILE);
  let services = data.services || [];

  if (type) services = services.filter((s) => s.type === type);
  if (tag) services = services.filter((s) => s.tags.includes(tag));

  return { services, count: services.length };
}

/**
 * Get a specific service.
 */
export function getService(serviceId) {
  const data = readJSON(DATA_FILE);
  return (data.services || []).find((s) => s.id === serviceId) || null;
}

/**
 * Get service by name.
 */
export function getServiceByName(name) {
  const data = readJSON(DATA_FILE);
  return (data.services || []).find((s) => s.name === name) || null;
}

/**
 * Update a service.
 */
export function updateService(serviceId, updates) {
  const data = readJSON(DATA_FILE);
  const index = (data.services || []).findIndex((s) => s.id === serviceId);
  if (index === -1) return null;

  data.services[index] = {
    ...data.services[index],
    ...updates,
    id: serviceId,
    updatedAt: Date.now(),
  };
  writeJSON(DATA_FILE, data);
  return data.services[index];
}

/**
 * Delete a service.
 */
export function deleteService(serviceId) {
  const data = readJSON(DATA_FILE);
  const index = (data.services || []).findIndex((s) => s.id === serviceId);
  if (index === -1) return false;

  data.services.splice(index, 1);
  writeJSON(DATA_FILE, data);
  return true;
}

/**
 * Record health status for a service.
 */
export function recordHealth(options = {}) {
  const data = readJSON(DATA_FILE);
  if (!data.healthRecords) data.healthRecords = [];

  const record = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    serviceId: options.serviceId,
    serviceName: options.serviceName,
    status: options.status || "healthy", // "healthy", "degraded", "unhealthy", "unknown"
    responseTime: options.responseTime || 0,
    message: options.message || "",
    timestamp: Date.now(),
  };

  data.healthRecords.unshift(record);
  if (data.healthRecords.length > MAX_HEALTH_RECORDS) data.healthRecords.length = MAX_HEALTH_RECORDS;

  writeJSON(DATA_FILE, data);
  return record;
}

/**
 * Get health records for a service.
 */
export function getHealthRecords(serviceId, limit = 50) {
  const data = readJSON(DATA_FILE);
  const records = (data.healthRecords || [])
    .filter((r) => r.serviceId === serviceId)
    .slice(0, limit);
  return { records, total: records.length };
}

/**
 * Get the dependency graph.
 */
export function getDependencyGraph() {
  const data = readJSON(DATA_FILE);
  const services = data.services || [];
  const healthRecords = data.healthRecords || [];

  // Get latest health for each service
  const latestHealth = {};
  for (const record of healthRecords) {
    if (!latestHealth[record.serviceId]) {
      latestHealth[record.serviceId] = record;
    }
  }

  const nodes = services.map((s) => ({
    id: s.id,
    name: s.name,
    type: s.type,
    health: latestHealth[s.id]?.status || "unknown",
    responseTime: latestHealth[s.id]?.responseTime || 0,
  }));

  const edges = [];
  for (const service of services) {
    for (const depName of service.dependencies || []) {
      const dep = services.find((s) => s.name === depName);
      if (dep) {
        edges.push({ from: service.name, to: depName });
      }
    }
  }

  return { nodes, edges };
}

/**
 * Get dependency analysis — find circular dependencies, critical paths.
 */
export function analyzeDependencies() {
  const data = readJSON(DATA_FILE);
  const services = data.services || [];

  // Find services with most dependencies
  const mostDeps = [...services]
    .sort((a, b) => (b.dependencies?.length || 0) - (a.dependencies?.length || 0))
    .slice(0, 5)
    .map((s) => ({ name: s.name, dependencyCount: s.dependencies?.length || 0 }));

  // Find most depended-upon services
  const depCounts = {};
  for (const service of services) {
    for (const dep of service.dependencies || []) {
      depCounts[dep] = (depCounts[dep] || 0) + 1;
    }
  }
  const mostDepended = Object.entries(depCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, count]) => ({ name, dependentCount: count }));

  // Find orphan services (no dependencies and nothing depends on them)
  const orphans = services.filter(
    (s) => (!s.dependencies || s.dependencies.length === 0) && !depCounts[s.name]
  ).map((s) => s.name);

  return {
    mostDeps,
    mostDepended,
    orphans,
    totalServices: services.length,
    totalEdges: Object.values(depCounts).reduce((sum, c) => sum + c, 0),
  };
}

/**
 * Get dependency map statistics.
 */
export function getDependencyStats() {
  const data = readJSON(DATA_FILE);
  const services = data.services || [];

  const typeCounts = {};
  for (const s of services) {
    typeCounts[s.type] = (typeCounts[s.type] || 0) + 1;
  }

  return {
    totalServices: services.length,
    totalHealthRecords: (data.healthRecords || []).length,
    typeCounts,
    servicesWithDeps: services.filter((s) => s.dependencies?.length > 0).length,
  };
}

/**
 * Clear dependency data.
 */
export function clearDependencyData() {
  writeJSON(DATA_FILE, { services: [], healthRecords: [] });
}
