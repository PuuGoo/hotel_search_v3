// Query expansion — automatically expand abbreviations, synonyms, and related terms
// Enhances search queries for better results

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CUSTOM_RULES_FILE = path.join(__dirname, "..", "query_expansion_rules.json");

function readJSON(filePath) {
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch { /* ignore */ }
  return [];
}

function writeJSON(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  } catch { /* ignore */ }
}

/**
 * Built-in expansion rules for hotel search domain.
 */
const BUILTIN_EXPANSIONS = {
  // City abbreviations
  abbreviations: {
    "nyc": "new york city",
    "la": "los angeles",
    "sf": "san francisco",
    "dc": "washington dc",
    "uk": "united kingdom",
    "us": "united states",
    "usa": "united states",
    "eu": "europe",
    "uae": "united arab emirates",
    "hk": "hong kong",
    "sg": "singapore",
    "kl": "kuala lumpur",
    "bkk": "bangkok",
    "jkt": "jakarta",
    "rio": "rio de janeiro",
    "buenos aires": "buenos aires argentina",
    "saigon": "ho chi minh city",
  },

  // Hotel-related synonyms
  synonyms: {
    "hotel": ["hotels", "accommodation", "lodging", "stay"],
    "resort": ["resorts", "spa resort", "beach resort"],
    "motel": ["motels", "motor inn"],
    "hostel": ["hostels", "backpackers", "dormitory"],
    "inn": ["inns", "guesthouse", "guest house"],
    "lodge": ["lodges", "cabin", "cottage"],
    "apartment": ["apartments", "apartment hotel", "serviced apartment"],
    "villa": ["villas", "holiday home", "vacation rental"],
    "bnb": ["bed and breakfast", "b&b", "bed & breakfast"],
    "cheap": ["budget", "affordable", "economical", "low cost", "value"],
    "luxury": ["luxurious", "premium", "high-end", "upscale", "5-star", "five star"],
    "boutique": ["boutique hotel", "design hotel", "unique hotel"],
    "business": ["business hotel", "corporate", "work trip"],
    "family": ["family-friendly", "kid-friendly", "child-friendly"],
    "romantic": ["couples", "honeymoon", "romantic getaway"],
    "beach": ["beachfront", "oceanfront", "seaside", "coastal"],
    "pool": ["swimming pool", "pool access", "pool view"],
    "spa": ["spa hotel", "wellness", "massage"],
    "gym": ["fitness center", "fitness", "workout"],
    "parking": ["free parking", "valet parking", "car park"],
    "wifi": ["wireless internet", "free wifi", "internet access"],
    "breakfast": ["free breakfast", "breakfast included", "continental breakfast"],
    "restaurant": ["on-site restaurant", "dining"],
    "pet": ["pet-friendly", "pet friendly", "pets allowed", "dog friendly"],
    "view": ["scenic view", "panoramic view", "mountain view", "city view", "sea view", "ocean view"],
    "downtown": ["city center", "central", "heart of city", "midtown"],
    "airport": ["near airport", "airport shuttle", "airport transfer"],
    "station": ["near station", "near train station", "railway station"],
    "all-inclusive": ["all inclusive", "full board", "full service"],
  },

  // Common misspellings
  misspellings: {
    "hotle": "hotel",
    "hotell": "hotel",
    "hoetl": "hotel",
    "reosrt": "resort",
    "resrot": "resort",
    "appartment": "apartment",
    "apartement": "apartment",
    "accomodation": "accommodation",
    "acommodation": "accommodation",
    "luxuary": "luxury",
    "luxery": "luxury",
    "resturant": "restaurant",
    "restraunt": "restaurant",
    "beackfast": "breakfast",
    "brekfast": "breakfast",
    "swiming": "swimming",
    "fitnes": "fitness",
    "parcking": "parking",
    "pakring": "parking",
  },

  // Amenity expansions
  amenities: {
    "wifi": ["free wifi", "wireless internet", "high speed internet"],
    "pool": ["swimming pool", "outdoor pool", "indoor pool", "infinity pool"],
    "spa": ["spa services", "wellness center", "massage therapy"],
    "gym": ["fitness center", "gym facilities", "exercise room"],
    "parking": ["free parking", "valet parking", "covered parking"],
    "breakfast": ["free breakfast", "buffet breakfast", "continental breakfast"],
    "ac": ["air conditioning", "climate control", "air conditioned"],
    "tv": ["television", "flat screen tv", "cable tv", "smart tv"],
    "minibar": ["mini bar", "mini-bar", "in-room bar"],
    "safe": ["in-room safe", "safety deposit box", "security safe"],
    "balcony": ["private balcony", "terrace", "patio"],
    "kitchen": ["kitchenette", "full kitchen", "cooking facilities"],
    "laundry": ["laundry service", "washer dryer", "dry cleaning"],
    "elevator": ["lift", "elevator access"],
    "bar": ["lounge bar", "cocktail bar", "hotel bar"],
    "room service": ["24 hour room service", "in-room dining"],
  },
};

