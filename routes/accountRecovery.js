import { Router } from "express";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { readUsers, writeUsers } from "../middleware/auth.js";
import { validatePasswordStrength } from "../middleware/validation.js";
import { logAudit } from "./audit.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = Router();

const TOKENS_FILE = path.join(__dirname, "..", "password_reset_tokens.json");
const TOKEN_EXPIRY_MS = 60 * 60 * 1000; // 1 hour

function readTokens() {
  try {
    if (fs.existsSync(TOKENS_FILE)) {
      return JSON.parse(fs.readFileSync(TOKENS_FILE, "utf8"));
    }
  } catch {}
  return {};
}

function writeTokens(tokens) {
  fs.writeFileSync(TOKENS_FILE, JSON.stringify(tokens, null, 2));
}

function cleanupExpiredTokens(tokens) {
  const now = Date.now();
  for (const [token, data] of Object.entries(tokens)) {
    if (data.expiresAt < now) {
      delete tokens[token];
    }
  }
  return tokens;
}

/**
 * @swagger
 * /api/forgot-password:
 *   post:
 *     summary: Request password reset
 *     description: Generate a password reset token for a user
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [username]
 *             properties:
 *               username:
 *                 type: string
 *     responses:
 *       200:
 *         description: Reset token generated (always returns success for security)
 */
router.post("/api/forgot-password", (req, res) => {
  const { username } = req.body;

  if (!username || typeof username !== "string") {
    return res.status(400).json({ error: "Username is required" });
  }

  const users = readUsers();
  const user = users.find((u) => u.username === username.trim());

  // Always return success to prevent username enumeration
  if (!user) {
    return res.json({ success: true, message: "If the account exists, a reset token has been generated" });
  }

  // Generate secure token
  const token = crypto.randomBytes(32).toString("hex");
  let tokens = readTokens();
  tokens = cleanupExpiredTokens(tokens);

  // Remove any existing tokens for this user
  for (const [t, data] of Object.entries(tokens)) {
    if (data.userId === user.id) {
      delete tokens[t];
    }
  }

  tokens[token] = {
    userId: user.id,
    username: user.username,
    expiresAt: Date.now() + TOKEN_EXPIRY_MS,
    createdAt: new Date().toISOString(),
  };

  writeTokens(tokens);

  logAudit("password_reset_requested", {
    userId: user.id,
    username: user.username,
    ip: req.ip,
  });

  // In production, send email with reset link containing token
  // For now, return the token directly
  res.json({
    success: true,
    message: "If the account exists, a reset token has been generated",
    token, // In production, this would be sent via email
    expiresIn: "1 hour",
  });
});

/**
 * @swagger
 * /api/reset-password:
 *   post:
 *     summary: Reset password with token
 *     description: Reset a user's password using a valid reset token
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [token, newPassword]
 *             properties:
 *               token:
 *                 type: string
 *               newPassword:
 *                 type: string
 *                 minLength: 8
 *     responses:
 *       200:
 *         description: Password reset successfully
 *       400:
 *         description: Invalid or expired token
 */
router.post("/api/reset-password", validatePasswordStrength, (req, res) => {
  const { token, newPassword } = req.body;

  if (!token || typeof token !== "string") {
    return res.status(400).json({ error: "Reset token is required" });
  }

  if (!newPassword || typeof newPassword !== "string") {
    return res.status(400).json({ error: "New password is required" });
  }

  let tokens = readTokens();
  tokens = cleanupExpiredTokens(tokens);

  const tokenData = tokens[token];
  if (!tokenData) {
    return res.status(400).json({ error: "Invalid or expired reset token" });
  }

  if (tokenData.expiresAt < Date.now()) {
    delete tokens[token];
    writeTokens(tokens);
    return res.status(400).json({ error: "Invalid or expired reset token" });
  }

  const users = readUsers();
  const user = users.find((u) => u.id === tokenData.userId);

  if (!user) {
    delete tokens[token];
    writeTokens(tokens);
    return res.status(404).json({ error: "User not found" });
  }

  // Update password
  user.password = bcrypt.hashSync(newPassword, 10);
  writeUsers(users);

  // Remove used token
  delete tokens[token];
  writeTokens(tokens);

  logAudit("password_reset_completed", {
    userId: user.id,
    username: user.username,
    ip: req.ip,
  });

  res.json({ success: true, message: "Password has been reset successfully" });
});

/**
 * @swagger
 * /api/reset-password/validate:
 *   post:
 *     summary: Validate reset token
 *     description: Check if a reset token is valid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [token]
 *             properties:
 *               token:
 *                 type: string
 *     responses:
 *       200:
 *         description: Token validity status
 */
router.post("/api/reset-password/validate", (req, res) => {
  const { token } = req.body;

  if (!token || typeof token !== "string") {
    return res.status(400).json({ error: "Token is required" });
  }

  let tokens = readTokens();
  tokens = cleanupExpiredTokens(tokens);

  const tokenData = tokens[token];
  if (!tokenData || tokenData.expiresAt < Date.now()) {
    return res.json({ valid: false });
  }

  res.json({
    valid: true,
    username: tokenData.username,
    expiresAt: new Date(tokenData.expiresAt).toISOString(),
  });
});

export default router;
