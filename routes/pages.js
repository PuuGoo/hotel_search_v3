import { Router } from "express";
import path from "path";
import { fileURLToPath } from "url";
import { checkAuthenticated, checkRole } from "../middleware/auth.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, "..", "public");

const router = Router();

router.get("/BRAVE_MASTER", checkAuthenticated, (_req, res) => {
  res.sendFile(path.join(publicDir, "hotelSearchMaster.html"));
});

router.get("/AZURE_CHILD", checkAuthenticated, (_req, res) => {
  res.sendFile(path.join(publicDir, "hotelSearchChild.html"));
});

router.get("/searchXNG", checkAuthenticated, (_req, res) => {
  res.sendFile(path.join(publicDir, "hotelSearchXNG.html"));
});

router.get("/roomXNG", checkAuthenticated, (_req, res) => {
  res.sendFile(path.join(publicDir, "hotelRoomXNG.html"));
});

router.get("/CRAWLBASE_MASTER", checkAuthenticated, (_req, res) => {
  res.sendFile(path.join(publicDir, "crawlbaseMaster.html"));
});

router.get("/profile", checkAuthenticated, (_req, res) => {
  res.sendFile(path.join(publicDir, "profile.html"));
});

router.get("/bookmarks", checkAuthenticated, (_req, res) => {
  res.sendFile(path.join(publicDir, "bookmarks.html"));
});

router.get("/dashboard", checkAuthenticated, (_req, res) => {
  res.sendFile(path.join(publicDir, "dashboard.html"));
});

router.get("/saved-searches", checkAuthenticated, (_req, res) => {
  res.sendFile(path.join(publicDir, "savedSearches.html"));
});

router.get("/shares", checkAuthenticated, (_req, res) => {
  res.sendFile(path.join(publicDir, "shares.html"));
});

router.get("/admin-dashboard", checkAuthenticated, checkRole("admin"), (_req, res) => {
  res.sendFile(path.join(publicDir, "admin-dashboard.html"));
});

router.get("/share/:token", (_req, res) => {
  res.sendFile(path.join(publicDir, "share.html"));
});

router.get("/compare", checkAuthenticated, (_req, res) => {
  res.sendFile(path.join(publicDir, "comparison.html"));
});

router.get("/price-alerts", checkAuthenticated, (_req, res) => {
  res.sendFile(path.join(publicDir, "priceAlerts.html"));
});

router.get("/templates", checkAuthenticated, (_req, res) => {
  res.sendFile(path.join(publicDir, "templates.html"));
});

router.get("/webhooks", checkAuthenticated, (_req, res) => {
  res.sendFile(path.join(publicDir, "webhooks.html"));
});

router.get("/scheduled-searches", checkAuthenticated, (_req, res) => {
  res.sendFile(path.join(publicDir, "scheduledSearches.html"));
});

router.get("/deduplication", checkAuthenticated, (_req, res) => {
  res.sendFile(path.join(publicDir, "deduplication.html"));
});

router.get("/analytics", checkAuthenticated, (_req, res) => {
  res.sendFile(path.join(publicDir, "analytics.html"));
});

router.get("/bulk-data", checkAuthenticated, (_req, res) => {
  res.sendFile(path.join(publicDir, "bulkData.html"));
});

router.get("/preferences", checkAuthenticated, (_req, res) => {
  res.sendFile(path.join(publicDir, "preferences.html"));
});

router.get("/starred", checkAuthenticated, (_req, res) => {
  res.sendFile(path.join(publicDir, "starredResults.html"));
});

router.get("/search-stats", checkAuthenticated, (_req, res) => {
  res.sendFile(path.join(publicDir, "searchStats.html"));
});

router.get("/data-cleanup", checkAuthenticated, (_req, res) => {
  res.sendFile(path.join(publicDir, "dataCleanup.html"));
});

router.get("/bulk-tags", checkAuthenticated, (_req, res) => {
  res.sendFile(path.join(publicDir, "bulkTagOps.html"));
});

router.get("/data-retention", checkAuthenticated, (_req, res) => {
  res.sendFile(path.join(publicDir, "dataRetention.html"));
});

router.get("/import-bookmarks", checkAuthenticated, (_req, res) => {
  res.sendFile(path.join(publicDir, "importBookmarks.html"));
});

router.get("/bookmarks/import", checkAuthenticated, (_req, res) => {
  res.sendFile(path.join(publicDir, "importBookmarks.html"));
});

