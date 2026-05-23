import { Router } from "express";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { checkAuthenticated } from "../middleware/auth.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SHARES_FILE = path.join(__dirname, "..", "shares.json");
const MAX_SHARES_PER_USER = 50;
const SHARE_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const router = Router();

function readShares() {
  try {
    if (fs.existsSync(SHARES_FILE)) {
      return JSON.parse(fs.readFileSync(SHARES_FILE, "utf8"));
    }
  } catch (e) {
    console.error("Error reading shares.json:", e.message);
  }
  return {};
}

function writeShares(data) {
  fs.writeFileSync(SHARES_FILE, JSON.stringify(data, null, 2), "utf8");
}

function generateToken() {
  return crypto.randomBytes(8).toString("hex");
}

/**
 * @swagger
 * /api/shares:
 *   post:
 *     summary: Create a shareable link
 *     description: Generate a shareable link for search results
 *     security:
 *       - sessionAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [query, engine, results]
 *             properties:
 *               query:
 *                 type: string
 *               engine:
 *                 type: string
 *                 enum: [tavily, google, ddg]
 *               results:
 *                 type: array
 *                 items:
 *                   type: object
 *     responses:
 *       200:
 *         description: Share created with token
 *       400:
 *         description: Missing required fields
 *       401:
 *         description: Not authenticated
 */
router.post("/api/shares", checkAuthenticated, (req, res) => {
  const userId = req.session.user.id;
  const { query, engine, results } = req.body;

  if (!query || typeof query !== "string") {
    return res.status(400).json({ error: "Thiếu query" });
  }
  if (!engine || !["tavily", "google", "ddg"].includes(engine)) {
    return res.status(400).json({ error: "Engine không hợp lệ" });
  }
  if (!Array.isArray(results)) {
    return res.status(400).json({ error: "Thiếu results" });
  }

  const allShares = readShares();
  if (!allShares[userId]) {
    allShares[userId] = [];
  }

  if (allShares[userId].length >= MAX_SHARES_PER_USER) {
    return res.status(400).json({ error: `Tối đa ${MAX_SHARES_PER_USER} link chia sẻ` });
  }

  // Clean expired shares for this user
  const now = Date.now();
  allShares[userId] = allShares[userId].filter((s) => now - s.createdAt < SHARE_EXPIRY_MS);

  const token = generateToken();
  const share = {
    token,
    userId,
    username: req.session.user.username,
    query: query.replace(/[<>]/g, "").trim().slice(0, 500),
    engine,
    results: results.slice(0, 50).map((r) => ({
      title: (r.title || "").replace(/[<>]/g, "").trim().slice(0, 500),
      url: (r.url || "").trim().slice(0, 2000),
      snippet: (r.snippet || "").replace(/[<>]/g, "").trim().slice(0, 1000),
    })),
    viewCount: 0,
    createdAt: now,
    expiresAt: now + SHARE_EXPIRY_MS,
  };

  allShares[userId].push(share);
  writeShares(allShares);

  res.json({ success: true, token, url: `/share/${token}` });
});

/**
 * @swagger
 * /api/shares:
 *   get:
 *     summary: List user's shares
 *     description: Returns all active shares for the authenticated user
 *     security:
 *       - sessionAuth: []
 *     responses:
 *       200:
 *         description: List of shares
 *       401:
 *         description: Not authenticated
 */
router.get("/api/shares", checkAuthenticated, (req, res) => {
  const userId = req.session.user.id;
  const allShares = readShares();
  const now = Date.now();

  const userShares = (allShares[userId] || [])
    .filter((s) => now < s.expiresAt)
    .map((s) => ({
      token: s.token,
      query: s.query,
      engine: s.engine,
      resultCount: s.results.length,
      viewCount: s.viewCount,
      createdAt: s.createdAt,
      expiresAt: s.expiresAt,
    }));

  res.json({ shares: userShares });
});

/**
 * @swagger
 * /api/shares/{token}:
 *   delete:
 *     summary: Delete a share
 *     description: Delete a specific share by token
 *     security:
 *       - sessionAuth: []
 *     parameters:
 *       - in: path
 *         name: token
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Share deleted
 *       404:
 *         description: Share not found
 */
router.delete("/api/shares/:token", checkAuthenticated, (req, res) => {
  const userId = req.session.user.id;
  const { token } = req.params;

  const allShares = readShares();
  const userShares = allShares[userId] || [];
  const idx = userShares.findIndex((s) => s.token === token);

  if (idx === -1) {
    return res.status(404).json({ error: "Không tìm thấy link chia sẻ" });
  }

  userShares.splice(idx, 1);
  allShares[userId] = userShares;
  writeShares(allShares);
  res.json({ success: true });
});

/**
 * @swagger
 * /share/{token}:
 *   get:
 *     summary: View shared results
 *     description: Public endpoint to view shared search results
 *     parameters:
 *       - in: path
 *         name: token
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Shared results page
 *       404:
 *         description: Share not found or expired
 */
router.get("/api/shares/view/:token", (req, res) => {
  const { token } = req.params;
  const allShares = readShares();
  const now = Date.now();

  for (const userShares of Object.values(allShares)) {
    const share = userShares.find((s) => s.token === token);
    if (share) {
      if (now >= share.expiresAt) {
        return res.status(404).json({ error: "Link chia sẻ đã hết hạn" });
      }
      share.viewCount = (share.viewCount || 0) + 1;
      writeShares(allShares);
      return res.json({
        query: share.query,
        engine: share.engine,
        results: share.results,
        sharedBy: share.username,
        viewCount: share.viewCount,
        createdAt: share.createdAt,
      });
    }
  }

  res.status(404).json({ error: "Không tìm thấy link chia sẻ" });
});

export default router;
