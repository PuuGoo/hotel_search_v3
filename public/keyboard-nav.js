/**
 * Keyboard navigation helpers.
 * Provides arrow key navigation for tabs, menus, and lists.
 */

// Arrow key navigation for tab lists
export function initTabNavigation(tabContainer) {
  const tabs = tabContainer.querySelectorAll('[role="tab"], button');
  if (tabs.length === 0) return;

  tabContainer.addEventListener("keydown", (e) => {
    const current = document.activeElement;
    const idx = Array.from(tabs).indexOf(current);
    if (idx === -1) return;

    let next;
    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
        e.preventDefault();
        next = tabs[(idx + 1) % tabs.length];
        break;
      case "ArrowLeft":
      case "ArrowUp":
        e.preventDefault();
        next = tabs[(idx - 1 + tabs.length) % tabs.length];
        break;
      case "Home":
        e.preventDefault();
        next = tabs[0];
        break;
      case "End":
        e.preventDefault();
        next = tabs[tabs.length - 1];
        break;
      default:
        return;
    }

    next.focus();
    if (next.tagName === "BUTTON") next.click();
  });
}

// Arrow key navigation for list items
export function initListNavigation(listContainer, itemSelector = "li, .list-item") {
  listContainer.setAttribute("role", "listbox");

  listContainer.addEventListener("keydown", (e) => {
    const items = listContainer.querySelectorAll(itemSelector);
    const current = document.activeElement;
    const idx = Array.from(items).indexOf(current);
    if (idx === -1) return;

    let next;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        next = items[Math.min(idx + 1, items.length - 1)];
        break;
      case "ArrowUp":
        e.preventDefault();
        next = items[Math.max(idx - 1, 0)];
        break;
      case "Home":
        e.preventDefault();
        next = items[0];
        break;
      case "End":
        e.preventDefault();
        next = items[items.length - 1];
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        current.click();
        return;
      default:
        return;
    }

    next?.focus();
  });
}

// Escape key to close modals/dropdowns
export function initEscapeKey() {
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      // Close active modal
      const modal = document.querySelector(".modal.active, .modal[style*='display: flex']");
      if (modal) {
        modal.classList.remove("active");
        modal.style.display = "none";
        return;
      }

      // Close active dropdown
      const dropdown = document.querySelector(".dropdown.open, .dropdown-menu.show");
      if (dropdown) {
        dropdown.classList.remove("open", "show");
      }
    }
  });
}

// Ctrl+K to focus search
export function initSearchShortcut(inputSelector = 'input[type="search"], #searchInput, #query') {
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "k") {
      e.preventDefault();
      const input = document.querySelector(inputSelector);
      if (input) {
        input.focus();
        input.select();
      }
    }
  });
}

// Initialize all keyboard navigation
export function initKeyboardNav() {
  initEscapeKey();
  initSearchShortcut();

  // Auto-init tab navigation on containers with role="tablist"
  document.querySelectorAll('[role="tablist"], .tabs, .tab-bar').forEach(initTabNavigation);

  // Auto-init list navigation on containers with role="listbox"
  document.querySelectorAll('[role="listbox"], .keyboard-list').forEach(initListNavigation);
}

// Auto-initialize on DOM ready
if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initKeyboardNav);
  } else {
    initKeyboardNav();
  }
}