router.get("/system-health", checkAuthenticated, checkRole("admin"), (_req, res) => {
  res.sendFile(path.join(publicDir, "systemHealth.html"));
});

router.get("/audit-log", checkAuthenticated, checkRole("admin"), (_req, res) => {
  res.sendFile(path.join(publicDir, "auditViewer.html"));
});

router.get("/audit-dashboard", checkAuthenticated, checkRole("admin"), (_req, res) => {
  res.sendFile(path.join(publicDir, "auditDashboard.html"));
});

router.get("/api-keys", checkAuthenticated, checkRole("admin"), (_req, res) => {
  res.sendFile(path.join(publicDir, "apiKeys.html"));
});

router.get("/backup-restore", checkAuthenticated, checkRole("admin"), (_req, res) => {
  res.sendFile(path.join(publicDir, "backupRestore.html"));
});

router.get("/rate-limits", checkAuthenticated, checkRole("admin"), (_req, res) => {
  res.sendFile(path.join(publicDir, "rateLimitDashboard.html"));
});

router.get("/errors", checkAuthenticated, checkRole("admin"), (_req, res) => {
  res.sendFile(path.join(publicDir, "errorDashboard.html"));
});

router.get("/request-log", checkAuthenticated, checkRole("admin"), (_req, res) => {
  res.sendFile(path.join(publicDir, "requestLogDashboard.html"));
});

router.get("/sessions", checkAuthenticated, checkRole("admin"), (_req, res) => {
  res.sendFile(path.join(publicDir, "sessionManagement.html"));
});

router.get("/feature-flags", checkAuthenticated, checkRole("admin"), (_req, res) => {
  res.sendFile(path.join(publicDir, "featureFlags.html"));
});

router.get("/api-usage", checkAuthenticated, checkRole("admin"), (_req, res) => {
  res.sendFile(path.join(publicDir, "apiUsageDashboard.html"));
});

router.get("/2fa", checkAuthenticated, (_req, res) => {
  res.sendFile(path.join(publicDir, "twoFactorAuth.html"));
});

router.get("/ip-access", checkAuthenticated, checkRole("admin"), (_req, res) => {
  res.sendFile(path.join(publicDir, "ipAccessControl.html"));
});

router.get("/activity", checkAuthenticated, (_req, res) => {
  res.sendFile(path.join(publicDir, "userActivity.html"));
});

router.get("/search-patterns", checkAuthenticated, (_req, res) => {
  res.sendFile(path.join(publicDir, "searchPatterns.html"));
});

router.get("/snapshots", checkAuthenticated, (_req, res) => {
  res.sendFile(path.join(publicDir, "snapshots.html"));
});

router.get("/price-history", checkAuthenticated, (_req, res) => {
  res.sendFile(path.join(publicDir, "priceHistory.html"));
});

router.get("/comparison-history", checkAuthenticated, (_req, res) => {
  res.sendFile(path.join(publicDir, "comparisonHistory.html"));
});

router.get("/collections", checkAuthenticated, (_req, res) => {
  res.sendFile(path.join(publicDir, "collections.html"));
});

router.get("/circuit-breakers", checkAuthenticated, checkRole("admin"), (_req, res) => {
  res.sendFile(path.join(publicDir, "circuitBreakerDashboard.html"));
});

router.get("/collections/view/:token", (_req, res) => {
  res.sendFile(path.join(publicDir, "collectionView.html"));
});

router.get("/realtime", checkAuthenticated, (_req, res) => {
  res.sendFile(path.join(publicDir, "realtime.html"));
});

router.get("/map", checkAuthenticated, (_req, res) => {
  res.sendFile(path.join(publicDir, "mapView.html"));
});

router.get("/performance-dashboard", checkAuthenticated, checkRole("admin"), (_req, res) => {
  res.sendFile(path.join(publicDir, "performanceDashboard.html"));
});

router.get("/forgot-password", (_req, res) => {
  res.sendFile(path.join(publicDir, "forgotPassword.html"));
});

router.get("/reset-password", (_req, res) => {
  res.sendFile(path.join(publicDir, "resetPassword.html"));
});

router.get("/admin/chat", checkAuthenticated, checkRole("admin"), (_req, res) => {
  res.sendFile(path.join(publicDir, "adminChat.html"));
});

export default router;
