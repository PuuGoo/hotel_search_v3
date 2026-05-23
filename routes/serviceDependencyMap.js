// Service dependency map routes

import { Router } from "express";
import { checkAuthenticated, checkRole } from "../middleware/auth.js";
import {
  registerService,
  getServices,
  getService,
  getServiceByName,
  updateService,
  deleteService,
  recordHealth,
  getHealthRecords,
  getDependencyGraph,
  analyzeDependencies,
  getDependencyStats,
  clearDependencyData,
} from "../utils/serviceDependencyMap.js";

const router = Router();

/**
 * POST /api/dependencies/services
 * Register a service (admin only).
 */
router.post("/api/dependencies/services", checkAuthenticated, checkRole("admin"), (req, res) => {
  const service = registerService({
    ...req.body,
    userId: req.session.user?.id,
  });
  res.status(201).json(service);
});

/**
 * GET /api/dependencies/services
 * Get all services with optional filters.
 */
router.get("/api/dependencies/services", checkAuthenticated, checkRole("admin"), (req, res) => {
  const { type, tag } = req.query;
  const result = getServices({
    type: type || null,
    tag: tag || null,
  });
  res.json(result);
});

/**
 * GET /api/dependencies/graph
 * Get the dependency graph.
 */
router.get("/api/dependencies/graph", checkAuthenticated, checkRole("admin"), (_req, res) => {
  const graph = getDependencyGraph();
  res.json(graph);
});

/**
 * GET /api/dependencies/analysis
 * Get dependency analysis.
 */
router.get("/api/dependencies/analysis", checkAuthenticated, checkRole("admin"), (_req, res) => {
  const analysis = analyzeDependencies();
  res.json(analysis);
});

/**
 * GET /api/dependencies/stats
 * Get dependency statistics.
 */
router.get("/api/dependencies/stats", checkAuthenticated, checkRole("admin"), (_req, res) => {
  const stats = getDependencyStats();
  res.json(stats);
});

/**
 * POST /api/dependencies/health
 * Record health status (admin only).
 */
router.post("/api/dependencies/health", checkAuthenticated, checkRole("admin"), (req, res) => {
  const record = recordHealth(req.body);
  res.status(201).json(record);
});

/**
 * DELETE /api/dependencies/clear
 * Clear dependency data (admin only).
 */
router.delete("/api/dependencies/clear", checkAuthenticated, checkRole("admin"), (_req, res) => {
  clearDependencyData();
  res.json({ message: "Dependency data cleared" });
});

/**
 * GET /api/dependencies/services/by-name/:name
 * Get service by name.
 */
router.get("/api/dependencies/services/by-name/:name", checkAuthenticated, checkRole("admin"), (req, res) => {
  const service = getServiceByName(req.params.name);
  if (!service) {
    return res.status(404).json({ error: "Service not found", code: 404 });
  }
  res.json(service);
});

/**
 * GET /api/dependencies/services/:id
 * Get a specific service.
 */
router.get("/api/dependencies/services/:id", checkAuthenticated, checkRole("admin"), (req, res) => {
  const service = getService(req.params.id);
  if (!service) {
    return res.status(404).json({ error: "Service not found", code: 404 });
  }
  res.json(service);
});

/**
 * PUT /api/dependencies/services/:id
 * Update a service (admin only).
 */
router.put("/api/dependencies/services/:id", checkAuthenticated, checkRole("admin"), (req, res) => {
  const service = updateService(req.params.id, req.body);
  if (!service) {
    return res.status(404).json({ error: "Service not found", code: 404 });
  }
  res.json(service);
});

/**
 * DELETE /api/dependencies/services/:id
 * Delete a service (admin only).
 */
router.delete("/api/dependencies/services/:id", checkAuthenticated, checkRole("admin"), (req, res) => {
  const deleted = deleteService(req.params.id);
  if (!deleted) {
    return res.status(404).json({ error: "Service not found", code: 404 });
  }
  res.json({ message: "Service deleted" });
});

/**
 * GET /api/dependencies/services/:id/health
 * Get health records for a service.
 */
router.get("/api/dependencies/services/:id/health", checkAuthenticated, checkRole("admin"), (req, res) => {
  const limit = req.query.limit ? parseInt(req.query.limit) : 50;
  const result = getHealthRecords(req.params.id, limit);
  res.json(result);
});

export default router;
