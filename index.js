import express from "express";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import session from "express-session";
import dotenv from "dotenv";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import { createProxyMiddleware } from "http-proxy-middleware";
import swaggerUi from "swagger-ui-express";
import config from "./utils/config.js";
import { requestLogger } from "./middleware/logger.js";
import { requestId } from "./middleware/requestId.js";
import { requestTimeout } from "./middleware/timeout.js";
import authRoutes from "./routes/auth.js";
import userRoutes from "./routes/users.js";
import chatRoutes from "./routes/chat.js";
import searchRoutes from "./routes/search.js";
import case12Routes from "./routes/case12.js";
import pageRoutes from "./routes/pages.js";
import historyRoutes from "./routes/history.js";
import auditRoutes from "./routes/audit.js";
import bookmarkRoutes from "./routes/bookmarks.js";
import dashboardRoutes from "./routes/dashboard.js";
import savedSearchRoutes from "./routes/savedSearches.js";
import shareRoutes from "./routes/shares.js";
import comparisonRoutes from "./routes/comparison.js";
import priceAlertRoutes from "./routes/priceAlerts.js";
import searchTemplateRoutes from "./routes/searchTemplates.js";
import notificationRoutes from "./routes/notifications.js";
import filterRoutes from "./routes/filters.js";
import webhookRoutes from "./routes/webhooks.js";
import scheduledSearchRoutes from "./routes/scheduledSearches.js";
import deduplicationRoutes from "./routes/deduplication.js";
import analyticsRoutes from "./routes/analytics.js";
import bulkDataRoutes from "./routes/bulkData.js";
import preferencesRoutes from "./routes/preferences.js";
import recentSearchRoutes from "./routes/recentSearches.js";
import starredResultRoutes from "./routes/starredResults.js";
import historyReplayRoutes from "./routes/historyReplay.js";
import exportResultRoutes from "./routes/exportResults.js";
import suggestionRoutes from "./routes/suggestions.js";
import resultCacheRoutes from "./routes/resultCache.js";
import searchSharingRoutes from "./routes/searchSharing.js";
import resultNoteRoutes from "./routes/resultNotes.js";
import searchTagRoutes from "./routes/searchTags.js";
import dataCleanupRoutes from "./routes/dataCleanup.js";
import dataRetentionRoutes from "./routes/dataRetention.js";
import systemHealthRoutes from "./routes/systemHealth.js";
import apiKeyRoutes from "./routes/apiKeys.js";
import backupRestoreRoutes from "./routes/backupRestore.js";
import rateLimitDashboardRoutes from "./routes/rateLimitDashboard.js";
import errorTrackingRoutes from "./routes/errorTracking.js";
import requestLoggingRoutes from "./routes/requestLogging.js";
import sessionManagementRoutes from "./routes/sessionManagement.js";
import featureFlagRoutes from "./routes/featureFlags.js";
import apiUsageRoutes from "./routes/apiUsage.js";
import twoFactorAuthRoutes from "./routes/twoFactorAuth.js";
import ipAccessControlRoutes from "./routes/ipAccessControl.js";
import impersonationRoutes from "./routes/impersonation.js";
import bulkUserManagementRoutes from "./routes/bulkUserManagement.js";
import gdprExportRoutes from "./routes/gdprExport.js";
import notificationPreferencesRoutes from "./routes/notificationPreferences.js";
import userActivityRoutes from "./routes/userActivity.js";
import dataImportRoutes from "./routes/dataImport.js";
import accountRecoveryRoutes from "./routes/accountRecovery.js";
import snapshotRoutes from "./routes/snapshots.js";
import collectionRoutes from "./routes/collections.js";
import circuitBreakerDashboardRoutes from "./routes/circuitBreakerDashboard.js";
import sseRoutes from "./routes/sse.js";
import geocodingRoutes from "./routes/geocoding.js";
import reportRoutes from "./routes/reports.js";
import emailNotificationRoutes from "./routes/emailNotifications.js";
import behaviorAnalyticsRoutes from "./routes/behaviorAnalytics.js";
import abTestingRoutes from "./routes/abTesting.js";
import smartDefaultsRoutes from "./routes/smartDefaults.js";
import performanceDashboardRoutes, { perfCountMiddleware } from "./routes/performanceDashboard.js";
import previewRoutes from "./routes/previews.js";
import devToolsRoutes from "./routes/devTools.js";
import querySuggestionRoutes from "./routes/querySuggestions.js";
import resultValidationRoutes from "./routes/resultValidation.js";
import searchSessionRoutes from "./routes/searchSessions.js";
import resultFreshnessRoutes from "./routes/resultFreshness.js";
import queryExpansionRoutes from "./routes/queryExpansion.js";
import favoritesSyncRoutes from "./routes/favoritesSync.js";
import smartHistoryRoutes from "./routes/smartHistory.js";
import resultSnapshotRoutes from "./routes/resultSnapshots.js";
import userProfileRoutes from "./routes/userSearchProfile.js";
import collaborativeRoutes from "./routes/collaborativeFiltering.js";
import intelligentCacheRoutes from "./routes/intelligentCache.js";
import queryPerformanceRoutes from "./routes/queryPerformance.js";
import rankingFeedbackRoutes from "./routes/rankingFeedback.js";
import searchABRoutes from "./routes/searchABTesting.js";
import predictivePrefetchRoutes from "./routes/predictivePrefetch.js";
import searchPersonalizationRoutes from "./routes/searchPersonalization.js";
import autocompleteDictionaryRoutes from "./routes/autocompleteDictionary.js";
import resultClusteringRoutes from "./routes/resultClustering.js";
import sessionRecommendationRoutes from "./routes/sessionRecommendations.js";
import comparisonExportRoutes from "./routes/comparisonExport.js";
import resultDedupV2Routes from "./routes/resultDedupV2.js";
import urlHealthCheckerRoutes from "./routes/urlHealthChecker.js";
import queryNormalizationRoutes from "./routes/queryNormalization.js";
import dataIntegrityRoutes from "./routes/dataIntegrity.js";
import backupSchedulerRoutes from "./routes/backupScheduler.js";
import anomalyDetectionRoutes from "./routes/anomalyDetection.js";
import errorRateRoutes from "./routes/errorRateMonitor.js";
import responseTimeRoutes from "./routes/responseTimePercentiles.js";
import engagementRoutes from "./routes/userEngagement.js";
import systemResourceRoutes from "./routes/systemResources.js";
import healthScoreRoutes from "./routes/apiHealthScore.js";
import schemaRoutes from "./routes/requestSchemas.js";
import changelogRoutes from "./routes/apiChangelog.js";
import docsRoutes from "./routes/endpointDocs.js";
import reqResLogRoutes from "./routes/requestResponseLogger.js";
import wsRoutes from "./routes/websocket.js";
import collaborationRoutes from "./routes/searchCollaboration.js";
import priceMonitorRoutes from "./routes/livePriceMonitor.js";
import realtimeNotifRoutes from "./routes/realtimeNotifications.js";
import connectionMgrRoutes from "./routes/connectionManager.js";
import pipelineRoutes from "./routes/dataPipeline.js";
import etlRoutes from "./routes/etlScheduler.js";
import transformRoutes from "./routes/dataTransforms.js";
import pipelineMonitorRoutes from "./routes/pipelineMonitor.js";
import qualityRoutes from "./routes/dataQuality.js";
import workflowRoutes from "./routes/workflowEngine.js";
import taskQueueRoutes from "./routes/taskQueue.js";
import eventRoutes from "./routes/eventSourcing.js";
import webhookRetryRoutes from "./routes/webhookRetry.js";
import automationRoutes from "./routes/automationRules.js";
import integrationTestRoutes from "./routes/integrationTests.js";
import loadTestRoutes from "./routes/loadTesting.js";
import testDataRoutes from "./routes/testDataGenerators.js";
import mockServiceRoutes from "./routes/mockServices.js";
import contractRoutes from "./routes/contractTesting.js";
import changelogViewerRoutes from "./routes/apiChangelogViewer.js";
import deprecationRoutes from "./routes/endpointDeprecation.js";
import usageAnalyticsRoutes from "./routes/apiUsageAnalytics.js";
import schemaRegistryRoutes from "./routes/schemaRegistry.js";
import versioningDashboardRoutes from "./routes/apiVersioningDashboard.js";
import containerHealthRoutes from "./routes/containerHealth.js";
import deploymentTrackerRoutes from "./routes/deploymentTracker.js";
import envConfigRoutes from "./routes/envConfigManager.js";
import iacViewerRoutes from "./routes/iacViewer.js";
import serviceDependencyRoutes from "./routes/serviceDependencyMap.js";
import complianceCheckerRoutes from "./routes/complianceChecker.js";
import vulnerabilityScannerRoutes from "./routes/vulnerabilityScanner.js";
import accessControlAuditRoutes from "./routes/accessControlAudit.js";
import dataEncryptionRoutes from "./routes/dataEncryption.js";
import securityIncidentRoutes from "./routes/securityIncidents.js";
import { pipelineTrace } from "./middleware/pipelineTrace.js";
import { getSSEManager } from "./middleware/sse.js";
import { initWebSocket } from "./utils/websocket.js";
import { errorTracker } from "./middleware/errorTracker.js";
import { metricsMiddleware, metricsEndpoint, performanceEndpoint } from "./middleware/metrics.js";
import { csrfProtection } from "./middleware/csrf.js";
import { slowRequestTimeout } from "./middleware/slowTimeout.js";
import { apiVersion } from "./middleware/apiVersion.js";
import { responseCache } from "./middleware/responseCache.js";
import swaggerSpec from "./utils/swagger.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Trust proxy (nginx/Cloudflare) for secure cookies and correct IP
app.set("trust proxy", 1);

