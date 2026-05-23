/**
 * Quick Filters Module
 * Provides one-click filter buttons for common hotel searches.
 */

const DEFAULT_FILTERS = [
  { label: "5-star", query: "5-star hotel", icon: "fa-star", color: "#f59e0b" },
  { label: "Budget", query: "budget hotel cheap", icon: "fa-wallet", color: "#22c55e" },
  { label: "Beach", query: "beach resort hotel", icon: "fa-umbrella-beach", color: "#06b6d4" },
  { label: "City Center", query: "city center hotel downtown", icon: "fa-city", color: "#8b5cf6" },
  { label: "Family", query: "family friendly hotel kids", icon: "fa-people-roof", color: "#ec4899" },
  { label: "Business", query: "business hotel work trip", icon: "fa-briefcase", color: "#6366f1" },
  { label: "Spa", query: "spa resort wellness hotel", icon: "fa-spa", color: "#14b8a6" },
  { label: "Near Airport", query: "hotel near airport", icon: "fa-plane", color: "#f97316" },
];

/**
 * Create quick filter buttons.
 * @param {Function} onFilter - Callback when a filter is clicked, receives query string
 * @param {Object} options - Options
 * @param {Array} options.filters - Custom filter definitions (defaults to DEFAULT_FILTERS)
 * @param {string} options.title - Section title
 * @returns {HTMLElement} The quick filters container
 */
export function createQuickFilters(onFilter, options = {}) {
  const filters = options.filters || DEFAULT_FILTERS;
  const title = options.title || "Quick Filters";

  const container = document.createElement("div");
  container.className = "quick-filters";
  container.style.cssText = "margin-bottom:var(--spacing-md);";

  const header = document.createElement("div");
  header.style.cssText = "display:flex;align-items:center;gap:8px;margin-bottom:8px;";
  header.innerHTML = `<i class="fa-solid fa-bolt" style="color:#f59e0b;font-size:0.85rem"></i><span style="font-size:0.82rem;font-weight:600">${escapeHtml(title)}</span>`;
  container.appendChild(header);

  const buttons = document.createElement("div");
  buttons.style.cssText = "display:flex;flex-wrap:wrap;gap:6px;";

  for (const filter of filters) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-outline btn-small quick-filter-btn";
    btn.style.cssText = `font-size:0.75rem;padding:4px 10px;border-radius:16px;transition:all 0.15s;`;
    btn.innerHTML = `<i class="fa-solid ${filter.icon}" style="color:${filter.color};margin-right:4px"></i>${escapeHtml(filter.label)}`;
    btn.title = filter.query;

    btn.addEventListener("click", () => {
      onFilter(filter.query);
      // Visual feedback
      btn.style.background = `${filter.color}22`;
      btn.style.borderColor = filter.color;
      setTimeout(() => {
        btn.style.background = "";
        btn.style.borderColor = "";
      }, 1000);
    });

    buttons.appendChild(btn);
  }

  container.appendChild(buttons);
  return container;
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export { DEFAULT_FILTERS };
