import { describe, test, expect, beforeEach } from "@jest/globals";

// i18n translations for testing
const translations = {
  vi: {
    "nav.dashboard": "Dashboard",
    "action.search": "Tìm kiếm",
    "search.placeholder": "Nhập tên khách sạn...",
    "msg.success": "Thành công",
  },
  en: {
    "nav.dashboard": "Dashboard",
    "action.search": "Search",
    "search.placeholder": "Enter hotel name...",
    "msg.success": "Success",
  },
};

function createI18n() {
  let lang = "vi";
  function t(key, fallback) {
    const dict = translations[lang] || translations.vi;
    return dict[key] || fallback || key;
  }
  function setLanguage(newLang) {
    if (translations[newLang]) lang = newLang;
  }
  function getLanguage() { return lang; }
  return { t, setLanguage, getLanguage };
}

describe("i18n", () => {
  let i18n;

  beforeEach(() => {
    i18n = createI18n();
  });

  test("defaults to Vietnamese", () => {
    expect(i18n.getLanguage()).toBe("vi");
  });

  test("t() returns Vietnamese translation", () => {
    expect(i18n.t("action.search")).toBe("Tìm kiếm");
    expect(i18n.t("msg.success")).toBe("Thành công");
  });

  test("t() returns English after switching language", () => {
    i18n.setLanguage("en");
    expect(i18n.t("action.search")).toBe("Search");
    expect(i18n.t("msg.success")).toBe("Success");
  });

  test("t() returns fallback for missing key", () => {
    expect(i18n.t("missing.key", "Default")).toBe("Default");
  });

  test("t() returns key itself when no translation or fallback", () => {
    expect(i18n.t("missing.key")).toBe("missing.key");
  });

  test("setLanguage ignores invalid language", () => {
    i18n.setLanguage("fr");
    expect(i18n.getLanguage()).toBe("vi");
  });

  test("setLanguage switches between vi and en", () => {
    i18n.setLanguage("en");
    expect(i18n.getLanguage()).toBe("en");
    i18n.setLanguage("vi");
    expect(i18n.getLanguage()).toBe("vi");
  });

  test("translations exist for both languages", () => {
    const viKeys = Object.keys(translations.vi);
    const enKeys = Object.keys(translations.en);
    expect(viKeys).toEqual(expect.arrayContaining(enKeys));
    expect(enKeys).toEqual(expect.arrayContaining(viKeys));
  });

  test("all translation values are non-empty strings", () => {
    for (const [lang, dict] of Object.entries(translations)) {
      for (const [key, value] of Object.entries(dict)) {
        expect(typeof value).toBe("string");
        expect(value.length).toBeGreaterThan(0);
      }
    }
  });
});
