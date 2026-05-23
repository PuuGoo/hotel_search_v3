/**
 * Password Strength UI Component
 * Shows a strength bar and requirement checklist next to a password input.
 */

const STRENGTH_LABELS = {
  none: "",
  "very-weak": "Rất yếu",
  weak: "Yếu",
  fair: "Trung bình",
  good: "Tốt",
  strong: "Mạnh",
  invalid: "Không hợp lệ",
};

const STRENGTH_COLORS = {
  none: "var(--border-color)",
  "very-weak": "#ef4444",
  weak: "#f97316",
  fair: "#eab308",
  good: "#22c55e",
  strong: "#10b981",
  invalid: "#ef4444",
};

const REQUIREMENTS = [
  { test: (p) => p.length >= 8, label: "At least 8 characters" },
  { test: (p) => /[A-Z]/.test(p), label: "One uppercase letter" },
  { test: (p) => /[a-z]/.test(p), label: "One lowercase letter" },
  { test: (p) => /\d/.test(p), label: "One digit" },
  { test: (p) => /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?`~]/.test(p), label: "One special character" },
];

/**
 * Create a password strength indicator next to a password input.
 * @param {HTMLInputElement} passwordInput - The password input element
 * @returns {{ update: () => void, destroy: () => void }}
 */
export function createPasswordStrengthIndicator(passwordInput) {
  const container = document.createElement("div");
  container.className = "password-strength-container";
  container.style.cssText = "margin-top:6px;";

  // Strength bar
  const barContainer = document.createElement("div");
  barContainer.style.cssText = "display:flex;gap:4px;margin-bottom:6px;";
  const bars = [];
  for (let i = 0; i < 5; i++) {
    const bar = document.createElement("div");
    bar.style.cssText = `height:4px;flex:1;border-radius:2px;background:var(--border-color);transition:background 0.2s;`;
    barContainer.appendChild(bar);
    bars.push(bar);
  }
  container.appendChild(barContainer);

  // Strength label
  const label = document.createElement("div");
  label.style.cssText = "font-size:0.75rem;color:var(--text-tertiary);margin-bottom:4px;";
  container.appendChild(label);

  // Requirements list
  const reqList = document.createElement("ul");
  reqList.style.cssText = "list-style:none;padding:0;margin:0;font-size:0.75rem;";
  const reqItems = REQUIREMENTS.map((req) => {
    const li = document.createElement("li");
    li.style.cssText = "display:flex;align-items:center;gap:6px;padding:1px 0;color:var(--text-tertiary);transition:color 0.2s;";
    const icon = document.createElement("span");
    icon.textContent = "○";
    icon.style.cssText = "font-size:0.7rem;";
    const text = document.createElement("span");
    text.textContent = req.label;
    li.appendChild(icon);
    li.appendChild(text);
    reqList.appendChild(li);
    return { li, icon, text, req };
  });
  container.appendChild(reqList);

  // Insert after the password input's parent
  const parent = passwordInput.closest(".input-group") || passwordInput.parentElement;
  parent.parentElement.insertBefore(container, parent.nextSibling);

  function update() {
    const password = passwordInput.value;
    if (!password) {
      bars.forEach((b) => (b.style.background = "var(--border-color)"));
      label.textContent = "";
      reqItems.forEach(({ li, icon }) => {
        icon.textContent = "○";
        li.style.color = "var(--text-tertiary)";
      });
      return;
    }

    // Check requirements
    let passed = 0;
    reqItems.forEach(({ li, icon, req }) => {
      if (req.test(password)) {
        icon.textContent = "●";
        li.style.color = "var(--color-success, #22c55e)";
        passed++;
      } else {
        icon.textContent = "○";
        li.style.color = "var(--text-tertiary)";
      }
    });

    // Update bars
    const score = passed;
    bars.forEach((b, i) => {
      b.style.background = i < score ? STRENGTH_COLORS[STRENGTH_LABELS[Object.keys(STRENGTH_LABELS)[score]] || "none"] || "var(--border-color)" : "var(--border-color)";
    });

    // Use specific colors per level
    const levels = ["very-weak", "weak", "fair", "good", "strong"];
    const currentLevel = levels[score] || "none";
    const color = STRENGTH_COLORS[currentLevel] || "var(--border-color)";
    bars.forEach((b, i) => {
      b.style.background = i < score ? color : "var(--border-color)";
    });

    label.textContent = STRENGTH_LABELS[currentLevel] || "";
    label.style.color = color;
  }

  passwordInput.addEventListener("input", update);

  return {
    update,
    destroy() {
      container.remove();
      passwordInput.removeEventListener("input", update);
    },
  };
}
