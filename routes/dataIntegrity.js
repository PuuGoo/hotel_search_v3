// Data integrity routes — verify consistency across data files

import { Router } from "express";
import { checkAuthenticated, checkRole } from "../middleware/auth.js";
import {
  validateFile,
  validateAllFiles,
  checkOrphanedReferences,
  checkDataConsistency,
  getIntegrityReport,
} from "../utils/dataIntegrity.js";

const router = Router();

/**
 * GET /api/integrity/report
 * Get full integrity report (admin only).
 */
router.get("/api/integrity/report", checkAuthenticated, checkRole("admin"), (req, res) => {
  const report = getIntegrityReport();
  res.json(report);
});

/**
 * GET /api/integrity/files
 * Validate all data files (admin only).
 */
router.get("/api/integrity/files", checkAuthenticated, checkRole("admin"), (req, res) => {
  const result = validateAllFiles();
  res.json(result);
});

/**
 * GET /api/integrity/file/:filename
 * Validate a specific file (admin only).
 */
router.get("/api/integrity/file/:filename", checkAuthenticated, checkRole("admin"), (req, res) => {
  const result = validateFile(req.params.filename);
  res.json(result);
});

/**
 * GET /api/integrity/orphans
 * Check for orphaned references (admin only).
 */
router.get("/api/integrity/orphans", checkAuthenticated, checkRole("admin"), (req, res) => {
  const result = checkOrphanedReferences();
  res.json(result);
});

/**
 * GET /api/integrity/consistency
 * Check data consistency (admin only).
 */
router.get("/api/integrity/consistency", checkAuthenticated, checkRole("admin"), (req, res) => {
  const result = checkDataConsistency();
  res.json(result);
});

export default router;
