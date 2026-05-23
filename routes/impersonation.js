import { Router } from "express";
import { checkAuthenticated, checkRole, readUsers } from "../middleware/auth.js";
import { logAudit } from "./audit.js";

const router = Router();

// POST /api/admin/impersonate/:userId — start impersonating a user
router.post("/api/admin/impersonate/:userId", checkAuthenticated, checkRole("admin"), (req, res) => {
  const targetUserId = parseInt(req.params.userId, 10);

  if (isNaN(targetUserId)) {
    return res.status(400).json({ error: "Invalid user ID" });
  }

  const users = readUsers();
  const targetUser = users.find((u) => u.id === targetUserId);

  if (!targetUser) {
    return res.status(404).json({ error: "User not found" });
  }

  if (targetUser.role === "admin") {
    return res.status(400).json({ error: "Cannot impersonate another admin" });
  }

  // Save original admin info in session
  req.session.impersonator = {
    id: req.session.user.id,
    username: req.session.user.username,
    role: req.session.user.role,
    displayName: req.session.user.displayName,
    features: req.session.user.features,
  };

  // Switch to target user
  req.session.user = {
    id: targetUser.id,
    username: targetUser.username,
    role: targetUser.role,
    displayName: targetUser.displayName,
    features: targetUser.features || [],
  };

  logAudit("admin_impersonate", {
    adminId: req.session.impersonator.id,
    adminUsername: req.session.impersonator.username,
    targetId: targetUser.id,
    targetUsername: targetUser.username,
    ip: req.ip,
  });

  res.json({
    success: true,
    impersonating: {
      id: targetUser.id,
      username: targetUser.username,
      displayName: targetUser.displayName,
    },
    message: `Now impersonating ${targetUser.username}`,
  });
});

// POST /api/admin/stop-impersonating — stop impersonating and return to admin
router.post("/api/admin/stop-impersonating", checkAuthenticated, (req, res) => {
  if (!req.session.impersonator) {
    return res.status(400).json({ error: "Not currently impersonating" });
  }

  const impersonated = req.session.user.username;

  // Restore original admin
  req.session.user = { ...req.session.impersonator };
  delete req.session.impersonator;

  logAudit("admin_stop_impersonate", {
    adminId: req.session.user.id,
    adminUsername: req.session.user.username,
    impersonated,
    ip: req.ip,
  });

  res.json({
    success: true,
    message: `Stopped impersonating ${impersonated}`,
  });
});

// GET /api/admin/impersonation/status — check if currently impersonating
router.get("/api/admin/impersonation/status", checkAuthenticated, (req, res) => {
  res.json({
    impersonating: !!req.session.impersonator,
    originalAdmin: req.session.impersonator || null,
    currentUser: req.session.user || null,
  });
});

// GET /api/admin/users-list — list users for impersonation selection
router.get("/api/admin/users-list", checkAuthenticated, checkRole("admin"), (_req, res) => {
  const users = readUsers();
  const list = users
    .filter((u) => u.role !== "admin")
    .map((u) => ({
      id: u.id,
      username: u.username,
      displayName: u.displayName,
      role: u.role,
      createdAt: u.createdAt,
    }));

  res.json({ users: list });
});

export default router;
