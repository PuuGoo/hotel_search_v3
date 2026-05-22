# Hotel Search v2 — Production Roadmap

## Status Legend
- [x] Done
- [ ] In Progress / TODO

---

## Phase 1: Security Hardening
- [x] Session-based auth with bcrypt
- [x] Session fixation protection (regenerate ID after login)
- [x] Rate limiting (login + search + user endpoints)
- [x] Input validation middleware
- [x] XSS protection (escapeHtml, CSP headers with frame-ancestors, base-uri, form-action)
- [x] Security headers (helmet + X-Content-Type, X-Frame, X-XSS)
- [x] HSTS in production (Strict-Transport-Security)
- [x] CORS configuration (CORS_ORIGINS env var)
- [x] Request body size limits (2mb)
- [x] CSRF protection (Origin/Referer + token-based)
- [x] Remove error.message from API responses
- [x] Failed login attempt logging with IP for security monitoring
- [x] Favicon route to avoid 404 noise

## Phase 2: Test Coverage (276 tests, 15 suites, 96.59% statements)
- [x] Auth routes tests (97.36%)
- [x] User management tests (97.53%)
- [x] Chat routes tests (100%)
- [x] Utility function tests (ddg.js — 98.52%)
- [x] Validation middleware tests (100%)
- [x] Rate limiter tests (100%)
- [x] Logger middleware tests (100%)
- [x] Request ID middleware tests (100%)
- [x] Timeout middleware tests (100%)
- [x] CSRF middleware tests (100%)
- [x] Circuit breaker tests (100%)
- [x] Config module tests
- [x] Structured logger tests
- [x] Server configuration tests
- [x] Search routes tests (75.22% — key rotation + DDG server)
- [x] Case12 route tests (100%)
- [x] Page route tests (100%)
- [x] Edge case tests for error handlers

## Phase 3: API Quality
- [x] Consistent JSON error responses
- [x] Health endpoint with dependency checks
- [x] Graceful shutdown handling (SIGTERM/SIGINT)
- [x] Request ID tracking (X-Request-Id header)
- [x] API response time headers (X-Response-Time)
- [x] Request timeout middleware (408)
- [x] No error.message exposure in responses

## Phase 4: Architecture
- [x] Route separation (auth, users, chat, search, case12, pages)
- [x] Middleware layer (auth, validation, rateLimit, logger, requestId, timeout, csrf)
- [x] Utility extraction (ddg.js, config.js, logger.js, circuitBreaker.js)
- [x] Environment-based config management
- [x] Rate limiter uses config module (login/search window + max)
- [x] Centralized DDG_SERVER_URL via config (search routes + health endpoint)
- [x] Centralized CASE12_API_URL via config
- [x] Structured logging (JSON in production)
- [x] Add OpenAPI/Swagger documentation
- [x] Python requirements.txt for reproducible builds
- [x] Meta description tags on all HTML pages
- [x] Autocomplete attributes on password fields

## Phase 5: Reliability
- [x] Error handling on all routes
- [x] DDG server health checks + auto-start
- [x] Tavily/Google API key rotation with retry
- [x] Circuit breaker for external APIs
- [x] Health check dependencies (DDG server)
- [x] Python bare except clauses fixed (ddg_server.py, ddg_search.py)
- [x] Generic error messages in test routes (no e.message exposure)
