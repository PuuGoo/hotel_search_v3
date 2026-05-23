/**
 * Accessibility helpers for WCAG compliance.
 * Include this script on pages that need enhanced a11y support.
 */

// Focus trap for modals
export function trapFocus(element) {
  const focusable = element.querySelectorAll(
    'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
  );
  const first = focusable[0];
  const last = focusable[focusable.length - 1];

  function handleKeydown(e) {
    if (e.key !== "Tab") return;
    if (e.shiftKey) {
      if (document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  element.addEventListener("keydown", handleKeydown);
  first?.focus();

  return () => element.removeEventListener("keydown", handleKeydown);
}

// Announce message to screen readers via aria-live region
export function announce(message, priority = "polite") {
  let region = document.getElementById("sr-announcer");
  if (!region) {
    region = document.createElement("div");
    region.id = "sr-announcer";
    region.setAttribute("aria-live", priority);
    region.setAttribute("aria-atomic", "true");
    region.className = "visually-hidden";
    document.body.appendChild(region);
  }
  region.textContent = "";
  // Force re-announcement by clearing then setting
  requestAnimationFrame(() => {
    region.textContent = message;
  });
}

// Add ARIA attributes to common patterns
export function enhanceAccessibility() {
  // Add role="main" to main content if missing
  const main = document.querySelector("main");
  if (main && !main.getAttribute("role")) {
    main.setAttribute("role", "main");
  }

  // Add aria-label to nav if missing
  const navs = document.querySelectorAll("nav");
  navs.forEach((nav, i) => {
    if (!nav.getAttribute("aria-label")) {
      nav.setAttribute("aria-label", i === 0 ? "Main navigation" : `Navigation ${i + 1}`);
    }
  });

  // Add aria-label to icon-only buttons
  document.querySelectorAll("button").forEach((btn) => {
    const text = btn.textContent.trim();
    const hasLabel = btn.getAttribute("aria-label");
    const hasIcon = btn.querySelector("svg, img, .icon");
    if (!hasLabel && !text && hasIcon) {
      btn.setAttribute("aria-label", btn.title || "Button");
    }
  });

  // Add aria-current to active nav links
  document.querySelectorAll("nav a").forEach((link) => {
    if (link.classList.contains("active") || link.getAttribute("aria-current")) {
      link.setAttribute("aria-current", "page");
    }
  });

  // Make toast notifications accessible
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (node.classList?.contains("toast") || node.classList?.contains("Toastify")) {
          node.setAttribute("role", "status");
          node.setAttribute("aria-live", "polite");
        }
      });
    });
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

// Initialize on DOM ready
if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", enhanceAccessibility);
  } else {
    enhanceAccessibility();
  }
}
