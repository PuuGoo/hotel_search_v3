// Search result personalization — weight results based on user preferences and history
// Learns from user behavior to rank results more relevantly

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PREFERENCES_FILE = path.join(__dirname, "..", "user_preferences.json");
const HISTORY_FILE = path.join(__dirname, "..", "search_history.json");
const BOOKMARKS_FILE = path.join(__dirname, "..", "bookmarks.json");
const CLICKS_FILE = path.join(__dirname, "..", "ranking_feedback.json");

function readJSON(filePath) {
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch { /* ignore */ }
  return {};
}

/**
 * Build a user preference profile from history, bookmarks, and clicks.
 */
export function buildUserPreferences(userId) {
  const history = Array.isArray(readJSON(HISTORY_FILE)) ? readJSON(HISTORY_FILE) : [];
  const bookmarksData = readJSON(BOOKMARKS_FILE);
  const bookmarks = bookmarksData[userId] || [];
  const clicksData = readJSON(CLICKS_FILE);
  const clicks = (clicksData.clicks || []).filter((c) => c && c.userId === userId);

  // Extract preferred engines from history
  const engineCounts = {};
  for (const h of history) {
    if (h && h.userId === userId && h.engine) {
      engineCounts[h.engine] = (engineCounts[h.engine] || 0) + 1;
    }
  }

  // Extract preferred domains from bookmarks and clicks
  const domainCounts = {};
  for (const b of bookmarks) {
    try {
      const domain = new URL(b.url).hostname.replace("www.", "");
      domainCounts[domain] = (domainCounts[domain] || 0) + 1;
    } catch { /* ignore */ }
  }
  for (const c of clicks) {
    if (c.url) {
      try {
        const domain = new URL(c.url).hostname.replace("www.", "");
        domainCounts[domain] = (domainCounts[domain] || 0) + 1;
      } catch { /* ignore */ }
    }
  }

  // Extract preferred topics/keywords from queries
  const keywordCounts = {};
  for (const h of history) {
    if (h && h.userId === userId && h.query) {
      const words = h.query.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
      for (const word of words) {
        keywordCounts[word] = (keywordCounts[word] || 0) + 1;
      }
    }
  }

  // Sort and limit
  const preferredEngines = Object.entries(engineCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([engine, count]) => ({ engine, count }));

  const preferredDomains = Object.entries(domainCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([domain, count]) => ({ domain, count }));

  const preferredKeywords = Object.entries(keywordCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([keyword, count]) => ({ keyword, count }));

  return {
    userId,
    preferredEngines,
    preferredDomains,
    preferredKeywords,
    totalSearches: history.filter((h) => h && h.userId === userId).length,
    totalBookmarks: bookmarks.length,
    totalClicks: clicks.length,
    builtAt: Date.now(),
  };
}

/**
 * Score a single result based on user preferences.
 */
export function scoreResult(result, preferences, options = {}) {
  const { engineWeight = 0.1, domainWeight = 0.3, keywordWeight = 0.2, recencyWeight = 0.1 } = options;

  let score = result.score || result.relevance || 1.0;
  const url = result.url || result.link || "";
  const title = (result.title || "").toLowerCase();
  const snippet = (result.snippet || result.description || "").toLowerCase();
  const text = `${title} ${snippet}`;

  // Domain boost
  try {
    const domain = new URL(url).hostname.replace("www.", "");
    const domainPref = preferences.preferredDomains.find((d) => d.domain === domain);
    if (domainPref) {
      const maxCount = preferences.preferredDomains[0]?.count || 1;
      score += (domainPref.count / maxCount) * domainWeight;
    }
  } catch { /* ignore */ }

  // Keyword boost
  let keywordHits = 0;
  for (const kw of preferences.preferredKeywords) {
    if (text.includes(kw.keyword)) {
      keywordHits++;
    }
  }
  if (preferences.preferredKeywords.length > 0) {
    score += (keywordHits / Math.min(preferences.preferredKeywords.length, 10)) * keywordWeight;
  }

  // Engine preference boost
  const engine = result.engine || "";
  const enginePref = preferences.preferredEngines.find((e) => e.engine === engine);
  if (enginePref) {
    const maxCount = preferences.preferredEngines[0]?.count || 1;
    score += (enginePref.count / maxCount) * engineWeight;
  }

  return {
    ...result,
    personalizedScore: Math.round(score * 100) / 100,
    originalScore: result.score || result.relevance || 1.0,
  };
}

/**
 * Personalize a list of results for a user.
 */
export function personalizeResults(userId, results, options = {}) {
  const prefs = buildUserPreferences(userId);

  if (prefs.totalSearches === 0 && prefs.totalBookmarks === 0) {
    return results.map((r) => ({ ...r, personalizedScore: r.score || r.relevance || 1.0, originalScore: r.score || r.relevance || 1.0 }));
  }

  return results
    .map((r) => scoreResult(r, prefs, options))
    .sort((a, b) => b.personalizedScore - a.personalizedScore);
}

/**
 * Get personalization stats for a user.
 */
export function getPersonalizationStats(userId) {
  const prefs = buildUserPreferences(userId);
  return {
    hasPreferences: prefs.totalSearches > 0 || prefs.totalBookmarks > 0,
    totalSearches: prefs.totalSearches,
    totalBookmarks: prefs.totalBookmarks,
    totalClicks: prefs.totalClicks,
    topEngine: prefs.preferredEngines[0]?.engine || null,
    topDomains: prefs.preferredDomains.slice(0, 3).map((d) => d.domain),
    topKeywords: prefs.preferredKeywords.slice(0, 5).map((k) => k.keyword),
  };
}
