import { Router } from "express";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { readUsers, writeUsers, checkAuthenticated } from "../middleware/auth.js";
import { validatePassword, validateUserInput, validatePasswordStrength, checkPasswordStrength } from "../middleware/validation.js";
import { rateLimitLogin, applyLoginDelay, resetLoginAttempts } from "../middleware/rateLimit.js";
import { logAudit } from "./audit.js";
import { trackSession, removeSession } from "./sessionManagement.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = Router();

/**
 * @swagger
 * /:
 *   get:
 *     summary: Login page
 *     description: Serves the login HTML page
 *     responses:
 *       200:
 *         description: Login page HTML
 */

/**
 * @swagger
 * /login:
 *   post:
 *     summary: Authenticate user
 *     description: Login with username and password to get a session
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
 *     responses:
 *       200:
 *         description: Redirects to /searchTavily on success
 *       401:
 *         description: Invalid credentials
 *       429:
 *         description: Too many login attempts
 *       500:
 *         description: Server error
 */
router.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "login.html"));
});

// Login handler
router.post("/login", rateLimitLogin, validateUserInput, async (req, res) => {
  const { username, password } = req.body;

  try {
    const users = readUsers();
    const user = users.find((u) => u.username === username);

    if (user && (await bcrypt.compare(password, user.password))) {
      // Reset rate limit counter on successful login
      resetLoginAttempts(req);
      // Regenerate session ID to prevent session fixation
      req.session.regenerate((err) => {
        if (err) {
          console.error("Session regeneration error:", err);
          return res.redirect("/?error=2");
        }
        req.session.isAuthenticated = true;
        req.session.user = {
          id: user.id,
          username: user.username,
          role: user.role,
          displayName: user.displayName,
          features: user.features || [],
        };
        // Rotate CSRF token after login (privilege escalation)
        req.session.csrfToken = crypto.randomBytes(32).toString("hex");
        logAudit("user_login", { userId: user.id, username: user.username, ip: req.ip });
        trackSession(req.sessionID, req.session.user, req);
        res.redirect("/searchTavily?success=1");
      });
    } else {
      // Log failed login attempt for security monitoring
      console.warn(`Failed login attempt for username: ${username} from IP: ${req.ip}`);
      logAudit("login_failed", { username, ip: req.ip });
      // Apply progressive delay before responding
      applyLoginDelay(req, res, () => {
        res.redirect("/?error=1");
      });
    }
  } catch (error) {
    console.error("Login error:", error);
    res.redirect("/?error=2");
  }
});

/**
 * @swagger
 * /logout:
 *   post:
 *     summary: Logout user
 *     description: Destroys the current session
 *     security:
 *       - sessionAuth: []
 *     responses:
 *       302:
 *         description: Redirects to login page
 */

// Logout (POST to prevent CSRF via image tags)
router.post("/logout", (req, res) => {
  const username = req.session.user?.username;
  const userId = req.session.user?.id;
  logAudit("user_logout", { userId, username, ip: req.ip });
  removeSession(req.sessionID);
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).send("Error during logout.");
    }
    res.redirect("/?logout=1");
  });
});

/**
 * @swagger
 * /api/me:
 *   get:
 *     summary: Get current user
 *     description: Returns the authenticated user's profile
 *     security:
 *       - sessionAuth: []
 *     responses:
 *       200:
 *         description: User profile
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/User'
 *       401:
 *         description: Not authenticated
 */

// Current user info
router.get("/api/me", checkAuthenticated, (req, res) => {
  res.json(req.session.user);
});

// Password strength check API (for real-time frontend feedback)
router.get("/api/password-strength", (req, res) => {
  const { password } = req.query;
  if (!password) {
    return res.json({ score: 0, level: "none", errors: [] });
  }
  const result = checkPasswordStrength(password);
  res.json(result);
});

// User stats summary
router.get("/api/me/stats", checkAuthenticated, (req, res) => {
  const userId = req.session.user.id;
  const stats = { searchCount: 0, bookmarkCount: 0, recentSearches: 0 };

  try {
    const historyFile = path.join(__dirname, "..", "search_history.json");
    if (fs.existsSync(historyFile)) {
      const history = JSON.parse(fs.readFileSync(historyFile, "utf8"));
      const userHistory = history[userId] || [];
      stats.searchCount = userHistory.length;
      const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
      stats.recentSearches = userHistory.filter((h) => h.timestamp > oneDayAgo).length;
    }
  } catch {}

  try {
    const bookmarksFile = path.join(__dirname, "..", "bookmarks.json");
    if (fs.existsSync(bookmarksFile)) {
      const bookmarks = JSON.parse(fs.readFileSync(bookmarksFile, "utf8"));
      stats.bookmarkCount = (bookmarks[userId] || []).length;
    }
  } catch {}

  res.json(stats);
});

/**
 * @swagger
 * /api/change-password:
 *   put:
 *     summary: Change password
 *     description: Change the authenticated user's password
 *     security:
 *       - sessionAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [oldPassword, newPassword]
 *             properties:
 *               oldPassword:
 *                 type: string
 *               newPassword:
 *                 type: string
 *                 minLength: 8
 *     responses:
 *       200:
 *         description: Password changed
 *       400:
 *         description: Invalid input or wrong old password
 *       401:
 *         description: Not authenticated
 *       404:
 *         description: User not found
 */

/**
 * @swagger
 * /api/me:
 *   put:
 *     summary: Update own profile
 *     description: Update the authenticated user's display name
 *     security:
 *       - sessionAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               displayName:
 *                 type: string
 *                 minLength: 1
 *                 maxLength: 50
 *     responses:
 *       200:
 *         description: Profile updated
 *       400:
 *         description: Invalid input
 *       401:
 *         description: Not authenticated
 */
router.put("/api/me", checkAuthenticated, (req, res) => {
  const { displayName } = req.body;
  if (!displayName || typeof displayName !== "string") {
    return res.status(400).json({ error: "Display name is required" });
  }
  const trimmed = displayName.trim();
  if (trimmed.length < 1 || trimmed.length > 50) {
    return res.status(400).json({ error: "Display name must be 1-50 characters" });
  }

  const users = readUsers();
  const user = users.find((u) => u.id === req.session.user.id);
  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }

  user.displayName = trimmed;
  writeUsers(users);
  req.session.user.displayName = trimmed;
  res.json({ success: true, displayName: trimmed });
});

// Change own password
router.put("/api/change-password", checkAuthenticated, validatePassword, validatePasswordStrength, async (req, res) => {
  const { oldPassword, newPassword } = req.body;
  const users = readUsers();
  const user = users.find((u) => u.id === req.session.user.id);
  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }
  const match = await bcrypt.compare(oldPassword, user.password);
  if (!match) {
    return res.status(400).json({ error: "Incorrect old password" });
  }
  user.password = await bcrypt.hash(newPassword, 10);
  writeUsers(users);
  // Rotate CSRF token after password change (privilege escalation)
  req.session.csrfToken = crypto.randomBytes(32).toString("hex");
  logAudit("password_changed", { userId: user.id, username: user.username, ip: req.ip });
  res.json({ success: true });
});

/**
 * @swagger
 * /api/session-ping:
 *   post:
 *     summary: Extend session
 *     description: Updates session activity timestamp to prevent timeout
 *     security:
 *       - sessionAuth: []
 *     responses:
 *       200:
 *         description: Session extended
 *       401:
 *         description: Not authenticated
 */
router.post("/api/session-ping", checkAuthenticated, (req, res) => {
  req.session.lastActivity = Date.now();
  res.json({ success: true });
});

export default router;
