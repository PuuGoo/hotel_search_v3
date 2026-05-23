(() => {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return;
  }

  // Skip on localhost - Vercel Analytics only works in production
  if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
    return;
  }

  // Initialize the queue if the Vercel Analytics helper is not present yet.
  if (!window.va) {
    window.va = function (...args) {
      (window.vaq = window.vaq || []).push(args);
    };
  }

  const scriptSrc = "/_vercel/insights/script.js";
  const existingScript = document.head.querySelector(
    `script[src="${scriptSrc}"]`
  );
  if (existingScript) {
    return;
  }

  const script = document.createElement("script");
  script.src = scriptSrc;
  script.defer = true;
  script.dataset.sdkn = "@vercel/analytics";
  script.dataset.sdkv = "manual";
  script.onerror = () => {
    console.warn(
      "[Vercel Analytics] Không thể tải script analytics. Hãy đảm bảo dự án đã bật Web Analytics."
    );
  };

  document.head.appendChild(script);
})();
