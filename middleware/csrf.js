import crypto from "crypto";

// CSRF protection using double-submit cookie pattern
// For API endpoints, we also check Origin/Referer headers
export function csrfProtection(req, res, next) {
  // Skip for safe methods
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    return next();
  }

  // Skip for login endpoint (already rate-limited, no session to hijack)
  if (req.path === "/login") {
    return next();
  }

  // Check Origin header for API requests
  const origin = req.headers.origin || req.headers.referer;
  if (origin) {
    const allowedOrigins = process.env.CORS_ORIGINS
      ? process.env.CORS_ORIGINS.split(",").map((o) => o.trim())
      : [];

    // If no CORS_ORIGINS configured, allow same-origin only
    if (allowedOrigins.length > 0) {
      const isAllowed = allowedOrigins.some((o) => origin.startsWith(o));
      if (!isAllowed) {
        return res.status(403).json({ error: "CSRF validation failed: invalid origin" });
      }
    } else {
      // Same-origin check: origin must match the host
      const host = req.headers.host;
      if (host && !origin.includes(host)) {
        return res.status(403).json({ error: "CSRF validation failed: origin mismatch" });
      }
    }
  }

  next();
}

// Generate CSRF token (for form-based submissions)
export function generateCsrfToken(req, res, next) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString("hex");
  }
  res.locals.csrfToken = req.session.csrfToken;
  next();
}

// Validate CSRF token from form submissions
export function validateCsrfToken(req, res, next) {
  // Skip for safe methods
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    return next();
  }

  const token = req.body._csrf || req.headers["x-csrf-token"];
  if (!token || token !== req.session.csrfToken) {
    return res.status(403).json({ error: "CSRF token validation failed" });
  }

  next();
}
