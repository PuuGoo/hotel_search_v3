import { Router } from "express";
import bcrypt from "bcryptjs";
import { checkAuthenticated, checkRole, readUsers, writeUsers } from "../middleware/auth.js";
import { logAudit } from "./audit.js";

const router = Router();

// POST /api/admin/users/bulk-create — create multiple users
router.post("/api/admin/users/bulk-create", checkAuthenticated, checkRole("admin"), async (req, res) => {
  const { users: newUsers } = req.body;

  if (!Array.isArray(newUsers) || newUsers.length === 0) {
    return res.status(400).json({ error: "Array of users required" });
  }

  if (newUsers.length > 100) {
    return res.status(400).json({ error: "Maximum 100 users per batch" });
  }

  const existing = readUsers();
  const results = [];
  const errors = [];

  for (const u of newUsers) {
    const { username, password, displayName, role } = u;

    if (!username || !password) {
      errors.push({ username, error: "Username and password required" });
      continue;
    }

    if (existing.find((eu) => eu.username === username)) {
      errors.push({ username, error: "Username already exists" });
      continue;
    }

    const hashed = await bcrypt.hash(password, 10);
    const newUser = {
      id: existing.length > 0 ? Math.max(...existing.map((eu) => eu.id)) + 1 : 1,
      username,
      password: hashed,
      displayName: displayName || username,
      role: role === "admin" ? "admin" : "user",
      features: [],
      createdAt: new Date().toISOString(),
    };

    existing.push(newUser);
    results.push({ id: newUser.id, username: newUser.username, role: newUser.role });
  }

  writeUsers(existing);

  logAudit("bulk_user_create", {
    adminId: req.session.user.id,
    adminUsername: req.session.user.username,
    created: results.length,
    errors: errors.length,
    ip: req.ip,
  });

  res.json({ created: results, errors, total: results.length });
});

// PUT /api/admin/users/bulk-update — update multiple users
router.put("/api/admin/users/bulk-update", checkAuthenticated, checkRole("admin"), (req, res) => {
  const { updates } = req.body;

  if (!Array.isArray(updates) || updates.length === 0) {
    return res.status(400).json({ error: "Array of updates required" });
  }

  const users = readUsers();
  const results = [];
  const errors = [];

  for (const update of updates) {
    const { id, displayName, role } = update;

    if (!id) {
      errors.push({ id, error: "User ID required" });
      continue;
    }

    const user = users.find((u) => u.id === id);
    if (!user) {
      errors.push({ id, error: "User not found" });
      continue;
    }

    if (displayName !== undefined) user.displayName = displayName.trim();
    if (role !== undefined && ["user", "admin"].includes(role)) user.role = role;

    results.push({ id: user.id, username: user.username, role: user.role });
  }

  writeUsers(users);

  logAudit("bulk_user_update", {
    adminId: req.session.user.id,
    adminUsername: req.session.user.username,
    updated: results.length,
    errors: errors.length,
    ip: req.ip,
  });

  res.json({ updated: results, errors, total: results.length });
});

// DELETE /api/admin/users/bulk-delete — delete multiple users
router.delete("/api/admin/users/bulk-delete", checkAuthenticated, checkRole("admin"), (req, res) => {
  const ids = req.body?.ids || (req.query.ids ? JSON.parse(req.query.ids) : null);

  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: "Array of user IDs required" });
  }

  const users = readUsers();
  const adminId = req.session.user.id;
  const results = [];
  const errors = [];

  for (const id of ids) {
    if (id === adminId) {
      errors.push({ id, error: "Cannot delete yourself" });
      continue;
    }

    const index = users.findIndex((u) => u.id === id);
    if (index === -1) {
      errors.push({ id, error: "User not found" });
      continue;
    }

    const removed = users.splice(index, 1)[0];
    results.push({ id: removed.id, username: removed.username });
  }

  writeUsers(users);

  logAudit("bulk_user_delete", {
    adminId: req.session.user.id,
    adminUsername: req.session.user.username,
    deleted: results.length,
    errors: errors.length,
    ip: req.ip,
  });

  res.json({ deleted: results, errors, total: results.length });
});

// POST /api/admin/users/bulk-reset-password — reset passwords for multiple users
router.post("/api/admin/users/bulk-reset-password", checkAuthenticated, checkRole("admin"), async (req, res) => {
  const { resets } = req.body;

  if (!Array.isArray(resets) || resets.length === 0) {
    return res.status(400).json({ error: "Array of resets required" });
  }

  const users = readUsers();
  const results = [];
  const errors = [];

  for (const reset of resets) {
    const { id, newPassword } = reset;

    if (!id || !newPassword) {
      errors.push({ id, error: "ID and new password required" });
      continue;
    }

    const user = users.find((u) => u.id === id);
    if (!user) {
      errors.push({ id, error: "User not found" });
      continue;
    }

    user.password = await bcrypt.hash(newPassword, 10);
    results.push({ id: user.id, username: user.username });
  }

  writeUsers(users);

  logAudit("bulk_password_reset", {
    adminId: req.session.user.id,
    adminUsername: req.session.user.username,
    reset: results.length,
    ip: req.ip,
  });

  res.json({ reset: results, errors, total: results.length });
});

export default router;
