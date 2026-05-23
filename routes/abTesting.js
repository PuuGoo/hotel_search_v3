// A/B testing routes — manage experiments and view results

import { Router } from "express";
import { checkAuthenticated } from "../middleware/auth.js";
import {
  createExperiment,
  getExperiments,
  getExperiment,
  assignVariant,
  recordEvent,
  getExperimentResults,
  updateExperimentStatus,
  deleteExperiment,
} from "../utils/abTesting.js";

const router = Router();

/**
 * POST /api/experiments
 * Create a new experiment (admin only).
 */
router.post("/api/experiments", checkAuthenticated, (req, res) => {
  if (req.session.user.role !== "admin") {
    return res.status(403).json({ error: "Admin access required" });
  }

  try {
    const experiment = createExperiment(req.body);
    res.status(201).json(experiment);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * GET /api/experiments
 * List all experiments.
 */
router.get("/api/experiments", checkAuthenticated, (req, res) => {
  const experiments = getExperiments();
  res.json({ experiments, total: experiments.length });
});

/**
 * GET /api/experiments/:name
 * Get experiment details.
 */
router.get("/api/experiments/:name", checkAuthenticated, (req, res) => {
  const experiment = getExperiment(req.params.name);
  if (!experiment) return res.status(404).json({ error: "Experiment not found" });
  res.json(experiment);
});

/**
 * GET /api/experiments/:name/assign
 * Get the current user's variant assignment.
 */
router.get("/api/experiments/:name/assign", checkAuthenticated, (req, res) => {
  try {
    const variant = assignVariant(req.params.name, req.session.user.id);
    res.json({ experiment: req.params.name, variant });
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

/**
 * POST /api/experiments/:name/event
 * Record an experiment event.
 * Body: { eventName, value }
 */
router.post("/api/experiments/:name/event", checkAuthenticated, (req, res) => {
  const { eventName, value } = req.body;
  if (!eventName) return res.status(400).json({ error: "eventName is required" });

  try {
    recordEvent(req.params.name, req.session.user.id, eventName, value);
    res.json({ success: true });
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

/**
 * GET /api/experiments/:name/results
 * Get experiment results (admin only).
 */
router.get("/api/experiments/:name/results", checkAuthenticated, (req, res) => {
  if (req.session.user.role !== "admin") {
    return res.status(403).json({ error: "Admin access required" });
  }

  try {
    const results = getExperimentResults(req.params.name);
    res.json(results);
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

/**
 * PATCH /api/experiments/:name/status
 * Update experiment status (admin only).
 * Body: { status: "active"|"paused"|"completed" }
 */
router.patch("/api/experiments/:name/status", checkAuthenticated, (req, res) => {
  if (req.session.user.role !== "admin") {
    return res.status(403).json({ error: "Admin access required" });
  }

  const { status } = req.body;
  if (!["active", "paused", "completed"].includes(status)) {
    return res.status(400).json({ error: "Invalid status" });
  }

  try {
    const experiment = updateExperimentStatus(req.params.name, status);
    res.json(experiment);
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

/**
 * DELETE /api/experiments/:name
 * Delete an experiment (admin only).
 */
router.delete("/api/experiments/:name", checkAuthenticated, (req, res) => {
  if (req.session.user.role !== "admin") {
    return res.status(403).json({ error: "Admin access required" });
  }

  try {
    deleteExperiment(req.params.name);
    res.json({ success: true });
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

export default router;
