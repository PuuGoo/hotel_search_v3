// Request deduplication middleware
// Prevents duplicate in-flight requests by caching the result promise.
// If the same GET request comes in while a previous one is pending,
// the second request waits for the first and returns the same result.

import crypto from "crypto";

const inflight = new Map();

function makeRequestKey(req) {
  const parts = [req.method, req.path, JSON.stringify(req.query)];
  return crypto.createHash("md5").update(parts.join("|")).digest("hex");
}

/**
 * Request deduplication middleware.
 * Caches in-flight GET requests. Concurrent identical requests
 * share the same handler execution.
 */
export function requestDedup(options = {}) {
  const methods = options.methods || ["GET"];

  return (req, res, next) => {
    if (!methods.includes(req.method)) {
      return next();
    }

    const key = makeRequestKey(req);

    if (inflight.has(key)) {
      // Another request is already in-flight — wait for it
      const entry = inflight.get(key);
      entry.waiters.push(res);
      return;
    }

    // First request — track it
    const entry = { waiters: [], result: null, statusCode: 200 };
    inflight.set(key, entry);

    // Intercept json to capture the result
    const originalJson = res.json.bind(res);
    res.json = function (body) {
      entry.result = body;
      entry.statusCode = res.statusCode;

      // Send to all waiting requests
      for (const waiterRes of entry.waiters) {
        try {
          waiterRes.status(entry.statusCode).json(body);
        } catch {
          // waiter may have disconnected
        }
      }

      inflight.delete(key);
      return originalJson(body);
    };

    res.on("close", () => {
      if (inflight.has(key)) {
        inflight.delete(key);
      }
    });

    next();
  };
}

export const _inflight = inflight;
