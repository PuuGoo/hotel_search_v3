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
- [x] Security headers (X-Content-Type, X-Frame, X-XSS)
- [x] Add CORS configuration
- [x] Add request body size limits (2mb)
- [ ] Add helmet for production security headers
- [ ] Add CSRF protection for state-changing endpoints

## Phase 2: Test Coverage (202 tests, 88% overall)
- [x] Auth routes tests (89.47%)
- [x] User management tests (97.53%)
- [x] Chat routes tests (97.61%)
- [x] Utility function tests (ddg.js — 98.52%)
- [x] Validation middleware tests (100%)
- [x] Rate limiter tests (100%)
- [x] Logger middleware tests (100%)
- [x] Request ID middleware tests (100%)
- [x] Timeout middleware tests (100%)
- [x] Server configuration tests
- [x] Search routes tests (search.js — 53.77%)
- [x] Case12 route tests (case12.js — 100%)
- [x] Edge case tests for error handlers
- [ ] Improve search.js coverage (key rotation/DDG server edge cases)

## Phase 3: API Quality
- [x] Consistent JSON error responses
- [x] Health endpoint
- [x] Graceful shutdown handling (SIGTERM/SIGINT)
- [x] Request ID tracking (X-Request-Id header)
- [x] API response time headers (X-Response-Time)
- [x] Request timeout middleware (408)
- [ ] Standardize all error responses format

## Phase 4: Architecture
- [x] Route separation (auth, users, chat, search, case12, pages)
- [x] Middleware layer (auth, validation, rateLimit, logger, requestId, timeout)
- [x] Utility extraction (ddg.js)
- [ ] Add OpenAPI/Swagger documentation
- [ ] Add structured logging (JSON format for production)
- [ ] Add environment-based config management

## Phase 5: Reliability
- [x] Error handling on all routes
- [x] DDG server health checks + auto-start
- [x] Tavily/Google API key rotation with retry
- [ ] Add circuit breaker for external APIs
- [ ] Add health check dependencies (DB, external APIs)
