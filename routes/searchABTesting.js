// Search A/B testing routes — manage search configuration experiments

import { Router } from "express";
import { checkAuthenticated, checkRole } from "../middleware/auth.js";
import {
  createExperiment,
  getExperiments,
  getExperiment,
  assignVariant,
  getSearchConfig,
  recordSearchResult,
  getExperimentAnalytics,
  toggleExperiment,
  deleteExperiment,
  clearResults,
} from "../utils/searchABTesting.js";

const router = Router();

/**
 * POST /api/search-ab/experiments
 * Create a search experiment (admin only).
 * Body: { name, description, variants, trafficSplit? }
 */
router.post("/api/search-ab/experiments", checkAuthenticated, checkRole("admin"), (req, res) => {
  try {
    const experiment = createExperiment(req.body);
    res.status(201).json(experiment);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * GET /api/search-ab/experiments
 * List all search experiments (admin only).
 */
router.get("/api/search-ab/experiments", checkAuthenticated, checkRole("admin"), (req, res) => {
  const experiments = getExperiments();
  res.json({ experiments, count: experiments.length });
});

/**
 * GET /api/search-ab/experiments/:id
 * Get a specific experiment (admin only).
 */
router.get("/api/search-ab/experiments/:id", checkAuthenticated, checkRole("admin"), (req, res) => {
  const experiment = getExperiment(req.params.id);
  if (!experiment) return res.status(404).json({ error: "Experiment not found" });
  res.json(experiment);
});

/**
 * GET /api/search-ab/assign/:experimentId
 * Assign current user to a variant.
 */
router.get("/api/search-ab/assign/:experimentId", checkAuthenticated, (req, res) => {
  const assignment = assignVariant(req.session.user?.id, req.params.experimentId);
  if (!assignment) return res.status(404).json({ error: "Experiment not found or inactive" });
  res.json(assignment);
});

/**
 * GET /api/search-ab/config
 * Get merged search config for current user based on active experiments.
 */
router.get("/api/search-ab/config", checkAuthenticated, (req, res) => {
  const config = getSearchConfig(req.session.user?.id);
  res.json(config);
});

/**
 * POST /api/search-ab/result
 * Record a search result for A/B analysis.
 * Body: { experimentId, variantIndex, query, engine, resultCount, duration, clicked? }
 */
router.post("/api/search-ab/result", checkAuthenticated, (req, res) => {
  const result = recordSearchResult({
    ...req.body,
    userId: req.session.user?.id,
  });
  res.status(201).json(result);
});

/**
 * GET /api/search-ab/analytics/:experimentId
 * Get experiment analytics (admin only).
 * Query: hours
 */
router.get("/api/search-ab/analytics/:experimentId", checkAuthenticated, checkRole("admin"), (req, res) => {
  const hours = parseInt(req.query.hours) || 168;
  const analytics = getExperimentAnalytics(req.params.experimentId, { hours });
  if (!analytics) return res.status(404).json({ error: "Experiment not found" });
  res.json(analytics);
});

/**
 * PUT /api/search-ab/experiments/:id/toggle
 * Toggle experiment active state (admin only).
 */
router.put("/api/search-ab/experiments/:id/toggle", checkAuthenticated, checkRole("admin"), (req, res) => {
  const experiment = toggleExperiment(req.params.id);
  if (!experiment) return res.status(404).json({ error: "Experiment not found" });
  res.json(experiment);
});

/**
 * DELETE /api/search-ab/experiments/:id
 * Delete an experiment (admin only).
 */
router.delete("/api/search-ab/experiments/:id", checkAuthenticated, checkRole("admin"), (req, res) => {
  const deleted = deleteExperiment(req.params.id);
  if (!deleted) return res.status(404).json({ error: "Experiment not found" });
  res.json({ message: "Experiment deleted" });
});

/**
 * DELETE /api/search-ab/results
 * Clear all experiment results (admin only).
 */
router.delete("/api/search-ab/results", checkAuthenticated, checkRole("admin"), (req, res) => {
  clearResults();
  res.json({ message: "Results cleared" });
});

export default router;