/**
 * Get custom expansion rules from file.
 */
function getCustomRules() {
  const rules = readJSON(CUSTOM_RULES_FILE);
  return Array.isArray(rules) ? rules : [];
}

/**
 * Expand a query with abbreviations, synonyms, and corrections.
 * @param {string} query - original search query
 * @param {Object} options - { expandAbbreviations, expandSynonyms, fixMisspellings, expandAmenities, maxExpansions }
 * @returns {Object} { original, expanded, expansions, corrections }
 */
export function expandQueryTerms(query, options = {}) {
  const {
    expandAbbreviations = true,
    expandSynonyms = true,
    fixMisspellings = true,
    expandAmenities = false,
    maxExpansions = 3,
    useCustomRules = true,
  } = options;

  if (!query || typeof query !== "string") {
    return { original: query, expanded: query, expansions: [], corrections: [], changed: false };
  }

  let expanded = query.toLowerCase().trim();
  const expansions = [];
  const corrections = [];

  // 1. Fix misspellings first
  if (fixMisspellings) {
    for (const [wrong, correct] of Object.entries(BUILTIN_EXPANSIONS.misspellings)) {
      const regex = new RegExp(`\\b${wrong}\\b`, "gi");
      if (regex.test(expanded)) {
        expanded = expanded.replace(regex, correct);
        corrections.push({ original: wrong, corrected: correct, type: "misspelling" });
      }
    }
  }

  // 2. Expand abbreviations
  if (expandAbbreviations) {
    for (const [abbrev, full] of Object.entries(BUILTIN_EXPANSIONS.abbreviations)) {
      const regex = new RegExp(`\\b${abbrev}\\b`, "gi");
      if (regex.test(expanded)) {
        expanded = expanded.replace(regex, full);
        expansions.push({ term: abbrev, expanded: full, type: "abbreviation" });
      }
    }
  }

  // 3. Expand synonyms (only for key terms, limited by maxExpansions)
  if (expandSynonyms) {
    const words = expanded.split(/\s+/);
    let synonymCount = 0;

    for (const word of words) {
      if (synonymCount >= maxExpansions) break;

      for (const [term, synonyms] of Object.entries(BUILTIN_EXPANSIONS.synonyms)) {
        if (word === term || synonyms.includes(word)) {
          // Add the most relevant synonym
          const synonym = synonyms.find((s) => !expanded.includes(s)) || term;
          if (synonym && !expanded.includes(synonym)) {
            expanded = `${expanded} ${synonym}`;
            expansions.push({ term: word, expanded: synonym, type: "synonym" });
            synonymCount++;
            break;
          }
        }
      }
    }
  }

  // 4. Expand amenities
  if (expandAmenities) {
    for (const [amenity, expansions_list] of Object.entries(BUILTIN_EXPANSIONS.amenities)) {
      const regex = new RegExp(`\\b${amenity}\\b`, "gi");
      if (regex.test(expanded)) {
        const fullExpansion = expansions_list[0]; // Use first (most common) expansion
        if (!expanded.includes(fullExpansion)) {
          expanded = expanded.replace(regex, fullExpansion);
          expansions.push({ term: amenity, expanded: fullExpansion, type: "amenity" });
        }
      }
    }
  }

  // 5. Apply custom rules
  if (useCustomRules) {
    const customRules = getCustomRules();
    for (const rule of customRules) {
      if (rule.pattern && rule.replacement) {
        try {
          const regex = new RegExp(rule.pattern, rule.flags || "gi");
          if (regex.test(expanded)) {
            expanded = expanded.replace(regex, rule.replacement);
            expansions.push({
              term: rule.pattern,
              expanded: rule.replacement,
              type: rule.type || "custom",
            });
          }
        } catch { /* skip invalid regex */ }
      }
    }
  }

  // Clean up extra spaces
  expanded = expanded.replace(/\s+/g, " ").trim();

  return {
    original: query,
    expanded,
    expansions,
    corrections,
    changed: expanded !== query.toLowerCase(),
  };
}

