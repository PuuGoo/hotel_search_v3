// Auto-complete dictionary — build and serve suggestions from search history
// Maintains a ranked dictionary of terms, bigrams, and phrases

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DICTIONARY_FILE = path.join(__dirname, "..", "autocomplete_dictionary.json");
const HISTORY_FILE = path.join(__dirname, "..", "search_history.json");
const MAX_TERMS = 5000;
const MIN_WORD_LENGTH = 2;

function readJSON(filePath) {
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch { /* ignore */ }
  return { terms: {}, phrases: {}, rebuiltAt: 0 };
}

function writeJSON(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  } catch { /* ignore */ }
}

function readHistory() {
  try {
    if (fs.existsSync(HISTORY_FILE)) return JSON.parse(fs.readFileSync(HISTORY_FILE, "utf8"));
  } catch { /* ignore */ }
  return [];
}

/**
 * Rebuild the dictionary from search history.
 */
export function rebuildDictionary(options = {}) {
  const { minOccurrences = 2, includePhrases = true, maxPhraseLength = 4 } = options;
  const history = readHistory();

  const termCounts = {};
  const phraseCounts = {};

  for (const entry of history) {
    if (!entry || !entry.query) continue;
    const query = entry.query.toLowerCase().trim();
    const words = query.split(/\s+/).filter((w) => w.length >= MIN_WORD_LENGTH);

    // Count individual terms
    for (const word of words) {
      termCounts[word] = (termCounts[word] || 0) + 1;
    }

    // Count phrases (2 to maxPhraseLength words)
    if (includePhrases) {
      for (let len = 2; len <= Math.min(maxPhraseLength, words.length); len++) {
        for (let i = 0; i <= words.length - len; i++) {
          const phrase = words.slice(i, i + len).join(" ");
          phraseCounts[phrase] = (phraseCounts[phrase] || 0) + 1;
        }
      }
    }
  }

  // Filter by minimum occurrences and sort
  const terms = Object.entries(termCounts)
    .filter(([, count]) => count >= minOccurrences)
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_TERMS)
    .reduce((acc, [term, count]) => {
      acc[term] = { count, type: "term" };
      return acc;
    }, {});

  const phrases = Object.entries(phraseCounts)
    .filter(([, count]) => count >= minOccurrences)
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_TERMS)
    .reduce((acc, [phrase, count]) => {
      acc[phrase] = { count, type: "phrase" };
      return acc;
    }, {});

  const data = { terms, phrases, rebuiltAt: Date.now() };
  writeJSON(DICTIONARY_FILE, data);

  return {
    termCount: Object.keys(terms).length,
    phraseCount: Object.keys(phrases).length,
    rebuiltAt: data.rebuiltAt,
  };
}

/**
 * Get autocomplete suggestions for a prefix.
 */
export function getSuggestions(prefix, options = {}) {
  const { limit = 10, includePhrases = true } = options;
  const normalized = (prefix || "").toLowerCase().trim();

  if (!normalized || normalized.length < 1) return [];

  const data = readJSON(DICTIONARY_FILE);
  const results = [];

  // Match terms
  for (const [term, info] of Object.entries(data.terms || {})) {
    if (term.startsWith(normalized)) {
      results.push({ text: term, count: info.count, type: "term" });
    }
  }

  // Match phrases
  if (includePhrases) {
    for (const [phrase, info] of Object.entries(data.phrases || {})) {
      if (phrase.startsWith(normalized) || phrase.includes(normalized)) {
        results.push({ text: phrase, count: info.count, type: "phrase" });
      }
    }
  }

  return results
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

/**
 * Add a term to the dictionary manually.
 */
export function addTerm(term, count = 1) {
  const data = readJSON(DICTIONARY_FILE);
  if (!data.terms) data.terms = {};

  const normalized = (term || "").toLowerCase().trim();
  if (!normalized) return null;

  if (data.terms[normalized]) {
    data.terms[normalized].count += count;
  } else {
    data.terms[normalized] = { count, type: "term" };
  }

  writeJSON(DICTIONARY_FILE, data);
  return { term: normalized, count: data.terms[normalized].count };
}

/**
 * Remove a term from the dictionary.
 */
export function removeTerm(term) {
  const data = readJSON(DICTIONARY_FILE);
  if (!data.terms) return false;

  const normalized = (term || "").toLowerCase().trim();
  if (!data.terms[normalized]) return false;

  delete data.terms[normalized];
  writeJSON(DICTIONARY_FILE, data);
  return true;
}

/**
 * Get dictionary statistics.
 */
export function getDictionaryStats() {
  const data = readJSON(DICTIONARY_FILE);
  const terms = data.terms || {};
  const phrases = data.phrases || {};

  const topTerms = Object.entries(terms)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 10)
    .map(([term, info]) => ({ term, count: info.count }));

  const topPhrases = Object.entries(phrases)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 10)
    .map(([phrase, info]) => ({ phrase, count: info.count }));

  return {
    totalTerms: Object.keys(terms).length,
    totalPhrases: Object.keys(phrases).length,
    rebuiltAt: data.rebuiltAt || 0,
    topTerms,
    topPhrases,
  };
}

/**
 * Clear the dictionary.
 */
export function clearDictionary() {
  writeJSON(DICTIONARY_FILE, { terms: {}, phrases: {}, rebuiltAt: 0 });
}
