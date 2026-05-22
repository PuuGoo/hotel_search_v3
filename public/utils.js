// Shared utility functions for public scripts

/**
 * Escape HTML special characters to prevent XSS
 * @param {string} str - String to escape
 * @returns {string} Escaped string
 */
export function escapeHtml(str) {
  if (!str) return "";
  const div = document.createElement("div");
  div.appendChild(document.createTextNode(str));
  return div.innerHTML;
}

/**
 * Sanitize URL to prevent javascript: and other dangerous schemes
 * @param {string} url - URL to sanitize
 * @returns {string} Safe URL or empty string
 */
export function safeUrl(url) {
  if (!url) return "";
  const trimmed = url.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return "";
}

/**
 * Format timestamp to locale string
 * @param {string|number|Date} ts - Timestamp
 * @returns {string} Formatted string
 */
export function formatTime(ts) {
  if (!ts) return "";
  return new Date(ts).toLocaleString();
}

/**
 * Debounce a function
 * @param {Function} fn - Function to debounce
 * @param {number} ms - Delay in milliseconds
 * @returns {Function} Debounced function
 */
export function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}
