// Favorites sync — sync starred results across devices
// Uses a sync token approach for conflict resolution

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FAVORITES_FILE = path.join(__dirname, "..", "favorites_sync.json");
const SYNC_TOKENS_FILE = path.join(__dirname, "..", "sync_tokens.json");

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
 * Generate a sync token for conflict resolution.
 */
function generateSyncToken() {
  return crypto.randomBytes(16).toString("hex");
}

/**
 * Get favorites for a user.
 */
export function getFavorites(userId) {
  const allFavorites = readJSON(FAVORITES_FILE);
  return allFavorites[userId] || { items: [], lastSync: null, syncToken: null };
}

/**
 * Add a favorite for a user.
 */
export function addFavorite(userId, item) {
  if (!userId || !item || !item.url) {
    throw new Error("userId and item.url are required");
  }

  const allFavorites = readJSON(FAVORITES_FILE);
  if (!allFavorites[userId]) {
    allFavorites[userId] = { items: [], lastSync: null, syncToken: null };
  }

  const userFavorites = allFavorites[userId];

  // Check for duplicate
  const existing = userFavorites.items.find((f) => f.url === item.url);
  if (existing) {
    return { added: false, item: existing, message: "Already in favorites" };
  }

  const favorite = {
    id: crypto.randomBytes(8).toString("hex"),
    url: item.url,
    title: item.title || "",
    description: item.description || "",
    engine: item.engine || "",
    imageUrl: item.imageUrl || null,
    price: item.price || null,
    rating: item.rating || null,
    tags: item.tags || [],
    addedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  userFavorites.items.unshift(favorite);
  userFavorites.lastSync = new Date().toISOString();
  userFavorites.syncToken = generateSyncToken();

  writeJSON(FAVORITES_FILE, allFavorites);

  return { added: true, item: favorite };
}

/**
 * Remove a favorite for a user.
 */
export function removeFavorite(userId, favoriteId) {
  const allFavorites = readJSON(FAVORITES_FILE);
  if (!allFavorites[userId]) return false;

  const userFavorites = allFavorites[userId];
  const initialLength = userFavorites.items.length;
  userFavorites.items = userFavorites.items.filter((f) => f.id !== favoriteId);

  if (userFavorites.items.length < initialLength) {
    userFavorites.lastSync = new Date().toISOString();
    userFavorites.syncToken = generateSyncToken();
    writeJSON(FAVORITES_FILE, allFavorites);
    return true;
  }
  return false;
}

/**
 * Update a favorite (tags, notes, etc).
 */
export function updateFavorite(userId, favoriteId, updates) {
  const allFavorites = readJSON(FAVORITES_FILE);
  if (!allFavorites[userId]) return null;

  const userFavorites = allFavorites[userId];
  const favorite = userFavorites.items.find((f) => f.id === favoriteId);

  if (!favorite) return null;

  // Apply updates
  const allowedFields = ["title", "description", "tags", "notes", "rating", "price"];
  for (const field of allowedFields) {
    if (updates[field] !== undefined) {
      favorite[field] = updates[field];
    }
  }
  favorite.updatedAt = new Date().toISOString();

  userFavorites.lastSync = new Date().toISOString();
  userFavorites.syncToken = generateSyncToken();

  writeJSON(FAVORITES_FILE, allFavorites);
  return favorite;
}

/**
 * Get favorites sync status for a user.
 */
export function getSyncStatus(userId) {
  const allFavorites = readJSON(FAVORITES_FILE);
  const userFavorites = allFavorites[userId];

  if (!userFavorites) {
    return {
      synced: false,
      itemCount: 0,
      lastSync: null,
      syncToken: null,
    };
  }

  return {
    synced: true,
    itemCount: userFavorites.items.length,
    lastSync: userFavorites.lastSync,
    syncToken: userFavorites.syncToken,
  };
}

/**
 * Sync favorites from a client device.
 * Uses sync token for conflict resolution.
 */
export function syncFavorites(userId, clientData) {
  if (!userId || !clientData) {
    throw new Error("userId and clientData are required");
  }

  const allFavorites = readJSON(FAVORITES_FILE);
  const serverData = allFavorites[userId] || { items: [], lastSync: null, syncToken: null };

  // If client has no sync token, treat as initial sync
  if (!clientData.syncToken) {
    return {
      action: "full_sync",
      favorites: serverData,
      conflicts: [],
    };
  }

  // Check for conflicts
  const conflicts = [];
  const mergedItems = new Map();

  // Add server items
  for (const item of serverData.items) {
    mergedItems.set(item.url, { ...item, source: "server" });
  }

  // Merge client items
  for (const item of clientData.items || []) {
    const existing = mergedItems.get(item.url);
    if (existing) {
      // Conflict: both have the same URL
      if (new Date(item.updatedAt) > new Date(existing.updatedAt)) {
        // Client is newer
        mergedItems.set(item.url, { ...item, source: "client" });
        conflicts.push({ url: item.url, resolution: "client_wins" });
      } else {
        conflicts.push({ url: item.url, resolution: "server_wins" });
      }
    } else {
      mergedItems.set(item.url, { ...item, source: "client" });
    }
  }

  // Update server data
  const mergedArray = [...mergedItems.values()].sort((a, b) =>
    new Date(b.addedAt) - new Date(a.addedAt)
  );

  serverData.items = mergedArray;
  serverData.lastSync = new Date().toISOString();
  serverData.syncToken = generateSyncToken();

  allFavorites[userId] = serverData;
  writeJSON(FAVORITES_FILE, allFavorites);

  return {
    action: "merged",
    favorites: serverData,
    conflicts,
  };
}

/**
 * Get favorites statistics for a user.
 */
export function getFavoritesStats(userId) {
  const favorites = getFavorites(userId);

  if (favorites.items.length === 0) {
    return {
      total: 0,
      byEngine: {},
      byTag: {},
      recentlyAdded: [],
    };
  }

  const byEngine = {};
  const byTag = {};

  for (const item of favorites.items) {
    if (item.engine) {
      byEngine[item.engine] = (byEngine[item.engine] || 0) + 1;
    }
    for (const tag of (item.tags || [])) {
      byTag[tag] = (byTag[tag] || 0) + 1;
    }
  }

  const recentlyAdded = favorites.items.slice(0, 5).map((item) => ({
    id: item.id,
    title: item.title,
    url: item.url,
    addedAt: item.addedAt,
  }));

  return {
    total: favorites.items.length,
    byEngine,
    byTag,
    recentlyAdded,
    lastSync: favorites.lastSync,
  };
}
