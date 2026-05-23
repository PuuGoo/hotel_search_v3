// Contract testing routes — verify API request/response contracts

import { Router } from "express";
import { checkAuthenticated, checkRole } from "../middleware/auth.js";
import {
  defineContract,
  getContracts,
  getContract,
  updateContract,
  deleteContract,
  validateResponse,
  getResults,
  getContractStats,
  clearContractData,
} from "../utils/contractTesting.js";

const router = Router();

/**
 * POST /api/contracts
 * Define an API contract (admin only).
 */
router.post("/api/contracts", checkAuthenticated, checkRole("admin"), (req, res) => {
  const contract = defineContract({
    ...req.body,
    userId: req.session.user?.id,
  });
  if (contract.error) {
    return res.status(400).json({ error: contract.error, code: 400 });
  }
  res.status(201).json(contract);
});

/**
 * GET /api/contracts
 * Get all contracts (admin only).
 */
router.get("/api/contracts", checkAuthenticated, checkRole("admin"), (req, res) => {
  const enabled = req.query.enabled !== undefined ? req.query.enabled === "true" : null;
  const contracts = getContracts({ enabled });
  res.json({ contracts, count: contracts.length });
});

/**
 * GET /api/contracts/stats
 * Get contract testing statistics (admin only).
 */
router.get("/api/contracts/stats", checkAuthenticated, checkRole("admin"), (_req, res) => {
  const stats = getContractStats();
  res.json(stats);
});

/**
 * POST /api/contracts/:id/validate
 * Validate a response against a contract (admin only).
 */
router.post("/api/contracts/:id/validate", checkAuthenticated, checkRole("admin"), (req, res) => {
  const result = validateResponse(req.params.id, req.body);
  if (result.error) {
    return res.status(400).json({ error: result.error, code: 400 });
  }
  res.json(result);
});

/**
 * GET /api/contracts/results
 * Get validation results (admin only).
 */
router.get("/api/contracts/results", checkAuthenticated, checkRole("admin"), (req, res) => {
  const contractId = req.query.contractId || null;
  const valid = req.query.valid !== undefined ? req.query.valid === "true" : null;
  const limit = parseInt(req.query.limit) || 50;
  const results = getResults({ contractId, valid, limit });
  res.json(results);
});

/**
 * GET /api/contracts/:id
 * Get a specific contract (admin only).
 */
router.get("/api/contracts/:id", checkAuthenticated, checkRole("admin"), (req, res) => {
  const contract = getContract(req.params.id);
  if (!contract) {
    return res.status(404).json({ error: "Contract not found", code: 404 });
  }
  res.json(contract);
});

/**
 * PUT /api/contracts/:id
 * Update a contract (admin only).
 */
router.put("/api/contracts/:id", checkAuthenticated, checkRole("admin"), (req, res) => {
  const contract = updateContract(req.params.id, req.body);
  if (!contract) {
    return res.status(404).json({ error: "Contract not found", code: 404 });
  }
  res.json(contract);
});

/**
 * DELETE /api/contracts/clear
 * Clear contract data (admin only).
 */
router.delete("/api/contracts/clear", checkAuthenticated, checkRole("admin"), (_req, res) => {
  clearContractData();
  res.json({ message: "Contract data cleared" });
});

/**
 * DELETE /api/contracts/:id
 * Delete a contract (admin only).
 */
router.delete("/api/contracts/:id", checkAuthenticated, checkRole("admin"), (req, res) => {
  const deleted = deleteContract(req.params.id);
  if (!deleted) {
    return res.status(404).json({ error: "Contract not found", code: 404 });
  }
  res.json({ message: "Contract deleted" });
});

export default router;
