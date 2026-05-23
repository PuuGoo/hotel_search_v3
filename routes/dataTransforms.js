// Data transformation routes — transform data between formats

import { Router } from "express";
import { checkAuthenticated, checkRole } from "../middleware/auth.js";
import {
  jsonToCSV,
  csvToJSON,
  mapFields,
  filterData,
  aggregateData,
  sortData,
  saveTemplate,
  getTemplates,
  deleteTemplate,
  recordTransform,
  getTransformHistory,
  getTransformStats,
  clearTransformData,
} from "../utils/dataTransforms.js";

const router = Router();

/**
 * POST /api/transforms/json-to-csv
 * Convert JSON to CSV.
 */
router.post("/api/transforms/json-to-csv", checkAuthenticated, (req, res) => {
  const { data, options } = req.body;
  const start = Date.now();
  const result = jsonToCSV(data, options);
  if (result.error) {
    return res.status(400).json({ error: result.error, code: 400 });
  }
  recordTransform({ operation: "json-to-csv", inputRows: result.rowCount, outputRows: result.rowCount, duration: Date.now() - start });
  res.json(result);
});

/**
 * POST /api/transforms/csv-to-json
 * Convert CSV to JSON.
 */
router.post("/api/transforms/csv-to-json", checkAuthenticated, (req, res) => {
  const { csv, options } = req.body;
  const start = Date.now();
  const result = csvToJSON(csv, options);
  if (result.error) {
    return res.status(400).json({ error: result.error, code: 400 });
  }
  recordTransform({ operation: "csv-to-json", inputRows: result.rowCount, outputRows: result.rowCount, duration: Date.now() - start });
  res.json(result);
});

/**
 * POST /api/transforms/map
 * Apply field mapping to data.
 */
router.post("/api/transforms/map", checkAuthenticated, (req, res) => {
  const { data, mapping } = req.body;
  const start = Date.now();
  const result = mapFields(data, mapping);
  if (result.error) {
    return res.status(400).json({ error: result.error, code: 400 });
  }
  recordTransform({ operation: "map", inputRows: data?.length || 0, outputRows: result.rowCount, duration: Date.now() - start });
  res.json(result);
});

/**
 * POST /api/transforms/filter
 * Filter data by conditions.
 */
router.post("/api/transforms/filter", checkAuthenticated, (req, res) => {
  const { data, conditions } = req.body;
  const start = Date.now();
  const result = filterData(data, conditions);
  if (result.error) {
    return res.status(400).json({ error: result.error, code: 400 });
  }
  recordTransform({ operation: "filter", inputRows: data?.length || 0, outputRows: result.rowCount, duration: Date.now() - start });
  res.json(result);
});

/**
 * POST /api/transforms/aggregate
 * Aggregate data.
 */
router.post("/api/transforms/aggregate", checkAuthenticated, (req, res) => {
  const { data, options } = req.body;
  const start = Date.now();
  const result = aggregateData(data, options);
  if (result.error) {
    return res.status(400).json({ error: result.error, code: 400 });
  }
  recordTransform({ operation: "aggregate", inputRows: data?.length || 0, outputRows: result.groupCount, duration: Date.now() - start });
  res.json(result);
});

/**
 * POST /api/transforms/sort
 * Sort data by field(s).
 */
router.post("/api/transforms/sort", checkAuthenticated, (req, res) => {
  const { data, sortBy } = req.body;
  const start = Date.now();
  const result = sortData(data, sortBy);
  if (result.error) {
    return res.status(400).json({ error: result.error, code: 400 });
  }
  recordTransform({ operation: "sort", inputRows: result.rowCount, outputRows: result.rowCount, duration: Date.now() - start });
  res.json(result);
});

/**
 * GET /api/transforms/templates
 * Get transformation templates.
 */
router.get("/api/transforms/templates", checkAuthenticated, (_req, res) => {
  const templates = getTemplates();
  res.json({ templates, count: templates.length });
});

/**
 * POST /api/transforms/templates
 * Save a transformation template (admin only).
 */
router.post("/api/transforms/templates", checkAuthenticated, checkRole("admin"), (req, res) => {
  const template = saveTemplate({
    ...req.body,
    userId: req.session.user?.id,
  });
  if (template.error) {
    return res.status(400).json({ error: template.error, code: 400 });
  }
  res.status(201).json(template);
});

/**
 * GET /api/transforms/stats
 * Get transform statistics (admin only).
 */
router.get("/api/transforms/stats", checkAuthenticated, checkRole("admin"), (_req, res) => {
  const stats = getTransformStats();
  res.json(stats);
});

/**
 * GET /api/transforms/history
 * Get transform history (admin only).
 */
router.get("/api/transforms/history", checkAuthenticated, checkRole("admin"), (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const history = getTransformHistory(limit);
  res.json(history);
});

/**
 * DELETE /api/transforms/templates/:id
 * Delete a template (admin only).
 */
router.delete("/api/transforms/templates/:id", checkAuthenticated, checkRole("admin"), (req, res) => {
  const deleted = deleteTemplate(req.params.id);
  if (!deleted) {
    return res.status(404).json({ error: "Template not found", code: 404 });
  }
  res.json({ message: "Template deleted" });
});

/**
 * DELETE /api/transforms/clear
 * Clear transform data (admin only).
 */
router.delete("/api/transforms/clear", checkAuthenticated, checkRole("admin"), (_req, res) => {
  clearTransformData();
  res.json({ message: "Transform data cleared" });
});

export default router;