// Security headers (helmet)
app.use(
  helmet({
    contentSecurityPolicy: false, // We set CSP manually below
    crossOriginEmbedderPolicy: false,
    hsts: config.isProduction ? { maxAge: 31536000, includeSubDomains: true } : false,
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
    permissionsPolicy: {
      camera: [],
      microphone: [],
      geolocation: [],
      payment: [],
    },
  })
);

// Permissions Policy (restrict browser features)
app.use((_req, res, next) => {
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  next();
});

// Favicon (avoid 404 noise)
app.get("/favicon.ico", (_req, res) => res.status(204).end());

// Response compression (gzip/deflate for JSON, HTML, CSS, JS)
app.use(compression({
  threshold: 256, // Only compress responses > 256 bytes
  filter: (req, res) => {
    if (req.headers["x-no-compression"]) return false;
    return compression.filter(req, res);
  },
}));

// Content Security Policy
app.use((req, res, next) => {
  if (req.path.endsWith(".html") || req.path === "/") {
    res.setHeader(
      "Content-Security-Policy",
      [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://www.googletagmanager.com https://va.vercel-scripts.com",
        "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com https://cdnjs.cloudflare.com",
        "img-src 'self' data: https://placehold.co",
        "connect-src 'self' https://va.vercel-scripts.com ws: wss:",
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'self'",
      ].join("; ")
    );
  }
  next();
});

