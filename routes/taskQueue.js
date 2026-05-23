// Task queue routes — async task processing with priority and retry

import { Router } from "express";
import { checkAuthenticated, checkRole } from "../middleware/auth.js";
import {
  enqueue,
  peek,
  dequeue,
  complete,
  fail,
  cancel,
  getQueue,
  getHistory,
  getTask,
  getQueueStats,
  clearQueueData,
} from "../utils/taskQueue.js";

const router = Router();

/**
 * POST /api/task-queue/enqueue
 * Add a task to the queue.
 */
router.post("/api/task-queue/enqueue", checkAuthenticated, (req, res) => {
  const task = enqueue({
    ...req.body,
    userId: req.session.user?.id,
  });
  if (task.error) {
    return res.status(400).json({ error: task.error, code: 400 });
  }
  res.status(201).json(task);
});

/**
 * GET /api/task-queue/peek
 * Peek at next task (admin only).
 */
router.get("/api/task-queue/peek", checkAuthenticated, checkRole("admin"), (_req, res) => {
  const task = peek();
  res.json({ task });
});

/**
 * POST /api/task-queue/dequeue
 * Dequeue (claim) next task (admin only).
 */
router.post("/api/task-queue/dequeue", checkAuthenticated, checkRole("admin"), (_req, res) => {
  const task = dequeue();
  if (!task) {
    return res.json({ task: null, message: "Queue is empty" });
  }
  res.json(task);
});

/**
 * POST /api/task-queue/:id/complete
 * Mark a task as complete (admin only).
 */
router.post("/api/task-queue/:id/complete", checkAuthenticated, checkRole("admin"), (req, res) => {
  const task = complete(req.params.id, req.body?.result);
  if (task.error) {
    return res.status(400).json({ error: task.error, code: 400 });
  }
  res.json(task);
});

/**
 * POST /api/task-queue/:id/fail
 * Mark a task as failed (admin only).
 */
router.post("/api/task-queue/:id/fail", checkAuthenticated, checkRole("admin"), (req, res) => {
  const task = fail(req.params.id, req.body?.error);
  if (task.error) {
    return res.status(400).json({ error: task.error, code: 400 });
  }
  res.json(task);
});

/**
 * POST /api/task-queue/:id/cancel
 * Cancel a task (admin only).
 */
router.post("/api/task-queue/:id/cancel", checkAuthenticated, checkRole("admin"), (req, res) => {
  const task = cancel(req.params.id);
  if (task.error) {
    return res.status(400).json({ error: task.error, code: 400 });
  }
  res.json(task);
});

/**
 * GET /api/task-queue
 * Get queue contents (admin only).
 */
router.get("/api/task-queue", checkAuthenticated, checkRole("admin"), (req, res) => {
  const status = req.query.status || null;
  const type = req.query.type || null;
  const limit = parseInt(req.query.limit) || 50;
  const queue = getQueue({ status, type, limit });
  res.json(queue);
});

/**
 * GET /api/task-queue/stats
 * Get queue statistics (admin only).
 */
router.get("/api/task-queue/stats", checkAuthenticated, checkRole("admin"), (_req, res) => {
  const stats = getQueueStats();
  res.json(stats);
});

/**
 * GET /api/task-queue/history
 * Get task history (admin only).
 */
router.get("/api/task-queue/history", checkAuthenticated, checkRole("admin"), (req, res) => {
  const status = req.query.status || null;
  const type = req.query.type || null;
  const limit = parseInt(req.query.limit) || 50;
  const history = getHistory({ status, type, limit });
  res.json(history);
});

/**
 * GET /api/task-queue/:id
 * Get a specific task (admin only).
 */
router.get("/api/task-queue/:id", checkAuthenticated, checkRole("admin"), (req, res) => {
  const task = getTask(req.params.id);
  if (!task) {
    return res.status(404).json({ error: "Task not found", code: 404 });
  }
  res.json(task);
});

/**
 * DELETE /api/task-queue/clear
 * Clear queue data (admin only).
 */
router.delete("/api/task-queue/clear", checkAuthenticated, checkRole("admin"), (_req, res) => {
  clearQueueData();
  res.json({ message: "Task queue cleared" });
});

export default router;
