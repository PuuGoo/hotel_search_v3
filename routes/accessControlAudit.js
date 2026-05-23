// Access control audit routes

import { Router } from "express";
import { checkAuthenticated, checkRole } from "../middleware/auth.js";
import {
  defineRule,
  getRules,
  getRule,
  updateRule,
  deleteRule,
  runAudit,
  getAuditHistory,
  getAccessControlStats,
  clearAccessControlData,
} from "../utils/accessControlAudit.js";

const router = Router();

/**
 * POST /api/access-control/rules
 * Define an access control rule (admin only).
 */
router.post("/api/access-control/rules", checkAuthenticated, checkRole("admin"), (req, res) => {
  const rule = defineRule({
    ...req.body,
    userId: req.session.user?.id,
  });
  res.status(201).json(rule);
});

/**
 * GET /api/access-control/rules
 * Get all rules with optional filters.
 */
router.get("/api/access-control/rules", checkAuthenticated, checkRole("admin"), (req, res) => {
  const { resource, enabled } = req.query;
  const result = getRules({
    resource: resource || null,
    enabled: enabled !== undefined ? enabled === "true" : null,
  });
  res.json(result);
});

/**
 * GET /api/access-control/stats
 * Get access control statistics.
 */
router.get("/api/access-control/stats", checkAuthenticated, checkRole("admin"), (_req, res) => {
  const stats = getAccessControlStats();
  res.json(stats);
});

/**
 * POST /api/access-control/audit
 * Run access control audit (admin only).
 */
router.post("/api/access-control/audit", checkAuthenticated, checkRole("admin"), (req, res) => {
  const audit = runAudit({
    currentAccess: req.body.currentAccess || {},
    userId: req.session.user?.id,
  });
  res.json(audit);
});

/**
 * GET /api/access-control/history
 * Get audit history.
 */
router.get("/api/access-control/history", checkAuthenticated, checkRole("admin"), (req, res) => {
  const limit = req.query.limit ? parseInt(req.query.limit) : 50;
  const history = getAuditHistory(limit);
  res.json(history);
});

/**
 * DELETE /api/access-control/clear
 * Clear access control data (admin only).
 */
router.delete("/api/access-control/clear", checkAuthenticated, checkRole("admin"), (_req, res) => {
  clearAccessControlData();
  res.json({ message: "Access control data cleared" });
});

/**
 * GET /api/access-control/rules/:id
 * Get a specific rule.
 */
router.get("/api/access-control/rules/:id", checkAuthenticated, checkRole("admin"), (req, res) => {
  const rule = getRule(req.params.id);
  if (!rule) {
    return res.status(404).json({ error: "Rule not found", code: 404 });
  }
  res.json(rule);
});

/**
 * PUT /api/access-control/rules/:id
 * Update a rule (admin only).
 */
router.put("/api/access-control/rules/:id", checkAuthenticated, checkRole("admin"), (req, res) => {
  const rule = updateRule(req.params.id, req.body);
  if (!rule) {
    return res.status(404).json({ error: "Rule not found", code: 404 });
  }
  res.json(rule);
});

/**
 * DELETE /api/access-control/rules/:id
 * Delete a rule (admin only).
 */
router.delete("/api/access-control/rules/:id", checkAuthenticated, checkRole("admin"), (req, res) => {
  const deleted = deleteRule(req.params.id);
  if (!deleted) {
    return res.status(404).json({ error: "Rule not found", code: 404 });
  }
  res.json({ message: "Rule deleted" });
});

export default router;
