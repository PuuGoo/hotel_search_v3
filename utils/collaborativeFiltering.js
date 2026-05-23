// Collaborative filtering — recommend hotels based on similar users' choices
// Uses user-based collaborative filtering to find similar users and recommend their choices

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const HISTORY_FILE = path.join(__dirname, "..", "search_history.json");
const BOOKMARKS_FILE = path.join(__dirname, "..", "bookmarks.json");
const FAVORITES_FILE = path.join(__dirname, "..", "favorites_sync.json");

function readJSON(filePath) {
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch { /* ignore */ }
  return {};
}

/**
 * Calculate Jaccard similarity between two sets.
 */
function jaccardSimilarity(set1, set2) {
  const intersection = new Set([...set1].filter((x) => set2.has(x)));
  const union = new Set([...set1, ...set2]);
  return union.size > 0 ? intersection.size / union.size : 0;
}

/**
 * Get user's search/query profile as a set of tokens.
 */
function getUserTokens(userId) {
  const history = readJSON(HISTORY_FILE);
  const historyArray = Array.isArray(history) ? history : [];
  const userHistory = historyArray.filter((h) => h && h.userId === userId && h.query);

  const tokens = new Set();
  for (const entry of userHistory) {
    const words = entry.query.toLowerCase().split(/\s+/);
    for (const word of words) {
      if (word.length > 2) tokens.add(word);
    }
  }
  return tokens;
}

/**
 * Get user's bookmarked/favorited URLs.
 */
function getUserBookmarks(userId) {
  const bookmarks = readJSON(BOOKMARKS_FILE);
  const allFavorites = readJSON(FAVORITES_FILE);

  const urls = new Set();

  // From bookmarks
  const userBookmarks = bookmarks[userId] || [];
  if (Array.isArray(userBookmarks)) {
    for (const bm of userBookmarks) {
      if (bm.url) urls.add(bm.url);
    }
  }

  // From favorites sync
  const userFavorites = allFavorites[userId]?.items || [];
  for (const fav of userFavorites) {
    if (fav.url) urls.add(fav.url);
  }

  return urls;
}

/**
 * Find similar users based on search patterns.
 * @param {string} userId - target user
 * @param {number} maxSimilar - max similar users to return
 * @returns {Object[]} similar users with similarity scores
 */
export function findSimilarUsers(userId, maxSimilar = 5) {
  const history = readJSON(HISTORY_FILE);
  const historyArray = Array.isArray(history) ? history : [];

  // Get all unique user IDs
  const userIds = new Set(historyArray.filter((h) => h && h.userId).map((h) => h.userId));
  userIds.delete(userId);

  const targetTokens = getUserTokens(userId);
  if (targetTokens.size === 0) return [];

  const similarities = [];

  for (const otherId of userIds) {
    const otherTokens = getUserTokens(otherId);
    if (otherTokens.size === 0) continue;

    const similarity = jaccardSimilarity(targetTokens, otherTokens);
    if (similarity > 0) {
      similarities.push({
        userId: otherId,
        similarity: Math.round(similarity * 100) / 100,
        commonTokens: [...targetTokens].filter((t) => otherTokens.has(t)).length,
        totalTokens: otherTokens.size,
      });
    }
  }

  return similarities
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, maxSimilar);
}

/**
 * Get collaborative filtering recommendations.
 * @param {string} userId - target user
 * @param {Object} options - { maxRecommendations, minSimilarity }
 * @returns {Object[]} recommended items with scores
 */
export function getRecommendations(userId, options = {}) {
  const { maxRecommendations = 10, minSimilarity = 0.1 } = options;

  const similarUsers = findSimilarUsers(userId, 10);
  const filteredUsers = similarUsers.filter((u) => u.similarity >= minSimilarity);

  if (filteredUsers.length === 0) {
    return {
      urlRecommendations: [],
      queryRecommendations: [],
      similarUsers: [],
      totalRecommendations: 0,
    };
  }

  // Get target user's existing bookmarks/favorites
  const userBookmarks = getUserBookmarks(userId);

  // Aggregate recommendations from similar users
  const recommendationScores = new Map();

  for (const similarUser of filteredUsers) {
    const theirBookmarks = getUserBookmarks(similarUser.userId);

    for (const url of theirBookmarks) {
      if (userBookmarks.has(url)) continue; // Skip already bookmarked

      const existing = recommendationScores.get(url);
      if (existing) {
        existing.score += similarUser.similarity;
        existing.fromUsers.push(similarUser.userId);
      } else {
        recommendationScores.set(url, {
          url,
          score: similarUser.similarity,
          fromUsers: [similarUser.userId],
        });
      }
    }
  }

  // Also look at search queries from similar users
  const history = readJSON(HISTORY_FILE);
  const historyArray = Array.isArray(history) ? history : [];
  const userHistory = new Set(
    historyArray
      .filter((h) => h && h.userId === userId && h.query)
      .map((h) => h.query.toLowerCase())
  );

  const queryRecommendations = new Map();
  for (const similarUser of filteredUsers) {
    const theirQueries = historyArray
      .filter((h) => h && h.userId === similarUser.userId && h.query)
      .map((h) => h.query);

    for (const query of theirQueries) {
      if (userHistory.has(query.toLowerCase())) continue;

      const existing = queryRecommendations.get(query);
      if (existing) {
        existing.score += similarUser.similarity;
        existing.fromUsers.push(similarUser.userId);
      } else {
        queryRecommendations.set(query, {
          query,
          score: similarUser.similarity,
          fromUsers: [similarUser.userId],
        });
      }
    }
  }

  // Combine and sort recommendations
  const urlRecs = [...recommendationScores.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, maxRecommendations)
    .map((rec) => ({
      type: "url",
      url: rec.url,
      score: Math.round(rec.score * 100) / 100,
      fromUsers: [...new Set(rec.fromUsers)],
    }));

  const queryRecs = [...queryRecommendations.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, maxRecommendations)
    .map((rec) => ({
      type: "query",
      query: rec.query,
      score: Math.round(rec.score * 100) / 100,
      fromUsers: [...new Set(rec.fromUsers)],
    }));

  return {
    urlRecommendations: urlRecs,
    queryRecommendations: queryRecs,
    similarUsers: filteredUsers,
    totalRecommendations: urlRecs.length + queryRecs.length,
  };
}

/**
 * Get collaborative filtering statistics.
 */
export function getCollaborativeStats() {
  const history = readJSON(HISTORY_FILE);
  const historyArray = Array.isArray(history) ? history : [];

  const userIds = new Set(historyArray.filter((h) => h && h.userId).map((h) => h.userId));
  const totalUsers = userIds.size;
  const totalSearches = historyArray.filter((h) => h && h.query).length;

  // Calculate average similarity across all user pairs
  const users = [...userIds];
  let totalSimilarity = 0;
  let pairCount = 0;

  for (let i = 0; i < Math.min(users.length, 20); i++) {
    for (let j = i + 1; j < Math.min(users.length, 20); j++) {
      const tokens1 = getUserTokens(users[i]);
      const tokens2 = getUserTokens(users[j]);
      if (tokens1.size > 0 && tokens2.size > 0) {
        totalSimilarity += jaccardSimilarity(tokens1, tokens2);
        pairCount++;
      }
    }
  }

  return {
    totalUsers,
    totalSearches,
    avgSimilarity: pairCount > 0 ? Math.round((totalSimilarity / pairCount) * 100) : 0,
    analyzedPairs: pairCount,
  };
}
