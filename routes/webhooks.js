import { Router } from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { checkAuthenticated } from "../middleware/auth.js";
import { buildSignedHeaders } from "../utils/webhookSignature.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, "..", "webhooks.json");

const router = Router();

function readWebhooks() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    }
  } catch (e) {
    console.error("Error reading webhooks:", e.message);
  }
  return [];
}

function writeWebhooks(webhooks) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(webhooks, null, 2));
}

// Get all webhooks for current user
router.get("/api/webhooks", checkAuthenticated, (req, res) => {
  const webhooks = readWebhooks();
  const userWebhooks = webhooks.filter((w) => w.userId === req.session.user.id);
  res.json(userWebhooks);
});

// Create a webhook
router.post("/api/webhooks", checkAuthenticated, (req, res) => {
  const { name, url, events, secret, active } = req.body;

  if (!name || !url) {
    return res.status(400).json({ error: "name and url are required" });
  }

  // Validate URL
  try {
    new URL(url);
  } catch {
    return res.status(400).json({ error: "Invalid URL" });
  }

  const webhooks = readWebhooks();
  const webhook = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    userId: req.session.user.id,
    name: name.trim(),
    url: url.trim(),
    events: Array.isArray(events) ? events : ["price_alert", "search_complete"],
    secret: secret || null,
    active: active !== false,
    lastTriggeredAt: null,
    triggerCount: 0,
    lastStatus: null,
    lastError: null,
    createdAt: new Date().toISOString(),
  };

  webhooks.push(webhook);
  writeWebhooks(webhooks);
  res.status(201).json(webhook);
});

// Update a webhook
router.put("/api/webhooks/:id", checkAuthenticated, (req, res) => {
  const webhooks = readWebhooks();
  const idx = webhooks.findIndex((w) => w.id === req.params.id && w.userId === req.session.user.id);
  if (idx === -1) {
    return res.status(404).json({ error: "Webhook not found" });
  }

  const { name, url, events, secret, active } = req.body;
  const webhook = webhooks[idx];

  if (name !== undefined) webhook.name = name.trim();
  if (url !== undefined) {
    try { new URL(url); } catch { return res.status(400).json({ error: "Invalid URL" }); }
    webhook.url = url.trim();
  }
  if (events !== undefined) webhook.events = events;
  if (secret !== undefined) webhook.secret = secret;
  if (active !== undefined) webhook.active = active;

  webhooks[idx] = webhook;
  writeWebhooks(webhooks);
  res.json(webhook);
});

// Delete a webhook
router.delete("/api/webhooks/:id", checkAuthenticated, (req, res) => {
  const webhooks = readWebhooks();
  const idx = webhooks.findIndex((w) => w.id === req.params.id && w.userId === req.session.user.id);
  if (idx === -1) {
    return res.status(404).json({ error: "Webhook not found" });
  }
  webhooks.splice(idx, 1);
  writeWebhooks(webhooks);
  res.json({ success: true });
});

// Test a webhook (send a test payload)
router.post("/api/webhooks/:id/test", checkAuthenticated, async (req, res) => {
  const webhooks = readWebhooks();
  const idx = webhooks.findIndex((w) => w.id === req.params.id && w.userId === req.session.user.id);
  if (idx === -1) {
    return res.status(404).json({ error: "Webhook not found" });
  }

  const webhook = webhooks[idx];
  const testPayload = {
    event: "test",
    timestamp: new Date().toISOString(),
    data: { message: "This is a test webhook delivery" },
  };

  try {
    const body = JSON.stringify(testPayload);
    let headers = { "Content-Type": "application/json" };
    if (webhook.secret) {
      headers = buildSignedHeaders(body, webhook.secret);
    }

    const resp = await fetch(webhook.url, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(10000),
    });

    webhook.lastTriggeredAt = new Date().toISOString();
    webhook.lastStatus = resp.status;
    webhook.lastError = null;
    webhooks[idx] = webhook;
    writeWebhooks(webhooks);

    res.json({
      success: resp.ok,
      status: resp.status,
      message: resp.ok ? "Test delivery successful" : `Server returned ${resp.status}`,
    });
  } catch (err) {
    webhook.lastTriggeredAt = new Date().toISOString();
    webhook.lastStatus = 0;
    webhook.lastError = err.message;
    webhooks[idx] = webhook;
    writeWebhooks(webhooks);

    res.json({
      success: false,
      status: 0,
      message: err.message,
    });
  }
});

// Trigger webhooks for an event (internal use)
export async function triggerWebhooks(userId, event, data) {
  const webhooks = readWebhooks();
  const matching = webhooks.filter(
    (w) => w.userId === userId && w.active && w.events.includes(event)
  );

  const results = await Promise.allSettled(
    matching.map(async (webhook) => {
      const payload = {
        event,
        timestamp: new Date().toISOString(),
        data,
      };
      const body = JSON.stringify(payload);

      let headers = { "Content-Type": "application/json" };
      if (webhook.secret) {
        headers = buildSignedHeaders(body, webhook.secret);
      }

      const resp = await fetch(webhook.url, {
        method: "POST",
        headers,
        body,
        signal: AbortSignal.timeout(10000),
      });

      webhook.lastTriggeredAt = new Date().toISOString();
      webhook.triggerCount = (webhook.triggerCount || 0) + 1;
      webhook.lastStatus = resp.status;
      webhook.lastError = null;

      return { id: webhook.id, status: resp.status, ok: resp.ok };
    })
  );

  // Update webhook states
  writeWebhooks(webhooks);

  return results.map((r, i) => ({
    webhookId: matching[i].id,
    status: r.status,
    result: r.status === "fulfilled" ? r.value : { error: r.reason?.message },
  }));
}

// Get webhook stats
router.get("/api/webhooks/stats", checkAuthenticated, (req, res) => {
  const webhooks = readWebhooks();
  const userWebhooks = webhooks.filter((w) => w.userId === req.session.user.id);
  const active = userWebhooks.filter((w) => w.active).length;
  const totalTriggers = userWebhooks.reduce((s, w) => s + (w.triggerCount || 0), 0);
  res.json({ total: userWebhooks.length, active, totalTriggers });
});

export default router;
