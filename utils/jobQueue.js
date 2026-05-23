// Background job queue — processes tasks asynchronously
// In-memory queue with configurable concurrency and retry logic

const DEFAULT_OPTIONS = {
  concurrency: 3,
  maxRetries: 3,
  retryDelayMs: 5000,
};

class JobQueue {
  constructor(options = {}) {
    this.config = { ...DEFAULT_OPTIONS, ...options };
    this.queue = [];
    this.running = 0;
    this.jobs = new Map(); // Track all jobs by ID
    this.jobCounter = 0;
    this.processors = new Map(); // Job type -> handler function
  }

  /**
   * Register a job processor for a given type.
   */
  register(type, handler) {
    this.processors.set(type, handler);
  }

  /**
   * Add a job to the queue.
   * @param {string} type - Job type (must have a registered processor)
   * @param {object} data - Job data
   * @param {object} options - { priority, delay, maxRetries }
   * @returns {string} Job ID
   */
  enqueue(type, data, options = {}) {
    const id = `job_${++this.jobCounter}_${Date.now()}`;
    const job = {
      id,
      type,
      data,
      status: "pending",
      priority: options.priority || 0,
      maxRetries: options.maxRetries ?? this.config.maxRetries,
      retries: 0,
      createdAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null,
      error: null,
      result: null,
    };

    this.jobs.set(id, job);

    if (options.delay) {
      setTimeout(() => this._addToQueue(job), options.delay);
    } else {
      this._addToQueue(job);
    }

    return id;
  }

  _addToQueue(job) {
    this.queue.push(job);
    // Sort by priority (higher first)
    this.queue.sort((a, b) => b.priority - a.priority);
    this._processNext();
  }

  async _processNext() {
    if (this.running >= this.config.concurrency) return;
    if (this.queue.length === 0) return;

    const job = this.queue.shift();
    this.running++;
    job.status = "running";
    job.startedAt = new Date().toISOString();

    const processor = this.processors.get(job.type);
    if (!processor) {
      job.status = "failed";
      job.error = `No processor registered for type: ${job.type}`;
      job.completedAt = new Date().toISOString();
      this.running--;
      this._processNext();
      return;
    }

    try {
      job.result = await processor(job.data);
      job.status = "completed";
      job.completedAt = new Date().toISOString();
    } catch (err) {
      job.retries++;
      if (job.retries < job.maxRetries) {
        // Retry with delay
        job.status = "pending";
        setTimeout(() => this._addToQueue(job), this.config.retryDelayMs);
      } else {
        job.status = "failed";
        job.error = err.message;
        job.completedAt = new Date().toISOString();
      }
    } finally {
      this.running--;
      this._processNext();
    }
  }

  /**
   * Get job status by ID.
   */
  getJob(id) {
    const job = this.jobs.get(id);
    return job ? { ...job } : null;
  }

  /**
   * Get queue statistics.
   */
  stats() {
    const allJobs = Array.from(this.jobs.values());
    return {
      pending: this.queue.length,
      running: this.running,
      completed: allJobs.filter((j) => j.status === "completed").length,
      failed: allJobs.filter((j) => j.status === "failed").length,
      total: allJobs.length,
      processors: Array.from(this.processors.keys()),
    };
  }

  /**
   * Clear completed and failed jobs older than maxAge.
   */
  cleanup(maxAge = 3600000) {
    const cutoff = Date.now() - maxAge;
    for (const [id, job] of this.jobs) {
      if (
        (job.status === "completed" || job.status === "failed") &&
        new Date(job.completedAt).getTime() < cutoff
      ) {
        this.jobs.delete(id);
      }
    }
  }
}

// Singleton queue instance
export const jobQueue = new JobQueue();

// Export class for testing
export { JobQueue };
