// Endpoint documentation routes — auto-generate and manage API docs

import { Router } from "express";
import { checkAuthenticated, checkRole } from "../middleware/auth.js";
import {
  getAllDocs,
  getEndpointDoc,
  setEndpointDoc,
  removeEndpointDoc,
  getDocsByTag,
  getDocsStats,
  generateOpenAPISpec,
} from "../utils/endpointDocs.js";

const router = Router();

/**
 * GET /api/docs
 * Get all endpoint documentation.
 * Query: format (json|openapi)
 */
router.get("/api/docs", checkAuthenticated, (req, res) => {
  const format = req.query.format || "json";

  if (format === "openapi") {
    const spec = generateOpenAPISpec();
    return res.json(spec);
  }

  const docs = getAllDocs();
  res.json({ endpoints: docs, count: Object.keys(docs).length });
});

/**
 * GET /api/docs/by-tag
 * Get documentation grouped by tags.
 */
router.get("/api/docs/by-tag", checkAuthenticated, (_req, res) => {
  const grouped = getDocsByTag();
  res.json(grouped);
});

/**
 * GET /api/docs/stats
 * Get documentation statistics.
 */
router.get("/api/docs/stats", checkAuthenticated, (_req, res) => {
  const stats = getDocsStats();
  res.json(stats);
});

/**
 * GET /api/docs/:endpoint
 * Get documentation for a specific endpoint.
 * endpoint encoded as "METHOD-path" (e.g., "GET-api-docs")
 */
router.get("/api/docs/:endpoint", checkAuthenticated, (req, res) => {
  const endpoint = req.params.endpoint.replace(/-/g, "/");
  const doc = getEndpointDoc(endpoint);
  if (!doc) {
    return res.status(404).json({ error: "Documentation not found", code: 404 });
  }
  res.json({ endpoint, documentation: doc });
});

/**
 * POST /api/docs
 * Add or update endpoint documentation (admin only).
 * Body: { endpoint, summary, description, requestBody, responses, tags }
 */
router.post("/api/docs", checkAuthenticated, checkRole("admin"), (req, res) => {
  const { endpoint, ...doc } = req.body;
  if (!endpoint) {
    return res.status(400).json({ error: "Missing endpoint", code: 400 });
  }
  const result = setEndpointDoc(endpoint, doc);
  res.status(201).json({ endpoint, documentation: result, message: "Documentation updated" });
});

/**
 * DELETE /api/docs/:endpoint
 * Remove custom endpoint documentation (admin only).
 */
router.delete("/api/docs/:endpoint", checkAuthenticated, checkRole("admin"), (req, res) => {
  const endpoint = req.params.endpoint.replace(/-/g, "/");
  const removed = removeEndpointDoc(endpoint);
  if (!removed) {
    return res.status(404).json({ error: "Custom documentation not found", code: 404 });
  }
  res.json({ message: "Documentation removed", endpoint });
});

/**
 * GET /api/docs/spec/openapi
 * Get OpenAPI specification.
 */
router.get("/api/docs/spec/openapi", checkAuthenticated, (req, res) => {
  const spec = generateOpenAPISpec({
    title: req.query.title || "Hotel Search API",
    version: req.query.version || "1.0.0",
  });
  res.json(spec);
});

export default router;
