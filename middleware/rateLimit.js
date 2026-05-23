// Simple in-memory rate limiter
import config from "../utils/config.js";

const loginAttempts = new Map();
const RATE_LIMIT_WINDOW = config.rateLimit.loginWindow;
const MAX_ATTEMPTS = config.rateLimit.loginMax;
const LOCKOUT_THRESHOLD = 3; // Start delaying after this many failures
const MAX_DELAY_MS = 30000; // Cap delay at 30 seconds

// Export for testing
export const _loginAttempts = loginAttempts;
export const _RATE_LIMIT_WINDOW = RATE_LIMIT_WINDOW;
export const _LOCKOUT_THRESHOLD = LOCKOUT_THRESHOLD;
export const _MAX_DELAY_MS = MAX_DELAY_MS;

/**
 * Record a failed login attempt and return the progressive delay in ms.
 * Returns 0 if below lockout threshold.
 */
export function recordLoginFailure(req) {
  const ip = req.ip || req.connection.remoteAddress;
  const now = Date.now();
  const entry = loginAttempts.get(ip);

  if (!entry) {
    loginAttempts.set(ip, { count: 1, firstAttempt: now, failures: 1 });
    return 0;
  }

  // Increment rate limit counter for failed attempts
  entry.count = (entry.count || 0) + 1;
  entry.failures = (entry.failures || 0) + 1;

  if (entry.failures <= LOCKOUT_THRESHOLD) {
    return 0;
  }

  // Progressive delay: 2^(failures - threshold - 1) * 1000, capped
  const delayExponent = entry.failures - LOCKOUT_THRESHOLD - 1;
  const delay = Math.min(Math.pow(2, delayExponent) * 1000, MAX_DELAY_MS);
  return delay;
}

/**
 * Apply progressive delay by sleeping. Call before sending error response.
 */
export function applyLoginDelay(req, res, next) {
  const delay = recordLoginFailure(req);
  if (delay > 0) {
    res.setHeader("X-Login-Delay", delay);
    return setTimeout(next, delay);
  }
  next();
}

/**
 * Get current lockout info for an IP (for testing/debugging).
 */
export function getLockoutInfo(req) {
  const ip = req.ip || req.connection.remoteAddress;
  const entry = loginAttempts.get(ip);
  if (!entry) return { failures: 0, delay: 0 };
  const failures = entry.failures || 0;
  const delay = failures > LOCKOUT_THRESHOLD
    ? Math.min(Math.pow(2, failures - LOCKOUT_THRESHOLD - 1) * 1000, MAX_DELAY_MS)
    : 0;
  return { failures, delay };
}

export function rateLimitLogin(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress;
  const now = Date.now();

  if (!loginAttempts.has(ip)) {
    loginAttempts.set(ip, { count: 0, firstAttempt: now });
    res.setHeader("X-RateLimit-Limit", MAX_ATTEMPTS);
    res.setHeader("X-RateLimit-Remaining", MAX_ATTEMPTS);
    res.setHeader("X-RateLimit-Reset", Math.ceil((now + RATE_LIMIT_WINDOW) / 1000));
    return next();
  }

  const attempts = loginAttempts.get(ip);

  // Reset if window has passed
  if (now - attempts.firstAttempt > RATE_LIMIT_WINDOW) {
    loginAttempts.set(ip, { count: 0, firstAttempt: now });
    res.setHeader("X-RateLimit-Limit", MAX_ATTEMPTS);
    res.setHeader("X-RateLimit-Remaining", MAX_ATTEMPTS);
    res.setHeader("X-RateLimit-Reset", Math.ceil((now + RATE_LIMIT_WINDOW) / 1000));
    return next();
  }

  // Check if max attempts exceeded
  if (attempts.count >= MAX_ATTEMPTS) {
    res.setHeader("X-RateLimit-Limit", MAX_ATTEMPTS);
    res.setHeader("X-RateLimit-Remaining", 0);
    res.setHeader("X-RateLimit-Reset", Math.ceil((attempts.firstAttempt + RATE_LIMIT_WINDOW) / 1000));
    const remainingTime = Math.ceil((RATE_LIMIT_WINDOW - (now - attempts.firstAttempt)) / 60000);
    return res.status(429).json({
      error: `Quá nhiều lần thử đăng nhập. Vui lòng thử lại sau ${remainingTime} phút.`,
    });
  }

  // Don't increment here - only count failed attempts via recordLoginFailure
  const remaining = Math.max(0, MAX_ATTEMPTS - attempts.count);
  res.setHeader("X-RateLimit-Limit", MAX_ATTEMPTS);
  res.setHeader("X-RateLimit-Remaining", remaining);
  res.setHeader("X-RateLimit-Reset", Math.ceil((attempts.firstAttempt + RATE_LIMIT_WINDOW) / 1000));
  next();
}

