// Connection management — track and manage WebSocket connections per user
// Monitors connection lifecycle, enforces limits, and provides connection analytics

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_FILE = path.join(__dirname, "..", "connection_manager.json");
const MAX_CONNECTIONS_PER_USER = 5;
const MAX_HISTORY = 10000;

function readJSON(filePath) {
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch { /* ignore */ }
  return { history: [], config: {} };
}

function writeJSON(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data));
  } catch { /* ignore */ }
}

// In-memory connection tracking
const activeConnections = new Map(); // connectionId -> { userId, type, connectedAt, metadata }
const userConnections = new Map();   // userId -> Set<connectionId>

/**
 * Register a new connection.
 */
export function registerConnection(options = {}) {
  const userId = options.userId || "anonymous";
  const connectionId = options.connectionId || Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  // Check per-user limit
  const userConns = userConnections.get(userId);
  if (userConns && userConns.size >= MAX_CONNECTIONS_PER_USER) {
    return { error: "Max connections per user reached", limit: MAX_CONNECTIONS_PER_USER };
  }

  const connection = {
    id: connectionId,
    userId,
    type: options.type || "websocket", // websocket, sse, polling
    connectedAt: Date.now(),
    lastActivity: Date.now(),
    metadata: options.metadata || {},
    ip: options.ip || null,
  };

  activeConnections.set(connectionId, connection);

  if (!userConnections.has(userId)) {
    userConnections.set(userId, new Set());
  }
  userConnections.get(userId).add(connectionId);

  // Record in history
  recordEvent("connect", connection);

  return connection;
}

/**
 * Unregister a connection.
 */
export function unregisterConnection(connectionId) {
  const connection = activeConnections.get(connectionId);
  if (!connection) return false;

  activeConnections.delete(connectionId);

  const userConns = userConnections.get(connection.userId);
  if (userConns) {
    userConns.delete(connectionId);
    if (userConns.size === 0) userConnections.delete(connection.userId);
  }

  const duration = Date.now() - connection.connectedAt;
  recordEvent("disconnect", { ...connection, duration });

  return true;
}

/**
 * Update connection activity.
 */
export function touchConnection(connectionId) {
  const connection = activeConnections.get(connectionId);
  if (!connection) return false;
  connection.lastActivity = Date.now();
  return true;
}

/**
 * Get all active connections.
 */
export function getActiveConnections(options = {}) {
  const { userId = null, type = null } = options;
  let connections = [...activeConnections.values()];

  if (userId) connections = connections.filter((c) => c.userId === userId);
  if (type) connections = connections.filter((c) => c.type === type);

  return connections.sort((a, b) => b.connectedAt - a.connectedAt);
}

/**
 * Get connection info.
 */
export function getConnection(connectionId) {
  return activeConnections.get(connectionId) || null;
}

/**
 * Get user connection count.
 */
export function getUserConnectionCount(userId) {
  return (userConnections.get(userId) || new Set()).size;
}

/**
 * Disconnect all connections for a user.
 */
export function disconnectUser(userId) {
  const userConns = userConnections.get(userId);
  if (!userConns) return 0;

  let count = 0;
  for (const connId of [...userConns]) {
    if (unregisterConnection(connId)) count++;
  }

  return count;
}

/**
 * Get connection statistics.
 */
export function getConnectionStats() {
  const connections = [...activeConnections.values()];
  const uniqueUsers = new Set(connections.map((c) => c.userId)).size;

  const typeCounts = {};
  for (const conn of connections) {
    typeCounts[conn.type] = (typeCounts[conn.type] || 0) + 1;
  }

  const data = readJSON(DATA_FILE);
  const history = data.history || [];
  const recentConnects = history.filter((h) => h.type === "connect").length;
  const recentDisconnects = history.filter((h) => h.type === "disconnect").length;

  const durations = history
    .filter((h) => h.type === "disconnect" && h.duration)
    .map((h) => h.duration);

  const avgDuration = durations.length > 0
    ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
    : 0;

  return {
    activeConnections: connections.length,
    uniqueUsers,
    maxPerUser: MAX_CONNECTIONS_PER_USER,
    byType: typeCounts,
    totalConnects: recentConnects,
    totalDisconnects: recentDisconnects,
    avgSessionDuration: avgDuration,
  };
}

/**
 * Get connection history.
 */
export function getConnectionHistory(options = {}) {
  const { limit = 50, type = null } = options;
  const data = readJSON(DATA_FILE);
  let history = data.history || [];

  if (type) history = history.filter((h) => h.type === type);

  return { history: history.slice(0, limit), total: history.length };
}

function recordEvent(type, connection) {
  const data = readJSON(DATA_FILE);
  if (!data.history) data.history = [];

  data.history.unshift({
    type,
    connectionId: connection.id,
    userId: connection.userId,
    connectionType: connection.type,
    timestamp: Date.now(),
    duration: connection.duration || null,
  });

  if (data.history.length > MAX_HISTORY) data.history.length = MAX_HISTORY;
  writeJSON(DATA_FILE, data);
}

/**
 * Clear connection data.
 */
export function clearConnectionData() {
  activeConnections.clear();
  userConnections.clear();
  writeJSON(DATA_FILE, { history: [], config: {} });
}

/**
 * Cleanup stale connections.
 */
export function cleanupStale(maxIdleMs = 5 * 60 * 1000) {
  const now = Date.now();
  let cleaned = 0;

  for (const [connId, conn] of activeConnections) {
    if (now - conn.lastActivity > maxIdleMs) {
      unregisterConnection(connId);
      cleaned++;
    }
  }

  return cleaned;
}