// CORS configuration
const corsOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(",").map((o) => o.trim())
  : [];
app.use(
  cors({
    origin: corsOrigins.length > 0 ? corsOrigins : false,
    credentials: true,
  })
);

// Slow request timeout (before body parser to monitor data events)
app.use(slowRequestTimeout());

// Body parsing with size limits
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));

// Request ID and logging
app.use(requestId);
app.use(metricsMiddleware);
app.use(requestLogger);
app.use(requestTimeout());

// API versioning (supports /api/v1/* and /api/*)
app.use(apiVersion);

// Session configuration
const sessionMiddleware = session({
  secret: config.session.secret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    maxAge: config.session.maxAge,
    secure: config.isProduction,
    sameSite: "lax",
  },
});
app.use(sessionMiddleware);

// CSRF protection (after session, before routes)
app.use(csrfProtection);

// API response caching (skip auth-sensitive paths)
app.use(responseCache({
  skipPaths: ["/api/auth", "/api/me", "/api/csrf", "/health", "/metrics"],
}));

// Swagger API docs
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customCss: ".swagger-ui .topbar { display: none }",
  customSiteTitle: "Hotel Search API Docs",
}));

// Static files
app.use(express.static(join(__dirname, "public")));

// Prometheus metrics endpoint
app.get("/metrics", metricsEndpoint);

