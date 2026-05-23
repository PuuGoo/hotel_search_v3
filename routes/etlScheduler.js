// ETL job scheduler routes — schedule and manage ETL jobs

import { Router } from "express";
import { checkAuthenticated, checkRole } from "../middleware/auth.js";
import {
  createJob,
  getJobs,
  getJob,
  updateJob,
  deleteJob,
  executeJob,
  getRuns,
  getRun,
  getSchedulerStats,
  clearSchedulerData,
} from "../utils/etlScheduler.js";

const router = Router();

/**
 * POST /api/etl/jobs
 * Create an ETL job (admin only).
 */
router.post("/api/etl/jobs", checkAuthenticated, checkRole("admin"), (req, res) => {
  const job = createJob({
    ...req.body,
    userId: req.session.user?.id,
  });
  if (job.error) {
    return res.status(400).json({ error: job.error, code: 400 });
  }
  res.status(201).json(job);
});

/**
 * GET /api/etl/jobs
 * Get all ETL jobs (admin only).
 */
router.get("/api/etl/jobs", checkAuthenticated, checkRole("admin"), (req, res) => {
  const enabled = req.query.enabled !== undefined ? req.query.enabled === "true" : null;
  const jobs = getJobs({ enabled });
  res.json({ jobs, count: jobs.length });
});

/**
 * GET /api/etl/stats
 * Get scheduler statistics (admin only).
 */
router.get("/api/etl/stats", checkAuthenticated, checkRole("admin"), (_req, res) => {
  const stats = getSchedulerStats();
  res.json(stats);
});

/**
 * GET /api/etl/runs/list
 * Get run history (admin only).
 */
router.get("/api/etl/runs/list", checkAuthenticated, checkRole("admin"), (req, res) => {
  const jobId = req.query.jobId || null;
  const status = req.query.status || null;
  const limit = parseInt(req.query.limit) || 50;
  const runs = getRuns({ jobId, status, limit });
  res.json(runs);
});

/**
 * POST /api/etl/jobs/:id/execute
 * Execute an ETL job (admin only).
 */
router.post("/api/etl/jobs/:id/execute", checkAuthenticated, checkRole("admin"), (req, res) => {
  const run = executeJob(req.params.id, { userId: req.session.user?.id });
  if (run.error) {
    return res.status(400).json({ error: run.error, code: 400 });
  }
  res.status(201).json(run);
});

/**
 * GET /api/etl/jobs/:id
 * Get a specific job (admin only).
 */
router.get("/api/etl/jobs/:id", checkAuthenticated, checkRole("admin"), (req, res) => {
  const job = getJob(req.params.id);
  if (!job) {
    return res.status(404).json({ error: "Job not found", code: 404 });
  }
  res.json(job);
});

/**
 * PUT /api/etl/jobs/:id
 * Update a job (admin only).
 */
router.put("/api/etl/jobs/:id", checkAuthenticated, checkRole("admin"), (req, res) => {
  const job = updateJob(req.params.id, req.body);
  if (!job) {
    return res.status(404).json({ error: "Job not found", code: 404 });
  }
  res.json(job);
});

/**
 * DELETE /api/etl/jobs/:id
 * Delete a job (admin only).
 */
router.delete("/api/etl/jobs/:id", checkAuthenticated, checkRole("admin"), (req, res) => {
  const deleted = deleteJob(req.params.id);
  if (!deleted) {
    return res.status(404).json({ error: "Job not found", code: 404 });
  }
  res.json({ message: "Job deleted" });
});

/**
 * GET /api/etl/runs/:id
 * Get a specific run (admin only).
 */
router.get("/api/etl/runs/:id", checkAuthenticated, checkRole("admin"), (req, res) => {
  const run = getRun(req.params.id);
  if (!run) {
    return res.status(404).json({ error: "Run not found", code: 404 });
  }
  res.json(run);
});

/**
 * DELETE /api/etl/clear
 * Clear scheduler data (admin only).
 */
router.delete("/api/etl/clear", checkAuthenticated, checkRole("admin"), (_req, res) => {
  clearSchedulerData();
  res.json({ message: "ETL scheduler data cleared" });
});

export default router;
