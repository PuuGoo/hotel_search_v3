// Workflow engine routes — define and execute multi-step workflows

import { Router } from "express";
import { checkAuthenticated, checkRole } from "../middleware/auth.js";
import {
  createWorkflow,
  getWorkflows,
  getWorkflow,
  updateWorkflow,
  deleteWorkflow,
  executeWorkflow,
  getExecutions,
  getExecution,
  getWorkflowStats,
  clearWorkflowData,
} from "../utils/workflowEngine.js";

const router = Router();

/**
 * POST /api/workflows
 * Create a workflow (admin only).
 */
router.post("/api/workflows", checkAuthenticated, checkRole("admin"), (req, res) => {
  const workflow = createWorkflow({
    ...req.body,
    userId: req.session.user?.id,
  });
  if (workflow.error) {
    return res.status(400).json({ error: workflow.error, code: 400 });
  }
  res.status(201).json(workflow);
});

/**
 * GET /api/workflows
 * Get all workflows (admin only).
 */
router.get("/api/workflows", checkAuthenticated, checkRole("admin"), (req, res) => {
  const enabled = req.query.enabled !== undefined ? req.query.enabled === "true" : null;
  const workflows = getWorkflows({ enabled });
  res.json({ workflows, count: workflows.length });
});

/**
 * GET /api/workflows/stats
 * Get workflow statistics (admin only).
 */
router.get("/api/workflows/stats", checkAuthenticated, checkRole("admin"), (_req, res) => {
  const stats = getWorkflowStats();
  res.json(stats);
});

/**
 * GET /api/workflows/executions/list
 * Get execution history (admin only).
 */
router.get("/api/workflows/executions/list", checkAuthenticated, checkRole("admin"), (req, res) => {
  const workflowId = req.query.workflowId || null;
  const status = req.query.status || null;
  const limit = parseInt(req.query.limit) || 50;
  const executions = getExecutions({ workflowId, status, limit });
  res.json(executions);
});

/**
 * POST /api/workflows/:id/execute
 * Execute a workflow (admin only).
 */
router.post("/api/workflows/:id/execute", checkAuthenticated, checkRole("admin"), (req, res) => {
  const execution = executeWorkflow(req.params.id, {
    userId: req.session.user?.id,
    context: req.body?.context,
  });
  if (execution.error) {
    return res.status(400).json({ error: execution.error, code: 400 });
  }
  res.status(201).json(execution);
});

/**
 * GET /api/workflows/:id
 * Get a specific workflow (admin only).
 */
router.get("/api/workflows/:id", checkAuthenticated, checkRole("admin"), (req, res) => {
  const workflow = getWorkflow(req.params.id);
  if (!workflow) {
    return res.status(404).json({ error: "Workflow not found", code: 404 });
  }
  res.json(workflow);
});

/**
 * PUT /api/workflows/:id
 * Update a workflow (admin only).
 */
router.put("/api/workflows/:id", checkAuthenticated, checkRole("admin"), (req, res) => {
  const workflow = updateWorkflow(req.params.id, req.body);
  if (!workflow) {
    return res.status(404).json({ error: "Workflow not found", code: 404 });
  }
  res.json(workflow);
});

/**
 * DELETE /api/workflows/clear
 * Clear workflow data (admin only).
 */
router.delete("/api/workflows/clear", checkAuthenticated, checkRole("admin"), (_req, res) => {
  clearWorkflowData();
  res.json({ message: "Workflow data cleared" });
});

/**
 * DELETE /api/workflows/:id
 * Delete a workflow (admin only).
 */
router.delete("/api/workflows/:id", checkAuthenticated, checkRole("admin"), (req, res) => {
  const deleted = deleteWorkflow(req.params.id);
  if (!deleted) {
    return res.status(404).json({ error: "Workflow not found", code: 404 });
  }
  res.json({ message: "Workflow deleted" });
});

/**
 * GET /api/workflows/executions/:id
 * Get a specific execution (admin only).
 */
router.get("/api/workflows/executions/:id", checkAuthenticated, checkRole("admin"), (req, res) => {
  const execution = getExecution(req.params.id);
  if (!execution) {
    return res.status(404).json({ error: "Execution not found", code: 404 });
  }
  res.json(execution);
});

export default router;
