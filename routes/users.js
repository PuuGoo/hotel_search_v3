import { Router } from "express";
import bcrypt from "bcryptjs";
import { readUsers, writeUsers, checkRole, VALID_FEATURES } from "../middleware/auth.js";
import { validateUserInput, validatePasswordStrength, checkPasswordStrength } from "../middleware/validation.js";
import { rateLimitSearch, rateLimitLogin } from "../middleware/rateLimit.js";
import { logAudit } from "./audit.js";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = Router();

/**
 * @swagger
 * /admin:
 *   get:
 *     summary: Admin panel
 *     description: Serves the admin HTML page (admin only)
 *     security:
 *       - sessionAuth: []
 *     responses:
 *       200:
 *         description: Admin page HTML
 *       403:
 *         description: Not an admin
 */

/**
 * @swagger
 * /api/users:
 *   get:
 *     summary: List users
 *     description: Returns all users (admin only)
 *     security:
 *       - sessionAuth: []
 *     responses:
 *       200:
 *         description: List of users
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/User'
 *       403:
 *         description: Not an admin
 */

// Admin page
router.get("/admin", checkRole("admin"), (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "admin.html"));
});

// List users (admin only)
router.get("/api/users", checkRole("admin"), (_req, res) => {
  const users = readUsers().map(({ password: _pw, ...u }) => u);
  res.json(users);
});

/**
 * @swagger
 * /api/users:
 *   post:
 *     summary: Create user
 *     description: Create a new user (admin only)
 *     security:
 *       - sessionAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [username, password]
 *             properties:
 *               username:
 *                 type: string
 *               password:
 *                 type: string
 *                 minLength: 8
 *               displayName:
 *                 type: string
 *               role:
 *                 type: string
 *                 enum: [admin, user]
 *               features:
 *                 type: array
 *                 items:
 *                   type: string
 *                   enum: [tavily, ddg, case12]
 *     responses:
 *       200:
 *         description: User created
 *       400:
 *         description: Username already exists or invalid input
 *       403:
 *         description: Not an admin
 */

// Create user (admin only, rate limited)
router.post("/api/users", checkRole("admin"), rateLimitSearch, validateUserInput, validatePasswordStrength, async (req, res) => {
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
  logAudit("user_created", { userId: req.session.user?.id, username: req.session.user?.username, ip: req.ip, target: username });
  const { password: _, ...safe } = newUser;
  res.json({ success: true, user: safe });
});

/**
 * @swagger
 * /api/users/{id}:
 *   put:
 *     summary: Update user
 *     description: Update user details (admin only)
 *     security:
 *       - sessionAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               displayName:
 *                 type: string
 *               role:
 *                 type: string
 *                 enum: [admin, user]
 *               password:
 *                 type: string
 *                 minLength: 8
 *               features:
 *                 type: array
 *                 items:
 *                   type: string
 *                   enum: [tavily, ddg, case12]
 *     responses:
 *       200:
 *         description: User updated
 *       400:
 *         description: Invalid input
 *       404:
 *         description: User not found
 *   delete:
 *     summary: Delete user
 *     description: Delete a user (admin only, cannot delete last admin)
 *     security:
 *       - sessionAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: User deleted
 *       400:
 *         description: Cannot delete last user or default admin
 *       404:
 *         description: User not found
 */

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
    const { errors } = checkPasswordStrength(password);
    if (errors.length > 0) {
      return res.status(400).json({ error: "Password does not meet strength requirements", requirements: errors });
    }
    user.password = await bcrypt.hash(password, 10);
  }
  if (Array.isArray(features)) {
    user.features = features.filter((f) => VALID_FEATURES.includes(f));
  }
  writeUsers(users);
  logAudit("user_updated", { userId: req.session.user?.id, username: req.session.user?.username, ip: req.ip, target: user.username, detail: `Updated user #${id}` });
  const { password: _, ...safe } = user;
  res.json({ success: true, user: safe });
});

// Delete user (admin only) - annotation on parent PUT block
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
  const deletedUsername = users[idx].username;
  users.splice(idx, 1);
  writeUsers(users);
  logAudit("user_deleted", { userId: req.session.user?.id, username: req.session.user?.username, ip: req.ip, target: deletedUsername });
  res.json({ success: true });
});

// Change user password (admin or self, rate limited)
router.put("/api/users/:id/password", rateLimitLogin, validatePasswordStrength, async (req, res) => {
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

// Admin: get user's bookmarks
router.get("/api/users/:id/bookmarks", checkRole("admin"), (req, res) => {
  const userId = Number(req.params.id);
  const bookmarksFile = path.join(__dirname, "..", "bookmarks.json");
  try {
    const allBookmarks = fs.existsSync(bookmarksFile)
      ? JSON.parse(fs.readFileSync(bookmarksFile, "utf8"))
      : {};
    const userBookmarks = allBookmarks[userId] || [];
    res.json({ bookmarks: userBookmarks, total: userBookmarks.length });
  } catch (e) {
    console.error("Error reading user bookmarks:", e.message);
    res.json({ bookmarks: [], total: 0 });
  }
});

// Admin: get user's search history
router.get("/api/users/:id/history", checkRole("admin"), (req, res) => {
  const userId = Number(req.params.id);
  const historyFile = path.join(__dirname, "..", "search_history.json");
  try {
    const allHistory = fs.existsSync(historyFile)
      ? JSON.parse(fs.readFileSync(historyFile, "utf8"))
      : {};
    const userHistory = allHistory[userId] || [];
    res.json({ history: userHistory, total: userHistory.length });
  } catch (e) {
    console.error("Error reading user history:", e.message);
    res.json({ history: [], total: 0 });
  }
});

export default router;
