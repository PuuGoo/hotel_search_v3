import { Router } from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { checkAuthenticated, checkRole } from "../middleware/auth.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SESSION_FILE = path.join(__dirname, "..", "active_sessions.json");

const router = Router();

export function readSessions() {
  try {
    if (fs.existsSync(SESSION_FILE)) {
      return JSON.parse(fs.readFileSync(SESSION_FILE, "utf8"));
    }
  } catch (e) {
    console.error("Error reading sessions:", e.message);
  }
  return { sessions: [] };
}

export function writeSessions(data) {
  fs.writeFileSync(SESSION_FILE, JSON.stringify(data, null, 2));
}

// Track a new session (called on login)
export function trackSession(sessionId, userInfo, req) {
  try {
    const data = readSessions();
    // Remove existing session for same user (single-session enforcement optional)
    data.sessions = data.sessions.filter((s) => s.sessionId !== sessionId);

    data.sessions.push({
      sessionId,
      userId: userInfo.id,
      username: userInfo.username,
      displayName: userInfo.displayName,
      role: userInfo.role,
      ip: req.ip || req.connection?.remoteAddress || null,
      userAgent: req.headers?.["user-agent"] || null,
      loginTime: Date.now(),
      lastActivity: Date.now(),
    });

    // Trim to 500 sessions max
    if (data.sessions.length > 500) {
      data.sessions = data.sessions.slice(-500);
    }

    writeSessions(data);
  } catch (e) {
    console.error("Error tracking session:", e.message);
  }
}

// Update session activity (called on requests)
export function touchSession(sessionId) {
  try {
    const data = readSessions();
    const session = data.sessions.find((s) => s.sessionId === sessionId);
    if (session) {
      session.lastActivity = Date.now();
      writeSessions(data);
    }
  } catch {
    // Silent fail for activity tracking
  }
}

// Remove session (called on logout)
export function removeSession(sessionId) {
  try {
    const data = readSessions();
    data.sessions = data.sessions.filter((s) => s.sessionId !== sessionId);
    writeSessions(data);
  } catch (e) {
    console.error("Error removing session:", e.message);
  }
}

// GET /api/admin/sessions — list active sessions
router.get("/api/admin/sessions", checkAuthenticated, checkRole("admin"), (req, res) => {
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
  const search = req.query.search?.toLowerCase();

  const data = readSessions();
  let sessions = data.sessions;

  // Filter stale sessions (no activity in 24h)
  const staleThreshold = Date.now() - 86400000;
  sessions = sessions.filter((s) => s.lastActivity > staleThreshold);

  if (search) {
    sessions = sessions.filter((s) =>
      (s.username || "").toLowerCase().includes(search) ||
      (s.displayName || "").toLowerCase().includes(search) ||
      (s.ip || "").includes(search)
    );
  }

  // Sort by last activity (most recent first)
  sessions.sort((a, b) => b.lastActivity - a.lastActivity);

  const total = sessions.length;
  const totalPages = Math.ceil(total / limit);
  const offset = (page - 1) * limit;
  const paged = sessions.slice(offset, offset + limit);

  res.json({
    sessions: paged,
    total,
    page,
    limit,
    totalPages,
    hasMore: page < totalPages,
  });
});

// GET /api/admin/sessions/stats — session stats
router.get("/api/admin/sessions/stats", checkAuthenticated, checkRole("admin"), (_req, res) => {
  const data = readSessions();
  const staleThreshold = Date.now() - 86400000;
  const activeSessions = data.sessions.filter((s) => s.lastActivity > staleThreshold);

  const byRole = {};
  const byUser = {};
  for (const s of activeSessions) {
    byRole[s.role] = (byRole[s.role] || 0) + 1;
    byUser[s.username] = (byUser[s.username] || 0) + 1;
  }

  // Find users with multiple sessions
  const multiSessionUsers = Object.entries(byUser)
    .filter(([, count]) => count > 1)
    .map(([username, count]) => ({ username, count }));

  res.json({
    total: activeSessions.length,
    byRole,
    multiSessionUsers,
  });
});

// DELETE /api/admin/sessions/:sessionId — force logout a session
router.delete("/api/admin/sessions/:sessionId", checkAuthenticated, checkRole("admin"), (req, res) => {
  const { sessionId } = req.params;
  const data = readSessions();
  const session = data.sessions.find((s) => s.sessionId === sessionId);

  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }

  data.sessions = data.sessions.filter((s) => s.sessionId !== sessionId);
  writeSessions(data);

  res.json({ success: true, username: session.username });
});

// DELETE /api/admin/sessions/user/:username — force logout all sessions for a user
router.delete("/api/admin/sessions/user/:username", checkAuthenticated, checkRole("admin"), (req, res) => {
  const { username } = req.params;
  const data = readSessions();
  const count = data.sessions.filter((s) => s.username === username).length;

  data.sessions = data.sessions.filter((s) => s.username !== username);
  writeSessions(data);

  res.json({ success: true, removed: count });
});

export default router;
