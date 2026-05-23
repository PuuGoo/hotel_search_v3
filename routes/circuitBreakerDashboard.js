// Circuit breaker dashboard — visual status of all circuit breakers
import { Router } from "express";
import { checkAuthenticated, checkRole } from "../middleware/auth.js";
import { CircuitBreaker } from "../utils/circuitBreaker.js";

const router = Router();

// Registry of all circuit breakers
const breakers = new Map();

/**
 * Register a circuit breaker for monitoring.
 */
export function registerBreaker(name, breaker) {
  breakers.set(name, breaker);
}

/**
 * Get or create a named circuit breaker.
 */
export function getBreaker(name, options) {
  if (!breakers.has(name)) {
    breakers.set(name, new CircuitBreaker(options));
  }
  return breakers.get(name);
}

// GET /api/circuit-breakers — list all circuit breakers and their status
router.get("/api/circuit-breakers", checkAuthenticated, checkRole("admin"), (_req, res) => {
  const statuses = [];

  for (const [name, breaker] of breakers) {
    const stats = breaker.getStats();
    statuses.push({
      name,
      state: stats.state,
      failureCount: stats.failureCount,
      lastFailureTime: stats.lastFailureTime,
      lastFailureAge: stats.lastFailureTime
        ? Date.now() - stats.lastFailureTime
        : null,
      healthy: stats.state !== "open",
    });
  }

  const allHealthy = statuses.every((s) => s.healthy);

  res.json({
    status: allHealthy ? "ok" : "degraded",
    totalBreakers: statuses.length,
    healthy: statuses.filter((s) => s.healthy).length,
    unhealthy: statuses.filter((s) => !s.healthy).length,
    breakers: statuses,
    timestamp: new Date().toISOString(),
  });
});

// POST /api/circuit-breakers/:name/reset — manually reset a circuit breaker
router.post("/api/circuit-breakers/:name/reset", checkAuthenticated, checkRole("admin"), (req, res) => {
  const breaker = breakers.get(req.params.name);
  if (!breaker) {
    return res.status(404).json({ error: "Circuit breaker not found" });
  }
  breaker.reset();
  res.json({ success: true, name: req.params.name, state: breaker.getState() });
});

export default router;
