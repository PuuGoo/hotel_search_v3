// User search profile — personalized search experience based on behavior
// Builds a profile from search history to customize the experience

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const HISTORY_FILE = path.join(__dirname, "..", "search_history.json");
const PROFILES_FILE = path.join(__dirname, "..", "user_profiles.json");

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
 * Analyze user behavior and build a search profile.
 */
export function buildUserProfile(userId) {
  const history = readJSON(HISTORY_FILE);
  const historyArray = Array.isArray(history) ? history : [];
  const userHistory = historyArray
    .filter((h) => h && h.userId === userId && h.query && h.timestamp)
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  if (userHistory.length === 0) {
    return {
      userId,
      built: false,
      preferences: {},
      patterns: {},
      recommendations: [],
    };
  }

  // 1. Analyze preferred engines
  const engineCounts = {};
  for (const entry of userHistory) {
    if (entry.engine) {
      engineCounts[entry.engine] = (engineCounts[entry.engine] || 0) + 1;
    }
  }
  const preferredEngine = Object.entries(engineCounts)
    .sort((a, b) => b[1] - a[1])[0]?.[0] || null;

  // 2. Analyze preferred time slots
  const hourCounts = {};
  for (const entry of userHistory) {
    const hour = new Date(entry.timestamp).getHours();
    hourCounts[hour] = (hourCounts[hour] || 0) + 1;
  }
  const peakHours = Object.entries(hourCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([hour]) => parseInt(hour));

  // 3. Analyze query topics (extract common keywords)
  const wordCounts = {};
  const stopWords = new Set(["hotel", "hotels", "in", "the", "a", "an", "and", "or", "for", "with", "near", "to", "at"]);
  for (const entry of userHistory) {
    const words = entry.query.toLowerCase().split(/\s+/);
    for (const word of words) {
      if (word.length > 2 && !stopWords.has(word)) {
        wordCounts[word] = (wordCounts[word] || 0) + 1;
      }
    }
  }
  const topTopics = Object.entries(wordCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([word, count]) => ({ word, count }));

  // 4. Analyze price sensitivity
  const priceQueries = userHistory.filter((h) =>
    h.query.toLowerCase().match(/cheap|budget|affordable|luxury|premium|expensive/)
  );
  const priceSensitive = priceQueries.some((h) =>
    h.query.toLowerCase().match(/cheap|budget|affordable/)
  );
  const luxuryPreference = priceQueries.some((h) =>
    h.query.toLowerCase().match(/luxury|premium|expensive/)
  );

  // 5. Analyze location preferences
  const locationCounts = {};
  const locationWords = ["paris", "london", "tokyo", "new york", "rome", "barcelona", "dubai", "sydney", "bali", "maldives"];
  for (const entry of userHistory) {
    const lower = entry.query.toLowerCase();
    for (const location of locationWords) {
      if (lower.includes(location)) {
        locationCounts[location] = (locationCounts[location] || 0) + 1;
      }
    }
  }
  const preferredLocations = Object.entries(locationCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([location, count]) => ({ location, count }));

  // 6. Analyze search frequency
  const days = new Set(userHistory.map((h) => new Date(h.timestamp).toDateString())).size;
  const avgSearchesPerDay = Math.round(userHistory.length / Math.max(1, days) * 10) / 10;

  // 7. Analyze result interaction (if available)
  const withResults = userHistory.filter((h) => h.resultCount !== undefined);
  const avgResults = withResults.length > 0
    ? Math.round(withResults.reduce((sum, h) => sum + (h.resultCount || 0), 0) / withResults.length)
    : 0;

  const profile = {
    userId,
    built: true,
    totalSearches: userHistory.length,
    activeDays: days,
    avgSearchesPerDay,
    preferences: {
      engine: preferredEngine,
      priceSensitive,
      luxuryPreference,
      peakHours,
      preferredLocations,
    },
    patterns: {
      topTopics,
      engineDistribution: engineCounts,
      hourlyDistribution: hourCounts,
    },
    recommendations: generateRecommendations(preferredEngine, topTopics, preferredLocations, priceSensitive, luxuryPreference),
    lastUpdated: new Date().toISOString(),
  };

  // Save profile
  const allProfiles = readJSON(PROFILES_FILE);
  allProfiles[userId] = profile;
  writeJSON(PROFILES_FILE, allProfiles);

  return profile;
}

/**
 * Generate personalized recommendations based on profile.
 */
