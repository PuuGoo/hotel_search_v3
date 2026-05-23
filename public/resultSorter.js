/**
 * Result Sorting Module
 * Provides sorting functionality for search results.
 */

const SORT_OPTIONS = [
  { value: "relevance", label: "Relevance", icon: "fa-arrow-down-1-9" },
  { value: "title-asc", label: "Title A-Z", icon: "fa-arrow-down-a-z" },
  { value: "title-desc", label: "Title Z-A", icon: "fa-arrow-up-a-z" },
  { value: "domain", label: "Domain A-Z", icon: "fa-globe" },
];

function getDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/**
 * Sort results array by the given sort key.
 * @param {Array} results - Array of result objects with title, url, snippet
 * @param {string} sortKey - Sort key from SORT_OPTIONS
 * @returns {Array} Sorted copy of results
 */
export function sortResults(results, sortKey) {
  const sorted = [...results];
  switch (sortKey) {
    case "title-asc":
      return sorted.sort((a, b) => (a.title || "").localeCompare(b.title || ""));
    case "title-desc":
      return sorted.sort((a, b) => (b.title || "").localeCompare(a.title || ""));
    case "domain":
      return sorted.sort((a, b) => getDomain(a.url || "").localeCompare(getDomain(b.url || "")));
    case "relevance":
    default:
      return sorted; // Keep original order (relevance from API)
  }
}

/**
 * Create a sort dropdown UI element.
 * @param {Function} onSort - Callback when sort changes, receives sortKey
 * @returns {HTMLElement} The dropdown container
 */
export function createSortDropdown(onSort) {
  const container = document.createElement("div");
  container.style.cssText = "display:flex;align-items:center;gap:6px;";

  const label = document.createElement("span");
  label.style.cssText = "font-size:0.75rem;color:var(--text-tertiary);";
  label.innerHTML = '<i class="fa-solid fa-sort"></i> Sort:';
  container.appendChild(label);

  const select = document.createElement("select");
  select.style.cssText = "font-size:0.78rem;padding:4px 8px;background:var(--surface-2);border:1px solid var(--border-color);border-radius:6px;color:var(--text);cursor:pointer;";

  for (const opt of SORT_OPTIONS) {
    const option = document.createElement("option");
    option.value = opt.value;
    option.textContent = opt.label;
    select.appendChild(option);
  }

  select.addEventListener("change", () => {
    onSort(select.value);
  });

  container.appendChild(select);
  return container;
}

export { SORT_OPTIONS };
