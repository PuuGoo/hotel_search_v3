// Contract testing — verify API request/response contracts

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_FILE = path.join(__dirname, "..", "contract_tests.json");
const MAX_CONTRACTS = 100;
const MAX_RESULTS = 1000;

function readJSON(filePath) {
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch { /* ignore */ }
  return { contracts: [], results: [] };
}

function writeJSON(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  } catch { /* ignore */ }
}

/**
 * Define an API contract.
 */
export function defineContract(options = {}) {
  const data = readJSON(DATA_FILE);
  if (!data.contracts) data.contracts = [];
  if (data.contracts.length >= MAX_CONTRACTS) {
    return { error: "Max contracts reached" };
  }

  const contract = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name: options.name || "Unnamed Contract",
    description: options.description || "",
    endpoint: options.endpoint || {}, // { method, path }
    request: options.request || {}, // { headers, body schema, query }
    response: options.response || {}, // { status, headers, body schema }
    enabled: options.enabled !== false,
    createdBy: options.userId || "system",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  data.contracts.unshift(contract);
  writeJSON(DATA_FILE, data);
  return contract;
}

/**
 * Get all contracts.
 */
export function getContracts(options = {}) {
  const { enabled = null } = options;
  const data = readJSON(DATA_FILE);
  let contracts = data.contracts || [];

  if (enabled !== null) {
    contracts = contracts.filter((c) => c.enabled === enabled);
  }

  return contracts;
}

/**
 * Get a specific contract.
 */
export function getContract(contractId) {
  const data = readJSON(DATA_FILE);
  return (data.contracts || []).find((c) => c.id === contractId) || null;
}

/**
 * Update a contract.
 */
export function updateContract(contractId, updates) {
  const data = readJSON(DATA_FILE);
  const contract = (data.contracts || []).find((c) => c.id === contractId);
  if (!contract) return null;

  for (const [key, value] of Object.entries(updates)) {
    if (key !== "id" && key !== "createdBy" && key !== "createdAt") {
      contract[key] = value;
    }
  }
  contract.updatedAt = Date.now();

  writeJSON(DATA_FILE, data);
  return contract;
}

/**
 * Delete a contract.
 */
export function deleteContract(contractId) {
  const data = readJSON(DATA_FILE);
  const index = (data.contracts || []).findIndex((c) => c.id === contractId);
  if (index === -1) return false;

  data.contracts.splice(index, 1);
  writeJSON(DATA_FILE, data);
  return true;
}

/**
 * Validate a response against a contract.
 */
export function validateResponse(contractId, actualResponse) {
  const data = readJSON(DATA_FILE);
  if (!data.results) data.results = [];

  const contract = (data.contracts || []).find((c) => c.id === contractId);
  if (!contract) return { error: "Contract not found" };
  if (!contract.enabled) return { error: "Contract is disabled" };

  const violations = [];

  // Check status code
  if (contract.response.status && actualResponse.status !== contract.response.status) {
    violations.push({
      field: "status",
      expected: contract.response.status,
      actual: actualResponse.status,
    });
  }

  // Check required response headers
  if (contract.response.headers) {
    for (const [header, expected] of Object.entries(contract.response.headers)) {
      const actual = actualResponse.headers?.[header.toLowerCase()];
      if (expected === "required" && !actual) {
        violations.push({ field: `header:${header}`, expected: "present", actual: "missing" });
      }
    }
  }

  // Check required body fields
  if (contract.response.bodySchema) {
    const body = actualResponse.body || {};
    for (const [field, schema] of Object.entries(contract.response.bodySchema)) {
      if (schema === "required" && (body[field] === undefined || body[field] === null)) {
        violations.push({ field: `body.${field}`, expected: "present", actual: "missing" });
      }
      if (schema === "array" && !Array.isArray(body[field])) {
        violations.push({ field: `body.${field}`, expected: "array", actual: typeof body[field] });
      }
      if (schema === "string" && typeof body[field] !== "string" && body[field] !== undefined) {
        violations.push({ field: `body.${field}`, expected: "string", actual: typeof body[field] });
      }
      if (schema === "number" && typeof body[field] !== "number" && body[field] !== undefined) {
        violations.push({ field: `body.${field}`, expected: "number", actual: typeof body[field] });
      }
      if (schema === "boolean" && typeof body[field] !== "boolean" && body[field] !== undefined) {
        violations.push({ field: `body.${field}`, expected: "boolean", actual: typeof body[field] });
      }
    }
  }

  const result = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    contractId,
    contractName: contract.name,
    valid: violations.length === 0,
    violations,
    timestamp: Date.now(),
  };

  data.results.unshift(result);
  if (data.results.length > MAX_RESULTS) data.results.length = MAX_RESULTS;

  writeJSON(DATA_FILE, data);
  return result;
}

/**
 * Get validation results.
 */
export function getResults(options = {}) {
  const { contractId = null, valid = null, limit = 50 } = options;
  const data = readJSON(DATA_FILE);
  let results = data.results || [];

  if (contractId) results = results.filter((r) => r.contractId === contractId);
  if (valid !== null) results = results.filter((r) => r.valid === valid);

  return { results: results.slice(0, limit), total: results.length };
}

/**
 * Get contract testing statistics.
 */
export function getContractStats() {
  const data = readJSON(DATA_FILE);
  const contracts = data.contracts || [];
  const results = data.results || [];

  const passCount = results.filter((r) => r.valid).length;
  const failCount = results.filter((r) => !r.valid).length;

  return {
    totalContracts: contracts.length,
    enabledContracts: contracts.filter((c) => c.enabled).length,
    totalValidations: results.length,
    passCount,
    failCount,
    passRate: results.length > 0 ? Math.round((passCount / results.length) * 100) : 0,
  };
}

/**
 * Clear contract data.
 */
export function clearContractData() {
  writeJSON(DATA_FILE, { contracts: [], results: [] });
}
