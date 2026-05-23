// Recent Searches Dropdown Module
// Usage: import { initRecentSearches } from '/recentSearches.js'; initRecentSearches(inputElement);

const MAX_RECENT = 10;
let dropdown = null;

export function initRecentSearches(inputEl, options = {}) {
  if (!inputEl) return;

  const onSelect = options.onSelect || ((query) => { inputEl.value = query; });
  const engine = options.engine || "tavily";

  // Create dropdown
  dropdown = document.createElement("div");
  dropdown.className = "recent-searches-dropdown hidden";
  dropdown.style.cssText = `
    position: absolute; top: 100%; left: 0; right: 0; z-index: 100;
    background: var(--glass-bg, #1a1a2e); border: 1px solid var(--glass-border, #333);
    border-radius: var(--radius-md, 8px); max-height: 300px; overflow-y: auto;
    box-shadow: 0 8px 32px rgba(0,0,0,0.3); margin-top: 4px;
  `;

  // Make input container relative
  const parent = inputEl.parentElement;
  if (getComputedStyle(parent).position === "static") {
    parent.style.position = "relative";
  }
  parent.appendChild(dropdown);

  // Show on focus
  inputEl.addEventListener("focus", () => loadAndShow(inputEl, onSelect));
  inputEl.addEventListener("input", () => {
    if (inputEl.value.length === 0) loadAndShow(inputEl, onSelect);
    else hide();
  });

  // Hide on click outside
  document.addEventListener("click", (e) => {
    if (!parent.contains(e.target)) hide();
  });

  // Track search on Enter
  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && inputEl.value.trim()) {
      trackSearch(inputEl.value.trim(), engine);
    }
  });
}

async function loadAndShow(inputEl, onSelect) {
  if (!inputEl.value.trim()) {
    try {
      const res = await fetch("/api/recent-searches?limit=" + MAX_RECENT);
      if (!res.ok) return;
      const searches = await res.json();

      if (searches.length === 0) {
        hide();
        return;
      }

      dropdown.innerHTML = `
        <div style="padding: 8px 12px; font-size: 0.7rem; color: var(--text-tertiary, #888); display: flex; justify-content: space-between; align-items: center">
          <span><i class="fa-solid fa-clock-rotate-left" style="margin-right: 4px"></i>Recent Searches</span>
          <button id="clearRecentBtn" style="background: none; border: none; color: var(--text-tertiary, #888); cursor: pointer; font-size: 0.65rem" title="Clear all">Clear</button>
        </div>
        ${searches.map(s => `
          <div class="recent-item" data-query="${escapeAttr(s.query)}" style="padding: 8px 12px; cursor: pointer; font-size: 0.78rem; display: flex; align-items: center; gap: 8px; transition: background 0.15s">
            <i class="fa-solid fa-clock" style="color: var(--text-tertiary, #666); font-size: 0.65rem"></i>
            <span style="flex: 1">${escapeHtml(s.query)}</span>
            <span style="font-size: 0.6rem; color: var(--text-tertiary, #666)">${escapeHtml(s.engine)}</span>
            <button class="delete-recent" data-id="${s.id}" style="background: none; border: none; color: var(--text-tertiary, #666); cursor: pointer; font-size: 0.65rem; padding: 2px" title="Delete">
              <i class="fa-solid fa-xmark"></i>
            </button>
          </div>
        `).join("")}
      `;

      // Add hover styles
      dropdown.querySelectorAll(".recent-item").forEach((item) => {
        item.addEventListener("mouseenter", () => { item.style.background = "rgba(255,255,255,0.05)"; });
        item.addEventListener("mouseleave", () => { item.style.background = "transparent"; });
        item.addEventListener("click", (e) => {
          if (e.target.closest(".delete-recent")) return;
          onSelect(item.dataset.query);
          hide();
        });
      });

      // Delete individual
      dropdown.querySelectorAll(".delete-recent").forEach((btn) => {
        btn.addEventListener("click", async (e) => {
          e.stopPropagation();
          await fetch(`/api/recent-searches/${btn.dataset.id}`, { method: "DELETE" });
          loadAndShow(inputEl, onSelect);
        });
      });

      // Clear all
      const clearBtn = dropdown.querySelector("#clearRecentBtn");
      if (clearBtn) {
        clearBtn.addEventListener("click", async (e) => {
          e.stopPropagation();
          await fetch("/api/recent-searches", { method: "DELETE" });
          hide();
        });
      }

      dropdown.classList.remove("hidden");
    } catch (err) {
      console.error("Load recent searches error:", err);
    }
  }
}

function hide() {
  if (dropdown) dropdown.classList.add("hidden");
}

async function trackSearch(query, engine) {
  try {
    await fetch("/api/recent-searches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, engine }),
    });
  } catch (err) {
    // Silently fail
  }
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function escapeAttr(str) {
  if (!str) return "";
  return String(str).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export { trackSearch };
