# Hotel Search v2 — Production Roadmap

## Status Legend
- [x] Done
- [ ] In Progress / TODO

---

## Phase 1: Security Hardening
- [x] Session-based auth with bcrypt
- [x] Rate limiting (login + search)
- [x] Input validation middleware
- [x] XSS protection (escapeHtml, CSP headers)
- [x] Security headers (helmet + X-Content-Type, X-Frame, X-XSS)
- [x] CORS configuration (CORS_ORIGINS env var)
- [x] Request body size limits (2mb)
- [x] CSRF protection (Origin/Referer + token-based)

## Phase 2: Test Coverage (241 tests, 88%+ overall)
- [x] Auth routes tests (89.47%)
- [x] User management tests (97.53%)
- [x] Chat routes tests (97.61%)
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
- [x] Search routes tests (53.77%)
- [x] Case12 route tests (100%)
- [x] Edge case tests for error handlers
- [ ] Improve search.js coverage (key rotation/DDG server)

## Phase 3: API Quality
- [x] Consistent JSON error responses
- [x] Health endpoint with dependency checks
- [x] Graceful shutdown handling (SIGTERM/SIGINT)
- [x] Request ID tracking (X-Request-Id header)
- [x] API response time headers (X-Response-Time)
- [x] Request timeout middleware (408)
- [ ] Standardize all error responses format

## Phase 4: Architecture
- [x] Route separation (auth, users, chat, search, case12, pages)
- [x] Middleware layer (auth, validation, rateLimit, logger, requestId, timeout, csrf)
- [x] Utility extraction (ddg.js, config.js, logger.js, circuitBreaker.js)
- [x] Environment-based config management
- [x] Structured logging (JSON in production)
- [ ] Add OpenAPI/Swagger documentation

## Phase 5: Reliability
- [x] Error handling on all routes
- [x] DDG server health checks + auto-start
- [x] Tavily/Google API key rotation with retry
- [x] Circuit breaker for external APIs
- [x] Health check dependencies (DDG server)