/**
 * Generate alternative queries for broader search.
 * @param {string} query - original query
 * @param {number} maxAlternatives - max alternatives to generate
 * @returns {string[]} alternative queries
 */
export function generateAlternatives(query, maxAlternatives = 5) {
  if (!query) return [];

  const alternatives = new Set();
  const lower = query.toLowerCase().trim();
  const words = lower.split(/\s+/);

  // 1. Add expanded version
  const expanded = expandQueryTerms(lower);
  if (expanded.changed) alternatives.add(expanded.expanded);

  // 2. Add synonym variations
  for (const word of words) {
    for (const [term, synonyms] of Object.entries(BUILTIN_EXPANSIONS.synonyms)) {
      if (word === term) {
        for (const synonym of synonyms.slice(0, 2)) {
          const alt = lower.replace(word, synonym);
          alternatives.add(alt);
        }
      } else if (synonyms.includes(word)) {
        alternatives.add(lower.replace(word, term));
      }
    }
  }

  // 3. Remove adjectives for broader match
  const adjectives = ["best", "top", "cheap", "budget", "luxury", "nice", "good", "great", "amazing", "wonderful"];
  for (const adj of adjectives) {
    if (lower.includes(adj)) {
      alternatives.add(lower.replace(new RegExp(`\\b${adj}\\b`, "gi"), "").replace(/\s+/g, " ").trim());
    }
  }

  // Remove duplicates and the original
  alternatives.delete(lower);
  alternatives.delete("");

  return [...alternatives].slice(0, maxAlternatives);
}

/**
 * Add custom expansion rule.
 */
export function addCustomRule(rule) {
  if (!rule.pattern || !rule.replacement) {
    throw new Error("pattern and replacement are required");
  }

  const rules = getCustomRules();
  rules.push({
    pattern: rule.pattern,
    replacement: rule.replacement,
    type: rule.type || "custom",
    flags: rule.flags || "gi",
    addedAt: new Date().toISOString(),
  });

  writeJSON(CUSTOM_RULES_FILE, rules);
  return rule;
}

/**
 * Get all custom rules.
 */
export function getCustomRulesList() {
  return getCustomRules();
}

/**
 * Delete custom rule by index.
 */
export function deleteCustomRule(index) {
  const rules = getCustomRules();
  if (index < 0 || index >= rules.length) return false;

  rules.splice(index, 1);
  writeJSON(CUSTOM_RULES_FILE, rules);
  return true;
}

/**
 * Get expansion statistics.
 */
export function getExpansionStats() {
  return {
    builtinAbbreviations: Object.keys(BUILTIN_EXPANSIONS.abbreviations).length,
    builtinSynonyms: Object.keys(BUILTIN_EXPANSIONS.synonyms).length,
    builtinMisspellings: Object.keys(BUILTIN_EXPANSIONS.misspellings).length,
    builtinAmenities: Object.keys(BUILTIN_EXPANSIONS.amenities).length,
    customRules: getCustomRules().length,
  };
}
