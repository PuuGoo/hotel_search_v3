// Data encryption manager routes

import { Router } from "express";
import { checkAuthenticated, checkRole } from "../middleware/auth.js";
import {
  generateKey,
  getKeys,
  getKey,
  rotateKey,
  revokeKey,
  deleteKey,
  encryptData,
  decryptData,
  getEncryptionStats,
  getOperationHistory,
  clearEncryptionData,
} from "../utils/dataEncryption.js";

const router = Router();

/**
 * POST /api/encryption/keys
 * Generate an encryption key (admin only).
 */
router.post("/api/encryption/keys", checkAuthenticated, checkRole("admin"), (req, res) => {
  const key = generateKey({
    ...req.body,
    userId: req.session.user?.id,
  });
  res.status(201).json(key);
});

/**
 * GET /api/encryption/keys
 * Get all keys.
 */
router.get("/api/encryption/keys", checkAuthenticated, checkRole("admin"), (_req, res) => {
  const result = getKeys();
  res.json(result);
});

/**
 * GET /api/encryption/stats
 * Get encryption statistics.
 */
router.get("/api/encryption/stats", checkAuthenticated, checkRole("admin"), (_req, res) => {
  const stats = getEncryptionStats();
  res.json(stats);
});

/**
 * GET /api/encryption/operations
 * Get operation history.
 */
router.get("/api/encryption/operations", checkAuthenticated, checkRole("admin"), (req, res) => {
  const limit = req.query.limit ? parseInt(req.query.limit) : 50;
  const history = getOperationHistory(limit);
  res.json(history);
});

/**
 * POST /api/encryption/encrypt
 * Encrypt data (admin only).
 */
router.post("/api/encryption/encrypt", checkAuthenticated, checkRole("admin"), (req, res) => {
  const { plaintext, keyId } = req.body;
  if (!plaintext || !keyId) {
    return res.status(400).json({ error: "plaintext and keyId are required", code: 400 });
  }
  const result = encryptData(plaintext, keyId);
  if (result.error) {
    return res.status(400).json({ error: result.error, code: 400 });
  }
  res.json(result);
});

/**
 * POST /api/encryption/decrypt
 * Decrypt data (admin only).
 */
router.post("/api/encryption/decrypt", checkAuthenticated, checkRole("admin"), (req, res) => {
  const { encrypted, keyId, iv } = req.body;
  if (!encrypted || !keyId || !iv) {
    return res.status(400).json({ error: "encrypted, keyId, and iv are required", code: 400 });
  }
  const result = decryptData(encrypted, keyId, iv);
  if (result.error) {
    return res.status(400).json({ error: result.error, code: 400 });
  }
  res.json(result);
});

/**
 * POST /api/encryption/keys/:id/rotate
 * Rotate a key (admin only).
 */
router.post("/api/encryption/keys/:id/rotate", checkAuthenticated, checkRole("admin"), (req, res) => {
  const key = rotateKey(req.params.id, req.session.user?.id);
  if (!key) {
    return res.status(404).json({ error: "Key not found", code: 404 });
  }
  res.json(key);
});

/**
 * POST /api/encryption/keys/:id/revoke
 * Revoke a key (admin only).
 */
router.post("/api/encryption/keys/:id/revoke", checkAuthenticated, checkRole("admin"), (req, res) => {
  const key = revokeKey(req.params.id);
  if (!key) {
    return res.status(404).json({ error: "Key not found", code: 404 });
  }
  res.json(key);
});

/**
 * DELETE /api/encryption/clear
 * Clear encryption data (admin only).
 */
router.delete("/api/encryption/clear", checkAuthenticated, checkRole("admin"), (_req, res) => {
  clearEncryptionData();
  res.json({ message: "Encryption data cleared" });
});

/**
 * GET /api/encryption/keys/:id
 * Get a specific key.
 */
router.get("/api/encryption/keys/:id", checkAuthenticated, checkRole("admin"), (req, res) => {
  const key = getKey(req.params.id);
  if (!key) {
    return res.status(404).json({ error: "Key not found", code: 404 });
  }
  res.json(key);
});

/**
 * DELETE /api/encryption/keys/:id
 * Delete a key (admin only).
 */
router.delete("/api/encryption/keys/:id", checkAuthenticated, checkRole("admin"), (req, res) => {
  const deleted = deleteKey(req.params.id);
  if (!deleted) {
    return res.status(404).json({ error: "Key not found", code: 404 });
  }
  res.json({ message: "Key deleted" });
});

export default router;
