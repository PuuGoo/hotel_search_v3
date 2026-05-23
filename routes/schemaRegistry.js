// Schema registry routes

import { Router } from "express";
import { checkAuthenticated, checkRole } from "../middleware/auth.js";
import {
  registerSchema,
  getSchemas,
  getSchema,
  getSchemasByName,
  updateSchema,
  deleteSchema,
  validateAgainstSchema,
  getSchemaStats,
  clearSchemaData,
} from "../utils/schemaRegistry.js";

const router = Router();

/**
 * POST /api/schemas
 * Register a schema (admin only).
 */
router.post("/api/schemas", checkAuthenticated, checkRole("admin"), (req, res) => {
  const schema = registerSchema({
    ...req.body,
    userId: req.session.user?.id,
  });
  res.status(201).json(schema);
});

/**
 * GET /api/schemas
 * Get all schemas with optional filters.
 */
router.get("/api/schemas", checkAuthenticated, checkRole("admin"), (req, res) => {
  const { type, endpoint, limit } = req.query;
  const result = getSchemas({
    type: type || null,
    endpoint: endpoint || null,
    limit: limit ? parseInt(limit) : 50,
  });
  res.json(result);
});

/**
 * GET /api/schemas/stats
 * Get schema registry statistics.
 */
router.get("/api/schemas/stats", checkAuthenticated, checkRole("admin"), (_req, res) => {
  const stats = getSchemaStats();
  res.json(stats);
});

/**
 * GET /api/schemas/by-name/:name
 * Get schemas by name.
 */
router.get("/api/schemas/by-name/:name", checkAuthenticated, checkRole("admin"), (req, res) => {
  const schemas = getSchemasByName(req.params.name);
  res.json({ schemas, count: schemas.length });
});

/**
 * POST /api/schemas/:id/validate
 * Validate data against a schema.
 */
router.post("/api/schemas/:id/validate", checkAuthenticated, checkRole("admin"), (req, res) => {
  const result = validateAgainstSchema(req.params.id, req.body);
  if (result.error) {
    return res.status(400).json({ error: result.error, code: 400 });
  }
  res.json(result);
});

/**
 * DELETE /api/schemas/clear
 * Clear schema registry (admin only).
 */
router.delete("/api/schemas/clear", checkAuthenticated, checkRole("admin"), (_req, res) => {
  clearSchemaData();
  res.json({ message: "Schema registry cleared" });
});

/**
 * GET /api/schemas/:id
 * Get a specific schema.
 */
router.get("/api/schemas/:id", checkAuthenticated, checkRole("admin"), (req, res) => {
  const schema = getSchema(req.params.id);
  if (!schema) {
    return res.status(404).json({ error: "Schema not found", code: 404 });
  }
  res.json(schema);
});

/**
 * PUT /api/schemas/:id
 * Update a schema (admin only).
 */
router.put("/api/schemas/:id", checkAuthenticated, checkRole("admin"), (req, res) => {
  const schema = updateSchema(req.params.id, req.body);
  if (!schema) {
    return res.status(404).json({ error: "Schema not found", code: 404 });
  }
  res.json(schema);
});

/**
 * DELETE /api/schemas/:id
 * Delete a schema (admin only).
 */
router.delete("/api/schemas/:id", checkAuthenticated, checkRole("admin"), (req, res) => {
  const deleted = deleteSchema(req.params.id);
  if (!deleted) {
    return res.status(404).json({ error: "Schema not found", code: 404 });
  }
  res.json({ message: "Schema deleted" });
});

export default router;
