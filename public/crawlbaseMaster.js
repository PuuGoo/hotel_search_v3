/* global Toasts */
document.addEventListener("DOMContentLoaded", function () {
  const fileInput = document.getElementById("fileInput");
  const dropZone = document.getElementById("dropZone");
  const fileName = document.getElementById("fileName");
  const searchButton = document.getElementById("searchButton");
  const downloadCSVButton = document.getElementById("downloadCSVButton");
  const progressContainer = document.getElementById("progressContainer");
  const progressBar = document.getElementById("progressBar");
  const progressText = document.getElementById("progressText");
  const counter = document.getElementById("counter");
  const statusText = document.getElementById("statusText");
  const resultsSection = document.getElementById("resultsSection");
  const resultsBody = document.getElementById("resultsBody");
  const resultsCount = document.getElementById("resultsCount");
  const subscriptionKeyInput = document.getElementById("subscriptionKey");

  let isRunning = false;
  let allResults = [];

  // Drag & drop
  if (dropZone) {
    dropZone.addEventListener("click", () => fileInput.click());
    dropZone.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInput.click(); } });
    dropZone.addEventListener("dragover", (e) => { e.preventDefault(); dropZone.classList.add("drag-over"); });
    dropZone.addEventListener("dragleave", () => dropZone.classList.remove("drag-over"));
    dropZone.addEventListener("drop", (e) => {
      e.preventDefault();
      dropZone.classList.remove("drag-over");
      const f = e.dataTransfer.files[0];
      if (f) {
        fileInput.files = e.dataTransfer.files;
        fileName.textContent = f.name;
      }
    });
  }

  if (fileInput) {
    fileInput.addEventListener("change", () => {
      const f = fileInput.files && fileInput.files[0];
      fileName.textContent = f ? f.name : "Chưa chọn file";
    });
  }

  function setProgress(done, total) {
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    if (progressBar) progressBar.style.width = pct + "%";
    if (progressBar) progressBar.setAttribute("aria-valuenow", pct);
    if (progressText) progressText.textContent = pct + "%";
    if (counter) counter.textContent = `${done}/${total}`;
  }

  function appendResultRow(result) {
    if (!resultsBody) return;
    if (resultsSection && resultsSection.classList.contains("hidden")) {
      resultsSection.classList.remove("hidden");
    }
    const tr = document.createElement("tr");
    const linksHtml = (result.matchedLinks || []).map((url) => {
      if (!url || !/^https?:\/\//i.test(url)) return "";
      return `<a href="${url}" target="_blank" rel="noopener noreferrer" style="color:#21d4fd;word-break:break-all;font-size:0.72rem;display:block">${url.replace(/&/g,"&amp;").replace(/</g,"&lt;")}</a>`;
    }).join("") || "-";
    tr.innerHTML = `<td>${result.order}</td><td>${result.hotelNo || ""}</td><td>${(result.hotelName || "").replace(/</g,"&lt;")}</td><td style="font-size:0.78rem">${(result.hotelAddress || "").replace(/</g,"&lt;")}</td><td style="font-size:0.68rem">${linksHtml}</td>`;
    resultsBody.appendChild(tr);
    if (resultsCount) resultsCount.textContent = resultsBody.querySelectorAll("tr").length;
  }

  searchButton.addEventListener("click", async () => {
    if (isRunning) return;
    const subscriptionKey = subscriptionKeyInput.value.trim();
    if (!subscriptionKey) {
      if (typeof Toasts !== "undefined") Toasts.show("Vui lòng nhập Crawlbase API Key!", { type: "warning", title: "Thiếu API Key" });
      return;
    }
    if (!fileInput.files.length) {
      if (typeof Toasts !== "undefined") Toasts.show("Vui lòng chọn một file Excel!", { type: "warning", title: "Thiếu file" });
      return;
    }

    isRunning = true;
    searchButton.disabled = true;
    allResults = [];
    if (resultsBody) resultsBody.innerHTML = "";
    if (resultsSection) resultsSection.classList.add("hidden");
    if (downloadCSVButton) downloadCSVButton.classList.add("hidden");
    if (progressContainer) progressContainer.classList.remove("hidden");
    if (statusText) statusText.textContent = "Đang đọc file...";

    const file = fileInput.files[0];
    const reader = new FileReader();
    const corsProxy = window.CRAWLBASE_CORS_PROXY || "https://cors-anywhere-7jt3.onrender.com/";

    reader.onload = async (e) => {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: "array" });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      let jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1 });
      jsonData = jsonData.filter((row) =>
        row.some((cell) => cell !== undefined && cell !== null && cell !== "")
      );
      jsonData.shift();

      const total = jsonData.length;
      let done = 0;
      let order = 1;

      if (statusText) statusText.textContent = `Đang tìm kiếm 0/${total}...`;

      for (const row of jsonData) {
        const [hotelNo, hotelNameRaw, hotelAddress] = row;
        let hotelName = hotelNameRaw;
        if (!hotelName || !hotelAddress) {
          done++;
          setProgress(done, total);
          continue;
        }

        hotelName = hotelName.replace(/[^\x00-\x7F]/g, "");
        const query = `${hotelName} ${hotelAddress} on agoda page`;
        const searchURL = `${corsProxy}https://api.crawlbase.com/?token=${subscriptionKey}&url=https://www.google.com/search?q=${encodeURIComponent(query)}`;

        let matchedLink = [];
        try {
          const response = await fetch(searchURL, { method: "GET", headers: { Accept: "application/json" } });
          const text = await response.text();
          const parser = new DOMParser();
          const doc = parser.parseFromString(text, "text/html");
          const searchResults = doc.querySelectorAll("a");

          searchResults.forEach((result) => {
            const link = result.href;
            if (result.innerText.toLowerCase().includes(hotelName.toLowerCase())) {
              if (link.includes("?q=")) {
                const queryPart = link.split("?q=")[1];
                if (queryPart.includes("&")) {
                  const finalLink = queryPart.split("&")[0];
                  matchedLink.push(finalLink);
                }
              }
            }
          });
        } catch (error) {
          console.error("Error searching:", error);
        }

        matchedLink = matchedLink
          .filter((l) => l.includes("http") && !l.includes("tripadvisor"))
          .sort((a, b) => {
            if (a.includes("agoda") && !b.includes("agoda")) return -1;
            if (!a.includes("agoda") && b.includes("agoda")) return 1;
            return 0;
          });

        const result = { order: order++, hotelNo, hotelName, hotelAddress, matchedLinks: [...matchedLink] };
        allResults.push(result);
        appendResultRow(result);

        done++;
        setProgress(done, total);
        if (statusText) statusText.textContent = `Đang tìm kiếm ${done}/${total}...`;
      }

      if (statusText) statusText.textContent = `Hoàn thành! ${allResults.length} kết quả.`;
      if (allResults.length > 0) {
        downloadCSVButton.classList.remove("hidden");
        if (typeof Toasts !== "undefined") Toasts.show(`Tìm kiếm hoàn tất: ${allResults.length} kết quả`, { type: "success", title: "Hoàn thành" });
      } else {
        if (typeof Toasts !== "undefined") Toasts.show("Không tìm thấy kết quả nào khớp.", { type: "info", title: "Không có kết quả" });
      }

      isRunning = false;
      searchButton.disabled = false;
    };

    reader.readAsArrayBuffer(file);
  });

  if (downloadCSVButton) {
    downloadCSVButton.addEventListener("click", () => {
      if (!allResults.length) return;
      const maxLinks = Math.max(...allResults.map((r) => r.matchedLinks.length));
      const header = "Order,No,Hotel Name,Hotel Address," + Array.from({ length: maxLinks }, (_, i) => `Matched Link ${i + 1}`).join(",") + "\n";
      const csvContent = header + allResults.map((r) => {
        const links = r.matchedLinks.map((l) => `"${l}"`);
        while (links.length < maxLinks) links.push('""');
        return `"${r.order}","${r.hotelNo}","${r.hotelName}","${r.hotelAddress}",${links.join(",")}`;
      }).join("\n");
      const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = "crawlbase_hotel_search_results.csv";
      link.click();
      URL.revokeObjectURL(link.href);
      if (typeof Toasts !== "undefined") Toasts.show("Đã tải file CSV", { type: "success", title: "Tải xuống" });
    });
  }
});
