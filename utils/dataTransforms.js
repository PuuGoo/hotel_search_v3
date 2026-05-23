// Data transformation utilities — transform data between formats

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_FILE = path.join(__dirname, "..", "data_transforms.json");
const MAX_TEMPLATES = 50;
const MAX_HISTORY = 500;

function readJSON(filePath) {
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch { /* ignore */ }
  return { templates: [], history: [] };
}

function writeJSON(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  } catch { /* ignore */ }
}

/**
 * Convert JSON array to CSV string.
 */
export function jsonToCSV(data, options = {}) {
  if (!Array.isArray(data) || data.length === 0) {
    return { error: "Data must be a non-empty array" };
  }

  const delimiter = options.delimiter || ",";
  const headers = options.headers || Object.keys(data[0]);
  const rows = [headers.join(delimiter)];

  for (const item of data) {
    const row = headers.map((h) => {
      const val = item[h];
      if (val === null || val === undefined) return "";
      const str = String(val);
      return str.includes(delimiter) || str.includes('"') || str.includes("\n")
        ? `"${str.replace(/"/g, '""')}"`
        : str;
    });
    rows.push(row.join(delimiter));
  }

  return { result: rows.join("\n"), rowCount: data.length, headers };
}

/**
 * Parse CSV string to JSON array.
 */
export function csvToJSON(csv, options = {}) {
  if (typeof csv !== "string" || csv.trim() === "") {
    return { error: "CSV must be a non-empty string" };
  }

  const delimiter = options.delimiter || ",";
  const lines = csv.split("\n").filter((l) => l.trim() !== "");
  if (lines.length < 2) {
    return { error: "CSV must have at least a header and one data row" };
  }

  const headers = lines[0].split(delimiter).map((h) => h.trim().replace(/^"|"$/g, ""));
  const result = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i], delimiter);
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = values[idx] || "";
    });
    result.push(obj);
  }

  return { result, rowCount: result.length, headers };
}

function parseCSVLine(line, delimiter) {
  const values = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        current += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === delimiter) {
        values.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
  }
  values.push(current.trim());
  return values;
}

/**
 * Apply field mapping to data.
 */
export function mapFields(data, mapping) {
  if (!Array.isArray(data)) {
    return { error: "Data must be an array" };
  }
  if (!mapping || typeof mapping !== "object") {
    return { error: "Mapping must be an object" };
  }

  const result = data.map((item) => {
    const mapped = {};
    for (const [target, source] of Object.entries(mapping)) {
      mapped[target] = typeof source === "function" ? source(item) : item[source];
    }
    return mapped;
  });

  return { result, rowCount: result.length };
}

/**
 * Filter data by conditions.
 */
export function filterData(data, conditions) {
  if (!Array.isArray(data)) {
    return { error: "Data must be an array" };
  }

  let result = [...data];

  for (const [field, condition] of Object.entries(conditions)) {
    if (typeof condition === "object") {
      if (condition.eq !== undefined) result = result.filter((item) => item[field] === condition.eq);
      if (condition.ne !== undefined) result = result.filter((item) => item[field] !== condition.ne);
      if (condition.gt !== undefined) result = result.filter((item) => item[field] > condition.gt);
      if (condition.gte !== undefined) result = result.filter((item) => item[field] >= condition.gte);
      if (condition.lt !== undefined) result = result.filter((item) => item[field] < condition.lt);
      if (condition.lte !== undefined) result = result.filter((item) => item[field] <= condition.lte);
      if (condition.contains !== undefined) result = result.filter((item) => String(item[field]).includes(condition.contains));
      if (condition.in !== undefined) result = result.filter((item) => condition.in.includes(item[field]));
    } else {
      result = result.filter((item) => item[field] === condition);
    }
  }

  return { result, rowCount: result.length };
}

/**
 * Aggregate data (group by + sum/count/avg/min/max).
 */
