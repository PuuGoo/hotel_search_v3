import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { decrypt } from "./crypto.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const KEYS_FILE = path.join(__dirname, "..", "api_keys.json");

let cachedKeys = null;
let lastModified = 0;

function readManagedKeys() {
  try {
    if (!fs.existsSync(KEYS_FILE)) {
      return null;
    }
    const stat = fs.statSync(KEYS_FILE);
    if (stat.mtimeMs === lastModified && cachedKeys) {
      return cachedKeys;
    }
    const data = JSON.parse(fs.readFileSync(KEYS_FILE, "utf8"));
    // Decrypt keys on read
    for (const provider of Object.keys(data)) {
      if (data[provider].keys) {
        data[provider].keys = data[provider].keys.map(k => decrypt(k));
      }
    }
    cachedKeys = data;
    lastModified = stat.mtimeMs;
    return cachedKeys;
  } catch (e) {
    console.error("Error reading managed API keys:", e.message);
    return null;
  }
}

export function getActiveKey(provider) {
  const data = readManagedKeys();
  if (!data || !data[provider] || !data[provider].keys || data[provider].keys.length === 0) {
    return null;
  }
  const activeIndex = data[provider].activeIndex || 0;
  return data[provider].keys[activeIndex] || null;
}

export function getAllKeys(provider) {
  const data = readManagedKeys();
  if (!data || !data[provider] || !data[provider].keys) {
    return [];
  }
  return data[provider].keys;
}
