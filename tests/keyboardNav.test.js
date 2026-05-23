import { describe, test, expect } from "@jest/globals";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, "..", "public");

describe("Keyboard Navigation", () => {
  const src = fs.readFileSync(path.join(publicDir, "keyboard-nav.js"), "utf8");

  test("exports initTabNavigation function", () => {
    expect(src).toContain("export function initTabNavigation");
    expect(src).toContain("ArrowRight");
    expect(src).toContain("ArrowLeft");
  });

  test("exports initListNavigation function", () => {
    expect(src).toContain("export function initListNavigation");
    expect(src).toContain("ArrowDown");
    expect(src).toContain("ArrowUp");
  });

  test("exports initEscapeKey function", () => {
    expect(src).toContain("export function initEscapeKey");
    expect(src).toContain('e.key === "Escape"');
  });

  test("exports initSearchShortcut function", () => {
    expect(src).toContain("export function initSearchShortcut");
    expect(src).toContain("ctrlKey");
    expect(src).toContain('"k"');
  });

  test("exports initKeyboardNav function", () => {
    expect(src).toContain("export function initKeyboardNav");
  });

  test("tab navigation supports Home and End keys", () => {
    expect(src).toContain('"Home"');
    expect(src).toContain('"End"');
  });

  test("list navigation supports Enter and Space keys", () => {
    expect(src).toContain('"Enter"');
    expect(src).toContain('" "');
  });

  test("auto-initializes on DOMContentLoaded", () => {
    expect(src).toContain("DOMContentLoaded");
    expect(src).toContain("initKeyboardNav");
  });

  test("escape key closes modals", () => {
    expect(src).toContain(".modal.active");
  });

  test("escape key closes dropdowns", () => {
    expect(src).toContain(".dropdown.open");
  });

  test("search shortcut selects input text", () => {
    expect(src).toContain("input.select()");
  });

  test("tab navigation wraps around", () => {
    expect(src).toContain("(idx + 1) % tabs.length");
    expect(src).toContain("(idx - 1 + tabs.length) % tabs.length");
  });

  test("list navigation sets role=listbox", () => {
    expect(src).toContain('setAttribute("role", "listbox")');
  });

  test("auto-inits on containers with role=tablist", () => {
    expect(src).toContain('[role="tablist"]');
  });
});
