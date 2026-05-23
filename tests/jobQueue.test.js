import { describe, test, expect, beforeEach } from "@jest/globals";
import { JobQueue } from "../utils/jobQueue.js";

describe("Job Queue", () => {
  let queue;

  beforeEach(() => {
    queue = new JobQueue({ concurrency: 2, maxRetries: 2, retryDelayMs: 50 });
  });

  test("register and process a job", async () => {
    let processed = false;
    queue.register("test", async (data) => {
      processed = true;
      return { received: data.value };
    });

    const id = queue.enqueue("test", { value: 42 });

    // Wait for processing
    await new Promise((r) => setTimeout(r, 100));

    expect(processed).toBe(true);
    const job = queue.getJob(id);
    expect(job.status).toBe("completed");
    expect(job.result.received).toBe(42);
  });

  test("job without processor fails", async () => {
    const id = queue.enqueue("unknown", {});

    await new Promise((r) => setTimeout(r, 100));

    const job = queue.getJob(id);
    expect(job.status).toBe("failed");
    expect(job.error).toContain("No processor");
  });

  test("failed job retries", async () => {
    let attempts = 0;
    queue.register("flaky", async () => {
      attempts++;
      if (attempts < 2) throw new Error("fail");
      return "ok";
    });

    const id = queue.enqueue("flaky", {});

    await new Promise((r) => setTimeout(r, 300));

    const job = queue.getJob(id);
    expect(job.status).toBe("completed");
    expect(job.retries).toBe(1);
  });

  test("job exceeds max retries becomes failed", async () => {
    queue.register("always-fail", async () => {
      throw new Error("permanent failure");
    });

    const id = queue.enqueue("always-fail", {}, { maxRetries: 1 });

    await new Promise((r) => setTimeout(r, 300));

    const job = queue.getJob(id);
    expect(job.status).toBe("failed");
    expect(job.error).toBe("permanent failure");
  });

  test("priority ordering", async () => {
    const order = [];
    // Use concurrency 1 and a slow processor so all jobs queue up
    const seqQueue = new JobQueue({ concurrency: 1, retryDelayMs: 10 });

    seqQueue.register("track", async (data) => {
      order.push(data.priority);
      await new Promise((r) => setTimeout(r, 10)); // Slow enough for queue
    });

    // Enqueue all quickly — the first starts processing but takes 10ms,
    // so the other two get queued and sorted by priority
    seqQueue.enqueue("track", { priority: 1 }, { priority: 1 });
    seqQueue.enqueue("track", { priority: 10 }, { priority: 10 });
    seqQueue.enqueue("track", { priority: 5 }, { priority: 5 });

    await new Promise((r) => setTimeout(r, 300));

    // First job runs immediately (priority 1), then queue sorts: 10, 5
    expect(order[0]).toBe(1);
    expect(order[1]).toBe(10);
    expect(order[2]).toBe(5);
  });

  test("stats returns correct counts", async () => {
    queue.register("ok", async () => "done");

    queue.enqueue("ok", {});
    queue.enqueue("unknown", {});

    await new Promise((r) => setTimeout(r, 100));

    const stats = queue.stats();
    expect(stats.total).toBe(2);
    expect(stats.completed).toBe(1);
    expect(stats.failed).toBe(1);
    expect(stats.processors).toContain("ok");
  });

  test("getJob returns null for unknown ID", () => {
    expect(queue.getJob("nonexistent")).toBeNull();
  });

  test("getJob returns job copy", () => {
    queue.register("test", async () => {});
    const id = queue.enqueue("test", {});
    const job1 = queue.getJob(id);
    const job2 = queue.getJob(id);
    expect(job1).not.toBe(job2); // Different object references
    expect(job1.id).toBe(job2.id);
  });

  test("cleanup removes old jobs", async () => {
    queue.register("test", async () => "done");
    const id = queue.enqueue("test", {});

    await new Promise((r) => setTimeout(r, 100));

    expect(queue.getJob(id)).not.toBeNull();

    // Cleanup with 0ms maxAge removes everything
    queue.cleanup(0);

    expect(queue.getJob(id)).toBeNull();
  });

  test("delayed job is processed after delay", async () => {
    let processed = false;
    queue.register("delayed", async () => {
      processed = true;
      return "done";
    });

    queue.enqueue("delayed", {}, { delay: 100 });

    // Should not be processed immediately
    expect(processed).toBe(false);

    await new Promise((r) => setTimeout(r, 200));

    expect(processed).toBe(true);
  });
});