/**
 * Reset rate limit counter on successful login.
 */
export function resetLoginAttempts(req) {
  const ip = req.ip || req.connection.remoteAddress;
  loginAttempts.delete(ip);
}

// Search API rate limiter - prevents abuse of expensive search endpoints
const searchRequests = new Map();
const SEARCH_RATE_WINDOW = config.rateLimit.searchWindow;
const MAX_SEARCH_PER_MINUTE = config.rateLimit.searchMax;

export const _searchRequests = searchRequests;
export const _SEARCH_RATE_WINDOW = SEARCH_RATE_WINDOW;

// Rate limit status endpoint handler
export function rateLimitStatus(req, res) {
  const key = getSearchKey(req);
  const now = Date.now();

  const searchEntry = searchRequests.get(key);
  let searchUsed = 0;
  let searchRemaining = MAX_SEARCH_PER_MINUTE;
  let searchResetMs = 0;

  if (searchEntry) {
    if (now - searchEntry.firstRequest <= SEARCH_RATE_WINDOW) {
      searchUsed = searchEntry.count;
      searchRemaining = Math.max(0, MAX_SEARCH_PER_MINUTE - searchEntry.count);
      searchResetMs = Math.max(0, SEARCH_RATE_WINDOW - (now - searchEntry.firstRequest));
    }
  }

  res.json({
    search: {
      limit: MAX_SEARCH_PER_MINUTE,
      used: searchUsed,
      remaining: searchRemaining,
      resetInMs: searchResetMs,
      windowMs: SEARCH_RATE_WINDOW,
    },
  });
}

function getSearchKey(req) {
  if (req.session?.user?.id) {
    return `user:${req.session.user.id}`;
  }
  return `ip:${req.ip || req.connection.remoteAddress}`;
}

export function rateLimitSearch(req, res, next) {
  const key = getSearchKey(req);
  const now = Date.now();

  if (!searchRequests.has(key)) {
    searchRequests.set(key, { count: 1, firstRequest: now });
    res.setHeader("X-RateLimit-Limit", MAX_SEARCH_PER_MINUTE);
    res.setHeader("X-RateLimit-Remaining", MAX_SEARCH_PER_MINUTE - 1);
    res.setHeader("X-RateLimit-Reset", Math.ceil((now + SEARCH_RATE_WINDOW) / 1000));
    return next();
  }

  const entry = searchRequests.get(key);

  if (now - entry.firstRequest > SEARCH_RATE_WINDOW) {
    searchRequests.set(key, { count: 1, firstRequest: now });
    res.setHeader("X-RateLimit-Limit", MAX_SEARCH_PER_MINUTE);
    res.setHeader("X-RateLimit-Remaining", MAX_SEARCH_PER_MINUTE - 1);
    res.setHeader("X-RateLimit-Reset", Math.ceil((now + SEARCH_RATE_WINDOW) / 1000));
    return next();
  }

  if (entry.count >= MAX_SEARCH_PER_MINUTE) {
    res.setHeader("X-RateLimit-Limit", MAX_SEARCH_PER_MINUTE);
    res.setHeader("X-RateLimit-Remaining", 0);
    res.setHeader("X-RateLimit-Reset", Math.ceil((entry.firstRequest + SEARCH_RATE_WINDOW) / 1000));
    return res.status(429).json({
      error: "Quá nhiều yêu cầu tìm kiếm. Vui lòng chờ 1 phút rồi thử lại.",
    });
  }

  entry.count++;
  const remaining = Math.max(0, MAX_SEARCH_PER_MINUTE - entry.count);
  res.setHeader("X-RateLimit-Limit", MAX_SEARCH_PER_MINUTE);
  res.setHeader("X-RateLimit-Remaining", remaining);
  res.setHeader("X-RateLimit-Reset", Math.ceil((entry.firstRequest + SEARCH_RATE_WINDOW) / 1000));
  next();
}

// Cleanup function - removes expired entries
export function _cleanupExpired() {
  const now = Date.now();
  for (const [key, attempts] of loginAttempts.entries()) {
    if (now - attempts.firstAttempt > RATE_LIMIT_WINDOW) {
      loginAttempts.delete(key);
    }
  }
  for (const [key, entry] of searchRequests.entries()) {
    if (now - entry.firstRequest > SEARCH_RATE_WINDOW) {
      searchRequests.delete(key);
    }
  }
}

// Clean up old entries periodically (unref so it doesn't prevent process exit)
setInterval(_cleanupExpired, RATE_LIMIT_WINDOW).unref();
