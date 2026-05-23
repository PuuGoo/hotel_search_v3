// Container health monitoring routes

import { Router } from "express";
import { checkAuthenticated, checkRole } from "../middleware/auth.js";
import {
  registerContainer,
  getContainers,
  getContainer,
  updateContainer,
  deleteContainer,
  recordMetrics,
  getContainerMetrics,
  getLatestMetrics,
  getHealthOverview,
  clearContainerData,
} from "../utils/containerHealth.js";

const router = Router();

/**
 * POST /api/containers
 * Register a container (admin only).
 */
router.post("/api/containers", checkAuthenticated, checkRole("admin"), (req, res) => {
  const container = registerContainer(req.body);
  res.status(201).json(container);
});

/**
 * GET /api/containers
 * Get all containers with optional filters.
 */
router.get("/api/containers", checkAuthenticated, checkRole("admin"), (req, res) => {
  const { status, environment } = req.query;
  const result = getContainers({
    status: status || null,
    environment: environment || null,
  });
  res.json(result);
});

/**
 * GET /api/containers/overview
 * Get health overview.
 */
router.get("/api/containers/overview", checkAuthenticated, checkRole("admin"), (_req, res) => {
  const overview = getHealthOverview();
  res.json(overview);
});

/**
 * GET /api/containers/latest
 * Get latest metrics for all containers.
 */
router.get("/api/containers/latest", checkAuthenticated, checkRole("admin"), (_req, res) => {
  const latest = getLatestMetrics();
  res.json({ containers: latest, count: latest.length });
});

/**
 * POST /api/containers/metrics
 * Record container metrics (admin only).
 */
router.post("/api/containers/metrics", checkAuthenticated, checkRole("admin"), (req, res) => {
  const metric = recordMetrics(req.body);
  res.status(201).json(metric);
});

/**
 * DELETE /api/containers/clear
 * Clear all container data (admin only).
 */
router.delete("/api/containers/clear", checkAuthenticated, checkRole("admin"), (_req, res) => {
  clearContainerData();
  res.json({ message: "Container data cleared" });
});

/**
 * GET /api/containers/:id
 * Get a specific container.
 */
router.get("/api/containers/:id", checkAuthenticated, checkRole("admin"), (req, res) => {
  const container = getContainer(req.params.id);
  if (!container) {
    return res.status(404).json({ error: "Container not found", code: 404 });
  }
  res.json(container);
});

/**
 * PUT /api/containers/:id
 * Update a container (admin only).
 */
router.put("/api/containers/:id", checkAuthenticated, checkRole("admin"), (req, res) => {
  const container = updateContainer(req.params.id, req.body);
  if (!container) {
    return res.status(404).json({ error: "Container not found", code: 404 });
  }
  res.json(container);
});

/**
 * DELETE /api/containers/:id
 * Delete a container (admin only).
 */
router.delete("/api/containers/:id", checkAuthenticated, checkRole("admin"), (req, res) => {
  const deleted = deleteContainer(req.params.id);
  if (!deleted) {
    return res.status(404).json({ error: "Container not found", code: 404 });
  }
  res.json({ message: "Container deleted" });
});

/**
 * GET /api/containers/:id/metrics
 * Get metrics for a container.
 */
router.get("/api/containers/:id/metrics", checkAuthenticated, checkRole("admin"), (req, res) => {
  const limit = req.query.limit ? parseInt(req.query.limit) : 50;
  const result = getContainerMetrics(req.params.id, limit);
  res.json(result);
});

export default router;
