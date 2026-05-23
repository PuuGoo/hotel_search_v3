// Email notification routes — configure and test email delivery

import { Router } from "express";
import { checkAuthenticated } from "../middleware/auth.js";
import {
  getEmailConfig,
  setEmailConfig,
  sendEmail,
  sendTestEmail,
} from "../utils/email.js";

const router = Router();

/**
 * GET /api/email/config
 * Get current email configuration (admin only).
 */
router.get("/api/email/config", checkAuthenticated, (req, res) => {
  if (req.session.user.role !== "admin") {
    return res.status(403).json({ error: "Admin access required" });
  }
  const config = getEmailConfig();
  // Mask sensitive fields
  if (config.settings?.pass) {
    config.settings = { ...config.settings, pass: "***" };
  }
  res.json(config);
});

/**
 * PUT /api/email/config
 * Update email configuration (admin only).
 * Body: { transport, settings }
 */
router.put("/api/email/config", checkAuthenticated, (req, res) => {
  if (req.session.user.role !== "admin") {
    return res.status(403).json({ error: "Admin access required" });
  }

  const { transport, settings } = req.body;
  const validTransports = ["console", "smtp", "webhook"];

  if (transport && !validTransports.includes(transport)) {
    return res.status(400).json({ error: `Invalid transport. Must be: ${validTransports.join(", ")}` });
  }

  const updated = setEmailConfig({ transport, settings });
  if (updated.settings?.pass) {
    updated.settings = { ...updated.settings, pass: "***" };
  }
  res.json({ success: true, config: updated });
});

/**
 * POST /api/email/test
 * Send a test email (admin only).
 * Body: { to }
 */
router.post("/api/email/test", checkAuthenticated, async (req, res) => {
  if (req.session.user.role !== "admin") {
    return res.status(403).json({ error: "Admin access required" });
  }

  const { to } = req.body;
  if (!to) {
    return res.status(400).json({ error: "to is required" });
  }

  try {
    const result = await sendTestEmail(to);
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ error: "Failed to send test email", details: err.message });
  }
});

/**
 * POST /api/email/send
 * Send a custom email (admin only).
 * Body: { to, subject, body }
 */
router.post("/api/email/send", checkAuthenticated, async (req, res) => {
  if (req.session.user.role !== "admin") {
    return res.status(403).json({ error: "Admin access required" });
  }

  const { to, subject, body } = req.body;
  if (!to || !subject || !body) {
    return res.status(400).json({ error: "to, subject, and body are required" });
  }

  try {
    const result = await sendEmail({ to, subject, body });
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ error: "Failed to send email", details: err.message });
  }
});

/**
 * POST /api/email/notify-price-alert
 * Trigger a price alert email notification.
 * Body: { alertId, userEmail }
 */
router.post("/api/email/notify-price-alert", checkAuthenticated, async (req, res) => {
  const { sendPriceAlertEmail } = await import("../utils/email.js");
  const { alert, priceChange, userEmail } = req.body;

  if (!alert || !userEmail) {
    return res.status(400).json({ error: "alert and userEmail are required" });
  }

  try {
    const result = await sendPriceAlertEmail(userEmail, alert, priceChange || 0);
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ error: "Failed to send alert email", details: err.message });
  }
});

/**
 * POST /api/email/notify-scheduled-search
 * Trigger a scheduled search results email.
 * Body: { search, results, userEmail }
 */
router.post("/api/email/notify-scheduled-search", checkAuthenticated, async (req, res) => {
  const { sendScheduledSearchEmail } = await import("../utils/email.js");
  const { search, results, userEmail } = req.body;

  if (!search || !userEmail) {
    return res.status(400).json({ error: "search and userEmail are required" });
  }

  try {
    const result = await sendScheduledSearchEmail(userEmail, search, results || []);
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ error: "Failed to send search email", details: err.message });
  }
});

export default router;
