// i18n - Internationalization module
const translations = {
  vi: {
    // Navigation
    "nav.dashboard": "Dashboard",
    "nav.bookmarks": "Bookmarks",
    "nav.profile": "Hồ sơ",
    "nav.logout": "Đăng xuất",
    "nav.templates": "Mẫu tìm kiếm",
    "nav.alerts": "Cảnh báo giá",
    "nav.compare": "So sánh",
    "nav.notifications": "Thông báo",
    "nav.admin": "Quản trị",

    // Common actions
    "action.search": "Tìm kiếm",
    "action.save": "Lưu",
    "action.cancel": "Hủy",
    "action.delete": "Xóa",
    "action.edit": "Sửa",
    "action.create": "Tạo",
    "action.export": "Xuất",
    "action.import": "Nhập",
    "action.clear": "Xóa",
    "action.close": "Đóng",
    "action.back": "Quay lại",
    "action.next": "Tiếp",
    "action.prev": "Trước",
    "action.download": "Tải",
    "action.upload": "Tải lên",
    "action.start": "Bắt đầu",
    "action.stop": "Dừng",
    "action.pause": "Tạm dừng",
    "action.resume": "Tiếp tục",

    // Search
    "search.placeholder": "Nhập tên khách sạn, địa chỉ...",
    "search.results": "Kết quả",
    "search.noResults": "Không có kết quả",
    "search.filter": "Lọc",
    "search.total": "Tổng",
    "search.status": "Trạng thái",
    "search.engine": "Engine",

    // Messages
    "msg.success": "Thành công",
    "msg.error": "Lỗi",
    "msg.loading": "Đang tải...",
    "msg.confirm": "Xác nhận",
    "msg.noData": "Không có dữ liệu",
    "msg.saved": "Đã lưu",
    "msg.deleted": "Đã xóa",
    "msg.updated": "Đã cập nhật",

    // Auth
    "auth.login": "Đăng nhập",
    "auth.username": "Tên đăng nhập",
    "auth.password": "Mật khẩu",
    "auth.loginSuccess": "Đăng nhập thành công",

    // Time
    "time.now": "Bây giờ",
    "time.today": "Hôm nay",
    "time.yesterday": "Hôm qua",
  },
  en: {
    // Navigation
    "nav.dashboard": "Dashboard",
    "nav.bookmarks": "Bookmarks",
    "nav.profile": "Profile",
    "nav.logout": "Logout",
    "nav.templates": "Search Templates",
    "nav.alerts": "Price Alerts",
    "nav.compare": "Compare",
    "nav.notifications": "Notifications",
    "nav.admin": "Admin",

    // Common actions
    "action.search": "Search",
    "action.save": "Save",
    "action.cancel": "Cancel",
    "action.delete": "Delete",
    "action.edit": "Edit",
    "action.create": "Create",
    "action.export": "Export",
    "action.import": "Import",
    "action.clear": "Clear",
    "action.close": "Close",
    "action.back": "Back",
    "action.next": "Next",
    "action.prev": "Previous",
    "action.download": "Download",
    "action.upload": "Upload",
    "action.start": "Start",
    "action.stop": "Stop",
    "action.pause": "Pause",
    "action.resume": "Resume",

    // Search
    "search.placeholder": "Enter hotel name, address...",
    "search.results": "Results",
    "search.noResults": "No results",
    "search.filter": "Filter",
    "search.total": "Total",
    "search.status": "Status",
    "search.engine": "Engine",

    // Messages
    "msg.success": "Success",
    "msg.error": "Error",
    "msg.loading": "Loading...",
    "msg.confirm": "Confirm",
    "msg.noData": "No data",
    "msg.saved": "Saved",
    "msg.deleted": "Deleted",
    "msg.updated": "Updated",

    // Auth
    "auth.login": "Login",
    "auth.username": "Username",
    "auth.password": "Password",
    "auth.loginSuccess": "Login successful",

    // Time
    "time.now": "Now",
    "time.today": "Today",
    "time.yesterday": "Yesterday",
  },
};

const I18N_KEY = "app_language";
let currentLang = localStorage.getItem(I18N_KEY) || "vi";

function t(key, fallback) {
  const dict = translations[currentLang] || translations.vi;
  return dict[key] || fallback || key;
}

function setLanguage(lang) {
  if (translations[lang]) {
    currentLang = lang;
    localStorage.setItem(I18N_KEY, lang);
    applyTranslations();
    document.documentElement.setAttribute("lang", lang);
  }
}

function getLanguage() {
  return currentLang;
}

function applyTranslations() {
  // Apply translations to elements with data-i18n attribute
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.dataset.i18n;
    const translated = t(key);
    if (el.tagName === "INPUT" && el.type !== "submit") {
      el.placeholder = translated;
    } else {
      el.textContent = translated;
    }
  });

  // Apply to elements with data-i18n-title
  document.querySelectorAll("[data-i18n-title]").forEach((el) => {
    el.title = t(el.dataset.i18nTitle);
  });
}

// Initialize
function initI18n() {
  document.documentElement.setAttribute("lang", currentLang);
  applyTranslations();
}

// Export for use
window.I18n = { t, setLanguage, getLanguage, applyTranslations, initI18n };
export { t, setLanguage, getLanguage, applyTranslations, initI18n };
