// Deployment tracker — record deployments with version, environment, and rollback info

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_FILE = path.join(__dirname, "..", "deployment_tracker.json");
const MAX_DEPLOYMENTS = 500;

function readJSON(filePath) {
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch { /* ignore */ }
  return { deployments: [] };
}

function writeJSON(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  } catch { /* ignore */ }
}

/**
 * Record a deployment.
 */
export function recordDeployment(options = {}) {
  const data = readJSON(DATA_FILE);
  if (!data.deployments) data.deployments = [];

  const deployment = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    version: options.version,
    environment: options.environment || "production",
    status: options.status || "deployed", // "pending", "deploying", "deployed", "failed", "rolled_back"
    service: options.service || "",
    commitHash: options.commitHash || "",
    branch: options.branch || "",
    deployedBy: options.deployedBy || options.userId || "system",
    deployedAt: Date.now(),
    rollbackFrom: options.rollbackFrom || null,
    notes: options.notes || "",
    duration: options.duration || 0, // seconds
  };

  data.deployments.unshift(deployment);
  if (data.deployments.length > MAX_DEPLOYMENTS) data.deployments.length = MAX_DEPLOYMENTS;

  writeJSON(DATA_FILE, data);
  return deployment;
}

/**
 * Get deployments with optional filters.
 */
export function getDeployments(options = {}) {
  const { environment = null, service = null, status = null, limit = 50 } = options;
  const data = readJSON(DATA_FILE);
  let deployments = data.deployments || [];

  if (environment) deployments = deployments.filter((d) => d.environment === environment);
  if (service) deployments = deployments.filter((d) => d.service === service);
  if (status) deployments = deployments.filter((d) => d.status === status);

  return { deployments: deployments.slice(0, limit), total: deployments.length };
}

/**
 * Get a specific deployment.
 */
export function getDeployment(deploymentId) {
  const data = readJSON(DATA_FILE);
  return (data.deployments || []).find((d) => d.id === deploymentId) || null;
}

/**
 * Update a deployment.
 */
export function updateDeployment(deploymentId, updates) {
  const data = readJSON(DATA_FILE);
  const index = (data.deployments || []).findIndex((d) => d.id === deploymentId);
  if (index === -1) return null;

  data.deployments[index] = { ...data.deployments[index], ...updates, id: deploymentId };
  writeJSON(DATA_FILE, data);
  return data.deployments[index];
}

/**
 * Rollback a deployment — create a new deployment marked as rollback.
 */
export function rollbackDeployment(deploymentId, userId) {
  const data = readJSON(DATA_FILE);
  const deployment = (data.deployments || []).find((d) => d.id === deploymentId);
  if (!deployment) return null;

  // Mark original as rolled back
  deployment.status = "rolled_back";

  // Create rollback deployment
  const rollback = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    version: deployment.version,
    environment: deployment.environment,
    status: "deployed",
    service: deployment.service,
    commitHash: deployment.commitHash,
    branch: deployment.branch,
    deployedBy: userId || "system",
    deployedAt: Date.now(),
    rollbackFrom: deploymentId,
    notes: `Rollback of deployment ${deploymentId}`,
    duration: 0,
  };

  data.deployments.unshift(rollback);
  writeJSON(DATA_FILE, data);
  return rollback;
}

/**
 * Delete a deployment.
 */
export function deleteDeployment(deploymentId) {
  const data = readJSON(DATA_FILE);
  const index = (data.deployments || []).findIndex((d) => d.id === deploymentId);
  if (index === -1) return false;

  data.deployments.splice(index, 1);
  writeJSON(DATA_FILE, data);
  return true;
}

/**
 * Get deployment statistics.
 */
export function getDeploymentStats() {
  const data = readJSON(DATA_FILE);
  const deployments = data.deployments || [];

  const statusCounts = {};
  const environmentCounts = {};
  const serviceCounts = {};
  for (const d of deployments) {
    statusCounts[d.status] = (statusCounts[d.status] || 0) + 1;
    environmentCounts[d.environment] = (environmentCounts[d.environment] || 0) + 1;
    if (d.service) serviceCounts[d.service] = (serviceCounts[d.service] || 0) + 1;
  }

  const avgDuration = deployments.length > 0
    ? Math.round(deployments.reduce((sum, d) => sum + d.duration, 0) / deployments.length)
    : 0;

  return {
    total: deployments.length,
    statusCounts,
    environmentCounts,
    serviceCounts,
    avgDuration,
    rollbackCount: deployments.filter((d) => d.status === "rolled_back").length,
  };
}

/**
 * Clear deployment data.
 */
export function clearDeploymentData() {
  writeJSON(DATA_FILE, { deployments: [] });
}
