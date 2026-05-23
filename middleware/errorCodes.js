// Structured error codes — machine-readable error responses
// All API errors follow: { error: "Human message", code: "MACHINE_CODE", details?: {} }

export const ErrorCodes = {
  // Auth errors (1xxx)
  AUTH_REQUIRED: { code: "AUTH_REQUIRED", status: 401, message: "Authentication required" },
  AUTH_INVALID_CREDENTIALS: { code: "AUTH_INVALID_CREDENTIALS", status: 401, message: "Invalid username or password" },
  AUTH_SESSION_EXPIRED: { code: "AUTH_SESSION_EXPIRED", status: 401, message: "Session has expired" },
  AUTH_FORBIDDEN: { code: "AUTH_FORBIDDEN", status: 403, message: "Insufficient permissions" },
  AUTH_CSRF_FAILED: { code: "AUTH_CSRF_FAILED", status: 403, message: "CSRF validation failed" },

  // Validation errors (2xxx)
  VALIDATION_FAILED: { code: "VALIDATION_FAILED", status: 400, message: "Validation failed" },
  VALIDATION_MISSING_FIELD: { code: "VALIDATION_MISSING_FIELD", status: 400, message: "Required field missing" },
  VALIDATION_INVALID_FORMAT: { code: "VALIDATION_INVALID_FORMAT", status: 400, message: "Invalid format" },
  VALIDATION_TOO_LONG: { code: "VALIDATION_TOO_LONG", status: 400, message: "Value too long" },
  VALIDATION_TOO_SHORT: { code: "VALIDATION_TOO_SHORT", status: 400, message: "Value too short" },

  // Resource errors (3xxx)
  RESOURCE_NOT_FOUND: { code: "RESOURCE_NOT_FOUND", status: 404, message: "Resource not found" },
  RESOURCE_CONFLICT: { code: "RESOURCE_CONFLICT", status: 409, message: "Resource already exists" },
  RESOURCE_GONE: { code: "RESOURCE_GONE", status: 410, message: "Resource no longer available" },

  // Rate limit errors (4xxx)
  RATE_LIMIT_EXCEEDED: { code: "RATE_LIMIT_EXCEEDED", status: 429, message: "Rate limit exceeded" },
  RATE_LIMIT_LOGIN: { code: "RATE_LIMIT_LOGIN", status: 429, message: "Too many login attempts" },

  // Server errors (5xxx)
  SERVER_ERROR: { code: "SERVER_ERROR", status: 500, message: "Internal server error" },
  SERVER_UNAVAILABLE: { code: "SERVER_UNAVAILABLE", status: 503, message: "Service temporarily unavailable" },
  SERVER_TIMEOUT: { code: "SERVER_TIMEOUT", status: 408, message: "Request timeout" },
  SERVER_PROXY_ERROR: { code: "SERVER_PROXY_ERROR", status: 502, message: "Proxy error" },
};

/**
 * Create a structured error response.
 */
export function apiError(res, errorDef, details) {
  const body = {
    error: errorDef.message,
    code: errorDef.code,
    status: errorDef.status,
  };
  if (details) body.details = details;
  return res.status(errorDef.status).json(body);
}

/**
 * Express middleware that adds apiError helper to res.
 */
export function errorCodesMiddleware(_req, res, next) {
  res.apiError = (errorDef, details) => apiError(res, errorDef, details);
  next();
}
