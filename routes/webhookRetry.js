// Webhook retry routes — automatic retry with exponential backoff

import { Router } from "express";
import { checkAuthenticated, checkRole } from "../middleware/auth.js";
import {
  scheduleWebhook,
  getReadyWebhooks,
  recordSuccess,
  recordFailure,
  getPendingWebhooks,
  getWebhookHistory,
  getWebhook,
  cancelWebhook,
  getRetryStats,
  clearWebhookData,
} from "../utils/webhookRetry.js";

const router = Router();

/**
 * POST /api/webhook-retry/schedule
 * Schedule a webhook delivery.
 */
router.post("/api/webhook-retry/schedule", checkAuthenticated, (req, res) => {
  const webhook = scheduleWebhook({
    ...req.body,
    userId: req.session.user?.id,
  });
  if (webhook.error) {
    return res.status(400).json({ error: webhook.error, code: 400 });
  }
  res.status(201).json(webhook);
});

/**
 * GET /api/webhook-retry/ready
 * Get webhooks ready for delivery (admin only).
 */
router.get("/api/webhook-retry/ready", checkAuthenticated, checkRole("admin"), (req, res) => {
  const limit = parseInt(req.query.limit) || 10;
  const webhooks = getReadyWebhooks(limit);
  res.json({ webhooks, count: webhooks.length });
});

/**
 * GET /api/webhook-retry/pending
 * Get pending webhooks (admin only).
 */
router.get("/api/webhook-retry/pending", checkAuthenticated, checkRole("admin"), (req, res) => {
  const event = req.query.event || null;
  const limit = parseInt(req.query.limit) || 50;
  const result = getPendingWebhooks({ event, limit });
  res.json(result);
});

/**
 * GET /api/webhook-retry/stats
 * Get retry statistics (admin only).
 */
router.get("/api/webhook-retry/stats", checkAuthenticated, checkRole("admin"), (_req, res) => {
  const stats = getRetryStats();
  res.json(stats);
});

/**
 * GET /api/webhook-retry/history
 * Get webhook history (admin only).
 */
router.get("/api/webhook-retry/history", checkAuthenticated, checkRole("admin"), (req, res) => {
  const status = req.query.status || null;
  const event = req.query.event || null;
  const limit = parseInt(req.query.limit) || 50;
  const result = getWebhookHistory({ status, event, limit });
  res.json(result);
});

/**
 * POST /api/webhook-retry/:id/success
 * Record successful delivery (admin only).
 */
router.post("/api/webhook-retry/:id/success", checkAuthenticated, checkRole("admin"), (req, res) => {
  const { statusCode, responseBody } = req.body;
  const result = recordSuccess(req.params.id, statusCode, responseBody);
  if (result.error) {
    return res.status(400).json({ error: result.error, code: 400 });
  }
  res.json(result);
});

/**
 * POST /api/webhook-retry/:id/failure
 * Record failed delivery (admin only).
 */
router.post("/api/webhook-retry/:id/failure", checkAuthenticated, checkRole("admin"), (req, res) => {
  const { error, statusCode } = req.body;
  const result = recordFailure(req.params.id, error, statusCode);
  if (result.error) {
    return res.status(400).json({ error: result.error, code: 400 });
  }
  res.json(result);
});

/**
 * POST /api/webhook-retry/:id/cancel
 * Cancel a pending webhook (admin only).
 */
router.post("/api/webhook-retry/:id/cancel", checkAuthenticated, checkRole("admin"), (req, res) => {
  const result = cancelWebhook(req.params.id);
  if (result.error) {
    return res.status(400).json({ error: result.error, code: 400 });
  }
  res.json(result);
});

/**
 * GET /api/webhook-retry/:id
 * Get a specific webhook (admin only).
 */
router.get("/api/webhook-retry/:id", checkAuthenticated, checkRole("admin"), (req, res) => {
  const webhook = getWebhook(req.params.id);
  if (!webhook) {
    return res.status(404).json({ error: "Webhook not found", code: 404 });
  }
  res.json(webhook);
});

/**
 * DELETE /api/webhook-retry/clear
 * Clear webhook data (admin only).
 */
router.delete("/api/webhook-retry/clear", checkAuthenticated, checkRole("admin"), (_req, res) => {
  clearWebhookData();
  res.json({ message: "Webhook retry data cleared" });
});

export default router;
