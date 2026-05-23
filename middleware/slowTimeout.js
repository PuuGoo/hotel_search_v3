// Slow request timeout middleware — abort connections that send data too slowly
// Protects against slowloris-style attacks where clients hold connections open

const SLOW_THRESHOLD_MS_PER_KB = 100; // If a connection takes >100ms per KB, it's slow
const MIN_BODY_SIZE = 1024; // Only check after receiving at least 1KB
const GRACE_PERIOD_MS = 5000; // Initial grace period before checking speed

export function slowRequestTimeout(options = {}) {
  const threshold = options.thresholdMsPerKb || SLOW_THRESHOLD_MS_PER_KB;
  const minSize = options.minBodySize || MIN_BODY_SIZE;
  const gracePeriod = options.gracePeriod || GRACE_PERIOD_MS;

  return (req, res, next) => {
    // Only apply to requests with a body
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      return next();
    }

    const startTime = Date.now();
    let bytesReceived = 0;
    let aborted = false;

    const onData = (chunk) => {
      if (aborted) return;

      bytesReceived += chunk.length;
      const elapsed = Date.now() - startTime;

      // Only check after grace period and minimum body size
      if (elapsed < gracePeriod || bytesReceived < minSize) {
        return;
      }

      // Calculate speed: ms per KB
      const kbReceived = bytesReceived / 1024;
      const msPerKb = elapsed / kbReceived;

      if (msPerKb > threshold) {
        aborted = true;
        req.removeListener("data", onData);
        req.destroy();
        if (!res.headersSent) {
          res.status(408).json({
            error: "Request timeout: connection too slow",
            requestId: req.requestId,
          });
        }
      }
    };

    req.on("data", onData);

    req.on("end", () => {
      req.removeListener("data", onData);
    });

    req.on("close", () => {
      req.removeListener("data", onData);
    });

    next();
  };
}
