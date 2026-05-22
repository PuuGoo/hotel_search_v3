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
      const endpoint = "/api/search";

      if (statusText) statusText.textContent = `Đang tìm kiếm 0/${total}...`;

      for (const row of jsonData) {
        const [hotelNo, hotelNameRaw, hotelAddress, hotelUrlType] = row;
        let hotelName = hotelNameRaw;
        if (!hotelName || !hotelAddress) {
          done++;
          setProgress(done, total);
          continue;
        }

        hotelName = hotelName.replace(/[^\x00-\x7F]/g, "");
        const hotelNameArray = hotelName.split(" ").map((p) => p.replace(",", "").replace("(", "").replace(")", "").toLowerCase());
        const query = hotelUrlType === "CTrip SuperAgg" ? `${hotelName} ${hotelAddress} trip` : `${hotelName} ${hotelAddress}`;
        const searchURL = `${endpoint}?q=${encodeURIComponent(query)}&format=json&hl=en-US&lr=lang_en&cr=&ie=utf8&oe=utf8&filter=0&start=0&asearch=arc&async=arc_id%3Asrp_-JOX0lWm09eUzwILiJukthn_100%2Cuse_ac%3Atrue%2C_fmt%3Aprog`;

        let matchedLink = [];

        try {
          const response = await fetch(searchURL, { method: "GET", headers: { "Content-Type": "application/json" } });
          const data = await response.json();
          const resultsFromXNG = data.results;

          if (resultsFromXNG && resultsFromXNG.length > 0) {
            let resultsArray = [];
            for (const result of resultsFromXNG) {
              const pageTitle = result.title.toLowerCase();
              const pageUrl = result.url;
              const match = isHotelNameInPage(hotelNameArray, pageTitle);
              if (match.status && pageUrl.includes(".com")) {
                resultsArray.push({ percentage: match.percentage, matchedLink: pageUrl });
              }
            }

            const maxPct = resultsArray.reduce((max, item) => item.percentage > max.percentage ? item : max, { percentage: -Infinity });

            resultsArray = resultsArray
              .filter((r) => r.percentage === maxPct.percentage && !r.matchedLink.includes("tripadvisor") && !r.matchedLink.includes("makemytrip"))
              .sort((a, b) => getPriority(a.matchedLink) - getPriority(b.matchedLink));

            matchedLink = resultsArray.map((r) => r.matchedLink);
          }
        } catch (error) {
          console.error("Search error:", error);
        }

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
      link.download = "xng_hotel_search_results.csv";
      link.click();
      URL.revokeObjectURL(link.href);
      if (typeof Toasts !== "undefined") Toasts.show("Đã tải file CSV", { type: "success", title: "Tải xuống" });
    });
  }
});

function isHotelNameInPage(hotelNameArray, pageTitle) {
  let matchCount = 0;
  for (const part of hotelNameArray) {
    if (pageTitle.includes(part)) matchCount++;
  }
  return { status: true, percentage: (matchCount / hotelNameArray.length) * 100 };
}

function getPriority(link) {
  if (link.includes("agoda")) return 2;
  if (link.includes("booking")) return 3;
  if (link.includes("trip")) return 1;
  if (link.includes("hotels")) return 4;
  if (link.includes("hotel")) return 5;
  if (link.includes("trivago")) return 6;
  if (link.includes("expedia")) return 7;
  return 18;
}
