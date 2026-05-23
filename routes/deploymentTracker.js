// Deployment tracker routes

import { Router } from "express";
import { checkAuthenticated, checkRole } from "../middleware/auth.js";
import {
  recordDeployment,
  getDeployments,
  getDeployment,
  updateDeployment,
  rollbackDeployment,
  deleteDeployment,
  getDeploymentStats,
  clearDeploymentData,
} from "../utils/deploymentTracker.js";

const router = Router();

/**
 * POST /api/deployments
 * Record a deployment (admin only).
 */
router.post("/api/deployments", checkAuthenticated, checkRole("admin"), (req, res) => {
  const deployment = recordDeployment({
    ...req.body,
    userId: req.session.user?.id,
  });
  res.status(201).json(deployment);
});

/**
 * GET /api/deployments
 * Get deployments with optional filters.
 */
router.get("/api/deployments", checkAuthenticated, checkRole("admin"), (req, res) => {
  const { environment, service, status, limit } = req.query;
  const result = getDeployments({
    environment: environment || null,
    service: service || null,
    status: status || null,
    limit: limit ? parseInt(limit) : 50,
  });
  res.json(result);
});

/**
 * GET /api/deployments/stats
 * Get deployment statistics.
 */
router.get("/api/deployments/stats", checkAuthenticated, checkRole("admin"), (_req, res) => {
  const stats = getDeploymentStats();
  res.json(stats);
});

/**
 * POST /api/deployments/:id/rollback
 * Rollback a deployment (admin only).
 */
router.post("/api/deployments/:id/rollback", checkAuthenticated, checkRole("admin"), (req, res) => {
  const rollback = rollbackDeployment(req.params.id, req.session.user?.id);
  if (!rollback) {
    return res.status(404).json({ error: "Deployment not found", code: 404 });
  }
  res.json(rollback);
});

/**
 * DELETE /api/deployments/clear
 * Clear deployment data (admin only).
 */
router.delete("/api/deployments/clear", checkAuthenticated, checkRole("admin"), (_req, res) => {
  clearDeploymentData();
  res.json({ message: "Deployment data cleared" });
});

/**
 * GET /api/deployments/:id
 * Get a specific deployment.
 */
router.get("/api/deployments/:id", checkAuthenticated, checkRole("admin"), (req, res) => {
  const deployment = getDeployment(req.params.id);
  if (!deployment) {
    return res.status(404).json({ error: "Deployment not found", code: 404 });
  }
  res.json(deployment);
});

/**
 * PUT /api/deployments/:id
 * Update a deployment (admin only).
 */
router.put("/api/deployments/:id", checkAuthenticated, checkRole("admin"), (req, res) => {
  const deployment = updateDeployment(req.params.id, req.body);
  if (!deployment) {
    return res.status(404).json({ error: "Deployment not found", code: 404 });
  }
  res.json(deployment);
});

/**
 * DELETE /api/deployments/:id
 * Delete a deployment (admin only).
 */
router.delete("/api/deployments/:id", checkAuthenticated, checkRole("admin"), (req, res) => {
  const deleted = deleteDeployment(req.params.id);
  if (!deleted) {
    return res.status(404).json({ error: "Deployment not found", code: 404 });
  }
  res.json({ message: "Deployment deleted" });
});

export default router;
