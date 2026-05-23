import crypto from "crypto";

// CSRF protection using double-submit cookie pattern
// For API endpoints, we also check Origin/Referer headers
export function csrfProtection(req, res, next) {
  // Skip for safe methods
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    return next();
  }

  // Skip for auth endpoints (login/logout don't need CSRF protection)
  if (req.path === "/login" || req.path === "/logout") {
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
      // Same-origin check: origin hostname must match the host hostname
      const host = req.headers.host;
      if (host) {
        try {
          const originHost = new URL(origin).host;
          if (originHost !== host) {
            return res.status(403).json({ error: "CSRF validation failed: origin mismatch" });
          }
        } catch {
          return res.status(403).json({ error: "CSRF validation failed: invalid origin" });
        }
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

/**
 * Rotate CSRF token — call after privilege escalation (login, password change, 2FA).
 * Invalidates the old token and issues a new one.
 */
export function rotateCsrfToken(req, _res, next) {
  req.session.csrfToken = crypto.randomBytes(32).toString("hex");
  next();
}