export function aggregateData(data, options = {}) {
  if (!Array.isArray(data)) {
    return { error: "Data must be an array" };
  }

  const { groupBy, aggregations } = options;
  if (!groupBy || !aggregations) {
    return { error: "groupBy and aggregations are required" };
  }

  const groups = {};
  for (const item of data) {
    const key = item[groupBy];
    if (!groups[key]) groups[key] = [];
    groups[key].push(item);
  }

  const result = Object.entries(groups).map(([key, items]) => {
    const row = { [groupBy]: key };
    for (const [field, op] of Object.entries(aggregations)) {
      const values = items.map((i) => Number(i[field])).filter((v) => !isNaN(v));
      switch (op) {
        case "sum": row[`${field}_sum`] = values.reduce((a, b) => a + b, 0); break;
        case "avg": row[`${field}_avg`] = values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0; break;
        case "min": row[`${field}_min`] = values.length > 0 ? Math.min(...values) : null; break;
        case "max": row[`${field}_max`] = values.length > 0 ? Math.max(...values) : null; break;
        case "count": row[`${field}_count`] = values.length; break;
      }
    }
    return row;
  });

  return { result, groupCount: result.length };
}

/**
 * Sort data by field(s).
 */
export function sortData(data, sortBy) {
  if (!Array.isArray(data)) {
    return { error: "Data must be an array" };
  }

  const sortFields = Array.isArray(sortBy) ? sortBy : [sortBy];
  const result = [...data].sort((a, b) => {
    for (const field of sortFields) {
      const key = typeof field === "object" ? field.field : field;
      const order = typeof field === "object" ? (field.order || "asc") : "asc";
      const aVal = a[key];
      const bVal = b[key];
      if (aVal < bVal) return order === "asc" ? -1 : 1;
      if (aVal > bVal) return order === "asc" ? 1 : -1;
    }
    return 0;
  });

  return { result, rowCount: result.length };
}

/**
 * Save a transformation template.
 */
export function saveTemplate(options = {}) {
  const data = readJSON(DATA_FILE);
  if (!data.templates) data.templates = [];
  if (data.templates.length >= MAX_TEMPLATES) {
    return { error: "Max templates reached" };
  }

  const template = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name: options.name || "Unnamed Template",
    description: options.description || "",
    operations: options.operations || [],
    createdBy: options.userId || "system",
    createdAt: Date.now(),
  };

  data.templates.unshift(template);
  writeJSON(DATA_FILE, data);
  return template;
}

/**
 * Get all templates.
 */
export function getTemplates() {
  const data = readJSON(DATA_FILE);
  return data.templates || [];
}

/**
 * Delete a template.
 */
export function deleteTemplate(templateId) {
  const data = readJSON(DATA_FILE);
  const index = (data.templates || []).findIndex((t) => t.id === templateId);
  if (index === -1) return false;

  data.templates.splice(index, 1);
  writeJSON(DATA_FILE, data);
  return true;
}

/**
 * Record a transform operation in history.
 */
export function recordTransform(options = {}) {
  const data = readJSON(DATA_FILE);
  if (!data.history) data.history = [];

  const entry = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    operation: options.operation,
    inputRows: options.inputRows || 0,
    outputRows: options.outputRows || 0,
    duration: options.duration || 0,
    timestamp: Date.now(),
  };

  data.history.unshift(entry);
  if (data.history.length > MAX_HISTORY) data.history.length = MAX_HISTORY;

  writeJSON(DATA_FILE, data);
  return entry;
}

/**
 * Get transform history.
 */
export function getTransformHistory(limit = 50) {
  const data = readJSON(DATA_FILE);
  return { history: (data.history || []).slice(0, limit), total: (data.history || []).length };
}

/**
 * Get transform stats.
 */
export function getTransformStats() {
  const data = readJSON(DATA_FILE);
  const history = data.history || [];
  const templates = data.templates || [];

  const operationCounts = {};
  for (const entry of history) {
    operationCounts[entry.operation] = (operationCounts[entry.operation] || 0) + 1;
  }

  return {
    totalTransforms: history.length,
    totalTemplates: templates.length,
    operationCounts,
    totalInputRows: history.reduce((sum, e) => sum + (e.inputRows || 0), 0),
    totalOutputRows: history.reduce((sum, e) => sum + (e.outputRows || 0), 0),
  };
}

/**
 * Clear all transform data.
 */
export function clearTransformData() {
  writeJSON(DATA_FILE, { templates: [], history: [] });
}
