// Security incident tracker — track and manage security incidents

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_FILE = path.join(__dirname, "..", "security_incidents.json");
const MAX_INCIDENTS = 500;
const MAX_TIMELINE = 5000;

function readJSON(filePath) {
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch { /* ignore */ }
  return { incidents: [], timeline: [] };
}

function writeJSON(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  } catch { /* ignore */ }
}

/**
 * Create a security incident.
 */
export function createIncident(options = {}) {
  const data = readJSON(DATA_FILE);
  if (!data.incidents) data.incidents = [];

  const incident = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    title: options.title,
    description: options.description || "",
    severity: options.severity || "medium", // "low", "medium", "high", "critical"
    category: options.category || "other", // "unauthorized_access", "data_breach", "ddos", "malware", "phishing", "other"
    status: options.status || "open", // "open", "investigating", "contained", "resolved", "closed"
    source: options.source || "",
    affectedSystems: options.affectedSystems || [],
    assignedTo: options.assignedTo || null,
    reporter: options.userId || "system",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    resolvedAt: null,
    closedAt: null,
  };

  data.incidents.unshift(incident);
  if (data.incidents.length > MAX_INCIDENTS) data.incidents.length = MAX_INCIDENTS;

  // Add timeline entry
  addTimelineEntry(data, incident.id, "created", `Incident created: ${incident.title}`, options.userId);

  writeJSON(DATA_FILE, data);
  return incident;
}

/**
 * Get incidents with optional filters.
 */
export function getIncidents(options = {}) {
  const { severity = null, status = null, category = null, limit = 50 } = options;
  const data = readJSON(DATA_FILE);
  let incidents = data.incidents || [];

  if (severity) incidents = incidents.filter((i) => i.severity === severity);
  if (status) incidents = incidents.filter((i) => i.status === status);
  if (category) incidents = incidents.filter((i) => i.category === category);

  return { incidents: incidents.slice(0, limit), total: incidents.length };
}

/**
 * Get a specific incident.
 */
export function getIncident(incidentId) {
  const data = readJSON(DATA_FILE);
  return (data.incidents || []).find((i) => i.id === incidentId) || null;
}

/**
 * Update an incident.
 */
export function updateIncident(incidentId, updates, userId) {
  const data = readJSON(DATA_FILE);
  const index = (data.incidents || []).findIndex((i) => i.id === incidentId);
  if (index === -1) return null;

  const oldStatus = data.incidents[index].status;
  data.incidents[index] = {
    ...data.incidents[index],
    ...updates,
    id: incidentId,
    updatedAt: Date.now(),
  };

  // Track status changes
  if (updates.status && updates.status !== oldStatus) {
    if (updates.status === "resolved") data.incidents[index].resolvedAt = Date.now();
    if (updates.status === "closed") data.incidents[index].closedAt = Date.now();
    addTimelineEntry(data, incidentId, "status_change", `Status changed: ${oldStatus} → ${updates.status}`, userId);
  }

  writeJSON(DATA_FILE, data);
  return data.incidents[index];
}

/**
 * Delete an incident.
 */
export function deleteIncident(incidentId) {
  const data = readJSON(DATA_FILE);
  const index = (data.incidents || []).findIndex((i) => i.id === incidentId);
  if (index === -1) return false;

  data.incidents.splice(index, 1);
  writeJSON(DATA_FILE, data);
  return true;
}

/**
 * Add a comment/timeline entry to an incident.
 */
export function addComment(incidentId, comment, userId) {
  const data = readJSON(DATA_FILE);
  const incident = (data.incidents || []).find((i) => i.id === incidentId);
  if (!incident) return null;

  addTimelineEntry(data, incidentId, "comment", comment, userId);
  incident.updatedAt = Date.now();

  writeJSON(DATA_FILE, data);
  return incident;
}

/**
 * Get timeline for an incident.
 */
export function getIncidentTimeline(incidentId) {
  const data = readJSON(DATA_FILE);
  const timeline = (data.timeline || []).filter((t) => t.incidentId === incidentId);
  return { timeline, count: timeline.length };
}

function addTimelineEntry(data, incidentId, type, message, userId) {
  if (!data.timeline) data.timeline = [];
  data.timeline.unshift({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    incidentId,
    type,
    message,
    userId: userId || "system",
    timestamp: Date.now(),
  });
  if (data.timeline.length > MAX_TIMELINE) data.timeline.length = MAX_TIMELINE;
}

/**
 * Get incident statistics.
 */
export function getIncidentStats() {
  const data = readJSON(DATA_FILE);
  const incidents = data.incidents || [];

  const severityCounts = { low: 0, medium: 0, high: 0, critical: 0 };
  const statusCounts = { open: 0, investigating: 0, contained: 0, resolved: 0, closed: 0 };
  const categoryCounts = {};

  for (const i of incidents) {
    severityCounts[i.severity]++;
    statusCounts[i.status]++;
    categoryCounts[i.category] = (categoryCounts[i.category] || 0) + 1;
  }

  const openIncidents = incidents.filter((i) => !["resolved", "closed"].includes(i.status));
  const avgResolutionTime = incidents
    .filter((i) => i.resolvedAt)
    .reduce((sum, i) => sum + (i.resolvedAt - i.createdAt), 0) / (incidents.filter((i) => i.resolvedAt).length || 1);

  return {
    total: incidents.length,
    open: openIncidents.length,
    severityCounts,
    statusCounts,
    categoryCounts,
    avgResolutionTime: Math.round(avgResolutionTime / 1000 / 60), // minutes
  };
}

/**
 * Clear incident data.
 */
export function clearIncidentData() {
  writeJSON(DATA_FILE, { incidents: [], timeline: [] });
}
