// Request/response logging middleware — capture request and response bodies

import { logEntry, getConfig } from "../utils/requestResponseLogger.js";

// Paths to skip logging (high volume, not useful)
const SKIP_PATHS = ["/health", "/metrics", "/favicon.ico", "/api-docs"];

/**
 * Express middleware that logs request/response bodies.
 * Only logs in development mode or when explicitly enabled via config.
 */
export function requestResponseLogger(req, res, next) {
  const config = getConfig();

  // Skip unless enabled
  if (!config.enabled && process.env.ENABLE_REQ_RES_LOGGING !== "true") {
    return next();
  }

  // Skip certain paths
  if (SKIP_PATHS.some((p) => req.path.startsWith(p))) {
    return next();
  }

  // Skip static files
  if (req.path.match(/\.(html|css|js|png|jpg|ico|svg|woff|ttf)$/)) {
    return next();
  }

  const startTime = Date.now();

  // Capture request body
  let requestBody = null;
  if (req.body && typeof req.body === "object" && Object.keys(req.body).length > 0) {
    // Mask sensitive fields
    requestBody = { ...req.body };
    for (const field of ["password", "token", "secret", "apiKey", "creditCard"]) {
      if (requestBody[field]) requestBody[field] = "***MASKED***";
    }
  }

  // Capture response body
  const originalJson = res.json.bind(res);
  let responseBody = null;

  res.json = (body) => {
    responseBody = body;
    return originalJson(body);
  };

  // Log on response finish
  res.on("finish", () => {
    const duration = Date.now() - startTime;

    logEntry({
      method: req.method,
      path: req.path,
      query: Object.keys(req.query || {}).length > 0 ? req.query : null,
      requestHeaders: {
        "content-type": req.headers["content-type"],
        "user-agent": req.headers["user-agent"],
        "x-request-id": req.headers["x-request-id"],
      },
      requestBody,
      ip: req.ip || req.connection?.remoteAddress,
      userId: req.session?.user?.id || null,
      statusCode: res.statusCode,
      responseBody,
      duration,
    });
  });

  next();
}
