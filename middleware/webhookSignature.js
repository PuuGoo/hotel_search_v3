// Webhook signature verification — HMAC-SHA256 for webhook payloads
// Verify incoming webhooks and sign outgoing webhooks

import crypto from "crypto";

/**
 * Generate HMAC-SHA256 signature for a payload.
 */
export function signPayload(payload, secret) {
  const body = typeof payload === "string" ? payload : JSON.stringify(payload);
  return crypto.createHmac("sha256", secret).update(body).digest("hex");
}

/**
 * Verify HMAC-SHA256 signature from request.
 * Checks X-Webhook-Signature header.
 */
export function verifyWebhookSignature(req, secret) {
  const signature = req.headers["x-webhook-signature"];
  if (!signature) return false;

  const body = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
  const expected = crypto.createHmac("sha256", secret).update(body).digest("hex");

  // Timing-safe comparison
  if (signature.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

/**
 * Express middleware that verifies webhook signatures.
 */
export function webhookVerification(secret) {
  return (req, res, next) => {
    if (!verifyWebhookSignature(req, secret)) {
      return res.status(401).json({ error: "Invalid webhook signature" });
    }
    next();
  };
}
