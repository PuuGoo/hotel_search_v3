// Chat-specific rate limiter: 10 messages per minute per user
// Stub — will be fully implemented in Task 4

const messageTimestamps = new Map();
const WINDOW_MS = 60 * 1000;
const MAX_MESSAGES = 10;

setInterval(() => {
  const now = Date.now();
  for (const [userId, timestamps] of messageTimestamps) {
    const filtered = timestamps.filter((t) => now - t < WINDOW_MS);
    if (filtered.length === 0) messageTimestamps.delete(userId);
    else messageTimestamps.set(userId, filtered);
  }
}, 30000).unref();

export function checkChatRateLimit(userId) {
  const now = Date.now();
  const timestamps = messageTimestamps.get(userId) || [];
  const recent = timestamps.filter((t) => now - t < WINDOW_MS);

  if (recent.length >= MAX_MESSAGES) {
    return { allowed: false, retryAfter: Math.ceil((recent[0] + WINDOW_MS - now) / 1000) };
  }

  recent.push(now);
  messageTimestamps.set(userId, recent);
  return { allowed: true };
}
