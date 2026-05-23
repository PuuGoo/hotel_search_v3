import { Router } from "express";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { checkAuthenticated, readUsers, writeUsers } from "../middleware/auth.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TOTP_FILE = path.join(__dirname, "..", "totp_secrets.json");

const router = Router();

// TOTP configuration
const TOTP_DIGITS = 6;
const TOTP_PERIOD = 30; // seconds
const TOTP_ALGORITHM = "sha1";

function readSecrets() {
  try {
    if (fs.existsSync(TOTP_FILE)) {
      return JSON.parse(fs.readFileSync(TOTP_FILE, "utf8"));
    }
  } catch (e) {
    console.error("Error reading TOTP secrets:", e.message);
  }
  return {};
}

function writeSecrets(data) {
  fs.writeFileSync(TOTP_FILE, JSON.stringify(data, null, 2));
}

// Generate a random base32 secret
function generateSecret() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let secret = "";
  const bytes = crypto.randomBytes(20);
  for (let i = 0; i < bytes.length; i++) {
    secret += chars[bytes[i] % 32];
  }
  return secret;
}

// Base32 decode
function base32Decode(str) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of str.toUpperCase()) {
    const val = chars.indexOf(c);
    if (val === -1) continue;
    bits += val.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

// Generate TOTP code
function generateTOTP(secret, timeOffset = 0) {
  const key = base32Decode(secret);
  const time = Math.floor(Date.now() / 1000 / TOTP_PERIOD) + timeOffset;

  // Convert time to 8-byte buffer (big-endian)
  const timeBuffer = Buffer.alloc(8);
  timeBuffer.writeUInt32BE(Math.floor(time / 0x100000000), 0);
  timeBuffer.writeUInt32BE(time & 0xffffffff, 4);

  // HMAC-SHA1
  const hmac = crypto.createHmac(TOTP_ALGORITHM, key);
  hmac.update(timeBuffer);
  const hash = hmac.digest();

  // Dynamic truncation
  const offset = hash[hash.length - 1] & 0x0f;
  const code = (
    ((hash[offset] & 0x7f) << 24) |
    ((hash[offset + 1] & 0xff) << 16) |
    ((hash[offset + 2] & 0xff) << 8) |
    (hash[offset + 3] & 0xff)
  ) % Math.pow(10, TOTP_DIGITS);

  return code.toString().padStart(TOTP_DIGITS, "0");
}

// Verify TOTP code (allows 1 period drift)
function verifyTOTP(secret, code) {
  for (let drift = -1; drift <= 1; drift++) {
    if (generateTOTP(secret, drift) === code) {
      return true;
    }
  }
  return false;
}

// Generate otpauth:// URI for QR code
function generateOTPAuthURI(secret, username) {
  return `otpauth://totp/HotelSearch:${encodeURIComponent(username)}?secret=${secret}&issuer=HotelSearch&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_PERIOD}`;
}

// POST /api/2fa/setup — generate secret and QR URI
router.post("/api/2fa/setup", checkAuthenticated, (req, res) => {
  const userId = req.session.user.id;
  const username = req.session.user.username;

  const secret = generateSecret();
  const secrets = readSecrets();

  secrets[userId] = {
    secret,
    enabled: false,
    createdAt: Date.now(),
  };

  writeSecrets(secrets);

  const uri = generateOTPAuthURI(secret, username);

  res.json({
    secret,
    uri,
    message: "Scan the QR code with your authenticator app, then verify with /api/2fa/verify",
  });
});

// POST /api/2fa/verify — verify a code and enable 2FA
router.post("/api/2fa/verify", checkAuthenticated, (req, res) => {
  const { code } = req.body;
  const userId = req.session.user.id;

  if (!code || typeof code !== "string" || code.length !== TOTP_DIGITS) {
    return res.status(400).json({ error: "Invalid code format" });
  }

  const secrets = readSecrets();
  const userSecret = secrets[userId];

  if (!userSecret) {
    return res.status(400).json({ error: "2FA not set up. Call /api/2fa/setup first" });
  }

  if (verifyTOTP(userSecret.secret, code)) {
    userSecret.enabled = true;
    userSecret.verifiedAt = Date.now();
    writeSecrets(secrets);

    // Mark user as having 2FA enabled
    const users = readUsers();
    const user = users.find((u) => u.id === userId);
    if (user) {
      user.twoFactorEnabled = true;
      writeUsers(users);
    }

    req.session.user.twoFactorEnabled = true;

    res.json({ success: true, message: "2FA enabled successfully" });
  } else {
    res.status(400).json({ error: "Invalid code" });
  }
});

// POST /api/2fa/disable — disable 2FA
router.post("/api/2fa/disable", checkAuthenticated, (req, res) => {
  const { code } = req.body;
  const userId = req.session.user.id;

  const secrets = readSecrets();
  const userSecret = secrets[userId];

  if (!userSecret || !userSecret.enabled) {
    return res.status(400).json({ error: "2FA is not enabled" });
  }

  // Require current code to disable
  if (!code || !verifyTOTP(userSecret.secret, code)) {
    return res.status(400).json({ error: "Valid code required to disable 2FA" });
  }

  delete secrets[userId];
  writeSecrets(secrets);

  const users = readUsers();
  const user = users.find((u) => u.id === userId);
  if (user) {
    user.twoFactorEnabled = false;
    writeUsers(users);
  }

  req.session.user.twoFactorEnabled = false;

  res.json({ success: true, message: "2FA disabled" });
});

// POST /api/2fa/login-verify — verify 2FA during login
router.post("/api/2fa/login-verify", (req, res) => {
  const { code, tempToken } = req.body;

  if (!code || !tempToken) {
    return res.status(400).json({ error: "Code and tempToken required" });
  }

  // tempToken is the session ID stored during login
  // In a real app, you'd use a separate temp token store
  // For simplicity, we check if the session exists and has pending 2FA
  if (!req.session.pending2FA) {
    return res.status(400).json({ error: "No pending 2FA verification" });
  }

  const userId = req.session.pending2FA.userId;
  const secrets = readSecrets();
  const userSecret = secrets[userId];

  if (!userSecret || !userSecret.enabled) {
    return res.status(400).json({ error: "2FA not enabled for this user" });
  }

  if (verifyTOTP(userSecret.secret, code)) {
    // Complete login
    req.session.isAuthenticated = true;
    req.session.user = req.session.pending2FA.userInfo;
    delete req.session.pending2FA;

    res.json({ success: true });
  } else {
    res.status(400).json({ error: "Invalid code" });
  }
});

// GET /api/2fa/status — check 2FA status
router.get("/api/2fa/status", checkAuthenticated, (req, res) => {
  const userId = req.session.user.id;
  const secrets = readSecrets();
  const userSecret = secrets[userId];

  res.json({
    enabled: userSecret?.enabled || false,
    setupPending: !!(userSecret && !userSecret.enabled),
  });
});

// Export for use in auth flow
export function is2FAEnabled(userId) {
  const secrets = readSecrets();
  const userSecret = secrets[userId];
  return userSecret?.enabled || false;
}

export function verify2FACode(userId, code) {
  const secrets = readSecrets();
  const userSecret = secrets[userId];
  if (!userSecret || !userSecret.enabled) return false;
  return verifyTOTP(userSecret.secret, code);
}

export default router;
