import { Router } from "express";
import bcrypt from "bcryptjs";
import { readUsers, writeUsers, checkRole, VALID_FEATURES } from "../middleware/auth.js";
import { validateUserInput } from "../middleware/validation.js";
import { rateLimitSearch } from "../middleware/rateLimit.js";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = Router();

// Admin page
router.get("/admin", checkRole("admin"), (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "admin.html"));
});

// List users (admin only)
router.get("/api/users", checkRole("admin"), (_req, res) => {
  const users = readUsers().map(({ password: _pw, ...u }) => u);
  res.json(users);
});

// Create user (admin only, rate limited)
router.post("/api/users", checkRole("admin"), rateLimitSearch, validateUserInput, async (req, res) => {
  const { username, password, displayName, role, features } = req.body;
  const users = readUsers();
  if (users.find((u) => u.username === username)) {
    return res.status(400).json({ error: "Username already exists" });
  }
  const newUser = {
    id: users.length ? Math.max(...users.map((u) => u.id)) + 1 : 1,
    username,
    password: await bcrypt.hash(password, 10),
    displayName: (displayName || username).toString().replace(/[<>]/g, "").trim().slice(0, 100),
    role: role === "admin" ? "admin" : "user",
    features: Array.isArray(features) ? features.filter((f) => VALID_FEATURES.includes(f)) : [],
    createdAt: new Date().toISOString(),
  };
  users.push(newUser);
  writeUsers(users);
  const { password: _, ...safe } = newUser;
  res.json({ success: true, user: safe });
});

// Update user (admin only)
router.put("/api/users/:id", checkRole("admin"), async (req, res) => {
  const id = Number(req.params.id);
  const users = readUsers();
  const user = users.find((u) => u.id === id);
  if (!user) return res.status(404).json({ error: "User not found" });

  const { displayName, role, password, features } = req.body;
  if (displayName !== undefined) {
    if (typeof displayName !== "string" || displayName.length > 100) {
      return res.status(400).json({ error: "displayName must be a string up to 100 characters" });
    }
    user.displayName = displayName.replace(/[<>]/g, "").trim();
  }
  if (role !== undefined) user.role = role === "admin" ? "admin" : "user";
  if (password) {
    if (typeof password !== "string" || password.length < 8 || password.length > 128) {
      return res.status(400).json({ error: "Password must be 8-128 characters" });
    }
    user.password = await bcrypt.hash(password, 10);
  }
  if (Array.isArray(features)) {
    user.features = features.filter((f) => VALID_FEATURES.includes(f));
  }
  writeUsers(users);
  const { password: _, ...safe } = user;
  res.json({ success: true, user: safe });
});

// Delete user (admin only)
router.delete("/api/users/:id", checkRole("admin"), (req, res) => {
  const id = Number(req.params.id);
  const users = readUsers();
  if (users.length <= 1) {
    return res.status(400).json({ error: "Cannot delete the last user" });
  }
  const idx = users.findIndex((u) => u.id === id);
  if (idx === -1) return res.status(404).json({ error: "User not found" });
  if (users[idx].username === "admin") {
    return res.status(400).json({ error: "Cannot delete the default admin account" });
  }
  users.splice(idx, 1);
  writeUsers(users);
  res.json({ success: true });
});

// Change user password (admin or self, rate limited)
router.put("/api/users/:id/password", rateLimitSearch, async (req, res) => {
  if (!req.session.isAuthenticated) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const id = Number(req.params.id);
  const currentUser = req.session.user;
  if (currentUser.role !== "admin" && currentUser.id !== id) {
    return res.status(403).json({ error: "Cannot change another user's password" });
  }
  const { oldPassword, newPassword } = req.body;
  if (!newPassword || typeof newPassword !== "string" || newPassword.length < 8 || newPassword.length > 128) {
    return res.status(400).json({ error: "New password must be 8-128 characters" });
  }
  const users = readUsers();
  const user = users.find((u) => u.id === id);
  if (!user) return res.status(404).json({ error: "User not found" });

  if (currentUser.role !== "admin") {
    if (!oldPassword || !(await bcrypt.compare(oldPassword, user.password))) {
      return res.status(400).json({ error: "Incorrect old password" });
    }
  }
  user.password = await bcrypt.hash(newPassword, 10);
  writeUsers(users);
  res.json({ success: true });
});

export default router;
