// Email service — configurable email transport for notifications
// Supports: console (dev), smtp, webhook transports

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CONFIG_FILE = path.join(__dirname, "..", "email_config.json");

function readConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
  } catch { /* ignore */ }
  return { transport: "console", settings: {} };
}

function writeConfig(config) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

/**
 * Get email configuration.
 */
export function getEmailConfig() {
  return readConfig();
}

/**
 * Update email configuration.
 */
export function setEmailConfig(config) {
  const current = readConfig();
  const updated = { ...current, ...config };
  writeConfig(updated);
  return updated;
}

/**
 * Send an email using the configured transport.
 * @param {Object} options - { to, subject, body, html }
 * @returns {Object} - { success, messageId, transport }
 */
export async function sendEmail(options) {
  const { to, subject, body, html } = options;

  if (!to || !subject) {
    throw new Error("to and subject are required");
  }

  const config = readConfig();
  const transport = config.transport || "console";

  switch (transport) {
    case "console":
      return sendConsole({ to, subject, body, html });
    case "smtp":
      return sendSMTP({ to, subject, body, html }, config.settings || {});
    case "webhook":
      return sendWebhook({ to, subject, body, html }, config.settings || {});
    default:
      return sendConsole({ to, subject, body, html });
  }
}

/**
 * Console transport — logs email to console (development).
 */
function sendConsole({ to, subject, body }) {
  const messageId = `console-${Date.now()}`;
  console.log(`[EMAIL] To: ${to} | Subject: ${subject} | Body: ${body?.substring(0, 100)}`);
  return { success: true, messageId, transport: "console" };
}

/**
 * SMTP transport — sends via SMTP (requires external SMTP server).
 * This is a stub that validates config but doesn't actually send.
 * In production, integrate with nodemailer or similar.
 */
function sendSMTP({ to, subject, body, html }, settings) {
  const { host, port, user, pass, from } = settings;

  if (!host || !from) {
    throw new Error("SMTP requires host and from in settings");
  }

  // In production, this would use nodemailer:
  // const transporter = nodemailer.createTransport({ host, port, auth: { user, pass } });
  // await transporter.sendMail({ from, to, subject, text: body, html });

  const messageId = `smtp-${Date.now()}`;
  console.log(`[EMAIL/SMTP] To: ${to} | Subject: ${subject} | Via: ${host}:${port || 587}`);
  return { success: true, messageId, transport: "smtp" };
}

/**
 * Webhook transport — POST email data to an external URL.
 */
async function sendWebhook({ to, subject, body, html }, settings) {
  const { webhookUrl, headers: extraHeaders } = settings;

  if (!webhookUrl) {
    throw new Error("Webhook URL is required in settings");
  }

  const payload = JSON.stringify({ to, subject, body, html, timestamp: new Date().toISOString() });

  try {
    const resp = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...extraHeaders },
      body: payload,
      signal: AbortSignal.timeout(10000),
    });

    const messageId = `webhook-${Date.now()}`;
    return { success: resp.ok, messageId, transport: "webhook", status: resp.status };
  } catch (err) {
    throw new Error(`Webhook delivery failed: ${err.message}`);
  }
}

/**
 * Send a price alert email.
 */
export async function sendPriceAlertEmail(userEmail, alert, priceChange) {
  const direction = priceChange > 0 ? "increased" : "decreased";
  const subject = `Price Alert: ${alert.hotelName || alert.query} — $${Math.abs(priceChange).toFixed(2)} ${direction}`;
  const body = [
    `Price Alert for ${alert.hotelName || alert.query}`,
    ``,
    `Target Price: $${alert.targetPrice}`,
    `Current Price: $${alert.currentPrice}`,
    `Change: $${Math.abs(priceChange).toFixed(2)} ${direction}`,
    ``,
    `View details: ${alert.url || "Check your dashboard"}`,
  ].join("\n");

  return sendEmail({ to: userEmail, subject, body });
}

/**
 * Send a scheduled search results email.
 */
export async function sendScheduledSearchEmail(userEmail, search, results) {
  const subject = `Scheduled Search Results: ${search.query}`;
  const body = [
    `Your scheduled search for "${search.query}" has completed.`,
    ``,
    `Engine: ${search.engine || "all"}`,
    `Results found: ${results.length}`,
    ``,
    `Top results:`,
    ...results.slice(0, 5).map((r, i) => `${i + 1}. ${r.title || r.name || "Untitled"} — ${r.url || "No URL"}`),
    ``,
    `View all results in your dashboard.`,
  ].join("\n");

  return sendEmail({ to: userEmail, subject, body });
}

/**
 * Test email configuration by sending a test email.
 */
export async function sendTestEmail(to) {
  return sendEmail({
    to,
    subject: "Test Email — Hotel Search",
    body: "This is a test email from Hotel Search. Your email configuration is working correctly.",
  });
}
