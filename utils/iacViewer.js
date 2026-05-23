// Infrastructure as code viewer — view and validate IaC templates

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_FILE = path.join(__dirname, "..", "iac_templates.json");
const MAX_TEMPLATES = 100;
const MAX_VALIDATIONS = 500;

function readJSON(filePath) {
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch { /* ignore */ }
  return { templates: [], validations: [] };
}

function writeJSON(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  } catch { /* ignore */ }
}

/**
 * Register an IaC template.
 */
export function registerTemplate(options = {}) {
  const data = readJSON(DATA_FILE);
  if (!data.templates) data.templates = [];

  const template = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name: options.name,
    type: options.type || "terraform", // "terraform", "cloudformation", "kubernetes", "docker-compose", "ansible"
    content: options.content || "",
    description: options.description || "",
    provider: options.provider || "",
    resources: options.resources || [],
    author: options.userId || "system",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  data.templates.unshift(template);
  if (data.templates.length > MAX_TEMPLATES) data.templates.length = MAX_TEMPLATES;

  writeJSON(DATA_FILE, data);
  return template;
}

/**
 * Get all templates.
 */
export function getTemplates(options = {}) {
  const { type = null, provider = null } = options;
  const data = readJSON(DATA_FILE);
  let templates = data.templates || [];

  if (type) templates = templates.filter((t) => t.type === type);
  if (provider) templates = templates.filter((t) => t.provider === provider);

  return { templates, count: templates.length };
}

/**
 * Get a specific template.
 */
export function getTemplate(templateId) {
  const data = readJSON(DATA_FILE);
  return (data.templates || []).find((t) => t.id === templateId) || null;
}

/**
 * Update a template.
 */
export function updateTemplate(templateId, updates) {
  const data = readJSON(DATA_FILE);
  const index = (data.templates || []).findIndex((t) => t.id === templateId);
  if (index === -1) return null;

  data.templates[index] = {
    ...data.templates[index],
    ...updates,
    id: templateId,
    updatedAt: Date.now(),
  };
  writeJSON(DATA_FILE, data);
  return data.templates[index];
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
 * Validate a template (basic structural validation).
 */
export function validateTemplate(templateId) {
  const data = readJSON(DATA_FILE);
  const template = (data.templates || []).find((t) => t.id === templateId);
  if (!template) return { valid: false, error: "Template not found" };

  const issues = [];

  // Check for empty content
  if (!template.content || template.content.trim().length === 0) {
    issues.push({ severity: "error", message: "Template content is empty" });
  }

  // Check for required fields based on type
  if (template.type === "terraform" && !template.provider) {
    issues.push({ severity: "warning", message: "Terraform template missing provider" });
  }

  if (template.type === "kubernetes" && !template.content.includes("apiVersion")) {
    issues.push({ severity: "warning", message: "Kubernetes template missing apiVersion" });
  }

  if (template.type === "cloudformation" && !template.content.includes("AWSTemplateFormatVersion")) {
    issues.push({ severity: "warning", message: "CloudFormation template missing AWSTemplateFormatVersion" });
  }

  // Check for common issues
  if (template.content.includes("TODO") || template.content.includes("FIXME")) {
    issues.push({ severity: "info", message: "Template contains TODO/FIXME comments" });
  }

  const validation = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    templateId,
    templateName: template.name,
    valid: issues.filter((i) => i.severity === "error").length === 0,
    issues,
    timestamp: Date.now(),
  };

  // Store validation result
  if (!data.validations) data.validations = [];
  data.validations.unshift(validation);
  if (data.validations.length > MAX_VALIDATIONS) data.validations.length = MAX_VALIDATIONS;

  writeJSON(DATA_FILE, data);
  return validation;
}

/**
 * Get validation history.
 */
export function getValidationHistory(templateId = null, limit = 50) {
  const data = readJSON(DATA_FILE);
  let validations = data.validations || [];
  if (templateId) validations = validations.filter((v) => v.templateId === templateId);
  return { validations: validations.slice(0, limit), total: validations.length };
}

/**
 * Get IaC statistics.
 */
export function getIacStats() {
  const data = readJSON(DATA_FILE);
  const templates = data.templates || [];
  const validations = data.validations || [];

  const typeCounts = {};
  const providerCounts = {};
  for (const t of templates) {
    typeCounts[t.type] = (typeCounts[t.type] || 0) + 1;
    if (t.provider) providerCounts[t.provider] = (providerCounts[t.provider] || 0) + 1;
  }

  return {
    totalTemplates: templates.length,
    totalValidations: validations.length,
    typeCounts,
    providerCounts,
    passRate: validations.length > 0
      ? Math.round((validations.filter((v) => v.valid).length / validations.length) * 100)
      : 0,
  };
}

/**
 * Clear IaC data.
 */
export function clearIacData() {
  writeJSON(DATA_FILE, { templates: [], validations: [] });
}
