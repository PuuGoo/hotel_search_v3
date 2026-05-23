// Result snapshots — save and compare search result sets over time
// Tracks how results change for the same query over time

import fs from "fs";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SNAPSHOTS_FILE = path.join(__dirname, "..", "result_snapshots.json");
const MAX_SNAPSHOTS_PER_USER = 100;

function readJSON(filePath) {
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch { /* ignore */ }
  return {};
}

function writeJSON(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  } catch { /* ignore */ }
}

/**
 * Save a snapshot of search results.
 */
export function saveSnapshot(userId, data) {
  if (!userId || !data || !data.query || !data.results) {
    throw new Error("userId, query, and results are required");
  }

  const allSnapshots = readJSON(SNAPSHOTS_FILE);
  if (!allSnapshots[userId]) {
    allSnapshots[userId] = [];
  }

  const snapshot = {
    id: crypto.randomBytes(8).toString("hex"),
    query: data.query,
    engine: data.engine || "unknown",
    results: data.results.map((r) => ({
      title: r.title || "",
      url: r.url || "",
      description: r.description || "",
      price: r.price || null,
      rating: r.rating || null,
      position: r.position || null,
    })),
    resultCount: data.results.length,
    metadata: {
      userAgent: data.userAgent || null,
      filters: data.filters || {},
      sortBy: data.sortBy || null,
    },
    createdAt: new Date().toISOString(),
  };

  allSnapshots[userId].unshift(snapshot);

  // Cap per user
  if (allSnapshots[userId].length > MAX_SNAPSHOTS_PER_USER) {
    allSnapshots[userId].length = MAX_SNAPSHOTS_PER_USER;
  }

  writeJSON(SNAPSHOTS_FILE, allSnapshots);
  return snapshot;
}

/**
 * Get all snapshots for a user.
 */
export function getSnapshots(userId, options = {}) {
  const { query, engine, limit = 50 } = options;

  const allSnapshots = readJSON(SNAPSHOTS_FILE);
  let snapshots = allSnapshots[userId] || [];

  // Filter by query
  if (query) {
    const lower = query.toLowerCase();
    snapshots = snapshots.filter((s) => s.query.toLowerCase().includes(lower));
  }

  // Filter by engine
  if (engine) {
    snapshots = snapshots.filter((s) => s.engine === engine);
  }

  return snapshots.slice(0, limit);
}

/**
 * Get a specific snapshot by ID.
 */
export function getSnapshot(userId, snapshotId) {
  const allSnapshots = readJSON(SNAPSHOTS_FILE);
  const userSnapshots = allSnapshots[userId] || [];
  return userSnapshots.find((s) => s.id === snapshotId) || null;
}

/**
 * Delete a snapshot.
 */
export function deleteSnapshot(userId, snapshotId) {
  const allSnapshots = readJSON(SNAPSHOTS_FILE);
  if (!allSnapshots[userId]) return false;

  const initialLength = allSnapshots[userId].length;
  allSnapshots[userId] = allSnapshots[userId].filter((s) => s.id !== snapshotId);

  if (allSnapshots[userId].length < initialLength) {
    writeJSON(SNAPSHOTS_FILE, allSnapshots);
    return true;
  }
  return false;
}

/**
 * Compare two snapshots.
 * Returns differences between the two result sets.
 */
export function compareSnapshots(userId, snapshotId1, snapshotId2) {
  const snapshot1 = getSnapshot(userId, snapshotId1);
  const snapshot2 = getSnapshot(userId, snapshotId2);

  if (!snapshot1 || !snapshot2) {
    return null;
  }

  const urls1 = new Set(snapshot1.results.map((r) => r.url));
  const urls2 = new Set(snapshot2.results.map((r) => r.url));

  // Results in snapshot1 but not in snapshot2
  const removed = snapshot1.results
    .filter((r) => !urls2.has(r.url))
    .map((r) => ({ ...r, change: "removed" }));

  // Results in snapshot2 but not in snapshot1
  const added = snapshot2.results
    .filter((r) => !urls1.has(r.url))
    .map((r) => ({ ...r, change: "added" }));

  // Results in both (check for position changes)
  const moved = [];
  for (const r2 of snapshot2.results) {
    if (urls1.has(r2.url)) {
      const r1 = snapshot1.results.find((r) => r.url === r2.url);
      if (r1 && r1.position !== r2.position) {
        moved.push({
          ...r2,
          previousPosition: r1.position,
          currentPosition: r2.position,
          positionChange: (r1.position || 0) - (r2.position || 0),
          change: "moved",
        });
      }
    }
  }

  return {
    snapshot1: {
      id: snapshot1.id,
      query: snapshot1.query,
      engine: snapshot1.engine,
      resultCount: snapshot1.resultCount,
      createdAt: snapshot1.createdAt,
    },
    snapshot2: {
      id: snapshot2.id,
      query: snapshot2.query,
      engine: snapshot2.engine,
      resultCount: snapshot2.resultCount,
      createdAt: snapshot2.createdAt,
    },
    comparison: {
      added,
      removed,
      moved,
      unchanged: snapshot2.results.length - added.length - moved.length,
      totalChanges: added.length + removed.length + moved.length,
      timeDiff: new Date(snapshot2.createdAt) - new Date(snapshot1.createdAt),
    },
  };
}

/**
 * Get snapshot statistics for a user.
 */
export function getSnapshotStats(userId) {
  const allSnapshots = readJSON(SNAPSHOTS_FILE);
  const snapshots = allSnapshots[userId] || [];

  if (snapshots.length === 0) {
    return {
      total: 0,
      queries: [],
      engines: {},
      avgResults: 0,
    };
  }

  const queries = [...new Set(snapshots.map((s) => s.query))];
  const engines = {};
  let totalResults = 0;

  for (const snapshot of snapshots) {
    engines[snapshot.engine] = (engines[snapshot.engine] || 0) + 1;
    totalResults += snapshot.resultCount;
  }

  return {
    total: snapshots.length,
    queries: queries.slice(0, 20),
    engines,
    avgResults: Math.round(totalResults / snapshots.length),
    oldest: snapshots[snapshots.length - 1]?.createdAt,
    newest: snapshots[0]?.createdAt,
  };
}
