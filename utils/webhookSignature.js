// Webhook signature verification — HMAC-SHA256
// Signs webhook payloads so receivers can verify integrity and authenticity

import crypto from "crypto";

const SIGNATURE_ALGORITHM = "sha256";
const SIGNATURE_HEADER = "X-Webhook-Signature";
const TIMESTAMP_HEADER = "X-Webhook-Timestamp";

/**
 * Sign a webhook payload with HMAC-SHA256.
 * Format: "v1=<hex>" where the signed content is "<timestamp>.<body>"
 */
export function signPayload(body, secret, timestamp) {
  const content = `${timestamp}.${body}`;
  const signature = crypto
    .createHmac(SIGNATURE_ALGORITHM, secret)
    .update(content)
    .digest("hex");
  return `v1=${signature}`;
}

/**
 * Build headers for a signed webhook delivery.
 */
export function buildSignedHeaders(body, secret) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = signPayload(body, secret, timestamp);
  return {
    "Content-Type": "application/json",
    [SIGNATURE_HEADER]: signature,
    [TIMESTAMP_HEADER]: timestamp,
  };
}

/**
 * Verify a webhook signature.
 * Returns true if valid, false otherwise.
 * Rejects timestamps older than maxAgeSeconds (default 300s / 5 minutes).
 */
export function verifySignature(body, secret, signature, timestamp, maxAgeSeconds = 300) {
  if (!signature || !timestamp || !secret) {
    return false;
  }

  // Check timestamp freshness (prevent replay attacks)
  const now = Math.floor(Date.now() / 1000);
  const ts = parseInt(timestamp, 10);
  if (isNaN(ts) || Math.abs(now - ts) > maxAgeSeconds) {
    return false;
  }

  // Compute expected signature
  const expected = signPayload(body, secret, timestamp);

  // Timing-safe comparison
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

/**
 * Express middleware to verify incoming webhook signatures.
 * Expects the request body to be already parsed.
 */
export function verifyWebhookSignature(secretGetter) {
  return (req, res, next) => {
    const signature = req.headers[SIGNATURE_HEADER.toLowerCase()];
    const timestamp = req.headers[TIMESTAMP_HEADER.toLowerCase()];

    if (!signature || !timestamp) {
      return res.status(401).json({
        error: "Missing webhook signature headers",
        required: [SIGNATURE_HEADER, TIMESTAMP_HEADER],
      });
    }

    const secret = typeof secretGetter === "function"
      ? secretGetter(req)
      : secretGetter;

    if (!secret) {
      return res.status(500).json({ error: "Webhook secret not configured" });
    }

    const body = typeof req.body === "string" ? req.body : JSON.stringify(req.body);

    if (!verifySignature(body, secret, signature, timestamp)) {
      return res.status(401).json({ error: "Invalid webhook signature" });
    }

    next();
  };
}

export { SIGNATURE_HEADER, TIMESTAMP_HEADER };
