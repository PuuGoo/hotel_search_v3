// Data encryption manager — manage encryption keys and encrypted data

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_FILE = path.join(__dirname, "..", "data_encryption.json");
const MAX_KEYS = 50;
const MAX_OPERATIONS = 1000;

function readJSON(filePath) {
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch { /* ignore */ }
  return { keys: [], operations: [] };
}

function writeJSON(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  } catch { /* ignore */ }
}

/**
 * Generate an encryption key.
 */
export function generateKey(options = {}) {
  const data = readJSON(DATA_FILE);
  if (!data.keys) data.keys = [];

  const keyLength = options.keyLength || 32;
  const key = crypto.randomBytes(keyLength).toString("hex");

  const keyEntry = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name: options.name,
    algorithm: options.algorithm || "aes-256-cbc",
    keyLength,
    key, // In production, store encrypted or in KMS
    status: "active", // "active", "rotated", "revoked"
    createdAt: Date.now(),
    rotatedAt: null,
    author: options.userId || "system",
  };

  data.keys.unshift(keyEntry);
  if (data.keys.length > MAX_KEYS) data.keys.length = MAX_KEYS;

  writeJSON(DATA_FILE, data);
  return { ...keyEntry, key: key.slice(0, 8) + "..." }; // Mask key in response
}

/**
 * Get all keys.
 */
export function getKeys() {
  const data = readJSON(DATA_FILE);
  return {
    keys: (data.keys || []).map((k) => ({ ...k, key: k.key.slice(0, 8) + "..." })),
    count: (data.keys || []).length,
  };
}

/**
 * Get a specific key.
 */
export function getKey(keyId) {
  const data = readJSON(DATA_FILE);
  const key = (data.keys || []).find((k) => k.id === keyId);
  if (!key) return null;
  return { ...key, key: key.key.slice(0, 8) + "..." };
}

/**
 * Rotate a key — generate new key, mark old as rotated.
 */
export function rotateKey(keyId, userId) {
  const data = readJSON(DATA_FILE);
  const index = (data.keys || []).findIndex((k) => k.id === keyId);
  if (index === -1) return null;

  const oldKey = data.keys[index];
  oldKey.status = "rotated";
  oldKey.rotatedAt = Date.now();

  // Generate new key
  const newKeyLength = oldKey.keyLength;
  const newKeyValue = crypto.randomBytes(newKeyLength).toString("hex");
  const newKey = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name: oldKey.name,
    algorithm: oldKey.algorithm,
    keyLength: newKeyLength,
    key: newKeyValue,
    status: "active",
    createdAt: Date.now(),
    rotatedAt: null,
    rotatedFrom: keyId,
    author: userId || "system",
  };

  data.keys.unshift(newKey);
  writeJSON(DATA_FILE, data);
  return { ...newKey, key: newKeyValue.slice(0, 8) + "..." };
}

/**
 * Revoke a key.
 */
export function revokeKey(keyId) {
  const data = readJSON(DATA_FILE);
  const key = (data.keys || []).find((k) => k.id === keyId);
  if (!key) return null;

  key.status = "revoked";
  writeJSON(DATA_FILE, data);
  return { ...key, key: key.key.slice(0, 8) + "..." };
}

/**
 * Delete a key.
 */
export function deleteKey(keyId) {
  const data = readJSON(DATA_FILE);
  const index = (data.keys || []).findIndex((k) => k.id === keyId);
  if (index === -1) return false;

  data.keys.splice(index, 1);
  writeJSON(DATA_FILE, data);
  return true;
}

/**
 * Encrypt data.
 */
export function encryptData(plaintext, keyId) {
  const data = readJSON(DATA_FILE);
  const key = (data.keys || []).find((k) => k.id === keyId && k.status === "active");
  if (!key) return { error: "Active key not found" };

  try {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(key.algorithm, Buffer.from(key.key, "hex").slice(0, 32), iv);
    let encrypted = cipher.update(plaintext, "utf8", "hex");
    encrypted += cipher.final("hex");

    // Record operation
    recordOperation("encrypt", keyId);

    return { encrypted, iv: iv.toString("hex"), algorithm: key.algorithm };
  } catch (e) {
    return { error: "Encryption failed: " + e.message };
  }
}

/**
 * Decrypt data.
 */
export function decryptData(encrypted, keyId, iv) {
  const data = readJSON(DATA_FILE);
  const key = (data.keys || []).find((k) => k.id === keyId);
  if (!key) return { error: "Key not found" };

  try {
    const decipher = crypto.createDecipheriv(key.algorithm, Buffer.from(key.key, "hex").slice(0, 32), Buffer.from(iv, "hex"));
    let decrypted = decipher.update(encrypted, "hex", "utf8");
    decrypted += decipher.final("utf8");

    // Record operation
    recordOperation("decrypt", keyId);

    return { decrypted };
  } catch (e) {
    return { error: "Decryption failed: " + e.message };
  }
}

function recordOperation(type, keyId) {
  const data = readJSON(DATA_FILE);
  if (!data.operations) data.operations = [];

  data.operations.unshift({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    type,
    keyId,
    timestamp: Date.now(),
  });
  if (data.operations.length > MAX_OPERATIONS) data.operations.length = MAX_OPERATIONS;

  writeJSON(DATA_FILE, data);
}

/**
 * Get encryption statistics.
 */
export function getEncryptionStats() {
  const data = readJSON(DATA_FILE);
  const keys = data.keys || [];
  const operations = data.operations || [];

  return {
    totalKeys: keys.length,
    activeKeys: keys.filter((k) => k.status === "active").length,
    rotatedKeys: keys.filter((k) => k.status === "rotated").length,
    revokedKeys: keys.filter((k) => k.status === "revoked").length,
    totalOperations: operations.length,
    encryptOperations: operations.filter((o) => o.type === "encrypt").length,
    decryptOperations: operations.filter((o) => o.type === "decrypt").length,
  };
}

/**
 * Get operation history.
 */
export function getOperationHistory(limit = 50) {
  const data = readJSON(DATA_FILE);
  return { operations: (data.operations || []).slice(0, limit), total: (data.operations || []).length };
}

/**
 * Clear encryption data.
 */
export function clearEncryptionData() {
  writeJSON(DATA_FILE, { keys: [], operations: [] });
}
