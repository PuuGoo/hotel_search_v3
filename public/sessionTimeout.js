/**
 * Session Timeout Warning Module
 * Shows a warning before session expires and auto-logs out on inactivity.
 */

const TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const WARNING_BEFORE_MS = 2 * 60 * 1000; // Show warning 2 minutes before expiry

let warningTimer = null;
let logoutTimer = null;
let warningEl = null;
let lastActivity = Date.now();

function createWarningElement() {
  if (warningEl) return warningEl;

  warningEl = document.createElement("div");
  warningEl.id = "sessionTimeoutWarning";
  warningEl.style.cssText = `
    position: fixed; bottom: 20px; right: 20px; z-index: 10000;
    background: var(--bg-secondary, #1a1a2e); border: 1px solid #f59e0b;
    border-radius: 12px; padding: 16px 20px; min-width: 280px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.3);
    display: none; animation: slideUp 0.3s ease;
  `;
  warningEl.innerHTML = `
    <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 10px">
      <i class="fa-solid fa-clock" style="color: #f59e0b; font-size: 1.2rem"></i>
      <span style="font-weight: 600; font-size: 0.9rem">Session Timeout</span>
    </div>
    <p style="color: var(--text-secondary, #aaa); font-size: 0.82rem; margin: 0 0 12px">
      Your session will expire in <strong id="timeoutCountdown">2:00</strong> due to inactivity.
    </p>
    <div style="display: flex; gap: 8px">
      <button id="extendSessionBtn" style="
        flex: 1; padding: 8px; border-radius: 8px; border: none;
        background: #f59e0b; color: #000; font-weight: 600; font-size: 0.82rem;
        cursor: pointer;
      ">Stay Logged In</button>
      <button id="logoutNowBtn" style="
        padding: 8px 12px; border-radius: 8px; border: 1px solid var(--border, #333);
        background: transparent; color: var(--text-secondary, #aaa); font-size: 0.82rem;
        cursor: pointer;
      ">Logout</button>
    </div>
  `;

  const style = document.createElement("style");
  style.textContent = `@keyframes slideUp { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }`;
  document.head.appendChild(style);
  document.body.appendChild(warningEl);

  document.getElementById("extendSessionBtn").addEventListener("click", extendSession);
  document.getElementById("logoutNowBtn").addEventListener("click", () => {
    window.location.href = "/logout";
  });

  return warningEl;
}

function showWarning() {
  const el = createWarningElement();
  el.style.display = "block";

  let remaining = WARNING_BEFORE_MS;
  const countdownEl = document.getElementById("timeoutCountdown");

  const countdownTimer = setInterval(() => {
    remaining -= 1000;
    if (remaining <= 0) {
      clearInterval(countdownTimer);
      return;
    }
    const mins = Math.floor(remaining / 60000);
    const secs = Math.floor((remaining % 60000) / 1000);
    if (countdownEl) countdownEl.textContent = `${mins}:${secs.toString().padStart(2, "0")}`;
  }, 1000);

  warningEl._countdownTimer = countdownTimer;
}

function hideWarning() {
  if (warningEl) {
    warningEl.style.display = "none";
    if (warningEl._countdownTimer) clearInterval(warningEl._countdownTimer);
  }
}

function extendSession() {
  lastActivity = Date.now();
  hideWarning();
  resetTimers();

  // Ping the server to update session.lastActivity
  fetch("/api/session-ping", { method: "POST" }).catch(() => {});
}

function resetTimers() {
  if (warningTimer) clearTimeout(warningTimer);
  if (logoutTimer) clearTimeout(logoutTimer);

  const timeUntilWarning = TIMEOUT_MS - WARNING_BEFORE_MS;
  warningTimer = setTimeout(showWarning, timeUntilWarning);
  logoutTimer = setTimeout(() => {
    window.location.href = "/?session=expired";
  }, TIMEOUT_MS);
}

function trackActivity() {
  const events = ["mousedown", "keydown", "scroll", "touchstart"];
  const throttled = () => {
    const now = Date.now();
    if (now - lastActivity > 60000) {
      lastActivity = now;
      hideWarning();
      resetTimers();
    }
  };

  for (const event of events) {
    document.addEventListener(event, throttled, { passive: true });
  }
}

export function initSessionTimeout() {
  if (window.location.pathname === "/" || window.location.pathname === "/login") return;
  trackActivity();
  resetTimers();
}
