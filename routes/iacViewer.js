// Infrastructure as code viewer routes

import { Router } from "express";
import { checkAuthenticated, checkRole } from "../middleware/auth.js";
import {
  registerTemplate,
  getTemplates,
  getTemplate,
  updateTemplate,
  deleteTemplate,
  validateTemplate,
  getValidationHistory,
  getIacStats,
  clearIacData,
} from "../utils/iacViewer.js";

const router = Router();

/**
 * POST /api/iac/templates
 * Register an IaC template (admin only).
 */
router.post("/api/iac/templates", checkAuthenticated, checkRole("admin"), (req, res) => {
  const template = registerTemplate({
    ...req.body,
    userId: req.session.user?.id,
  });
  res.status(201).json(template);
});

/**
 * GET /api/iac/templates
 * Get all templates with optional filters.
 */
router.get("/api/iac/templates", checkAuthenticated, checkRole("admin"), (req, res) => {
  const { type, provider } = req.query;
  const result = getTemplates({
    type: type || null,
    provider: provider || null,
  });
  res.json(result);
});

/**
 * GET /api/iac/stats
 * Get IaC statistics.
 */
router.get("/api/iac/stats", checkAuthenticated, checkRole("admin"), (_req, res) => {
  const stats = getIacStats();
  res.json(stats);
});

/**
 * GET /api/iac/validations
 * Get validation history.
 */
router.get("/api/iac/validations", checkAuthenticated, checkRole("admin"), (req, res) => {
  const { templateId, limit } = req.query;
  const result = getValidationHistory(
    templateId || null,
    limit ? parseInt(limit) : 50
  );
  res.json(result);
});

/**
 * POST /api/iac/templates/:id/validate
 * Validate a template (admin only).
 */
router.post("/api/iac/templates/:id/validate", checkAuthenticated, checkRole("admin"), (req, res) => {
  const result = validateTemplate(req.params.id);
  if (result.error) {
    return res.status(404).json({ error: result.error, code: 404 });
  }
  res.json(result);
});

/**
 * DELETE /api/iac/clear
 * Clear IaC data (admin only).
 */
router.delete("/api/iac/clear", checkAuthenticated, checkRole("admin"), (_req, res) => {
  clearIacData();
  res.json({ message: "IaC data cleared" });
});

/**
 * GET /api/iac/templates/:id
 * Get a specific template.
 */
router.get("/api/iac/templates/:id", checkAuthenticated, checkRole("admin"), (req, res) => {
  const template = getTemplate(req.params.id);
  if (!template) {
    return res.status(404).json({ error: "Template not found", code: 404 });
  }
  res.json(template);
});

/**
 * PUT /api/iac/templates/:id
 * Update a template (admin only).
 */
router.put("/api/iac/templates/:id", checkAuthenticated, checkRole("admin"), (req, res) => {
  const template = updateTemplate(req.params.id, req.body);
  if (!template) {
    return res.status(404).json({ error: "Template not found", code: 404 });
  }
  res.json(template);
});

/**
 * DELETE /api/iac/templates/:id
 * Delete a template (admin only).
 */
router.delete("/api/iac/templates/:id", checkAuthenticated, checkRole("admin"), (req, res) => {
  const deleted = deleteTemplate(req.params.id);
  if (!deleted) {
    return res.status(404).json({ error: "Template not found", code: 404 });
  }
  res.json({ message: "Template deleted" });
});

export default router;
