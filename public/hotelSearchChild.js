/* global Toasts */
// Đảm bảo rằng script chỉ chạy khi DOM đã tải xong
document.addEventListener("DOMContentLoaded", function () {
  // Phần Javascript thao tác trên trình duyệt (client-side)
  document
    .getElementById("searchButton")
    .addEventListener("click", async () => {
      // Kiểm tra người dùng có chọn file Excel hay không
      const fileInput = document.getElementById("fileInput");
      if (fileInput.files.length === 0) {
        if (typeof Toasts !== "undefined") Toasts.show("Vui lòng chọn một file Excel!", { type: "warning", title: "Thiếu file" });
        return;
      }

      // Đọc dữ liệu từ file Excel
      const file = fileInput.files[0];
      const reader = new FileReader(); // Tạo một FileReader để đọc nội dung file Excel.

      // Cài đặt một số thông số từ BING SEARCH
      const subscriptionKey = document.getElementById("subscriptionKey").value;

      const endpoint = "https://api.bing.microsoft.com/v7.0/search";

      // Sau khi đọc file Excel hoàn tất ta dùng sự kiện onload xử lý dữ liệu data.
      reader.onload = async (e) => {
        const data = new Uint8Array(e.target.result); // Chuyển dữ liệu file thành mãng nhị phân(Unit8Array).
        const workbook = XLSX.read(data, { type: "array" }); // Đọc toàn bộ file Excel
        const sheetName = workbook.SheetNames[0]; // Lấy tên của sheet đầu tiên trong file Excel
        const sheet = workbook.Sheets[sheetName]; // Đọc dữ liệu của sheet đầu tiên trong file Excel
        let jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1 }); // Theo mặc định sheet_to_json sẽ lấy dòng đầu tiên và sự dụng giá trị như key cho tất cả các dòng còn lại giống mãng kết hợp. Nếu lựa chọn thuộc tính {header: 1} thì nó sẽ xuất thành một mãng các giá trị theo từng dòng file Excel.
        jsonData = jsonData.filter((row) =>
          row.some((cell) => cell !== undefined && cell !== null && cell !== "")
        );
        jsonData.shift(); // Bỏ dòng tiêu đề tức dòng đầu tiên
        console.log(jsonData.length);

        const excludedDomains = [
          "agoda",
          "booking",
          "trivago",
          "expedia",
          "zenhotels",
          "skyscanner",
          "airpaz",
          "readytotrip",
          "lodging-world",
          "yatra",
          "rentbyowner",
          "goibibo",
          "laterooms",
          "tiket",
        ];

        const results = []; // Tạo một mãng lưu trữ kết quả tìm kiếm được
        let order = 1; // Biến lưu số thứ tự khách sạn từ file
        let currentIndex = 0;
        // Duyệt qua từng dòng trong file Excel
        for (const row of jsonData) {
          const [hotelNo, hotelNameRaw, hotelCountry, hotelCity, hotelUrlType] = row;
          let hotelName = hotelNameRaw;
          if (!hotelName || !hotelCountry || !hotelCity) continue;

          hotelName = hotelName.replace(/[^\x00-\x7F]/g, "");
          const hotelNameArray = hotelName
            .split(" ")
            .map((part) => part.replace(/[(),]/g, "").toLowerCase());

          let query = `${hotelName} ${hotelCountry} ${hotelCity}`;
          let requireTripDomainOnly = false;

          if (
            hotelUrlType &&
            hotelUrlType.trim().toLowerCase() === "ctrip superagg"
          ) {
            query += " trip";
            requireTripDomainOnly = true;
          }

          // const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(
          //   query
          // )}`; //encodeURIComponent mã hóa 1 chuỗi nhằm đảm bảo chuỗi được truyền an toàn qua URL, và mã hóa toàn bộ ký tự đặc biệt &, ?, =, /, :&, ?, =, /, :, bên cạnh đó encodeURI thì không mã hóa các ký tự đặc biệt &, ?, =, /, :
          const searchURL = `${endpoint}?q=${encodeURIComponent(
            query
          )}&textDecorations=true&textFormat=HTML`;

          let matchedLink = []; // Giá trị mặc định khi không tìm thấy link

          // Thực hiện tìm kiếm qua Algolia
          try {
            const response = await axios.get(searchURL, {
              headers: {
                "Ocp-Apim-Subscription-Key": subscriptionKey, // Thêm API Key vào header, và Ocp-Apim-Subscription-Key: là tham số khóa cố định không đổi tên được
              },
            });
            // console.log(response);

            // Lấy kết quả từ Bing API
            const resultsFromBing = response.data.webPages.value;

            if (resultsFromBing && resultsFromBing.length > 0) {
              const resultsFromBingArray = [];
              let _officialSite = null;
              // Lặp qua các kết quả tìm kiếm từ Bing
              for (const result of resultsFromBing) {
                const pageTitle = result.name.toLowerCase(); // Tiêu đề của trang
                // const pageSnippet = result.snippet.toLowerCase(); // Mô tả ngắn gọn của trang
                const pageUrl = result.url;

                if (
                  !excludedDomains.some((domain) => pageUrl.includes(domain)) &&
                  (!requireTripDomainOnly || pageUrl.includes("trip"))
                ) {
                  _officialSite = pageUrl;
                  console.log(pageUrl);

                  const isMatch = isHotelNameInPage(hotelNameArray, pageTitle);

                  if (isMatch.status) {
                    resultsFromBingArray.push({
                      percentage: isMatch.percentage,
                      matchedLink: pageUrl,
                    });
                  }
                }
              }
              // console.log("resultsFromBingArray: ", resultsFromBingArray);
              const _maxPercentageResult = resultsFromBingArray.reduce(
                (max, item) => {
                  return item.percentage > max.percentage ? item : max;
                },
                { percentage: -Infinity }
              );
              // console.log("maxPercentageResult: ", maxPercentageResult);

              // matchedLink = maxPercentageResult.matchedLink;

              // console.log(
              //   "Những Link không phải trang Tripadvisor: ",
              //   resultsFromBingArray
              // );

              matchedLink = resultsFromBingArray.map(
                ({ percentage: _percentage, ...rest }) => rest["matchedLink"]
              );
              // console.log(matchedLink);
            }
          } catch (error) {
            console.log("Lỗi khi tìm kiếm:", error);
          }

          // Thêm số thứ tự vào kết quả , nếu không có link thì vẫn trả về kết quả với chữ "Không tìm thấy link"
          results.push({
            order: order++,
            hotelNo,
            hotelName,
            hotelCountry,
            hotelCity,
            matchedLinks: [...matchedLink],
          });
          currentIndex++;
          console.log("Dong thu:", currentIndex);
        }

        // Xuất kết quả ra file CSV
        if (results.length > 0) {
          setupDownloadButton(results); // Hiển thị nút tải khi có kết quả
        } else {
          if (typeof Toasts !== "undefined") Toasts.show("Không tìm thấy kết quả nào khớp với tên khách sạn.", { type: "info", title: "Không có kết quả" });
        }
      };

      reader.readAsArrayBuffer(file);
    });
});