// Performance profiling endpoint
app.get("/api/performance", performanceEndpoint);

// Health endpoint with dependency checks
app.get("/health", async (_req, res) => {
  const checks = {
    server: { status: "ok" },
    memory: {
      status: "ok",
      heapUsed: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`,
    },
  };

  // Check DDG server
  try {
    const ddgResp = await fetch(`${config.ddg.serverUrl}/health`, { signal: AbortSignal.timeout(2000) });
    checks.ddg = { status: ddgResp.ok ? "ok" : "degraded" };
  } catch {
    checks.ddg = { status: "unavailable" };
  }

  const allOk = Object.values(checks).every((c) => c.status === "ok" || c.status === "unavailable");

  res.status(allOk ? 200 : 503).json({
    status: allOk ? "ok" : "degraded",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    checks,
  });
});

// API routes (before proxy)
app.use(authRoutes);
app.use(userRoutes);
app.use(chatRoutes);
app.use(searchRoutes);
app.use(case12Routes);
app.use(historyRoutes);
app.use(auditRoutes);
app.use(bookmarkRoutes);
app.use(dashboardRoutes);
app.use(savedSearchRoutes);
app.use(shareRoutes);
app.use(comparisonRoutes);
app.use(priceAlertRoutes);
app.use(searchTemplateRoutes);
app.use(notificationRoutes);
app.use(filterRoutes);
app.use(webhookRoutes);
app.use(scheduledSearchRoutes);
app.use(deduplicationRoutes);
app.use(analyticsRoutes);
app.use(bulkDataRoutes);
app.use(preferencesRoutes);
app.use(recentSearchRoutes);
app.use(starredResultRoutes);
app.use(historyReplayRoutes);
app.use(exportResultRoutes);
app.use(suggestionRoutes);
app.use(resultCacheRoutes);
app.use(searchSharingRoutes);
app.use(resultNoteRoutes);
app.use(searchTagRoutes);
app.use(dataCleanupRoutes);
app.use(dataRetentionRoutes);
app.use(systemHealthRoutes);
app.use(apiKeyRoutes);
app.use(backupRestoreRoutes);
app.use(rateLimitDashboardRoutes);
app.use(errorTrackingRoutes);
app.use(requestLoggingRoutes);
app.use(sessionManagementRoutes);
app.use(featureFlagRoutes);
app.use(apiUsageRoutes);
app.use(twoFactorAuthRoutes);
app.use(ipAccessControlRoutes);
app.use(impersonationRoutes);
app.use(bulkUserManagementRoutes);
app.use(gdprExportRoutes);
app.use(notificationPreferencesRoutes);
app.use(userActivityRoutes);
app.use(dataImportRoutes);
app.use(accountRecoveryRoutes);
app.use(snapshotRoutes);
app.use(collectionRoutes);
app.use(circuitBreakerDashboardRoutes);
app.use(sseRoutes);
app.use(geocodingRoutes);
app.use(reportRoutes);
app.use(emailNotificationRoutes);
app.use(behaviorAnalyticsRoutes);
app.use(abTestingRoutes);
app.use(smartDefaultsRoutes);
app.use(performanceDashboardRoutes);
app.use(previewRoutes);
app.use(devToolsRoutes);
app.use(querySuggestionRoutes);
app.use(resultValidationRoutes);
app.use(searchSessionRoutes);
app.use(resultFreshnessRoutes);
app.use(queryExpansionRoutes);
app.use(favoritesSyncRoutes);
app.use(smartHistoryRoutes);
app.use(resultSnapshotRoutes);
app.use(userProfileRoutes);
app.use(collaborativeRoutes);
app.use(intelligentCacheRoutes);
app.use(queryPerformanceRoutes);
app.use(rankingFeedbackRoutes);
app.use(searchABRoutes);
app.use(predictivePrefetchRoutes);
app.use(searchPersonalizationRoutes);
app.use(autocompleteDictionaryRoutes);
app.use(resultClusteringRoutes);
app.use(sessionRecommendationRoutes);
app.use(comparisonExportRoutes);
app.use(resultDedupV2Routes);
app.use(urlHealthCheckerRoutes);
app.use(queryNormalizationRoutes);
app.use(dataIntegrityRoutes);
app.use(backupSchedulerRoutes);
app.use(anomalyDetectionRoutes);
app.use(errorRateRoutes);
app.use(responseTimeRoutes);
app.use(engagementRoutes);
app.use(systemResourceRoutes);
app.use(healthScoreRoutes);
app.use(schemaRoutes);
app.use(changelogRoutes);
app.use(docsRoutes);
app.use(reqResLogRoutes);
app.use(wsRoutes);
app.use(collaborationRoutes);
app.use(priceMonitorRoutes);
app.use(realtimeNotifRoutes);
app.use(connectionMgrRoutes);
app.use(pipelineRoutes);
app.use(etlRoutes);
app.use(transformRoutes);
app.use(pipelineMonitorRoutes);
app.use(qualityRoutes);
app.use(workflowRoutes);
app.use(taskQueueRoutes);
app.use(eventRoutes);
app.use(webhookRetryRoutes);
app.use(automationRoutes);
app.use(integrationTestRoutes);
app.use(loadTestRoutes);
app.use(testDataRoutes);
app.use(mockServiceRoutes);
app.use(contractRoutes);
app.use(changelogViewerRoutes);
app.use(deprecationRoutes);
app.use(usageAnalyticsRoutes);
app.use(schemaRegistryRoutes);
app.use(versioningDashboardRoutes);
app.use(containerHealthRoutes);
app.use(deploymentTrackerRoutes);
app.use(envConfigRoutes);
app.use(iacViewerRoutes);
app.use(serviceDependencyRoutes);
app.use(complianceCheckerRoutes);
app.use(vulnerabilityScannerRoutes);
app.use(accessControlAuditRoutes);
app.use(dataEncryptionRoutes);
app.use(securityIncidentRoutes);
app.use(pipelineTrace);
app.use(perfCountMiddleware);
app.use(pageRoutes);

// Proxy unmatched /api/* to localhost:8080 (SearXNG)
app.use(
  "/api",
  createProxyMiddleware({
    target: "http://localhost:8080",
    changeOrigin: true,
    pathRewrite: { "^/api": "" },
    timeout: 30000,
    proxyTimeout: 30000,
    on: {
      error: (_err, _req, res) => {
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Proxy error", code: 502 }));
      },
    },
  })
);

// 404 handler
app.use((req, res) => {
  if (req.accepts("html")) {
    return res.status(404).sendFile(join(__dirname, "public", "404.html"));
  }
  res.status(404).json({ error: "Not found", requestId: req.requestId });
});

// Error tracking middleware (before global error handler)
app.use(errorTracker);

// Global error handler
app.use((err, req, res, _next) => {
  console.error("Unhandled error:", err);
  if (req.accepts("html")) {
    return res.status(500).sendFile(join(__dirname, "public", "500.html"));
  }
  res.status(500).json({ error: "Internal server error", requestId: req.requestId });
});

// Start server with graceful shutdown
const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`http://localhost:${PORT}`);
  // Start SSE heartbeat (every 30s)
  getSSEManager().startHeartbeat(30000);
  initWebSocket(server, sessionMiddleware);
  console.log("Socket.IO initialized on /socket.io");
});

// Graceful shutdown
function shutdown(signal) {
  console.log(`\n${signal} received. Shutting down gracefully...`);
  server.close(() => {
    console.log("Server closed.");
    process.exit(0);
  });
  // Force close after 10s
  setTimeout(() => {
    console.error("Forced shutdown after timeout.");
    process.exit(1);
  }, 10000);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

export default app;
