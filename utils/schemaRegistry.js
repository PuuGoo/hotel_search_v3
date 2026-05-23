// Request/response schema registry — centralized schema management

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_FILE = path.join(__dirname, "..", "schema_registry.json");
const MAX_SCHEMAS = 300;

function readJSON(filePath) {
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch { /* ignore */ }
  return { schemas: [] };
}

function writeJSON(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  } catch { /* ignore */ }
}

/**
 * Register a schema.
 */
export function registerSchema(options = {}) {
  const data = readJSON(DATA_FILE);
  if (!data.schemas) data.schemas = [];

  const schema = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name: options.name,
    version: options.version || "1.0.0",
    type: options.type, // "request", "response", "both"
    endpoint: options.endpoint || null,
    method: options.method || null,
    schema: options.schema, // JSON schema object
    description: options.description || "",
    author: options.userId || "system",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  data.schemas.unshift(schema);
  if (data.schemas.length > MAX_SCHEMAS) data.schemas.length = MAX_SCHEMAS;

  writeJSON(DATA_FILE, data);
  return schema;
}

/**
 * Get all schemas.
 */
export function getSchemas(options = {}) {
  const { type = null, endpoint = null, limit = 50 } = options;
  const data = readJSON(DATA_FILE);
  let schemas = data.schemas || [];

  if (type) schemas = schemas.filter((s) => s.type === type || s.type === "both");
  if (endpoint) schemas = schemas.filter((s) => s.endpoint === endpoint);

  return { schemas: schemas.slice(0, limit), total: schemas.length };
}

/**
 * Get a specific schema.
 */
export function getSchema(schemaId) {
  const data = readJSON(DATA_FILE);
  return (data.schemas || []).find((s) => s.id === schemaId) || null;
}

/**
 * Get schemas by name (latest version first).
 */
export function getSchemasByName(name) {
  const data = readJSON(DATA_FILE);
  return (data.schemas || [])
    .filter((s) => s.name === name)
    .sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Update a schema.
 */
export function updateSchema(schemaId, updates) {
  const data = readJSON(DATA_FILE);
  const index = (data.schemas || []).findIndex((s) => s.id === schemaId);
  if (index === -1) return null;

  data.schemas[index] = {
    ...data.schemas[index],
    ...updates,
    id: schemaId,
    updatedAt: Date.now(),
  };
  writeJSON(DATA_FILE, data);
  return data.schemas[index];
}

/**
 * Delete a schema.
 */
export function deleteSchema(schemaId) {
  const data = readJSON(DATA_FILE);
  const index = (data.schemas || []).findIndex((s) => s.id === schemaId);
  if (index === -1) return false;

  data.schemas.splice(index, 1);
  writeJSON(DATA_FILE, data);
  return true;
}

/**
 * Validate data against a schema.
 */
export function validateAgainstSchema(schemaId, dataToValidate) {
  const data = readJSON(DATA_FILE);
  const schema = (data.schemas || []).find((s) => s.id === schemaId);
  if (!schema) return { valid: false, error: "Schema not found" };

  const violations = [];
  const schemaObj = schema.schema;

  if (schemaObj && schemaObj.properties) {
    for (const [field, rules] of Object.entries(schemaObj.properties)) {
      const value = dataToValidate[field];

      if (rules.required && (value === undefined || value === null)) {
        violations.push({ field, issue: "missing required field" });
        continue;
      }

      if (value !== undefined && value !== null) {
        if (rules.type === "string" && typeof value !== "string") {
          violations.push({ field, issue: `expected string, got ${typeof value}` });
        }
        if (rules.type === "number" && typeof value !== "number") {
          violations.push({ field, issue: `expected number, got ${typeof value}` });
        }
        if (rules.type === "boolean" && typeof value !== "boolean") {
          violations.push({ field, issue: `expected boolean, got ${typeof value}` });
        }
        if (rules.type === "array" && !Array.isArray(value)) {
          violations.push({ field, issue: "expected array" });
        }
        if (rules.type === "object" && (typeof value !== "object" || Array.isArray(value))) {
          violations.push({ field, issue: "expected object" });
        }
        if (rules.minLength && typeof value === "string" && value.length < rules.minLength) {
          violations.push({ field, issue: `minimum length is ${rules.minLength}` });
        }
        if (rules.maxLength && typeof value === "string" && value.length > rules.maxLength) {
          violations.push({ field, issue: `maximum length is ${rules.maxLength}` });
        }
        if (rules.minimum !== undefined && typeof value === "number" && value < rules.minimum) {
          violations.push({ field, issue: `minimum value is ${rules.minimum}` });
        }
        if (rules.maximum !== undefined && typeof value === "number" && value > rules.maximum) {
          violations.push({ field, issue: `maximum value is ${rules.maximum}` });
        }
        if (rules.enum && !rules.enum.includes(value)) {
          violations.push({ field, issue: `must be one of: ${rules.enum.join(", ")}` });
        }
        if (rules.pattern && typeof value === "string" && !new RegExp(rules.pattern).test(value)) {
          violations.push({ field, issue: `does not match pattern: ${rules.pattern}` });
        }
      }
    }

    // Check for unexpected fields
    if (schemaObj.additionalProperties === false) {
      for (const field of Object.keys(dataToValidate)) {
        if (!schemaObj.properties[field]) {
          violations.push({ field, issue: "unexpected field" });
        }
      }
    }
  }

  return {
    valid: violations.length === 0,
    violations,
    schemaName: schema.name,
    schemaVersion: schema.version,
  };
}

/**
 * Get schema registry statistics.
 */
export function getSchemaStats() {
  const data = readJSON(DATA_FILE);
  const schemas = data.schemas || [];

  const typeCounts = {};
  const endpointCounts = {};
  for (const schema of schemas) {
    typeCounts[schema.type] = (typeCounts[schema.type] || 0) + 1;
    if (schema.endpoint) endpointCounts[schema.endpoint] = (endpointCounts[schema.endpoint] || 0) + 1;
  }

  const uniqueNames = new Set(schemas.map((s) => s.name)).size;

  return {
    totalSchemas: schemas.length,
    uniqueNames,
    typeCounts,
    endpointsCovered: Object.keys(endpointCounts).length,
  };
}

/**
 * Clear schema registry.
 */
export function clearSchemaData() {
  writeJSON(DATA_FILE, { schemas: [] });
}
