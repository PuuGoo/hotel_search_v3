// Webhook retry system — automatic retry with exponential backoff for failed webhooks

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_FILE = path.join(__dirname, "..", "webhook_retry.json");
const MAX_WEBHOOKS = 500;
const MAX_HISTORY = 2000;
const DEFAULT_MAX_RETRIES = 5;
const BASE_DELAY_MS = 1000;

function readJSON(filePath) {
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch { /* ignore */ }
  return { pending: [], history: [] };
}

function writeJSON(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  } catch { /* ignore */ }
}

/**
 * Schedule a webhook delivery.
 */
export function scheduleWebhook(options = {}) {
  const data = readJSON(DATA_FILE);
  if (!data.pending) data.pending = [];
  if (data.pending.length >= MAX_WEBHOOKS) {
    return { error: "Max pending webhooks reached" };
  }

  const webhook = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    url: options.url,
    method: options.method || "POST",
    headers: options.headers || {},
    payload: options.payload || {},
    event: options.event || "webhook",
    maxRetries: options.maxRetries ?? DEFAULT_MAX_RETRIES,
    retryCount: 0,
    status: "pending",
    scheduledAt: Date.now(),
    nextRetryAt: Date.now(),
    lastAttemptAt: null,
    completedAt: null,
    error: null,
    responses: [],
    createdBy: options.userId || "system",
  };

  data.pending.push(webhook);
  writeJSON(DATA_FILE, data);
  return webhook;
}

/**
 * Get next webhooks ready for delivery.
 */
export function getReadyWebhooks(limit = 10) {
  const data = readJSON(DATA_FILE);
  const now = Date.now();
  return (data.pending || [])
    .filter((w) => w.status === "pending" && w.nextRetryAt <= now)
    .slice(0, limit);
}

/**
 * Record a successful delivery.
 */
export function recordSuccess(webhookId, statusCode, responseBody) {
  const data = readJSON(DATA_FILE);
  const index = (data.pending || []).findIndex((w) => w.id === webhookId);
  if (index === -1) return { error: "Webhook not found" };

  const webhook = data.pending[index];
  webhook.status = "delivered";
  webhook.completedAt = Date.now();
  webhook.responses.push({
    attempt: webhook.retryCount + 1,
    statusCode,
    body: typeof responseBody === "string" ? responseBody.slice(0, 1000) : responseBody,
    timestamp: Date.now(),
  });

  // Move to history
  if (!data.history) data.history = [];
  data.history.unshift({ ...webhook });
  if (data.history.length > MAX_HISTORY) data.history.length = MAX_HISTORY;

  data.pending.splice(index, 1);
  writeJSON(DATA_FILE, data);
  return webhook;
}

/**
 * Record a failed delivery attempt.
 */
export function recordFailure(webhookId, error, statusCode = null) {
  const data = readJSON(DATA_FILE);
  const index = (data.pending || []).findIndex((w) => w.id === webhookId);
  if (index === -1) return { error: "Webhook not found" };

  const webhook = data.pending[index];
  webhook.retryCount++;
  webhook.lastAttemptAt = Date.now();
  webhook.error = error;
  webhook.responses.push({
    attempt: webhook.retryCount,
    statusCode,
    error,
    timestamp: Date.now(),
  });

  if (webhook.retryCount >= webhook.maxRetries) {
    // Max retries exceeded
    webhook.status = "failed";
    webhook.completedAt = Date.now();

    if (!data.history) data.history = [];
    data.history.unshift({ ...webhook });
    if (data.history.length > MAX_HISTORY) data.history.length = MAX_HISTORY;

    data.pending.splice(index, 1);
  } else {
    // Schedule next retry with exponential backoff
    webhook.status = "pending";
    webhook.nextRetryAt = Date.now() + BASE_DELAY_MS * Math.pow(2, webhook.retryCount);
  }

  writeJSON(DATA_FILE, data);
  return webhook;
}

/**
 * Get pending webhooks.
 */
export function getPendingWebhooks(options = {}) {
  const data = readJSON(DATA_FILE);
  let pending = data.pending || [];

  if (options.event) pending = pending.filter((w) => w.event === options.event);

  return { webhooks: pending.slice(0, options.limit || 50), total: pending.length };
}

/**
 * Get webhook history.
 */
export function getWebhookHistory(options = {}) {
  const data = readJSON(DATA_FILE);
  let history = data.history || [];

  if (options.status) history = history.filter((w) => w.status === options.status);
  if (options.event) history = history.filter((w) => w.event === options.event);

  return { webhooks: history.slice(0, options.limit || 50), total: history.length };
}

/**
 * Get a specific webhook (pending or history).
 */
export function getWebhook(webhookId) {
  const data = readJSON(DATA_FILE);
  const pending = (data.pending || []).find((w) => w.id === webhookId);
  if (pending) return pending;
  return (data.history || []).find((w) => w.id === webhookId) || null;
}

/**
 * Cancel a pending webhook.
 */
export function cancelWebhook(webhookId) {
  const data = readJSON(DATA_FILE);
  const index = (data.pending || []).findIndex((w) => w.id === webhookId);
  if (index === -1) return { error: "Webhook not found" };

  const webhook = data.pending[index];
  webhook.status = "cancelled";
  webhook.completedAt = Date.now();

  if (!data.history) data.history = [];
  data.history.unshift({ ...webhook });
  if (data.history.length > MAX_HISTORY) data.history.length = MAX_HISTORY;

  data.pending.splice(index, 1);
  writeJSON(DATA_FILE, data);
  return webhook;
}

/**
 * Get retry statistics.
 */
export function getRetryStats() {
  const data = readJSON(DATA_FILE);
  const pending = data.pending || [];
  const history = data.history || [];

  const statusCounts = {};
  for (const w of history) {
    statusCounts[w.status] = (statusCounts[w.status] || 0) + 1;
  }

  const totalRetries = history.reduce((sum, w) => sum + (w.retryCount || 0), 0);
  const avgRetries = history.length > 0 ? Math.round(totalRetries / history.length) : 0;

  return {
    pendingCount: pending.length,
    historyCount: history.length,
    statusCounts,
    totalRetries,
    avgRetries,
  };
}

/**
 * Clear webhook data.
 */
export function clearWebhookData() {
  writeJSON(DATA_FILE, { pending: [], history: [] });
}
