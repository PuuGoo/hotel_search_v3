// Search session grouping — group related searches into sessions
// Sessions are based on time proximity and query similarity

import fs from "fs";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const HISTORY_FILE = path.join(__dirname, "..", "search_history.json");
const SESSIONS_FILE = path.join(__dirname, "..", "search_sessions.json");

const SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes gap = new session
const MAX_SESSIONS_PER_USER = 200;

function readJSON(filePath) {
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch { /* ignore */ }
  return [];
}

function writeJSON(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  } catch { /* ignore */ }
}

/**
 * Calculate similarity between two queries (simple token overlap).
 */
function querySimilarity(q1, q2) {
  if (!q1 || !q2) return 0;
  const tokens1 = new Set(q1.toLowerCase().split(/\s+/));
  const tokens2 = new Set(q2.toLowerCase().split(/\s+/));
  const intersection = [...tokens1].filter((t) => tokens2.has(t)).length;
  const union = new Set([...tokens1, ...tokens2]).size;
  return union > 0 ? intersection / union : 0;
}

/**
 * Group search history entries into sessions for a user.
 * @param {string} userId - user ID
 * @param {Object} options - { sessionTimeout, minSimilarity }
 * @returns {Object[]} sessions with grouped searches
 */
export function groupSearchSessions(userId, options = {}) {
  const { sessionTimeout = SESSION_TIMEOUT, minSimilarity = 0.3 } = options;

  const history = readJSON(HISTORY_FILE);
  const userHistory = Array.isArray(history)
    ? history
        .filter((h) => h.userId === userId && h.query && h.timestamp)
        .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
    : [];

  if (userHistory.length === 0) return [];

  function makeSessionId(startTime, userId) {
    return `session_${crypto.createHash("md5").update(`${userId}_${startTime}`).digest("hex").slice(0, 12)}`;
  }

  const sessions = [];
  let currentSession = {
    id: makeSessionId(userHistory[0].timestamp, userId),
    searches: [userHistory[0]],
    startTime: userHistory[0].timestamp,
    endTime: userHistory[0].timestamp,
    query: userHistory[0].query,
  };

  for (let i = 1; i < userHistory.length; i++) {
    const prev = userHistory[i - 1];
    const curr = userHistory[i];
    const timeDiff = new Date(curr.timestamp) - new Date(prev.timestamp);
    const similarity = querySimilarity(prev.query, curr.query);

    // Start new session if time gap too large OR query completely different
    if (timeDiff > sessionTimeout || (timeDiff > 5 * 60 * 1000 && similarity < minSimilarity)) {
      sessions.push(currentSession);
      currentSession = {
        id: makeSessionId(curr.timestamp, userId),
        searches: [curr],
        startTime: curr.timestamp,
        endTime: curr.timestamp,
        query: curr.query,
      };
    } else {
      currentSession.searches.push(curr);
      currentSession.endTime = curr.timestamp;
    }
  }

  sessions.push(currentSession);

  // Enrich sessions with metadata
  return sessions.map((session, index) => {
    const queries = session.searches.map((s) => s.query);
    const uniqueQueries = [...new Set(queries)];
    const engines = [...new Set(session.searches.map((s) => s.engine).filter(Boolean))];

    return {
      id: session.id,
      userId,
      query: session.query,
      queries: uniqueQueries,
      searchCount: session.searches.length,
      engines,
      startTime: session.startTime,
      endTime: session.endTime,
      duration: new Date(session.endTime) - new Date(session.startTime),
      searches: session.searches,
      index: sessions.length - index, // Most recent first
    };
  }).reverse(); // Most recent sessions first
}

/**
 * Get session summary for a user (without full search details).
 */
export function getSessionSummary(userId, options = {}) {
  const sessions = groupSearchSessions(userId, options);
  return sessions.map(({ searches, ...summary }) => summary);
}

/**
 * Get a specific session by ID.
 */
export function getSession(userId, sessionId) {
  const sessions = groupSearchSessions(userId);
  return sessions.find((s) => s.id === sessionId) || null;
}

/**
 * Get session statistics for a user.
 */
export function getSessionStats(userId) {
  const sessions = groupSearchSessions(userId);

  if (sessions.length === 0) {
    return {
      totalSessions: 0,
      totalSearches: 0,
      avgSearchesPerSession: 0,
      avgSessionDuration: 0,
      topQueries: [],
      topEngines: [],
    };
  }

  const totalSearches = sessions.reduce((sum, s) => sum + s.searchCount, 0);
  const totalDuration = sessions.reduce((sum, s) => sum + s.duration, 0);

  // Top queries
  const queryCounts = {};
  for (const session of sessions) {
    for (const q of session.queries) {
      queryCounts[q] = (queryCounts[q] || 0) + 1;
    }
  }
  const topQueries = Object.entries(queryCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([query, count]) => ({ query, count }));

  // Top engines
  const engineCounts = {};
  for (const session of sessions) {
    for (const e of session.engines) {
      engineCounts[e] = (engineCounts[e] || 0) + 1;
    }
  }
  const topEngines = Object.entries(engineCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([engine, count]) => ({ engine, count }));

  return {
    totalSessions: sessions.length,
    totalSearches,
    avgSearchesPerSession: Math.round(totalSearches / sessions.length * 10) / 10,
    avgSessionDuration: Math.round(totalDuration / sessions.length),
    topQueries,
    topEngines,
  };
}

/**
 * Save a named session for later reference.
 */
export function saveSession(userId, sessionId, name) {
  const sessions = readJSON(SESSIONS_FILE);
  const allSessions = Array.isArray(sessions) ? sessions : [];

  const searchSessions = groupSearchSessions(userId);
  const session = searchSessions.find((s) => s.id === sessionId);

  if (!session) return null;

  const saved = {
    userId,
    sessionId,
    name: name || `Session ${new Date(session.startTime).toLocaleString()}`,
    query: session.query,
    queries: session.queries,
    searchCount: session.searchCount,
    engines: session.engines,
    startTime: session.startTime,
    endTime: session.endTime,
    savedAt: new Date().toISOString(),
  };

  // Remove existing entry for same session
  const filtered = allSessions.filter((s) => !(s.userId === userId && s.sessionId === sessionId));
  filtered.push(saved);

  // Cap per user
  const userSessions = filtered.filter((s) => s.userId === userId);
  if (userSessions.length > MAX_SESSIONS_PER_USER) {
    const toRemove = userSessions
      .sort((a, b) => new Date(a.savedAt) - new Date(b.savedAt))
      .slice(0, userSessions.length - MAX_SESSIONS_PER_USER);
    const removeIds = new Set(toRemove.map((s) => s.sessionId));
    const pruned = filtered.filter((s) => !removeIds.has(s.sessionId) || s.userId !== userId);
    writeJSON(SESSIONS_FILE, pruned);
  } else {
    writeJSON(SESSIONS_FILE, filtered);
  }

  return saved;
}

/**
 * Get saved sessions for a user.
 */
export function getSavedSessions(userId) {
  const sessions = readJSON(SESSIONS_FILE);
  return Array.isArray(sessions)
    ? sessions.filter((s) => s.userId === userId).sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt))
    : [];
}

/**
 * Delete a saved session.
 */
export function deleteSavedSession(userId, sessionId) {
  const sessions = readJSON(SESSIONS_FILE);
  if (!Array.isArray(sessions)) return false;

  const initialLength = sessions.length;
  const filtered = sessions.filter((s) => !(s.userId === userId && s.sessionId === sessionId));

  if (filtered.length < initialLength) {
    writeJSON(SESSIONS_FILE, filtered);
    return true;
  }
  return false;
}
