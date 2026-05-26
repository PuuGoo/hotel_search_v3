/**
 * Hotel URL Finder — đọc Excel client-side, gọi /searchApiHotelFinder cho từng row.
 * Pattern giống hệt DDG: stop/resume/session save/download CSV/JSON/XLSX.
 */

document.addEventListener("DOMContentLoaded", () => {
  const fileInput = document.getElementById("hotelFinderFileInput");
  const pickBtn = document.getElementById("hotelFinderPickFile");
  const fileNameEl = document.getElementById("hotelFinderFileName");
  const runBtn = document.getElementById("hotelFinderRunButton");
  const stopBtn = document.getElementById("hotelFinderStopButton");
  const stopAllBtn = document.getElementById("hotelFinderStopAllButton");
  const resumeBtn = document.getElementById("hotelFinderResumeButton");
  const downloadCSVBtn = document.getElementById("hotelFinderDownloadButton");
  const downloadJSONBtn = document.getElementById("hotelFinderDownloadJSONButton");
  const downloadXLSXBtn = document.getElementById("hotelFinderDownloadXLSXButton");
  const statusEl = document.getElementById("hotelFinderStatus");
  const counterEl = document.getElementById("hotelFinderCounter");
  const progressContainer = document.getElementById("hotelFinderProgressContainer");
  const progressBar = document.getElementById("hotelFinderProgressBar");
  const progressText = document.getElementById("hotelFinderProgressText");
  const resultsSection = document.getElementById("hotelFinderResultsSection");
  const resultsBody = document.getElementById("hotelFinderResultsBody");
  const resultsCount = document.getElementById("hotelFinderResultsCount");
  const visibleCount = document.getElementById("hotelFinderVisibleCount");
  const filterInput = document.getElementById("hotelFinderFilterInput");
  const tabBtn = document.getElementById("hotelFinderTabButton");

  if (!fileInput || !runBtn) return;

  // State
  let stopped = false;
  let stoppedCompletely = false;
  let abortController = null;
  let results = [];
  let allRows = [];
  let nextIndex = 0;
  let resultsRowCount = 0;

  const SESSION_KEY = "hotel_finder_session";

  // ---- File pick ----
  pickBtn.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => {
    const f = fileInput.files && fileInput.files[0];
    if (fileNameEl) fileNameEl.textContent = f ? f.name : "Chưa chọn file";
    if (f) setStatus("Đã chọn file, sẵn sàng tìm kiếm");
  });

  // ---- Status helpers ----
  function setStatus(text, kind = "normal") {
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.style.color = kind === "error" ? "#ff9c9c" : kind === "success" ? "#9df3c4" : "";
  }

  function setProgress(done, total) {
    if (!counterEl) return;
    counterEl.textContent = `${done}/${total}`;
    if (!progressContainer || !progressBar || !progressText) return;
    progressContainer.classList.remove("hidden");
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    progressBar.style.width = pct + "%";
    progressBar.setAttribute("aria-valuenow", pct);
    progressText.textContent = pct + "%";
  }

  // ---- Session save/restore ----
  function saveSession(stoppedCompletelyFlag = false) {
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify({
        allRows,
        results,
        nextIndex,
        stoppedCompletely: stoppedCompletelyFlag,
        ts: Date.now(),
      }));
    } catch {}
  }

  function clearSession() {
    try { localStorage.removeItem(SESSION_KEY); } catch {}
  }

  // ---- Buttons ----
  stopBtn.addEventListener("click", () => {
    stopped = true;
    if (abortController) abortController.abort();
    setStatus("Đã dừng", "error");
    stopBtn.classList.add("hidden");
    stopAllBtn.classList.add("hidden");
    showDownloadButtons();
  });

  stopAllBtn.addEventListener("click", () => {
    stopped = true;
    stoppedCompletely = true;
    if (abortController) abortController.abort();
    saveSession(true);
    setStatus("Đã dừng hẳn", "error");
    runBtn.disabled = false;
    stopBtn.classList.add("hidden");
    stopAllBtn.classList.add("hidden");
    resumeBtn.classList.add("hidden");
    showDownloadButtons();
  });

  resumeBtn.addEventListener("click", () => {
    resumeBtn.classList.add("hidden");
    runHotelFinder(nextIndex);
  });

  downloadCSVBtn.addEventListener("click", downloadCSV);
  downloadJSONBtn.addEventListener("click", downloadJSON);
  downloadXLSXBtn.addEventListener("click", downloadXLSX);

  function showDownloadButtons() {
    if (downloadCSVBtn) downloadCSVBtn.classList.remove("hidden");
    if (downloadJSONBtn) downloadJSONBtn.classList.remove("hidden");
    if (downloadXLSXBtn) downloadXLSXBtn.classList.remove("hidden");
  }

  function hideDownloadButtons() {
    if (downloadCSVBtn) downloadCSVBtn.classList.add("hidden");
    if (downloadJSONBtn) downloadJSONBtn.classList.add("hidden");
    if (downloadXLSXBtn) downloadXLSXBtn.classList.add("hidden");
  }

  // ---- Append result row ----
  function appendResultRow(result) {
    if (!resultsBody) return;
    if (resultsRowCount === 0) {
      if (resultsSection) resultsSection.classList.remove("hidden");
      const tab = document.querySelector('[data-target="panel-results-hotelfinder"]');
      if (tab) tab.click();
    }
    resultsRowCount++;
    if (resultsCount) resultsCount.textContent = resultsRowCount;

    const tr = document.createElement("tr");
    tr.dataset.name = (result.hotelName || "").toLowerCase();
    tr.dataset.address = (result.hotelAddress || "").toLowerCase();
    tr.dataset.pct = String(result.score || 0);

    const statusColors = { "Tìm thấy": "#3ba55d", "Không tìm thấy": "#ff4d4f", "Lỗi": "#ff4d4f", "Thiếu dữ liệu": "#666" };
    const statusColor = statusColors[result.status] || "#999";

    let urlHtml = "";
    if (result.url) {
      const esc = escapeHtml(result.url);
      urlHtml = `<a href="${esc}" target="_blank" rel="noopener" style="color:var(--color-accent,#1a73e8);text-decoration:none;max-width:280px;display:inline-block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc}">${esc}</a>`;
    }

    tr.innerHTML = `
      <td>${result.order}</td>
      <td title="${escapeHtml(result.hotelName)}">${escapeHtml(result.hotelName)}</td>
      <td title="${escapeHtml(result.hotelAddress)}">${escapeHtml(result.hotelAddress)}</td>
      <td>${urlHtml}</td>
      <td>${result.score || 0}%</td>
      <td>${result.imgCount || 0}</td>
      <td><span style="color:${statusColor};font-size:.72rem">${result.status}</span></td>
    `;

    resultsBody.appendChild(tr);
    applyFilter();
  }

  // ---- Filter ----
  function applyFilter() {
    const q = filterInput ? filterInput.value.toLowerCase().trim() : "";
    const rows = resultsBody ? Array.from(resultsBody.querySelectorAll("tr")) : [];
    let visible = 0;
    rows.forEach((tr) => {
      const name = tr.dataset.name || "";
      const addr = tr.dataset.address || "";
      const match = !q || name.includes(q) || addr.includes(q);
      tr.style.display = match ? "" : "none";
      if (match) visible++;
    });
    if (visibleCount) visibleCount.textContent = String(visible);
    if (resultsCount) resultsCount.textContent = String(resultsRowCount);
  }

  if (filterInput) {
    filterInput.addEventListener("input", applyFilter);
  }

  // ---- Main run function ----
  async function runHotelFinder(startIndex) {
    stopped = false;
    stoppedCompletely = false;
    abortController = new AbortController();
    runBtn.disabled = true;
    resumeBtn.classList.add("hidden");
    stopBtn.classList.remove("hidden");
    stopAllBtn.classList.remove("hidden");
    hideDownloadButtons();
    setStatus("Đang tìm kiếm...");

    const rows = allRows;
    let order = results.length + 1;

    for (let i = startIndex; i < rows.length; i++) {
      if (stopped) {
        nextIndex = i;
        break;
      }

      const hotelName = rows[i].name || "";
      const hotelAddress = rows[i].address || "";

      if (!hotelName) {
        setProgress(i + 1, rows.length);
        nextIndex = i + 1;
        continue;
      }

      const searchURL = `/searchApiHotelFinder?hotel_name=${encodeURIComponent(hotelName)}&hotel_address=${encodeURIComponent(hotelAddress)}`;

      let result = {
        order: order++,
        hotelNo: rows[i].no || "",
        hotelName,
        hotelAddress,
        url: "",
        score: 0,
        imgCount: 0,
        status: "Không tìm thấy",
      };

      try {
        await new Promise((r) => setTimeout(r, 1000));
        if (stopped) { nextIndex = i; break; }

        const response = await axios.get(searchURL, { signal: abortController.signal });
        if (stopped) { nextIndex = i; break; }

        const data = response.data;
        if (data.url) {
          result.url = data.url;
          result.score = data.score || 0;
          result.imgCount = data.image_count || 0;
          result.status = data.status === "matched" ? "Tìm thấy" : "Không tìm thấy";
        }
      } catch (e) {
        if (stopped) { nextIndex = i; break; }
        console.log("Hotel Finder error:", e);
        result.status = "Lỗi";
      }

      results.push(result);
      appendResultRow(result);

      nextIndex = i + 1;
      saveSession();
      setProgress(i + 1, rows.length);
    }

    runBtn.disabled = false;
    stopBtn.classList.add("hidden");
    stopAllBtn.classList.add("hidden");
    showDownloadButtons();

    if (stopped) {
      if (!stoppedCompletely) {
        saveSession();
        if (nextIndex < rows.length) {
          resumeBtn.classList.remove("hidden");
        }
      }
    } else {
      setStatus("Hoàn thành!", "success");
      nextIndex = rows.length;
      clearSession();
    }
  }

  // ---- Run button ----
  runBtn.addEventListener("click", async () => {
    const file = fileInput?.files?.[0];
    if (!file) {
      setStatus("Vui lòng chọn file Excel", "error");
      return;
    }

    // Đọc Excel client-side
    const buffer = await file.arrayBuffer();
    const wb = XLSX.read(new Uint8Array(buffer), { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    let rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
    rows = rows.filter((r) => r.some((c) => c !== undefined && c !== null && c !== ""));

    // Tìm header row
    const headerRow = rows[0] || [];
    const nameIdx = headerRow.findIndex((h) => /child.*hotel.*name/i.test(String(h || "")));
    const addrIdx = headerRow.findIndex((h) => /child.*hotel.*address/i.test(String(h || "")));

    if (nameIdx === -1) {
      setStatus("File thiếu cột child_hotel_name", "error");
      return;
    }

    // Parse rows
    const dataRows = rows.slice(1).map((r, i) => ({
      no: r[0] || i + 1,
      name: String(r[nameIdx] || "").trim(),
      address: addrIdx >= 0 ? String(r[addrIdx] || "").trim() : "",
    })).filter((r) => r.name);

    if (!dataRows.length) {
      setStatus("File không có dữ liệu", "error");
      return;
    }

    // Reset
    allRows = dataRows;
    results = [];
    nextIndex = 0;
    resultsRowCount = 0;
    if (resultsBody) resultsBody.innerHTML = "";
    if (resultsSection) resultsSection.classList.add("hidden");
    if (resultsCount) resultsCount.textContent = "0";
    clearSession();
    setProgress(0, dataRows.length);

    await runHotelFinder(0);
  });

  // ---- Download functions ----
  function downloadCSV() {
    if (!results.length) return;
    const header = ["Order", "Hotel Name", "Address", "URL", "Score", "Image Count", "Status"];
    const csv = [header.join(",")];
    results.forEach((r) => {
      csv.push([r.order, `"${(r.hotelName || "").replace(/"/g, '""')}"`, `"${(r.hotelAddress || "").replace(/"/g, '""')}"`, r.url || "", r.score || 0, r.imgCount || 0, r.status].join(","));
    });
    const blob = new Blob(["﻿" + csv.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "hotel_finder_results.csv";
    a.click();
  }

  function downloadJSON() {
    if (!results.length) return;
    const data = results.map((r) => ({
      order: r.order, hotelName: r.hotelName, hotelAddress: r.hotelAddress,
      url: r.url, score: r.score, imageCount: r.imgCount, status: r.status,
    }));
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "hotel_finder_results.json";
    a.click();
  }

  function downloadXLSX() {
    if (!results.length) return;
    const data = results.map((r) => ({
      Order: r.order, "Hotel Name": r.hotelName, Address: r.hotelAddress,
      URL: r.url, "Score (%)": r.score, "Image Count": r.imgCount, Status: r.status,
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Results");
    const matched = results.filter((r) => r.status === "Tìm thấy").length;
    const summary = XLSX.utils.aoa_to_sheet([
      ["Hotel URL Finder Results Summary"],
      [], ["Total Hotels", results.length], ["Matched", matched],
      ["Not Matched", results.length - matched],
      ["Match Rate", results.length ? `${((matched / results.length) * 100).toFixed(1)}%` : "N/A"],
    ]);
    XLSX.utils.book_append_sheet(wb, summary, "Summary");
    XLSX.writeFile(wb, "hotel_finder_results.xlsx");
  }

  // ---- Restore session on page load ----
  try {
    const saved = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
    if (saved && Array.isArray(saved.allRows) && saved.allRows.length > 0) {
      allRows = saved.allRows;
      results = saved.results || [];
      nextIndex = typeof saved.nextIndex === "number" ? saved.nextIndex : results.length;

      if (results.length > 0) {
        if (resultsSection) resultsSection.classList.remove("hidden");
        results.forEach((r) => {
          resultsRowCount++;
          if (resultsCount) resultsCount.textContent = resultsRowCount;
          appendResultRow(r);
        });
        showDownloadButtons();
      }

      if (saved.stoppedCompletely) {
        setStatus(`Đã dừng hẳn (${results.length}/${allRows.length})`, "error");
      } else if (nextIndex < allRows.length) {
        setStatus(`Tạm dừng (${results.length}/${allRows.length}). Nhấn "Tiếp tục" để chạy tiếp.`);
        resumeBtn.classList.remove("hidden");
      } else {
        setStatus("Hoàn thành!", "success");
        clearSession();
      }
      setProgress(results.length, allRows.length);
    }
  } catch {}

  // ---- Helper ----
  function escapeHtml(text) {
    if (!text) return "";
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }
});
