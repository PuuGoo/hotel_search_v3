// Request schema routes — manage validation schemas

import { Router } from "express";
import { checkAuthenticated, checkRole } from "../middleware/auth.js";
import {
  validate,
  getAllSchemas,
  getSchema,
  registerSchema,
  removeSchema,
  getValidationStats,
} from "../utils/requestSchemas.js";

const router = Router();

/**
 * GET /api/schemas
 * List all schemas (admin only).
 */
router.get("/api/schemas", checkAuthenticated, checkRole("admin"), (_req, res) => {
  const schemas = getAllSchemas();
  res.json({ schemas, count: Object.keys(schemas).length });
});

/**
 * GET /api/schemas/stats
 * Get validation statistics (admin only).
 */
router.get("/api/schemas/stats", checkAuthenticated, checkRole("admin"), (_req, res) => {
  const stats = getValidationStats();
  res.json(stats);
});

/**
 * GET /api/schemas/:endpoint
 * Get schema for a specific endpoint (admin only).
 * endpoint is encoded as "METHOD-path" (e.g., "POST-api-auth-login")
 */
router.get("/api/schemas/:endpoint", checkAuthenticated, checkRole("admin"), (req, res) => {
  const endpoint = req.params.endpoint.replace(/-/g, "/");
  const schema = getSchema(endpoint);
  if (!schema) {
    return res.status(404).json({ error: "Schema not found", code: 404 });
  }
  res.json({ endpoint, schema });
});

/**
 * POST /api/schemas
 * Register a custom schema (admin only).
 * Body: { endpoint, schema }
 */
router.post("/api/schemas", checkAuthenticated, checkRole("admin"), (req, res) => {
  const { endpoint, schema } = req.body;
  if (!endpoint || !schema) {
    return res.status(400).json({ error: "Missing endpoint or schema", code: 400 });
  }
  registerSchema(endpoint, schema);
  res.status(201).json({ endpoint, schema, message: "Schema registered" });
});

/**
 * POST /api/schemas/validate
 * Validate a value against a schema (admin only).
 * Body: { value, schema }
 */
router.post("/api/schemas/validate", checkAuthenticated, checkRole("admin"), (req, res) => {
  const { value, schema } = req.body;
  if (!schema) {
    return res.status(400).json({ error: "Missing schema", code: 400 });
  }
  const result = validate(value, schema);
  res.json(result);
});

/**
 * DELETE /api/schemas/:endpoint
 * Remove a custom schema (admin only).
 */
router.delete("/api/schemas/:endpoint", checkAuthenticated, checkRole("admin"), (req, res) => {
  const endpoint = req.params.endpoint.replace(/-/g, "/");
  const removed = removeSchema(endpoint);
  if (!removed) {
    return res.status(404).json({ error: "Schema not found or is built-in", code: 404 });
  }
  res.json({ message: "Schema removed", endpoint });
});

export default router;
