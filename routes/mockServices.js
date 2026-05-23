// Mock service routes — mock external API dependencies for testing

import { Router } from "express";
import { checkAuthenticated, checkRole } from "../middleware/auth.js";
import {
  registerService,
  getServices,
  getService,
  updateService,
  deleteService,
  handleRequest,
  getLogs,
  getMockStats,
  clearMockData,
} from "../utils/mockServices.js";

const router = Router();

/**
 * POST /api/mock/services
 * Register a mock service (admin only).
 */
router.post("/api/mock/services", checkAuthenticated, checkRole("admin"), (req, res) => {
  const service = registerService({
    ...req.body,
    userId: req.session.user?.id,
  });
  if (service.error) {
    return res.status(400).json({ error: service.error, code: 400 });
  }
  res.status(201).json(service);
});

/**
 * GET /api/mock/services
 * Get all mock services (admin only).
 */
router.get("/api/mock/services", checkAuthenticated, checkRole("admin"), (_req, res) => {
  const services = getServices();
  res.json({ services, count: services.length });
});

/**
 * GET /api/mock/stats
 * Get mock service statistics (admin only).
 */
router.get("/api/mock/stats", checkAuthenticated, checkRole("admin"), (_req, res) => {
  const stats = getMockStats();
  res.json(stats);
});

/**
 * POST /api/mock/request/:serviceId
 * Handle a mock request (admin only).
 */
router.post("/api/mock/request/:serviceId", checkAuthenticated, checkRole("admin"), (req, res) => {
  const { method, path, body } = req.body;
  const result = handleRequest(req.params.serviceId, method, path, body);
  if (result.error) {
    return res.status(result.status || 400).json({ error: result.error, code: result.status || 400 });
  }
  res.json(result);
});

/**
 * GET /api/mock/logs
 * Get request logs (admin only).
 */
router.get("/api/mock/logs", checkAuthenticated, checkRole("admin"), (req, res) => {
  const serviceId = req.query.serviceId || null;
  const method = req.query.method || null;
  const limit = parseInt(req.query.limit) || 50;
  const logs = getLogs({ serviceId, method, limit });
  res.json(logs);
});

/**
 * GET /api/mock/services/:id
 * Get a specific mock service (admin only).
 */
router.get("/api/mock/services/:id", checkAuthenticated, checkRole("admin"), (req, res) => {
  const service = getService(req.params.id);
  if (!service) {
    return res.status(404).json({ error: "Service not found", code: 404 });
  }
  res.json(service);
});

/**
 * PUT /api/mock/services/:id
 * Update a mock service (admin only).
 */
router.put("/api/mock/services/:id", checkAuthenticated, checkRole("admin"), (req, res) => {
  const service = updateService(req.params.id, req.body);
  if (!service) {
    return res.status(404).json({ error: "Service not found", code: 404 });
  }
  res.json(service);
});

/**
 * DELETE /api/mock/services/:id
 * Delete a mock service (admin only).
 */
router.delete("/api/mock/services/:id", checkAuthenticated, checkRole("admin"), (req, res) => {
  const deleted = deleteService(req.params.id);
  if (!deleted) {
    return res.status(404).json({ error: "Service not found", code: 404 });
  }
  res.json({ message: "Service deleted" });
});

/**
 * DELETE /api/mock/clear
 * Clear mock data (admin only).
 */
router.delete("/api/mock/clear", checkAuthenticated, checkRole("admin"), (_req, res) => {
  clearMockData();
  res.json({ message: "Mock data cleared" });
});

export default router;