function generateRecommendations(preferredEngine, topTopics, preferredLocations, priceSensitive, luxuryPreference) {
  const recommendations = [];

  // Engine recommendation
  if (preferredEngine) {
    recommendations.push({
      type: "engine",
      message: `Based on your history, ${preferredEngine} tends to work best for your searches`,
      value: preferredEngine,
    });
  }

  // Topic-based recommendations
  if (topTopics.length > 0) {
    const topics = topTopics.slice(0, 3).map((t) => t.word).join(", ");
    recommendations.push({
      type: "topics",
      message: `You often search for: ${topics}`,
      value: topTopics.slice(0, 3),
    });
  }

  // Location recommendations
  if (preferredLocations.length > 0) {
    const locations = preferredLocations.slice(0, 3).map((l) => l.location).join(", ");
    recommendations.push({
      type: "locations",
      message: `Your favorite destinations: ${locations}`,
      value: preferredLocations.slice(0, 3),
    });
  }

  // Price recommendations
  if (priceSensitive) {
    recommendations.push({
      type: "price",
      message: "You seem price-conscious. Try using 'cheap' or 'budget' filters",
      value: "budget",
    });
  } else if (luxuryPreference) {
    recommendations.push({
      type: "price",
      message: "You prefer luxury. Try using 'luxury' or 'premium' filters",
      value: "luxury",
    });
  }

  return recommendations;
}

/**
 * Get cached user profile (faster than rebuilding).
 */
export function getUserProfile(userId) {
  const allProfiles = readJSON(PROFILES_FILE);
  const profile = allProfiles[userId];

  if (!profile) {
    return buildUserProfile(userId);
  }

  // Check if profile is stale (older than 1 day)
  const lastUpdated = new Date(profile.lastUpdated);
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  if (lastUpdated < oneDayAgo) {
    return buildUserProfile(userId);
  }

  return profile;
}

/**
 * Get profile comparison between two users.
 */
export function compareProfiles(userId1, userId2) {
  const profile1 = getUserProfile(userId1);
  const profile2 = getUserProfile(userId2);

  if (!profile1.built || !profile2.built) {
    return null;
  }

  // Find common topics
  const topics1 = new Set(profile1.patterns.topTopics.map((t) => t.word));
  const topics2 = new Set(profile2.patterns.topTopics.map((t) => t.word));
  const commonTopics = [...topics1].filter((t) => topics2.has(t));

  // Find common locations
  const locations1 = new Set(profile1.preferences.preferredLocations.map((l) => l.location));
  const locations2 = new Set(profile2.preferences.preferredLocations.map((l) => l.location));
  const commonLocations = [...locations1].filter((l) => locations2.has(l));

  // Calculate similarity score
  const topicSimilarity = commonTopics.length / Math.max(1, Math.max(topics1.size, topics2.size));
  const locationSimilarity = commonLocations.length / Math.max(1, Math.max(locations1.size, locations2.size));
  const engineSimilarity = profile1.preferences.engine === profile2.preferences.engine ? 1 : 0;
  const priceSimilarity = profile1.preferences.priceSensitive === profile2.preferences.priceSensitive ? 1 : 0;

  const similarity = Math.round(
    (topicSimilarity * 0.3 + locationSimilarity * 0.3 + engineSimilarity * 0.2 + priceSimilarity * 0.2) * 100
  );

  return {
    user1: { id: userId1, totalSearches: profile1.totalSearches },
    user2: { id: userId2, totalSearches: profile2.totalSearches },
    similarity,
    commonTopics,
    commonLocations,
    details: {
      topicSimilarity: Math.round(topicSimilarity * 100),
      locationSimilarity: Math.round(locationSimilarity * 100),
      engineSimilarity: Math.round(engineSimilarity * 100),
      priceSimilarity: Math.round(priceSimilarity * 100),
    },
  };
}

/**
 * Get profile statistics (admin).
 */
export function getProfileStats() {
  const allProfiles = readJSON(PROFILES_FILE);
  const profiles = Object.values(allProfiles);

  if (profiles.length === 0) {
    return {
      totalProfiles: 0,
      avgSearchesPerUser: 0,
      topEngines: {},
      topTopics: [],
    };
  }

  const engineCounts = {};
  const topicCounts = {};

  for (const profile of profiles) {
    if (profile.preferences?.engine) {
      engineCounts[profile.preferences.engine] = (engineCounts[profile.preferences.engine] || 0) + 1;
    }
    for (const topic of (profile.patterns?.topTopics || [])) {
      topicCounts[topic.word] = (topicCounts[topic.word] || 0) + topic.count;
    }
  }

  const topTopics = Object.entries(topicCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([word, count]) => ({ word, count }));

  return {
    totalProfiles: profiles.length,
    avgSearchesPerUser: Math.round(profiles.reduce((sum, p) => sum + (p.totalSearches || 0), 0) / profiles.length),
    topEngines: engineCounts,
    topTopics,
  };
}
