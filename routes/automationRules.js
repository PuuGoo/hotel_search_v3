// Automation rules routes — trigger actions based on conditions

import { Router } from "express";
import { checkAuthenticated, checkRole } from "../middleware/auth.js";
import {
  createRule,
  getRules,
  getRule,
  updateRule,
  deleteRule,
  processEvent,
  getExecutions,
  getAutomationStats,
  clearAutomationData,
} from "../utils/automationRules.js";

const router = Router();

/**
 * POST /api/automation/rules
 * Create an automation rule (admin only).
 */
router.post("/api/automation/rules", checkAuthenticated, checkRole("admin"), (req, res) => {
  const rule = createRule({
    ...req.body,
    userId: req.session.user?.id,
  });
  if (rule.error) {
    return res.status(400).json({ error: rule.error, code: 400 });
  }
  res.status(201).json(rule);
});

/**
 * GET /api/automation/rules
 * Get all rules (admin only).
 */
router.get("/api/automation/rules", checkAuthenticated, checkRole("admin"), (req, res) => {
  const enabled = req.query.enabled !== undefined ? req.query.enabled === "true" : null;
  const rules = getRules({ enabled });
  res.json({ rules, count: rules.length });
});

/**
 * GET /api/automation/stats
 * Get automation statistics (admin only).
 */
router.get("/api/automation/stats", checkAuthenticated, checkRole("admin"), (_req, res) => {
  const stats = getAutomationStats();
  res.json(stats);
});

/**
 * POST /api/automation/process
 * Process an event through rules (admin only).
 */
router.post("/api/automation/process", checkAuthenticated, checkRole("admin"), (req, res) => {
  const { eventType, context } = req.body;
  if (!eventType) {
    return res.status(400).json({ error: "eventType is required", code: 400 });
  }
  const result = processEvent(eventType, context);
  res.json(result);
});

/**
 * GET /api/automation/executions
 * Get rule executions (admin only).
 */
router.get("/api/automation/executions", checkAuthenticated, checkRole("admin"), (req, res) => {
  const ruleId = req.query.ruleId || null;
  const limit = parseInt(req.query.limit) || 50;
  const executions = getExecutions({ ruleId, limit });
  res.json(executions);
});

/**
 * GET /api/automation/rules/:id
 * Get a specific rule (admin only).
 */
router.get("/api/automation/rules/:id", checkAuthenticated, checkRole("admin"), (req, res) => {
  const rule = getRule(req.params.id);
  if (!rule) {
    return res.status(404).json({ error: "Rule not found", code: 404 });
  }
  res.json(rule);
});

/**
 * PUT /api/automation/rules/:id
 * Update a rule (admin only).
 */
router.put("/api/automation/rules/:id", checkAuthenticated, checkRole("admin"), (req, res) => {
  const rule = updateRule(req.params.id, req.body);
  if (!rule) {
    return res.status(404).json({ error: "Rule not found", code: 404 });
  }
  res.json(rule);
});

/**
 * DELETE /api/automation/rules/:id
 * Delete a rule (admin only).
 */
router.delete("/api/automation/rules/:id", checkAuthenticated, checkRole("admin"), (req, res) => {
  const deleted = deleteRule(req.params.id);
  if (!deleted) {
    return res.status(404).json({ error: "Rule not found", code: 404 });
  }
  res.json({ message: "Rule deleted" });
});

/**
 * DELETE /api/automation/clear
 * Clear automation data (admin only).
 */
router.delete("/api/automation/clear", checkAuthenticated, checkRole("admin"), (_req, res) => {
  clearAutomationData();
  res.json({ message: "Automation data cleared" });
});

export default router;