// Thêm nút tải xuống CSV sau khi có dữ liệu
function setupDownloadButton(results) {
  const downloadButton = document.getElementById("downloadCSVButton");
  downloadButton.style.display = "block"; // Hiển thị nút
  downloadButton.onclick = () => downloadCSV(results); // Khi nhấn mới tải
}
// Hàm xuất ra file CSV
function downloadCSV(results) {
  const maxMatchedLinks = Math.max(
    ...results.map((row) => row.matchedLinks.length)
  );
  const header =
    "Order, No, Type, Hotel Name, Hotel Country, Hotel City" +
    Array.from(
      { length: maxMatchedLinks },
      (_, i) => `Matched Link ${i + 1}`
    ).join(",") +
    "\n";

  const csvContent =
    header +
    results
      .map((row) => {
        const links = row.matchedLinks.map((link) => `"${link}"`);
        while (links.length < maxMatchedLinks) links.push('""');
        return `"${row.order}","${row.hotelNo}", Child,"${
          row.hotelName
        }","${row.hotelCountry}","${row.hotelCity}",${links.join(",")}`;
      })
      .join("\n");

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "hotel_search_results.csv";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
// Hàm kiểm tra tên khách sạn có nằm trong tiêu đề trang hay không
function isHotelNameInPage(hotelNameArray, pageTitle, _pageSnippet) {
  let matchCount = 0; // Đếm số phân tử trong hotelNameArray khớp với pageTitle

  // Duyệt qua từng phần tử trong mãng hotelNameArray
  for (let i = 0; i < hotelNameArray.length; i++) {
    const part = hotelNameArray[i];
    // So sánh với tiêu đề trang
    if (pageTitle.includes(part)) {
      matchCount++; // Nếu phần tử khớp tăng biến đếm
    }
  }

  // Kiểm tra nếu số phần tử khớp >= 50% tổng số phần tử trong hotelNameArray
  const matchPercentage = (matchCount / hotelNameArray.length) * 100;

  return {
    status: true,
    percentage: matchPercentage,
  };
}

// Cấu hình các trang và các nút liên quan
const pages = {
  AZURE_CHILD: ["SEARCHGO"],
  AZURE_MASTER: ["AZURE_CHILD"],
};

// Hàm thay đổi nội dung và hiển thị nút
function switchPage(page) {
  // Cập nhật tiêu đề trang
  document.querySelector("h1").textContent = `Chức năng ${page}`;

  // Ẩn tất cả các trang
  document.querySelectorAll(".page").forEach((p) => (p.style.display = "none"));

  // Hiển thị trang hiện tại
  document.getElementById(`page${page}`).style.display = "block";

  // Cập nhật các nút chức năng
  const buttonContainer = document.querySelector(".button-container");
  buttonContainer.innerHTML = ""; // Xóa các nút hiện tại
  pages[page].forEach((p) => {
    const a = document.createElement("a");
    a.href = p;
    const button = document.createElement("button");
    button.textContent = `Chức năng ${p}`;
    button.onclick = () => switchPage(p);
    a.appendChild(button);
    buttonContainer.appendChild(a);
  });
}

// Khởi tạo mặc định là trang A
switchPage("AZURE_CHILD");
