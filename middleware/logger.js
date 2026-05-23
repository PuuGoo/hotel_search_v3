import { logRequest } from "../routes/requestLogging.js";
import { trackApiCall } from "../routes/apiUsage.js";
import config from "../utils/config.js";

// Sensitive fields to redact in body logs
const SENSITIVE_FIELDS = ["password", "token", "secret", "apiKey", "api_key", "authorization", "cookie"];

function redactSensitive(obj) {
  if (!obj || typeof obj !== "object") return obj;
  const redacted = { ...obj };
  for (const key of Object.keys(redacted)) {
    if (SENSITIVE_FIELDS.some((f) => key.toLowerCase().includes(f.toLowerCase()))) {
      redacted[key] = "[REDACTED]";
    } else if (typeof redacted[key] === "object" && redacted[key] !== null) {
      redacted[key] = redactSensitive(redacted[key]);
    }
  }
  return redacted;
}

// Request logging middleware
export function requestLogger(req, res, next) {
  const start = Date.now();
  const { method, url } = req;

  // Log request body in development
  if (!config.isProduction && req.body && Object.keys(req.body).length > 0) {
    const isApiRequest = url.startsWith("/api/") || url.startsWith("/login");
    if (isApiRequest) {
      const safeBody = redactSensitive(req.body);
      const bodyStr = JSON.stringify(safeBody);
      if (bodyStr.length < 2000) {
        console.log(`[REQ BODY] ${method} ${url}`, bodyStr);
      } else {
        console.log(`[REQ BODY] ${method} ${url}`, bodyStr.slice(0, 500) + `... (${bodyStr.length} chars)`);
      }
    }
  }

  // Add response time header before response is sent
  const originalEnd = res.end;
  res.end = function (...args) {
    const duration = Date.now() - start;
    if (!res.headersSent) {
      res.setHeader("X-Response-Time", `${duration}ms`);
    }
    return originalEnd.apply(this, args);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    const status = res.statusCode;
    const log = `[${new Date().toISOString()}] ${method} ${url} ${status} ${duration}ms`;

    if (status >= 400) {
      console.error(log);
    } else {
      console.log(log);
    }

    // Persist API requests (skip static files)
    if (url.startsWith("/api/") || url.startsWith("/login") || url.startsWith("/logout")) {
      const requestInfo = {
        method,
        path: url,
        statusCode: status,
        duration,
        userId: req.session?.user?.id,
        username: req.session?.user?.username,
        ip: req.ip,
        userAgent: req.headers["user-agent"],
      };
      logRequest(requestInfo);
      trackApiCall(requestInfo);
    }
  });

  next();
}
