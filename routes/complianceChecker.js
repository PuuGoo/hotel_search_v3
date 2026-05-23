// Compliance checker routes

import { Router } from "express";
import { checkAuthenticated, checkRole } from "../middleware/auth.js";
import {
  definePolicy,
  getPolicies,
  getPolicy,
  updatePolicy,
  deletePolicy,
  runComplianceCheck,
  getCheckHistory,
  getComplianceStats,
  clearComplianceData,
} from "../utils/complianceChecker.js";

const router = Router();

/**
 * POST /api/compliance/policies
 * Define a compliance policy (admin only).
 */
router.post("/api/compliance/policies", checkAuthenticated, checkRole("admin"), (req, res) => {
  const policy = definePolicy({
    ...req.body,
    userId: req.session.user?.id,
  });
  res.status(201).json(policy);
});

/**
 * GET /api/compliance/policies
 * Get all policies with optional filters.
 */
router.get("/api/compliance/policies", checkAuthenticated, checkRole("admin"), (req, res) => {
  const { category, enabled } = req.query;
  const result = getPolicies({
    category: category || null,
    enabled: enabled !== undefined ? enabled === "true" : null,
  });
  res.json(result);
});

/**
 * GET /api/compliance/stats
 * Get compliance statistics.
 */
router.get("/api/compliance/stats", checkAuthenticated, checkRole("admin"), (_req, res) => {
  const stats = getComplianceStats();
  res.json(stats);
});

/**
 * POST /api/compliance/check
 * Run compliance check (admin only).
 */
router.post("/api/compliance/check", checkAuthenticated, checkRole("admin"), (req, res) => {
  const check = runComplianceCheck({
    systemState: req.body.systemState || {},
  });
  res.json(check);
});

/**
 * GET /api/compliance/history
 * Get compliance check history.
 */
router.get("/api/compliance/history", checkAuthenticated, checkRole("admin"), (req, res) => {
  const limit = req.query.limit ? parseInt(req.query.limit) : 50;
  const history = getCheckHistory(limit);
  res.json(history);
});

/**
 * DELETE /api/compliance/clear
 * Clear compliance data (admin only).
 */
router.delete("/api/compliance/clear", checkAuthenticated, checkRole("admin"), (_req, res) => {
  clearComplianceData();
  res.json({ message: "Compliance data cleared" });
});

/**
 * GET /api/compliance/policies/:id
 * Get a specific policy.
 */
router.get("/api/compliance/policies/:id", checkAuthenticated, checkRole("admin"), (req, res) => {
  const policy = getPolicy(req.params.id);
  if (!policy) {
    return res.status(404).json({ error: "Policy not found", code: 404 });
  }
  res.json(policy);
});

/**
 * PUT /api/compliance/policies/:id
 * Update a policy (admin only).
 */
router.put("/api/compliance/policies/:id", checkAuthenticated, checkRole("admin"), (req, res) => {
  const policy = updatePolicy(req.params.id, req.body);
  if (!policy) {
    return res.status(404).json({ error: "Policy not found", code: 404 });
  }
  res.json(policy);
});

/**
 * DELETE /api/compliance/policies/:id
 * Delete a policy (admin only).
 */
router.delete("/api/compliance/policies/:id", checkAuthenticated, checkRole("admin"), (req, res) => {
  const deleted = deletePolicy(req.params.id);
  if (!deleted) {
    return res.status(404).json({ error: "Policy not found", code: 404 });
  }
  res.json({ message: "Policy deleted" });
});

export default router;
