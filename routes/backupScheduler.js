// Backup scheduler routes — manage automated backups

import { Router } from "express";
import { checkAuthenticated, checkRole } from "../middleware/auth.js";
import {
  getBackupConfig,
  updateBackupConfig,
  createBackup,
  listBackups,
  deleteBackup,
  restoreBackup,
  autoBackup,
  getBackupStats,
} from "../utils/backupScheduler.js";

const router = Router();

/**
 * GET /api/backup/config
 * Get backup configuration (admin only).
 */
router.get("/api/backup/config", checkAuthenticated, checkRole("admin"), (req, res) => {
  const config = getBackupConfig();
  res.json(config);
});

/**
 * PUT /api/backup/config
 * Update backup configuration (admin only).
 * Body: { enabled?, maxBackups?, intervalHours?, autoBackup? }
 */
router.put("/api/backup/config", checkAuthenticated, checkRole("admin"), (req, res) => {
  const config = updateBackupConfig(req.body);
  res.json(config);
});

/**
 * POST /api/backup/create
 * Create a new backup (admin only).
 * Body: { name? }
 */
router.post("/api/backup/create", checkAuthenticated, checkRole("admin"), (req, res) => {
  const result = createBackup(req.body?.name);
  res.status(201).json(result);
});

/**
 * GET /api/backup/list
 * List all backups (admin only).
 */
router.get("/api/backup/list", checkAuthenticated, checkRole("admin"), (req, res) => {
  const backups = listBackups();
  res.json({ backups, count: backups.length });
});

/**
 * DELETE /api/backup/:name
 * Delete a backup (admin only).
 */
router.delete("/api/backup/:name", checkAuthenticated, checkRole("admin"), (req, res) => {
  const result = deleteBackup(req.params.name);
  if (!result.deleted) return res.status(404).json({ error: result.error });
  res.json(result);
});

/**
 * POST /api/backup/restore/:name
 * Restore from a backup (admin only).
 */
router.post("/api/backup/restore/:name", checkAuthenticated, checkRole("admin"), (req, res) => {
  const result = restoreBackup(req.params.name);
  if (!result.success) return res.status(404).json({ error: result.error });
  res.json(result);
});

/**
 * POST /api/backup/auto
 * Run auto-backup (admin only).
 */
router.post("/api/backup/auto", checkAuthenticated, checkRole("admin"), (req, res) => {
  const result = autoBackup();
  res.json(result);
});

/**
 * GET /api/backup/stats
 * Get backup statistics (admin only).
 */
router.get("/api/backup/stats", checkAuthenticated, checkRole("admin"), (req, res) => {
  const stats = getBackupStats();
  res.json(stats);
});

export default router;
