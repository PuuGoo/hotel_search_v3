// Data pipeline routes — manage and execute data processing pipelines

import { Router } from "express";
import { checkAuthenticated, checkRole } from "../middleware/auth.js";
import {
  createPipeline,
  getPipelines,
  getPipeline,
  updatePipeline,
  deletePipeline,
  executePipeline,
  getExecutions,
  getExecution,
  getPipelineStats,
  clearPipelineData,
} from "../utils/dataPipeline.js";

const router = Router();

/**
 * POST /api/pipelines
 * Create a pipeline (admin only).
 * Body: { name, description, steps, schedule, enabled }
 */
router.post("/api/pipelines", checkAuthenticated, checkRole("admin"), (req, res) => {
  const pipeline = createPipeline({
    ...req.body,
    userId: req.session.user?.id,
  });
  if (pipeline.error) {
    return res.status(400).json({ error: pipeline.error, code: 400 });
  }
  res.status(201).json(pipeline);
});

/**
 * GET /api/pipelines
 * Get all pipelines (admin only).
 * Query: enabled
 */
router.get("/api/pipelines", checkAuthenticated, checkRole("admin"), (req, res) => {
  const enabled = req.query.enabled !== undefined ? req.query.enabled === "true" : null;
  const pipelines = getPipelines({ enabled });
  res.json({ pipelines, count: pipelines.length });
});

/**
 * GET /api/pipelines/stats
 * Get pipeline statistics (admin only).
 */
router.get("/api/pipelines/stats", checkAuthenticated, checkRole("admin"), (_req, res) => {
  const stats = getPipelineStats();
  res.json(stats);
});

/**
 * GET /api/pipelines/:id
 * Get a specific pipeline (admin only).
 */
router.get("/api/pipelines/:id", checkAuthenticated, checkRole("admin"), (req, res) => {
  const pipeline = getPipeline(req.params.id);
  if (!pipeline) {
    return res.status(404).json({ error: "Pipeline not found", code: 404 });
  }
  res.json(pipeline);
});

/**
 * PUT /api/pipelines/:id
 * Update a pipeline (admin only).
 */
router.put("/api/pipelines/:id", checkAuthenticated, checkRole("admin"), (req, res) => {
  const pipeline = updatePipeline(req.params.id, req.body);
  if (!pipeline) {
    return res.status(404).json({ error: "Pipeline not found", code: 404 });
  }
  res.json(pipeline);
});

/**
 * POST /api/pipelines/:id/execute
 * Execute a pipeline (admin only).
 */
router.post("/api/pipelines/:id/execute", checkAuthenticated, checkRole("admin"), (req, res) => {
  const execution = executePipeline(req.params.id, { userId: req.session.user?.id });
  if (execution.error) {
    return res.status(400).json({ error: execution.error, code: 400 });
  }
  res.status(201).json(execution);
});

/**
 * GET /api/pipelines/executions/list
 * Get execution history (admin only).
 * Query: pipelineId, status, limit
 */
router.get("/api/pipelines/executions/list", checkAuthenticated, checkRole("admin"), (req, res) => {
  const pipelineId = req.query.pipelineId || null;
  const status = req.query.status || null;
  const limit = parseInt(req.query.limit) || 50;
  const executions = getExecutions({ pipelineId, status, limit });
  res.json(executions);
});

/**
 * GET /api/pipelines/executions/:id
 * Get a specific execution (admin only).
 */
router.get("/api/pipelines/executions/:id", checkAuthenticated, checkRole("admin"), (req, res) => {
  const execution = getExecution(req.params.id);
  if (!execution) {
    return res.status(404).json({ error: "Execution not found", code: 404 });
  }
  res.json(execution);
});

/**
 * DELETE /api/pipelines/clear
 * Clear pipeline data (admin only).
 */
router.delete("/api/pipelines/clear", checkAuthenticated, checkRole("admin"), (_req, res) => {
  clearPipelineData();
  res.json({ message: "Pipeline data cleared" });
});

/**
 * DELETE /api/pipelines/:id
 * Delete a pipeline (admin only).
 */
router.delete("/api/pipelines/:id", checkAuthenticated, checkRole("admin"), (req, res) => {
  const deleted = deletePipeline(req.params.id);
  if (!deleted) {
    return res.status(404).json({ error: "Pipeline not found", code: 404 });
  }
  res.json({ message: "Pipeline deleted" });
});

export default router;
