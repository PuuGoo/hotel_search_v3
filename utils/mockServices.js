// Mock services — mock external API dependencies for isolated testing

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_FILE = path.join(__dirname, "..", "mock_services.json");
const MAX_SERVICES = 50;
const MAX_LOGS = 2000;

function readJSON(filePath) {
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch { /* ignore */ }
  return { services: [], logs: [] };
}

function writeJSON(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  } catch { /* ignore */ }
}

/**
 * Register a mock service.
 */
export function registerService(options = {}) {
  const data = readJSON(DATA_FILE);
  if (!data.services) data.services = [];
  if (data.services.length >= MAX_SERVICES) {
    return { error: "Max services reached" };
  }

  const service = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name: options.name || "Unnamed Service",
    baseUrl: options.baseUrl || "",
    endpoints: options.endpoints || [], // [{ path, method, response, status, delay }]
    enabled: options.enabled !== false,
    createdBy: options.userId || "system",
    createdAt: Date.now(),
    callCount: 0,
  };

  data.services.unshift(service);
  writeJSON(DATA_FILE, data);
  return service;
}

/**
 * Get all mock services.
 */
export function getServices() {
  const data = readJSON(DATA_FILE);
  return data.services || [];
}

/**
 * Get a specific mock service.
 */
export function getService(serviceId) {
  const data = readJSON(DATA_FILE);
  return (data.services || []).find((s) => s.id === serviceId) || null;
}

/**
 * Update a mock service.
 */
export function updateService(serviceId, updates) {
  const data = readJSON(DATA_FILE);
  const service = (data.services || []).find((s) => s.id === serviceId);
  if (!service) return null;

  for (const [key, value] of Object.entries(updates)) {
    if (key !== "id" && key !== "createdBy" && key !== "createdAt" && key !== "callCount") {
      service[key] = value;
    }
  }

  writeJSON(DATA_FILE, data);
  return service;
}

/**
 * Delete a mock service.
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
 * Handle a mock request.
 */
export function handleRequest(serviceId, method, endpointPath, requestBody = null) {
  const data = readJSON(DATA_FILE);
  if (!data.logs) data.logs = [];

  const service = (data.services || []).find((s) => s.id === serviceId);
  if (!service) return { error: "Service not found" };
  if (!service.enabled) return { error: "Service is disabled" };

  const endpoint = service.endpoints.find((e) =>
    e.method === method && e.path === endpointPath
  );

  if (!endpoint) {
    return { error: `No mock for ${method} ${endpointPath}`, status: 404 };
  }

  // Log the request
  const log = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    serviceId,
    serviceName: service.name,
    method,
    path: endpointPath,
    requestBody,
    responseStatus: endpoint.status || 200,
    responseBody: endpoint.response,
    timestamp: Date.now(),
  };

  data.logs.unshift(log);
  if (data.logs.length > MAX_LOGS) data.logs.length = MAX_LOGS;

  service.callCount++;

  writeJSON(DATA_FILE, data);

  return {
    status: endpoint.status || 200,
    data: endpoint.response || {},
    delay: endpoint.delay || 0,
  };
}

/**
 * Get request logs.
 */
export function getLogs(options = {}) {
  const { serviceId = null, method = null, limit = 50 } = options;
  const data = readJSON(DATA_FILE);
  let logs = data.logs || [];

  if (serviceId) logs = logs.filter((l) => l.serviceId === serviceId);
  if (method) logs = logs.filter((l) => l.method === method);

  return { logs: logs.slice(0, limit), total: logs.length };
}

/**
 * Get mock service statistics.
 */
export function getMockStats() {
  const data = readJSON(DATA_FILE);
  const services = data.services || [];
  const logs = data.logs || [];

  return {
    totalServices: services.length,
    enabledServices: services.filter((s) => s.enabled).length,
    totalCalls: logs.length,
    totalEndpoints: services.reduce((sum, s) => sum + s.endpoints.length, 0),
  };
}

/**
 * Clear mock data.
 */
export function clearMockData() {
  writeJSON(DATA_FILE, { services: [], logs: [] });
}
