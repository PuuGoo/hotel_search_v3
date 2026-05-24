/* ui.js - Shared UI behaviors: theme, clock, tabs, modals, ripple, toasts, drag-drop helpers */
import { escapeHtml, safeUrl } from "/utils.js";

// THEME MANAGER -----------------------------------------------------------
const Theme = (() => {
  const KEY = "theme";
  let current = localStorage.getItem(KEY) || (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
  const apply = () =>
    document.documentElement.setAttribute("data-theme", current);
  const toggle = () => {
    current = current === "dark" ? "light" : "dark";
    localStorage.setItem(KEY, current);
    apply();
    dispatch();
  };
  const onChangeHandlers = new Set();
  const onChange = (fn) => {
    onChangeHandlers.add(fn);
    return () => onChangeHandlers.delete(fn);
  };
  const dispatch = () =>
    onChangeHandlers.forEach((fn) => {
      try {
        fn(current);
      } catch (e) {}
    });
  function init() {
    apply();
    document.addEventListener("keydown", (e) => {
      if (e.altKey && (e.key === "d" || e.key === "D")) {
        toggle();
      }
    });
  }
  return { init, toggle, onChange, get: () => current };
})();

// CLOCK -------------------------------------------------------------------
function initClock(selector = ".clock") {
  const el = document.querySelector(selector);
  if (!el) return;
  const update = () => {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    el.textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(
      d.getSeconds()
    )}`;
  };
  update();
  setInterval(update, 1000);
}

// RIPPLE EFFECT -----------------------------------------------------------
function enableRipples(selector = ".btn") {
  document.addEventListener(
    "click",
    (e) => {
      const target = e.target.closest(selector);
      if (!target) return;
      const rect = target.getBoundingClientRect();
      const ripple = document.createElement("span");
      ripple.className = "ripple-effect";
      const size = Math.max(rect.width, rect.height);
      ripple.style.width = ripple.style.height = size + "px";
      ripple.style.left = e.clientX - rect.left - size / 2 + "px";
      ripple.style.top = e.clientY - rect.top - size / 2 + "px";
      target.appendChild(ripple);
      setTimeout(() => ripple.remove(), 600);
    },
    { passive: true }
  );
}

// TOASTS ------------------------------------------------------------------
const Toasts = (() => {
  let container;
  function ensure() {
    if (!container) {
      container = document.createElement("div");
      container.className = "toast-container";
      document.body.appendChild(container);
    }
  }
  function show(
    message,
    { title = null, type = null, timeout = 4000, actions = null } = {}
  ) {
    ensure();
    const el = document.createElement("div");
    el.className = "toast" + (type ? ` ${type}` : "");
    const safeTitle = escapeHtml(title || "");
    const safeMsg = escapeHtml(message);
    el.innerHTML = `<div style="flex:1;min-width:0"><div class="title">${safeTitle}</div><div class="message">${safeMsg}</div></div>`;
    if (actions) {
      const wrap = document.createElement("div");
      wrap.style.display = "flex";
      wrap.style.gap = "6px";
      actions.forEach((a) => {
        const b = document.createElement("button");
        b.className = "btn btn-small btn-outline";
        b.textContent = a.label;
        b.addEventListener("click", () => {
          try {
            a.onClick && a.onClick();
          } finally {
            el.remove();
          }
        });
        wrap.appendChild(b);
      });
      el.appendChild(wrap);
    }
    const close = document.createElement("button");
    close.className = "btn btn-ghost btn-small";
    close.style.marginLeft = "4px";
    close.textContent = "×";
    close.setAttribute("aria-label", "Đóng");
    close.onclick = () => el.remove();
    el.appendChild(close);
    container.appendChild(el);
    if (timeout > 0) {
      setTimeout(() => el.remove(), timeout);
    }
    return el;
  }
  function success(msg, opts = {}) {
    return show(msg, {
      type: "success",
      title: opts.title || "Thành công",
      ...opts,
    });
  }
  function error(msg, opts = {}) {
    return show(msg, { type: "error", title: opts.title || "Lỗi", ...opts });
  }
  function warning(msg, opts = {}) {
    return show(msg, { type: "warning", title: opts.title || "Cảnh báo", ...opts });
  }
  function info(msg, opts = {}) {
    return show(msg, { type: "info", title: opts.title || "Thông tin", ...opts });
  }
  return { show, success, error, warning, info };
})();

// MODAL MANAGER -----------------------------------------------------------
const Modal = (() => {
  function open(
    html,
    { onClose = null, closable = true, className = "" } = {}
  ) {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    const modal = document.createElement("div");
    modal.className = "modal " + className;
    modal.innerHTML = html;
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    const close = () => {
      overlay.remove();
      onClose && onClose();
      document.removeEventListener("keydown", esc);
    };
    function esc(e) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("keydown", esc);
    if (closable) {
      const btn = document.createElement("button");
      btn.className = "close-btn";
      btn.innerHTML = "✕";
      btn.type = "button";
      btn.addEventListener("click", close);
      modal.appendChild(btn);
    }
    return { close, overlay, modal };
  }
  return { open };
})();

// TABS --------------------------------------------------------------------
function initTabs(root = document) {
  const tablists = [...root.querySelectorAll("[data-tabs]")];
  tablists.forEach((list) => {
    const buttons = [...list.querySelectorAll('[role="tab"]')];
    const panelIds = buttons.map((b) => b.getAttribute("data-target"));
    const panels = panelIds
      .map((id) => document.getElementById(id))
      .filter(Boolean);
    function activate(btn) {
      buttons.forEach((b) => {
        const sel = b === btn;
        b.setAttribute("aria-selected", sel);
        b.tabIndex = sel ? 0 : -1;
      });
      panels.forEach((p) => {
        p.classList.toggle("active", p.id === btn.getAttribute("data-target"));
      });
    }
    +buttons.forEach((b) => b.addEventListener("click", () => activate(b)));
    if (buttons.length) activate(buttons[0]);
  });
}

// DRAG & DROP HELPERS -----------------------------------------------------
function initDragDrop() {
  document.querySelectorAll(".drop-zone").forEach((zone) => {
    ["dragenter", "dragover"].forEach((ev) =>
      zone.addEventListener(ev, (e) => {
        e.preventDefault();
        zone.classList.add("drag-over");
      })
    );
    ["dragleave", "drop"].forEach((ev) =>
      zone.addEventListener(ev, (e) => {
        e.preventDefault();
        zone.classList.remove("drag-over");
      })
    );
    zone.addEventListener("drop", (e) => {
      const files = [...e.dataTransfer.files];
      zone.dispatchEvent(new CustomEvent("files-dropped", { detail: files }));
    });
  });
}

// PROGRESS BAR API --------------------------------------------------------
function updateProgress(selector, percent) {
  const bar = document.querySelector(selector);
  if (!bar) return;
  bar.style.width = Math.max(0, Math.min(100, percent)) + "%";
}

// ACCESSIBILITY -----------------------------------------------------------
function focusTrap(container) {
  const FOCUSABLE =
    'a,button,input,select,textarea,[tabindex]:not([tabindex="-1"])';
  const nodes = [...container.querySelectorAll(FOCUSABLE)].filter(
    (n) => !n.disabled && n.offsetParent !== null
  );
  if (!nodes.length) return;
  function key(e) {
    if (e.key !== "Tab") return;
    const first = nodes[0],
      last = nodes[nodes.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
  container.addEventListener("keydown", key);
  return () => container.removeEventListener("keydown", key);
}

// NOTIFICATION BELL -------------------------------------------------------
function initNotifications() {
  const header = document.querySelector(".app-header-inner");
  if (!header) return;

  // Don't inject if already exists
  if (document.getElementById("notifBell")) return;

  // Create bell button
  const bell = document.createElement("div");
  bell.id = "notifBell";
  bell.style.cssText = "position:relative;cursor:pointer;margin-left:4px";
  bell.innerHTML = `
    <button class="btn btn-outline btn-small" title="Thông báo" style="position:relative">
      <i class="fa-solid fa-bell"></i>
      <span id="notifBadge" class="hidden" style="position:absolute;top:-4px;right:-4px;width:16px;height:16px;border-radius:50%;background:#ff4d4f;color:#fff;font-size:.55rem;display:flex;align-items:center;justify-content:center;font-weight:700">0</span>
    </button>
  `;

  // Create dropdown
  const dropdown = document.createElement("div");
  dropdown.id = "notifDropdown";
  dropdown.className = "hidden";
  dropdown.style.cssText = `
    position:absolute;right:0;top:100%;z-index:200;min-width:340px;max-width:420px;
    background:var(--surface-elevated,rgba(30,30,40,.98));
    border:1px solid var(--border-subtle,rgba(255,255,255,.1));
    border-radius:var(--radius-md);box-shadow:var(--shadow-lg);
    backdrop-filter:blur(12px);max-height:420px;overflow:hidden;display:flex;flex-direction:column;
  `;

  const wrapper = document.createElement("div");
  wrapper.style.cssText = "position:relative;margin-left:4px";
  wrapper.appendChild(bell);
  wrapper.appendChild(dropdown);

  // Insert into the nav container (last flex div in header)
  const navContainer = header.querySelector('.flex.gap-sm') || header.lastElementChild;
  if (navContainer) {
    navContainer.appendChild(wrapper);
  } else {
    header.appendChild(wrapper);
  }

  let notifOpen = false;

  function renderNotifications(data) {
    const { notifications, unread } = data;
    const badge = document.getElementById("notifBadge");
    if (badge) {
      if (unread > 0) {
        badge.textContent = unread > 9 ? "9+" : unread;
        badge.classList.remove("hidden");
      } else {
        badge.classList.add("hidden");
      }
    }

    const typeIcons = { info: "fa-circle-info", success: "fa-circle-check", warning: "fa-triangle-exclamation", error: "fa-circle-xmark" };
    const typeColors = { info: "#d4a853", success: "#5b9a6f", warning: "#d4a853", error: "#e07456" };

    dropdown.innerHTML = `
      <div style="padding:10px 14px;display:flex;align-items:center;gap:8px;border-bottom:1px solid rgba(255,255,255,.06)">
        <strong style="font-size:.82rem;flex:1">Thông báo ${unread > 0 ? `(${unread})` : ""}</strong>
        ${unread > 0 ? '<button class="btn btn-outline btn-small" id="notifMarkAll" style="font-size:.6rem;padding:2px 6px">Đọc tất cả</button>' : ""}
        <button class="btn btn-outline btn-small" id="notifClearRead" style="font-size:.6rem;padding:2px 6px" title="Xóa đã đọc"><i class="fa-solid fa-trash"></i></button>
      </div>
      <div style="overflow-y:auto;max-height:360px">
        ${notifications.length === 0 ? '<div style="padding:20px;text-align:center;color:var(--text-tertiary);font-size:.75rem">Không có thông báo</div>' :
          notifications.slice(0, 30).map(n => `
            <div class="notif-item" data-id="${n.id}" style="padding:8px 14px;border-bottom:1px solid rgba(255,255,255,.03);cursor:pointer;transition:background .15s;${n.read ? 'opacity:.6' : ''}"
              onmouseover="this.style.background='rgba(255,255,255,.04)'" onmouseout="this.style.background=''">
              <div style="display:flex;align-items:flex-start;gap:8px">
                <i class="fa-solid ${typeIcons[n.type] || 'fa-circle-info'}" style="color:${typeColors[n.type] || '#d4a853'};margin-top:2px;font-size:.7rem"></i>
                <div style="flex:1;min-width:0">
                  <div style="font-size:.75rem;font-weight:${n.read ? '400' : '600'}">${escapeHtml(n.title)}</div>
                  <div style="font-size:.68rem;color:var(--text-secondary);margin-top:2px;white-space:pre-wrap">${escapeHtml(n.message)}</div>
                  <div style="font-size:.55rem;color:var(--text-tertiary);margin-top:3px">${new Date(n.createdAt).toLocaleString("vi")}</div>
                </div>
                ${!n.read ? '<div style="width:6px;height:6px;border-radius:50%;background:#d4a853;flex-shrink:0;margin-top:6px"></div>' : ""}
              </div>
            </div>
          `).join("")}
      </div>
    `;

    // Event handlers
    dropdown.querySelectorAll(".notif-item").forEach(el => {
      el.addEventListener("click", async () => {
        const id = el.dataset.id;
        if (!el.style.opacity || el.style.opacity === "1") {
          await fetch(`/api/notifications/${id}/read`, { method: "PUT" }).catch(() => {});
          loadNotifs();
        }
        // Navigate to link if present
      });
    });

    const markAll = document.getElementById("notifMarkAll");
    if (markAll) {
      markAll.addEventListener("click", async () => {
        await fetch("/api/notifications/read-all", { method: "PUT" }).catch(() => {});
        loadNotifs();
      });
    }

    const clearRead = document.getElementById("notifClearRead");
    if (clearRead) {
      clearRead.addEventListener("click", async () => {
        await fetch("/api/notifications/clear-read", { method: "DELETE" }).catch(() => {});
        loadNotifs();
      });
    }
  }

  async function loadNotifs() {
    try {
      const res = await fetch("/api/notifications");
      if (!res.ok) return;
      const data = await res.json();
      renderNotifications(data);
    } catch {}
  }

  bell.addEventListener("click", (e) => {
    e.stopPropagation();
    notifOpen = !notifOpen;
    dropdown.classList.toggle("hidden", !notifOpen);
    if (notifOpen) loadNotifs();
  });

  document.addEventListener("click", (e) => {
    if (notifOpen && !wrapper.contains(e.target)) {
      notifOpen = false;
      dropdown.classList.add("hidden");
    }
  });

  // Load unread count on init
  loadNotifs();
  // Poll every 60s
  setInterval(async () => {
    try {
      const res = await fetch("/api/notifications/unread-count");
      if (!res.ok) return;
      const { count } = await res.json();
      const badge = document.getElementById("notifBadge");
      if (badge) {
        if (count > 0) {
          badge.textContent = count > 9 ? "9+" : count;
          badge.classList.remove("hidden");
        } else {
          badge.classList.add("hidden");
        }
      }
    } catch {}
  }, 60000);
}

// INIT --------------------------------------------------------------------
function initUI() {
  Theme.init();
  enableRipples();
  initClock();
  initTabs();
  initDragDrop();
  initNotifications();
  document.addEventListener("keydown", (e) => {
    if (e.altKey && (e.key === "t" || e.key === "T")) {
      Toasts.show("Shortcut Alt+T triggered", { title: "Shortcut" });
    }
  });
}

document.addEventListener("DOMContentLoaded", initUI);

// EXPOSE GLOBALLY (for non-module scripts) --------------------------------
window.Toasts = Toasts;
window.Modal = Modal;
window.Theme = Theme;

// EXPORTS (ESM friendly) --------------------------------------------------
export {
  Theme,
  Toasts,
  Modal,
  enableRipples,
  initTabs,
  updateProgress,
  focusTrap,
  escapeHtml,
  safeUrl,
};
