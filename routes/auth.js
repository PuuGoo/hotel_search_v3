import { Router } from "express";
import bcrypt from "bcryptjs";
import path from "path";
import { fileURLToPath } from "url";
import { readUsers, writeUsers, checkAuthenticated } from "../middleware/auth.js";
import { validatePassword, validateUserInput } from "../middleware/validation.js";
import { rateLimitLogin } from "../middleware/rateLimit.js";

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
        res.redirect("/searchTavily?success=1");
      });
    } else {
      // Log failed login attempt for security monitoring
      console.warn(`Failed login attempt for username: ${username} from IP: ${req.ip}`);
      res.redirect("/?error=1");
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

// Change own password
router.put("/api/change-password", checkAuthenticated, validatePassword, async (req, res) => {
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
  res.json({ success: true });
});

export default router;
