// User engagement metrics — track feature usage and adoption
// Records user actions and computes engagement statistics

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_FILE = path.join(__dirname, "..", "engagement_data.json");
const MAX_EVENTS = 100000;

function readJSON(filePath) {
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch { /* ignore */ }
  return { events: [], features: {} };
}

function writeJSON(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data));
  } catch { /* ignore */ }
}

/**
 * Record a user engagement event.
 */
export function recordEvent(entry) {
  const data = readJSON(DATA_FILE);
  if (!data.events) data.events = [];
  if (!data.features) data.features = {};

  const record = {
    userId: entry.userId || "anonymous",
    feature: entry.feature || "unknown",
    action: entry.action || "use",
    metadata: entry.metadata || null,
    timestamp: Date.now(),
  };

  data.events.unshift(record);

  // Update feature usage counts
  if (!data.features[record.feature]) {
    data.features[record.feature] = { total: 0, uniqueUsers: new Set(), actions: {} };
  }
  const feat = data.features[record.feature];
  feat.total++;
  if (!feat.actions[record.action]) feat.actions[record.action] = 0;
  feat.actions[record.action]++;

  // Track unique users (store as array in JSON)
  if (!feat._users) feat._users = [];
  if (!feat._users.includes(record.userId)) {
    feat._users.push(record.userId);
  }
  feat.uniqueUsers = feat._users.length;

  if (data.events.length > MAX_EVENTS) {
    data.events.length = MAX_EVENTS;
  }

  writeJSON(DATA_FILE, data);
  return record;
}

/**
 * Get feature usage statistics.
 */
export function getFeatureStats(options = {}) {
  const { hours = 24 } = options;
  const data = readJSON(DATA_FILE);
  const cutoff = Date.now() - hours * 60 * 60 * 1000;

  const events = (data.events || []).filter((e) => e.timestamp > cutoff);
  const features = data.features || {};

  // Recompute from recent events for time-filtered stats
  const featureMap = {};
  for (const event of events) {
    if (!featureMap[event.feature]) {
      featureMap[event.feature] = { total: 0, users: new Set(), actions: {} };
    }
    const f = featureMap[event.feature];
    f.total++;
    f.users.add(event.userId);
    if (!f.actions[event.action]) f.actions[event.action] = 0;
    f.actions[event.action]++;
  }

  const featureList = Object.entries(featureMap)
    .map(([feature, stats]) => ({
      feature,
      totalEvents: stats.total,
      uniqueUsers: stats.users.size,
      actions: stats.actions,
    }))
    .sort((a, b) => b.totalEvents - a.totalEvents);

  return {
    totalEvents: events.length,
    features: featureList,
    timeRange: `${hours}h`,
  };
}

/**
 * Get engagement overview — active users, popular features, adoption rates.
 */
export function getEngagementOverview(options = {}) {
  const { hours = 24 } = options;
  const data = readJSON(DATA_FILE);
  const cutoff = Date.now() - hours * 60 * 60 * 1000;

  const events = (data.events || []).filter((e) => e.timestamp > cutoff);

  const uniqueUsers = new Set(events.map((e) => e.userId)).size;
  const featureCounts = {};
  const userFeatureMap = {};

  for (const event of events) {
    featureCounts[event.feature] = (featureCounts[event.feature] || 0) + 1;
    if (!userFeatureMap[event.userId]) userFeatureMap[event.userId] = new Set();
    userFeatureMap[event.userId].add(event.feature);
  }

  // Average features per user
  const userCounts = Object.values(userFeatureMap).map((s) => s.size);
  const avgFeaturesPerUser = userCounts.length > 0
    ? Math.round((userCounts.reduce((a, b) => a + b, 0) / userCounts.length) * 100) / 100
    : 0;

  // Top features
  const topFeatures = Object.entries(featureCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([feature, count]) => ({ feature, count }));

  // Event timeline (hourly buckets)
  const buckets = {};
  for (const event of events) {
    const hour = new Date(event.timestamp).toISOString().slice(0, 13);
    buckets[hour] = (buckets[hour] || 0) + 1;
  }

  return {
    totalEvents: events.length,
    uniqueUsers,
    avgFeaturesPerUser,
    topFeatures,
    timeline: Object.entries(buckets)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([hour, count]) => ({ hour, count })),
    timeRange: `${hours}h`,
  };
}

/**
 * Get user-specific engagement.
 */
export function getUserEngagement(userId, options = {}) {
  const { hours = 168 } = options; // default 7 days
  const data = readJSON(DATA_FILE);
  const cutoff = Date.now() - hours * 60 * 60 * 1000;

  const events = (data.events || []).filter(
    (e) => e.userId === userId && e.timestamp > cutoff
  );

  const features = {};
  const actions = {};
  const days = new Set();

  for (const event of events) {
    features[event.feature] = (features[event.feature] || 0) + 1;
    actions[event.action] = (actions[event.action] || 0) + 1;
    days.add(new Date(event.timestamp).toISOString().slice(0, 10));
  }

  return {
    userId,
    totalEvents: events.length,
    activeDays: days.size,
    features: Object.entries(features)
      .sort((a, b) => b[1] - a[1])
      .map(([feature, count]) => ({ feature, count })),
    actions: Object.entries(actions)
      .sort((a, b) => b[1] - a[1])
      .map(([action, count]) => ({ action, count })),
    timeRange: `${hours}h`,
  };
}

/**
 * Get adoption metrics — how many users have tried each feature.
 */
export function getAdoptionMetrics(options = {}) {
  const { hours = 168 } = options;
  const data = readJSON(DATA_FILE);
  const cutoff = Date.now() - hours * 60 * 60 * 1000;

  const events = (data.events || []).filter((e) => e.timestamp > cutoff);
  const totalUsers = new Set(events.map((e) => e.userId)).size;

  const featureUsers = {};
  for (const event of events) {
    if (!featureUsers[event.feature]) featureUsers[event.feature] = new Set();
    featureUsers[event.feature].add(event.userId);
  }

  const adoption = Object.entries(featureUsers)
    .map(([feature, users]) => ({
      feature,
      users: users.size,
      adoptionRate: totalUsers > 0 ? Math.round((users.size / totalUsers) * 10000) / 100 : 0,
    }))
    .sort((a, b) => b.adoptionRate - a.adoptionRate);

  return {
    totalUsers,
    features: adoption,
    timeRange: `${hours}h`,
  };
}

/**
 * Clear engagement data.
 */
export function clearEngagementData() {
  writeJSON(DATA_FILE, { events: [], features: {} });
}
