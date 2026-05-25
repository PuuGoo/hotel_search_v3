import { describe, test, expect, beforeEach, jest } from "@jest/globals";

const sendToUserMock = jest.fn();

describe("Real-time Notifications Socket Bridge", () => {
  let sendNotification;
  let clearAllNotificationData;
  let setNotificationEmitter;
  let retryPendingNotifications;
  let forceResendNotification;
  let startNotificationRetryScheduler;
  let stopNotificationRetryScheduler;
  let getNotificationDeliveryHealth;
  let getPendingNotificationDetails;
  let getDeadLetterNotifications;
  let acknowledgePendingNotification;
  let setDeliveryStatusBroadcastEnabled;
  let setNotificationOpsEmitter;
  let clearDeadLetterNotifications;
  let requeueDeadLetterNotification;
  let getNotificationRetrySchedulerConfig;
  let updateNotificationRetrySchedulerInterval;
  let setOpsStatusThrottleMs;
  let evaluateSupportRoomNudges;
  let getConversationQualitySignals;
  let evaluateSupportRoomSlaPrediction;
  let recordPostChatFeedback;
  let getPostChatFeedbackMetrics;
  const opsEmitterMock = jest.fn();

  beforeEach(async () => {
    sendToUserMock.mockClear();
    const mod = await import("../utils/realtimeNotifications.js");
    sendNotification = mod.sendNotification;
    clearAllNotificationData = mod.clearAllNotificationData;
    setNotificationEmitter = mod.setNotificationEmitter;
    retryPendingNotifications = mod.retryPendingNotifications;
    forceResendNotification = mod.forceResendNotification;
    startNotificationRetryScheduler = mod.startNotificationRetryScheduler;
    stopNotificationRetryScheduler = mod.stopNotificationRetryScheduler;
    getNotificationDeliveryHealth = mod.getNotificationDeliveryHealth;
    getPendingNotificationDetails = mod.getPendingNotificationDetails;
    getDeadLetterNotifications = mod.getDeadLetterNotifications;
    acknowledgePendingNotification = mod.acknowledgePendingNotification;
    setDeliveryStatusBroadcastEnabled = mod.setDeliveryStatusBroadcastEnabled;
    setNotificationOpsEmitter = mod.setNotificationOpsEmitter;
    clearDeadLetterNotifications = mod.clearDeadLetterNotifications;
    requeueDeadLetterNotification = mod.requeueDeadLetterNotification;
    getNotificationRetrySchedulerConfig = mod.getNotificationRetrySchedulerConfig;
    updateNotificationRetrySchedulerInterval = mod.updateNotificationRetrySchedulerInterval;
    setOpsStatusThrottleMs = mod.setOpsStatusThrottleMs;
    evaluateSupportRoomNudges = mod.evaluateSupportRoomNudges;
    getConversationQualitySignals = mod.getConversationQualitySignals;
    evaluateSupportRoomSlaPrediction = mod.evaluateSupportRoomSlaPrediction;
    recordPostChatFeedback = mod.recordPostChatFeedback;
    getPostChatFeedbackMetrics = mod.getPostChatFeedbackMetrics;
    setNotificationEmitter(sendToUserMock);
    opsEmitterMock.mockClear();
    setNotificationOpsEmitter(opsEmitterMock);
    clearAllNotificationData();
  });

  test("sendNotification pushes notification to socket user channel", () => {
    const created = sendNotification({
      userId: "socket-user-1",
      type: "info",
      title: "Realtime",
      message: "Socket push",
      data: { source: "test" },
    });

    expect(sendToUserMock).toHaveBeenCalledTimes(1);
    expect(sendToUserMock).toHaveBeenCalledWith("socket-user-1", {
      type: "notification:new",
      notification: created,
    });
  });

  test("retryPendingNotifications emits retryAttempt payload", () => {
    const created = sendNotification({
      userId: "socket-user-2",
      title: "Retry path",
    });
    sendToUserMock.mockClear();
    const count = retryPendingNotifications("socket-user-2");
    expect(count).toBe(1);
    expect(sendToUserMock).toHaveBeenCalledWith("socket-user-2", {
      type: "notification:new",
      notification: created,
      retryAttempt: 2,
    });
  });

  test("notification retry scheduler can start and stop", () => {
    const interval = startNotificationRetryScheduler(7000);
    expect(interval).toBe(7000);
    const health = getNotificationDeliveryHealth();
    expect(health.scheduler.active).toBe(true);
    expect(health.scheduler.intervalMs).toBe(7000);
    stopNotificationRetryScheduler();
    const afterStop = getNotificationDeliveryHealth();
    expect(afterStop.scheduler.active).toBe(false);
  });

  test("forceResendNotification resends specific pending notification", () => {
    const created = sendNotification({
      userId: "socket-user-3",
      title: "Force resend",
    });
    sendToUserMock.mockClear();
    const result = forceResendNotification(created.id);
    expect(result.resent).toBe(true);
    expect(result.notificationId).toBe(created.id);
    expect(sendToUserMock).toHaveBeenCalledWith("socket-user-3", {
      type: "notification:new",
      notification: created,
      retryAttempt: 2,
      forced: true,
    });
  });

  test("moves notification to dead-letter when max retry reached", () => {
    sendNotification({ userId: "socket-user-4", title: "Dead letter test" });
    retryPendingNotifications("socket-user-4");
    retryPendingNotifications("socket-user-4");
    sendToUserMock.mockClear();
    const retried = retryPendingNotifications("socket-user-4");
    expect(retried).toBe(0);
    const dead = getDeadLetterNotifications(10);
    expect(dead.length).toBe(1);
    expect(dead[0].reason).toBe("max_retry_reached");
    const pending = getPendingNotificationDetails("socket-user-4");
    expect(pending.length).toBe(0);
  });

  test("requeueDeadLetterNotification moves item back to pending and re-emits", () => {
    const created = sendNotification({ userId: "socket-user-7", title: "Requeue me" });
    retryPendingNotifications("socket-user-7");
    retryPendingNotifications("socket-user-7");
    retryPendingNotifications("socket-user-7");
    sendToUserMock.mockClear();
    const result = requeueDeadLetterNotification(created.id);
    expect(result.requeued).toBe(true);
    const pending = getPendingNotificationDetails("socket-user-7");
    expect(pending.length).toBe(1);
    expect(sendToUserMock).toHaveBeenCalledWith("socket-user-7", {
      type: "notification:new",
      notification: expect.objectContaining({ id: created.id }),
      requeued: true,
    });
    clearDeadLetterNotifications();
  });

  test("emits notification:status acknowledged when ack is received", () => {
    const created = sendNotification({ userId: "socket-user-5", title: "Ack status" });
    sendToUserMock.mockClear();
    const acknowledged = acknowledgePendingNotification(created.id, "socket-user-5");
    expect(acknowledged).toBe(true);
    expect(sendToUserMock).toHaveBeenCalledWith("socket-user-5", {
      type: "notification:status",
      status: "acknowledged",
      notificationId: created.id,
      timestamp: expect.any(Number),
    });
    expect(opsEmitterMock).toHaveBeenCalledWith({
      type: "notification:status",
      status: "acknowledged",
      notificationId: created.id,
      timestamp: expect.any(Number),
      userId: "socket-user-5",
    });
    const health = getNotificationDeliveryHealth();
    expect(health.delivery.ackLatencyCount).toBeGreaterThanOrEqual(1);
    expect(health.delivery.ackLatencyMsAvg).toBeGreaterThanOrEqual(0);
    expect(health.delivery.ackLatencyMsMax).toBeGreaterThanOrEqual(0);
    expect(health.delivery).toHaveProperty("ackLatencyMsP50");
    expect(health.delivery).toHaveProperty("ackLatencyMsP95");
  });

  test("does not emit status when delivery status broadcast is disabled", () => {
    setDeliveryStatusBroadcastEnabled(false);
    const created = sendNotification({ userId: "socket-user-6", title: "No status" });
    sendToUserMock.mockClear();
    acknowledgePendingNotification(created.id, "socket-user-6");
    expect(sendToUserMock).not.toHaveBeenCalledWith("socket-user-6", expect.objectContaining({
      type: "notification:status",
    }));
  });

  test("updateNotificationRetrySchedulerInterval updates interval config", () => {
    const before = getNotificationRetrySchedulerConfig();
    expect(before).toHaveProperty("intervalMs");
    const updated = updateNotificationRetrySchedulerInterval(9000);
    expect(updated.intervalMs).toBe(9000);
  });

  test("ops status emitter is throttled by opsThrottleMs", () => {
    setOpsStatusThrottleMs(60000);
    const created = sendNotification({ userId: "socket-user-8", title: "Throttle" });
    sendToUserMock.mockClear();
    opsEmitterMock.mockClear();
    acknowledgePendingNotification(created.id, "socket-user-8");
    acknowledgePendingNotification(created.id, "socket-user-8");
    const opsStatusCalls = opsEmitterMock.mock.calls.filter((c) => c[0]?.type === "notification:status");
    expect(opsStatusCalls.length).toBe(1);
  });

  test("support nudge emits once per rule window and deduplicates", () => {
    expect(typeof evaluateSupportRoomNudges).toBe("function");
    const now = Date.now();
    const room = {
      id: "support-nudge-room",
      type: "support",
      createdAt: new Date(now - 3 * 60 * 60 * 1000).toISOString(),
      status: "open",
    };
    const messages = [
      {
        id: "nudge-msg-1",
        timestamp: new Date(now - 2 * 60 * 60 * 1000).toISOString(),
        text: "initial support message",
      },
    ];

    const first = evaluateSupportRoomNudges({
      room,
      messages,
      now,
      targetUserIds: ["user-nudge-1"],
      config: { firstNudgeAfterMs: 30 * 60 * 1000, secondNudgeAfterMs: 5 * 60 * 60 * 1000, dedupeWindowMs: 60 * 60 * 1000 },
    });
    expect(first.roomId).toBe("support-nudge-room");
    expect(first.notificationsSent).toBe(1);
    expect(first.stages).toContain("first_followup");

    sendToUserMock.mockClear();
    const second = evaluateSupportRoomNudges({
      room,
      messages,
      now: now + 10 * 60 * 1000,
      targetUserIds: ["user-nudge-1"],
      config: { firstNudgeAfterMs: 30 * 60 * 1000, secondNudgeAfterMs: 5 * 60 * 60 * 1000, dedupeWindowMs: 60 * 60 * 1000 },
    });
    expect(second.notificationsSent).toBe(0);
  });

  test("post-chat feedback metrics aggregate deterministically", () => {
    expect(typeof recordPostChatFeedback).toBe("function");
    expect(typeof getPostChatFeedbackMetrics).toBe("function");

    const a = recordPostChatFeedback({ roomId: "fb-room-1", userId: "u1", rating: 5, comment: "great" });
    const b = recordPostChatFeedback({ roomId: "fb-room-2", userId: "u2", rating: 2, comment: "slow" });

    expect(a).toBeDefined();
    expect(b).toBeDefined();

    const metrics = getPostChatFeedbackMetrics();
    expect(metrics.feedbackCount).toBeGreaterThanOrEqual(2);
    expect(metrics.avgRating).toBeGreaterThanOrEqual(1);
    expect(metrics.avgRating).toBeLessThanOrEqual(5);
    expect(metrics.lowRatingRate).toBeGreaterThanOrEqual(0);
    expect(metrics.lowRatingRate).toBeLessThanOrEqual(1);
  });
});
