import { Router } from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { checkAuthenticated, checkRole } from "../middleware/auth.js";
import { logAudit } from "./audit.js";
import { encrypt, decrypt } from "../utils/crypto.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const KEYS_FILE = path.join(__dirname, "..", "api_keys.json");

const router = Router();

const DEFAULT_PROVIDERS = {
  tavily: { name: "Tavily", keys: [], activeIndex: 0 },
  google: { name: "Google", keys: [], activeIndex: 0 },
};

function readKeys() {
  try {
    if (fs.existsSync(KEYS_FILE)) {
      const data = JSON.parse(fs.readFileSync(KEYS_FILE, "utf8"));
      // Decrypt keys on read
      for (const provider of Object.keys(data)) {
        if (data[provider].keys) {
          data[provider].keys = data[provider].keys.map(k => decrypt(k));
        }
      }
      return data;
    }
  } catch (e) {
    console.error("Error reading API keys:", e.message);
  }
  return { ...DEFAULT_PROVIDERS };
}

function writeKeys(data) {
  // Encrypt keys before writing
  const encrypted = {};
  for (const [provider, info] of Object.entries(data)) {
    encrypted[provider] = {
      ...info,
      keys: (info.keys || []).map(k => encrypt(k)),
    };
  }
  fs.writeFileSync(KEYS_FILE, JSON.stringify(encrypted, null, 2), { mode: 0o600 });
}

function maskKey(key) {
  if (!key || key.length < 8) return "****";
  return key.slice(0, 4) + "****" + key.slice(-4);
}

// GET /api/admin/api-keys — list all providers and masked keys
router.get("/api/admin/api-keys", checkAuthenticated, checkRole("admin"), (_req, res) => {
  const data = readKeys();
  const result = {};

  for (const [provider, info] of Object.entries(data)) {
    result[provider] = {
      name: info.name || provider,
      keys: (info.keys || []).map((k, i) => ({
        index: i,
        masked: maskKey(k),
        active: i === (info.activeIndex || 0),
      })),
      activeIndex: info.activeIndex || 0,
    };
  }

  res.json(result);
});

// POST /api/admin/api-keys/:provider — add a new key
router.post("/api/admin/api-keys/:provider", checkAuthenticated, checkRole("admin"), (req, res) => {
  const { provider } = req.params;
  const { key } = req.body;

  if (!key || typeof key !== "string" || key.trim().length < 4) {
    return res.status(400).json({ error: "Valid API key required" });
  }

  const data = readKeys();
  if (!data[provider]) {
    data[provider] = { name: provider, keys: [], activeIndex: 0 };
  }

  // Check for duplicate
  if (data[provider].keys.includes(key.trim())) {
    return res.status(409).json({ error: "Key already exists" });
  }

  data[provider].keys.push(key.trim());
  writeKeys(data);

  logAudit("api_key_added", {
    userId: req.session.user?.id,
    username: req.session.user?.username,
    ip: req.ip,
    detail: `Provider: ${provider}`,
  });

  res.json({
    success: true,
    index: data[provider].keys.length - 1,
    masked: maskKey(key.trim()),
  });
});

// PUT /api/admin/api-keys/:provider/active — set active key index
router.put("/api/admin/api-keys/:provider/active", checkAuthenticated, checkRole("admin"), (req, res) => {
  const { provider } = req.params;
  const { index } = req.body;

  const data = readKeys();
  if (!data[provider] || !data[provider].keys[index]) {
    return res.status(404).json({ error: "Key not found" });
  }

  data[provider].activeIndex = index;
  writeKeys(data);

  logAudit("api_key_activated", {
    userId: req.session.user?.id,
    username: req.session.user?.username,
    ip: req.ip,
    detail: `Provider: ${provider}, Index: ${index}`,
  });

  res.json({ success: true, activeIndex: index });
});

// DELETE /api/admin/api-keys/:provider/:index — remove a key
router.delete("/api/admin/api-keys/:provider/:index", checkAuthenticated, checkRole("admin"), (req, res) => {
  const { provider, index } = req.params;
  const idx = parseInt(index);

  const data = readKeys();
  if (!data[provider] || !data[provider].keys[idx]) {
    return res.status(404).json({ error: "Key not found" });
  }

  data[provider].keys.splice(idx, 1);

  // Adjust active index
  if (data[provider].activeIndex >= data[provider].keys.length) {
    data[provider].activeIndex = Math.max(0, data[provider].keys.length - 1);
  }
  if (data[provider].activeIndex === idx) {
    data[provider].activeIndex = 0;
  } else if (data[provider].activeIndex > idx) {
    data[provider].activeIndex--;
  }

  writeKeys(data);

  logAudit("api_key_removed", {
    userId: req.session.user?.id,
    username: req.session.user?.username,
    ip: req.ip,
    detail: `Provider: ${provider}, Index: ${idx}`,
  });

  res.json({ success: true, remaining: data[provider].keys.length });
});

// POST /api/admin/api-keys/:provider/test — test a key with real API call
router.post("/api/admin/api-keys/:provider/test", checkAuthenticated, checkRole("admin"), async (req, res) => {
  const { provider } = req.params;
  const inputKey = req.body?.key;

  console.log("[TEST] provider:", provider, "body:", JSON.stringify(req.body), "inputKey:", inputKey);

  // Use input key if provided, otherwise use active key from file
  let key = inputKey;
  let activeIdx = 0;

  if (!key) {
    const data = readKeys();
    if (!data[provider] || data[provider].keys.length === 0) {
      return res.status(404).json({ error: "No keys configured. Enter a key first." });
    }
    activeIdx = data[provider].activeIndex || 0;
    key = data[provider].keys[activeIdx];
  }

  if (!key) {
    return res.status(404).json({ error: "No key to test" });
  }

  let valid = false;
  let message = "";
  let results = [];

  try {
    if (provider === "tavily") {
      const { tavily } = await import("@tavily/core");
      const client = tavily({ apiKey: key });
      const response = await client.search("Khách sạn Đà Nẵng Vietnam", { maxResults: 3 });
      valid = true;
      results = (response.results || []).slice(0, 3).map(r => ({
        title: r.title,
        url: r.url,
      }));
      message = `Key hoạt động! Tìm thấy ${results.length} kết quả`;
    } else if (provider === "google") {
      const axios = (await import("axios")).default;
      const resp = await axios.get("https://www.googleapis.com/customsearch/v1", {
        params: { key, cx: process.env.GOOGLE_SEARCH_ENGINE_ID || "test", q: "hotel Da Nang", num: 3 },
        timeout: 10000,
      });
      valid = true;
      results = (resp.data.items || []).slice(0, 3).map(r => ({
        title: r.title,
        url: r.link,
      }));
      message = `Key hoạt động! Tìm thấy ${results.length} kết quả`;
    } else {
      valid = key.length > 4;
      message = valid ? "Basic validation passed" : "Key too short";
    }
  } catch (err) {
    valid = false;
    const status = err?.response?.status || err?.status || 0;
    if (status === 401 || status === 403) {
      message = "Key không hợp lệ hoặc đã hết hạn";
    } else if (status === 429) {
      message = "Key hợp lệ nhưng đã vượt giới hạn rate limit";
      valid = true; // Key is valid, just rate limited
    } else {
      message = `Lỗi: ${err.message || "Không thể kết nối API"}`;
    }
  }

  res.json({
    provider,
    masked: maskKey(key),
    valid,
    message,
    results,
  });
});

export default router;
