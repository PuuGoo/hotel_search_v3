// Request signing — verify API request integrity with HMAC-SHA256
// Clients sign requests with a shared secret; server verifies before processing

import crypto from "crypto";

const SIGNATURE_HEADER = "X-Request-Signature";
const TIMESTAMP_HEADER = "X-Request-Timestamp";
const NONCE_HEADER = "X-Request-Nonce";

// Track used nonces to prevent replay (in-memory, short-lived)
const usedNonces = new Map();
const NONCE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Clean expired nonces periodically
setInterval(() => {
  const now = Date.now();
  for (const [nonce, expiry] of usedNonces) {
    if (now > expiry) usedNonces.delete(nonce);
  }
}, 60_000).unref();

/**
 * Build the string to sign: "METHOD:path:timestamp:nonce:bodyHash"
 */
function buildSigningString(method, path, timestamp, nonce, bodyHash) {
  return `${method.toUpperCase()}:${path}:${timestamp}:${nonce}:${bodyHash}`;
}

/**
 * Compute SHA-256 hash of body.
 */
function hashBody(body) {
  if (!body) return crypto.createHash("sha256").update("").digest("hex");
  const str = typeof body === "string" ? body : JSON.stringify(body);
  return crypto.createHash("sha256").update(str).digest("hex");
}

/**
 * Sign a request with HMAC-SHA256.
 */
export function signRequest(method, path, body, secret, timestamp, nonce) {
  const bodyHash = hashBody(body);
  const signingString = buildSigningString(method, path, timestamp, nonce, bodyHash);
  return crypto.createHmac("sha256", secret).update(signingString).digest("hex");
}

/**
 * Generate request signing headers for a client.
 */
export function buildRequestSignHeaders(method, path, body, secret) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomBytes(16).toString("hex");
  const signature = signRequest(method, path, body, secret, timestamp, nonce);
  return {
    [SIGNATURE_HEADER]: signature,
    [TIMESTAMP_HEADER]: timestamp,
    [NONCE_HEADER]: nonce,
  };
}

/**
 * Express middleware to verify request signatures.
 * @param {Function} secretGetter - (req) => secret or a static string
 * @param {Object} options - { maxAgeSeconds: 300 }
 */
export function verifyRequestSignature(secretGetter, options = {}) {
  const maxAgeSeconds = options.maxAgeSeconds || 300;

  return (req, res, next) => {
    const signature = req.headers[SIGNATURE_HEADER.toLowerCase()];
    const timestamp = req.headers[TIMESTAMP_HEADER.toLowerCase()];
    const nonce = req.headers[NONCE_HEADER.toLowerCase()];

    if (!signature || !timestamp || !nonce) {
      return res.status(401).json({
        error: "Missing request signature headers",
        required: [SIGNATURE_HEADER, TIMESTAMP_HEADER, NONCE_HEADER],
      });
    }

    // Check timestamp freshness
    const now = Math.floor(Date.now() / 1000);
    const ts = parseInt(timestamp, 10);
    if (isNaN(ts) || Math.abs(now - ts) > maxAgeSeconds) {
      return res.status(401).json({ error: "Request timestamp expired" });
    }

    // Check nonce uniqueness (prevent replay)
    if (usedNonces.has(nonce)) {
      return res.status(401).json({ error: "Request nonce already used" });
    }
    usedNonces.set(nonce, Date.now() + NONCE_TTL_MS);

    // Get secret
    const secret = typeof secretGetter === "function"
      ? secretGetter(req)
      : secretGetter;

    if (!secret) {
      return res.status(500).json({ error: "Signing secret not configured" });
    }

    // Verify signature
    const bodyHash = hashBody(req.body);
    const signingString = buildSigningString(req.method, req.path, timestamp, nonce, bodyHash);
    const expected = crypto.createHmac("sha256", secret).update(signingString).digest("hex");

    try {
      if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
        return res.status(401).json({ error: "Invalid request signature" });
      }
    } catch {
      return res.status(401).json({ error: "Invalid request signature" });
    }

    next();
  };
}

export { SIGNATURE_HEADER, TIMESTAMP_HEADER, NONCE_HEADER };
