// Real-time search collaboration — multiple users can see each other's searches live
// Manages collaboration sessions where users share search activity

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_FILE = path.join(__dirname, "..", "collaboration_data.json");
const MAX_SESSIONS = 100;
const SESSION_TIMEOUT_MS = 60 * 60 * 1000; // 1 hour

function readJSON(filePath) {
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch { /* ignore */ }
  return { sessions: [], history: [] };
}

function writeJSON(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data));
  } catch { /* ignore */ }
}

// In-memory sessions
const activeSessions = new Map(); // sessionId -> { participants, searches, createdAt }

/**
 * Create a collaboration session.
 */
export function createSession(options = {}) {
  const data = readJSON(DATA_FILE);
  if (!data.sessions) data.sessions = [];

  const sessionId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const session = {
    id: sessionId,
    name: options.name || `Session ${sessionId}`,
    createdBy: options.userId || "anonymous",
    participants: [options.userId || "anonymous"],
    searches: [],
    createdAt: Date.now(),
    lastActivity: Date.now(),
  };

  activeSessions.set(sessionId, { ...session });
  data.sessions.unshift(session);
  if (data.sessions.length > MAX_SESSIONS) data.sessions.length = MAX_SESSIONS;
  writeJSON(DATA_FILE, data);

  return session;
}

/**
 * Join a collaboration session.
 */
export function joinSession(sessionId, userId) {
  const session = activeSessions.get(sessionId);
  if (!session) return null;

  if (!session.participants.includes(userId)) {
    session.participants.push(userId);
    session.lastActivity = Date.now();
  }

  return session;
}

/**
 * Leave a collaboration session.
 */
export function leaveSession(sessionId, userId) {
  const session = activeSessions.get(sessionId);
  if (!session) return false;

  session.participants = session.participants.filter((p) => p !== userId);
  session.lastActivity = Date.now();

  if (session.participants.length === 0) {
    activeSessions.delete(sessionId);
  }

  return true;
}

/**
 * Record a search in a collaboration session.
 */
export function recordSearch(sessionId, search) {
  const session = activeSessions.get(sessionId);
  if (!session) return null;

  const record = {
    userId: search.userId || "anonymous",
    query: search.query || "",
    engine: search.engine || "unknown",
    resultCount: search.resultCount || 0,
    timestamp: Date.now(),
  };

  session.searches.unshift(record);
  if (session.searches.length > 100) session.searches.length = 100;
  session.lastActivity = Date.now();

  return record;
}

/**
 * Get active collaboration sessions.
 */
export function getActiveSessions() {
  const now = Date.now();
  const sessions = [];

  for (const [id, session] of activeSessions) {
    if (now - session.lastActivity < SESSION_TIMEOUT_MS) {
      sessions.push({
        id,
        name: session.name,
        participants: session.participants.length,
        searches: session.searches.length,
        createdBy: session.createdBy,
        createdAt: session.createdAt,
        lastActivity: session.lastActivity,
      });
    } else {
      activeSessions.delete(id);
    }
  }

  return sessions.sort((a, b) => b.lastActivity - a.lastActivity);
}

/**
 * Get a specific session with full details.
 */
export function getSession(sessionId) {
  const session = activeSessions.get(sessionId);
  if (!session) return null;

  return {
    id: sessionId,
    name: session.name,
    participants: session.participants,
    recentSearches: session.searches.slice(0, 20),
    totalSearches: session.searches.length,
    createdBy: session.createdBy,
    createdAt: session.createdAt,
    lastActivity: session.lastActivity,
  };
}

/**
 * Get collaboration statistics.
 */
export function getCollaborationStats() {
  const data = readJSON(DATA_FILE);
  const sessions = data.sessions || [];

  const totalSessions = sessions.length;
  const totalSearches = sessions.reduce((sum, s) => sum + (s.searches?.length || 0), 0);
  const activeNow = activeSessions.size;

  const userCounts = {};
  for (const session of sessions) {
    for (const user of session.participants || []) {
      userCounts[user] = (userCounts[user] || 0) + 1;
    }
  }

  const topUsers = Object.entries(userCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([user, count]) => ({ user, sessions: count }));

  return {
    totalSessions,
    activeSessions: activeNow,
    totalSearches,
    topUsers,
  };
}

/**
 * Clear collaboration data.
 */
export function clearCollaborationData() {
  activeSessions.clear();
  writeJSON(DATA_FILE, { sessions: [], history: [] });
}
