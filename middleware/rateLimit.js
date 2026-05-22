// Simple in-memory rate limiter
import config from "../utils/config.js";

const loginAttempts = new Map();
const RATE_LIMIT_WINDOW = config.rateLimit.loginWindow;
const MAX_ATTEMPTS = config.rateLimit.loginMax;

// Export for testing
export const _loginAttempts = loginAttempts;
export const _RATE_LIMIT_WINDOW = RATE_LIMIT_WINDOW;

export function rateLimitLogin(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress;
  const now = Date.now();

  if (!loginAttempts.has(ip)) {
    loginAttempts.set(ip, { count: 1, firstAttempt: now });
    return next();
  }

  const attempts = loginAttempts.get(ip);

  // Reset if window has passed
  if (now - attempts.firstAttempt > RATE_LIMIT_WINDOW) {
    loginAttempts.set(ip, { count: 1, firstAttempt: now });
    return next();
  }

  // Check if max attempts exceeded
  if (attempts.count >= MAX_ATTEMPTS) {
    const remainingTime = Math.ceil((RATE_LIMIT_WINDOW - (now - attempts.firstAttempt)) / 60000);
    return res.status(429).json({
      error: `Quá nhiều lần thử đăng nhập. Vui lòng thử lại sau ${remainingTime} phút.`,
    });
  }

  attempts.count++;
  next();
}

// Search API rate limiter - prevents abuse of expensive search endpoints
const searchRequests = new Map();
const SEARCH_RATE_WINDOW = config.rateLimit.searchWindow;
const MAX_SEARCH_PER_MINUTE = config.rateLimit.searchMax;

export const _searchRequests = searchRequests;
export const _SEARCH_RATE_WINDOW = SEARCH_RATE_WINDOW;

export function rateLimitSearch(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress;
  const now = Date.now();

  if (!searchRequests.has(ip)) {
    searchRequests.set(ip, { count: 1, firstRequest: now });
    return next();
  }

  const entry = searchRequests.get(ip);

  if (now - entry.firstRequest > SEARCH_RATE_WINDOW) {
    searchRequests.set(ip, { count: 1, firstRequest: now });
    return next();
  }

  if (entry.count >= MAX_SEARCH_PER_MINUTE) {
    return res.status(429).json({
      error: "Quá nhiều yêu cầu tìm kiếm. Vui lòng chờ 1 phút rồi thử lại.",
    });
  }

  entry.count++;
  next();
}

// Cleanup function - removes expired entries
export function _cleanupExpired() {
  const now = Date.now();
  for (const [ip, attempts] of loginAttempts.entries()) {
    if (now - attempts.firstAttempt > RATE_LIMIT_WINDOW) {
      loginAttempts.delete(ip);
    }
  }
  for (const [ip, entry] of searchRequests.entries()) {
    if (now - entry.firstRequest > SEARCH_RATE_WINDOW) {
      searchRequests.delete(ip);
    }
  }
}

// Clean up old entries periodically (unref so it doesn't prevent process exit)
setInterval(_cleanupExpired, RATE_LIMIT_WINDOW).unref();
