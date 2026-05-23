import { Router } from "express";
import { checkAuthenticated, checkRole } from "../middleware/auth.js";
import { _loginAttempts, _searchRequests, _RATE_LIMIT_WINDOW, _SEARCH_RATE_WINDOW } from "../middleware/rateLimit.js";
import config from "../utils/config.js";

const router = Router();

// GET /api/admin/rate-limits — view all rate limit state (admin only)
router.get("/api/admin/rate-limits", checkAuthenticated, checkRole("admin"), (_req, res) => {
  const now = Date.now();

  // Login attempts
  const loginEntries = [];
  for (const [ip, data] of _loginAttempts.entries()) {
    const elapsed = now - data.firstAttempt;
    if (elapsed <= _RATE_LIMIT_WINDOW) {
      loginEntries.push({
        ip,
        count: data.count,
        remaining: Math.max(0, config.rateLimit.loginMax - data.count),
        resetInMs: Math.max(0, _RATE_LIMIT_WINDOW - elapsed),
        windowMs: _RATE_LIMIT_WINDOW,
      });
    }
  }

  // Search requests
  const searchEntries = [];
  for (const [key, data] of _searchRequests.entries()) {
    const elapsed = now - data.firstRequest;
    if (elapsed <= _SEARCH_RATE_WINDOW) {
      searchEntries.push({
        key,
        count: data.count,
        remaining: Math.max(0, config.rateLimit.searchMax - data.count),
        resetInMs: Math.max(0, _SEARCH_RATE_WINDOW - elapsed),
        windowMs: _SEARCH_RATE_WINDOW,
      });
    }
  }

  res.json({
    timestamp: new Date().toISOString(),
    config: {
      login: {
        max: config.rateLimit.loginMax,
        windowMs: config.rateLimit.loginWindow,
      },
      search: {
        max: config.rateLimit.searchMax,
        windowMs: config.rateLimit.searchWindow,
      },
    },
    login: {
      total: loginEntries.length,
      entries: loginEntries.sort((a, b) => b.count - a.count),
    },
    search: {
      total: searchEntries.length,
      entries: searchEntries.sort((a, b) => b.count - a.count),
    },
  });
});

// GET /api/rate-limit/status — current user's rate limit status
router.get("/api/rate-limit/status", checkAuthenticated, (req, res) => {
  const now = Date.now();
  const userId = req.session.user?.id;
  const key = userId ? `user:${userId}` : `ip:${req.ip}`;
  const ip = req.ip || req.connection.remoteAddress;

  // Login status
  const loginEntry = _loginAttempts.get(ip);
  let loginUsed = 0;
  let loginRemaining = config.rateLimit.loginMax;
  let loginResetMs = 0;

  if (loginEntry) {
    const elapsed = now - loginEntry.firstAttempt;
    if (elapsed <= _RATE_LIMIT_WINDOW) {
      loginUsed = loginEntry.count;
      loginRemaining = Math.max(0, config.rateLimit.loginMax - loginEntry.count);
      loginResetMs = Math.max(0, _RATE_LIMIT_WINDOW - elapsed);
    }
  }

  // Search status
  const searchEntry = _searchRequests.get(key);
  let searchUsed = 0;
  let searchRemaining = config.rateLimit.searchMax;
  let searchResetMs = 0;

  if (searchEntry) {
    const elapsed = now - searchEntry.firstRequest;
    if (elapsed <= _SEARCH_RATE_WINDOW) {
      searchUsed = searchEntry.count;
      searchRemaining = Math.max(0, config.rateLimit.searchMax - searchEntry.count);
      searchResetMs = Math.max(0, _SEARCH_RATE_WINDOW - elapsed);
    }
  }

  res.json({
    login: {
      limit: config.rateLimit.loginMax,
      used: loginUsed,
      remaining: loginRemaining,
      resetInMs: loginResetMs,
      windowMs: config.rateLimit.loginWindow,
    },
    search: {
      limit: config.rateLimit.searchMax,
      used: searchUsed,
      remaining: searchRemaining,
      resetInMs: searchResetMs,
      windowMs: config.rateLimit.searchWindow,
    },
  });
});

export default router;
