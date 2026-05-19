// Khai báo các gói thư viện
import express from "express"; // Framework dùng để xây dựng ứng dụng web và API
import bodyParser from "body-parser"; // Middleware để xử lý dữ liệu từ body của request(JSON hoặc URL-encoded)
import sql from "mssql"; // Thư viện dùng để kết nối và tương tác với cơ sở dữ liệu MySQL
import axios from "axios"; // Thư viện để thực hiện các yêu cầu HTTP, như gọi API từ Bing
import { JSDOM } from "jsdom";
import { fileURLToPath } from "url"; // Import fileURLToPath
import { dirname } from "path"; // Import dirname
import path from "path";
import session from "express-session"; // To manage sessions
import dotenv from "dotenv"; // To manage sessions
dotenv.config();
import cors from "cors";
import { createProxyMiddleware } from "http-proxy-middleware";
import { tavily } from "@tavily/core";
import multer from "multer";

// Get the directory name from import.meta.url
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Khởi tạo ứng dụng
const app = express(); // App biến đại diện cho ứng dụng Express
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});
const CASE12_API_URL =
  process.env.CASE12_API_URL || "https://hotel-search-v2-api.vercel.app/api/case12";

// ⚠️ Đặt proxy TRƯỚC khi dùng static
const defaultApiProxy = createProxyMiddleware({
  target: "http://localhost:8080",
  changeOrigin: true,
  pathRewrite: { "^/api": "" }, // /api/search => /search
});

app.use("/api", (req, res, next) => {
  if (req.path === "/case12" || req.path === "/case12/health") {
    return next();
  }
  return defaultApiProxy(req, res, next);
});

app.use(bodyParser.json()); // Middleware giúp xử lý các request với dữ liệu JSON
app.use(bodyParser.urlencoded({ extended: true })); // Middleware xử lý dữ liệu URL-encoded từ các form HTML
app.use(express.static(path.join(__dirname, "public")));
// Set up express session
app.use(
  session({
    secret: "hotel_search_digi", // A secret key to sign the session ID cookie
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false }, // 'secure: false' for non-HTTPS environments
  })
);

const dom = new JSDOM(
  `<!DOCTYPE html><html><body><button id="searchButton">Search</button></body></html>`
);
const document = dom.window.document;

// Cấu hình Azure SQL Database
const dbConfig = {
  user: process.env.DB_USER, // Tên đăng nhập vào Azure SQL Database
  password: process.env.DB_PASSWORD, // Mật khẩu đăng nhập vào Azure SQL Database
  server: process.env.DB_SERVER, // Tên máy chủ của Azure SQL Database
  database: process.env.DB_NAME, // Tên cơ sở dữ liệu cần kết nối
  option: {
    encrypt: true, // Yêu cầu mã hóa kết nối (SSL) khi kết nối tới Azure SQL Database
    trustServerCertificate: false, // Không tin cậy chứng chỉ của máy chủ nếu không sử dụng chứng chỉ SSL đáng tin cậy
  },
};

// Kết nối đến Azure SQL Database
let pool; // Khai báo biến pool để quản lý kết nối cơ sở dữ liệu, giúp tái sử dụng kết nối

// Hàm kết nối tới Azure SQL Database
async function connectToDatabase() {
  try {
    pool = await sql.connect(dbConfig); // Kết nối tới cơ sở dữ liệu với cấu hình đã định nghĩa
    console.log("Đã kết nối đến Azure SQL Database"); // In thông báo khi kết nối thành công
  } catch (error) {
    console.error("Không thể kết nối đến Azure SQL Database:", error); // In thông báo lỗi nếu kết nối không thành công
  }
}

// await connectToDatabase(); // Gọi hàm kết nối đến cơ sở dữ liệu

// Middleware to check if the user is logged in
function checkAuthenticated(req, res, next) {
  if (req.session.isAuthenticated) {
    return next();
    // return next(); // If user is authenticated, proceed to the next middleware or route handler
  } else {
    res.redirect("/"); // If not authenticated, redirect to the login page
  }
}

// danh sách các API key Tavily
const apiTavilyKeys = [
  process.env.TAVILY_API_KEY_1,
  process.env.TAVILY_API_KEY_2,
  process.env.TAVILY_API_KEY_3,
  process.env.TAVILY_API_KEY_4,
  process.env.TAVILY_API_KEY_5,
  process.env.TAVILY_API_KEY_6,
  process.env.TAVILY_API_KEY_7,
  process.env.TAVILY_API_KEY_8,
  process.env.TAVILY_API_KEY_9,
  process.env.TAVILY_API_KEY_10,
  process.env.TAVILY_API_KEY_11,
  process.env.TAVILY_API_KEY_12,
  process.env.TAVILY_API_KEY_13,
  process.env.TAVILY_API_KEY_14,
  process.env.TAVILY_API_KEY_15,
  process.env.TAVILY_API_KEY_16,
  process.env.TAVILY_API_KEY_17,
  process.env.TAVILY_API_KEY_18,
  process.env.TAVILY_API_KEY_19,
  process.env.TAVILY_API_KEY_20,
];

let currentKeyTavilyIndex = 0;
function getClient() {
  const key = apiTavilyKeys[currentKeyTavilyIndex];
  return tavily({ apiKey: key });
}
async function searchWithRetry(query) {
  let attempts = 0;
  const maxAttempts = apiTavilyKeys.length;

  while (attempts < maxAttempts) {
    const client = getClient();

    try {
      // thử gọi API
      const result = await client.search(query);
      return result;
    } catch (error) {
      const status = error?.response?.status || 0;
      console.log("Error object:", error);
      console.log("Error status:", error?.response?.status);
      console.log("Error response data:", error?.response?.data);
      console.log("Error message:", error?.message);

      // Kiểm tra xem lỗi có phải do hết quota hoặc vượt giới hạn gói
      if (
        status === 403 ||
        status === 422 ||
        status === 429 ||
        status === 500 ||
        (error.message &&
          error.message.includes("exceeds your plan's set usage limit"))
      ) {
        console.warn(
          `API key ${
            currentKeyTavilyIndex + 1
          } hết lượt trong tháng, chuyển key tiếp theo...`
        );
        currentKeyTavilyIndex++;

        if (currentKeyTavilyIndex >= apiTavilyKeys.length) {
          throw new Error("Tất cả API key đã hết lượt trong tháng!");
        }

        attempts++;
      } else {
        // Nếu là lỗi khác không phải quota → trả về lỗi ngay
        throw error;
      }
    }
  }

  throw new Error("Không thể thực hiện search sau khi thử tất cả API key.");
}

// danh sách các API key Go
const apiGoogleKeys = [
  process.env.GO_API_KEY_1,
  process.env.GO_API_KEY_2,
  process.env.GO_API_KEY_3,
  process.env.GO_API_KEY_4,
  process.env.GO_API_KEY_5,
  process.env.GO_API_KEY_6,
  process.env.GO_API_KEY_7,
  process.env.GO_API_KEY_8,
  process.env.GO_API_KEY_9,
  process.env.GO_API_KEY_10,
];

const SEARCH_ENGINE_ID = process.env.GOOGLE_SEARCH_ENGINE_ID; // cx

let currentKeyGoogleIndex = 0;
// Hàm gọi Google Search API với key hiện tại
async function callGoogleSearchAPI(query, apiKey) {
  const url = "https://www.googleapis.com/customsearch/v1";

  const response = await axios.get(url, {
    params: {
      key: apiKey,
      cx: SEARCH_ENGINE_ID,
      q: query,
    },
  });

  return response.data;
}

// Hàm tìm kiếm có retry qua các API key
async function searchWithRetryGo(query) {
  let attempts = 0;
  const maxAttempts = apiGoogleKeys.length;

  while (attempts < maxAttempts) {
    const apiKey = apiGoogleKeys[currentKeyGoogleIndex];

    try {
      const result = await callGoogleSearchAPI(query, apiKey);
      return result;
    } catch (error) {
      const status = error?.response?.status || 0;

      if ([403, 429].includes(status)) {
        console.warn(
          `API key #${
            currentKeyGoogleIndex + 1
          } bị giới hạn (status ${status}). Chuyển sang key tiếp theo...`
        );
        currentKeyGoogleIndex++;

        if (currentKeyGoogleIndex >= apiGoogleKeys.length) {
          throw new Error("Tất cả API key đã hết lượt hoặc bị giới hạn.");
        }

        attempts++;
      } else {
        // Lỗi khác ngoài quota → dừng lại luôn
        console.error(
          "Lỗi khi gọi Google API:",
          error.response?.data || error.message
        );
        throw error;
      }
    }
  }

  throw new Error("Không thể thực hiện tìm kiếm sau khi thử tất cả API key.");
}

app.get("/api/case12/health", async (req, res) => {
  try {
    const response = await fetch(CASE12_API_URL);
    const body = await response.text();
    return res.status(response.status).type("application/json").send(body);
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: "Không kết nối được Case12 API",
      details: error.message,
    });
  }
});

app.post("/api/case12", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res
        .status(400)
        .json({ ok: false, error: "Thiếu file upload (field name: file)" });
    }

    const formData = new FormData();
    const fileBlob = new Blob([req.file.buffer], {
      type:
        req.file.mimetype ||
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    formData.append("file", fileBlob, req.file.originalname || "input.xlsx");

    const response = await fetch(CASE12_API_URL, {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).send(errorText);
    }

    const arrayBuffer = await response.arrayBuffer();
    const contentType =
      response.headers.get("content-type") ||
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    const disposition =
      response.headers.get("content-disposition") ||
      'attachment; filename="verified_case12.xlsx"';

    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Disposition", disposition);
    return res.send(Buffer.from(arrayBuffer));
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: "Lỗi khi gọi Case12 API",
      details: error.message,
    });
  }
});

// Định tuyến cho trang đăng nhập
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});
app.get("/AZURE_CHILD", checkAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "hotelSearchChild.html"));
});
app.get("/BRAVE_MASTER", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "hotelSearchMaster.html"));
});
app.get("/CRAWLBASE_MASTER", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "crawlbaseMaster.html"));
});
app.get("/searchXNG", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "hotelSearchXNG.html"));
});
app.get("/roomXNG", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "hotelRoomXNG.html"));
});
app.get("/searchGo", checkAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "hotelSearchGoogle.html"));
});
app.get("/searchApiGo", checkAuthenticated, async (req, res) => {
  console.log("Query string nhận được:", req.query); // 👈 dòng này để debug
  const query = req.query.q; // Default query if none provided

  if (!query) {
    return res.status(400).json({ error: "Thiếu tham số q" });
  }

  try {
    const result = await searchWithRetryGo(query);
    res.json(result);
  } catch (error) {
    console.error("Go error:", error);
    res.status(500).json({
      error: "Search Failed",
      details: error.message || error.toString(),
    });
  }
});
// ---- DuckDuckGo search helpers ----
const DDG_BLACKLISTED_DOMAINS = [
  "booking.com", "agoda.com", "expedia.com", "hotels.com", "tripadvisor.com",
  "airbnb.com", "kayak.com", "trivago.com", "priceline.com", "orbitz.com",
  "travelocity.com", "hotelbeds.com", "traveloka.com", "klook.com", "viator.com",
  "tiket.com", "dorms.com", "hostelworld.com", "hostelbookers.com",
  "google.com", "bing.com", "facebook.com", "instagram.com", "twitter.com",
  "youtube.com", "wikipedia.org", "yelp.com", "foursquare.com",
  "trip.com", "ctrip.com", "hoteles.com", "hrs.com", "hotelopia.com",
  "venere.com", "lastminute.com", "ebookers.com", "otel.com", "goibibo.com",
  "makemytrip.com", "cleartrip.com", "yatra.com",
];

const DDG_SUSPICIOUS_KEYWORDS = [
  "tophotels", "besthotels", "cheaphotels", "hotelscombined",
  "allhotels", "findhotels", "searchhotels", "comparehotels",
  "hotel-rates", "hotels-rates", "hoteldeals",
];

function ddgExtractDomain(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function ddgIsSuspicious(domain) {
  const withoutWww = domain.replace(/^www\./, "");
  if ((withoutWww.match(/\./g) || []).length > 1) return true;
  const main = withoutWww.split(".")[0];
  if (DDG_SUSPICIOUS_KEYWORDS.some((k) => main.includes(k))) return true;
  if (/\d{2,}.*hotel/.test(main) || /hotel.*\d{2,}/.test(main)) return true;
  return false;
}

function ddgIsBlacklisted(url) {
  if (!url) return true;
  try {
    const domain = ddgExtractDomain(url);
    const parts = domain.split(".");
    for (const bl of DDG_BLACKLISTED_DOMAINS) {
      const blParts = bl.split(".");
      if (parts.length >= blParts.length) {
        if (parts.slice(-blParts.length).join(".") === bl) return true;
      }
    }
    return ddgIsSuspicious(domain);
  } catch {
    return true;
  }
}

function ddgNormalizeName(name) {
  if (!name) return "";
  let n = name.toLowerCase();
  n = n.replace(/\b(the|a|an|at|in|on|by|de|do|da|le|la|el|los|las)\b/g, "");
  n = n.replace(/\b(hotel|resort|spa|inn|suites?|lodge|hostel|motel|apartments?)\b/g, "");
  n = n.replace(/[^a-z0-9]/g, "");
  return n.trim();
}

function ddgExtractDomainName(url) {
  try {
    const domain = ddgExtractDomain(url).replace(/^www\./, "");
    const parts = domain.split(".");
    return parts.length >= 2 ? parts[0] : domain;
  } catch {
    return "";
  }
}

function ddgHotelMatchesDomain(hotelName, url) {
  if (!hotelName || !url) return false;
  const domainName = ddgExtractDomainName(url);
  if (!domainName || domainName.length < 4) return false;

  const normalized = ddgNormalizeName(hotelName);
  if (normalized.length >= 4 && (normalized.includes(domainName) || domainName.includes(normalized))) return true;

  let hotelLower = hotelName.toLowerCase();
  hotelLower = hotelLower.replace(/\b(the|a|an|at|in|on|by|de|do|da|le|la|el|los|las)\b/g, " ");
  hotelLower = hotelLower.replace(/\b(hotel|resort|spa|inn|suites?|lodge|hostel|motel|apartments?)\b/g, " ");
  const words = hotelLower.match(/[a-z]{4,}/g) || [];

  for (const word of words) {
    if (domainName.startsWith(word)) return true;
  }

  if (words.length >= 2) {
    const combined2 = words.slice(0, 2).join("");
    if (combined2.length >= 6 && (combined2.includes(domainName) || domainName.startsWith(combined2.slice(0, 6)))) return true;
    if (words.length >= 3) {
      const combined3 = words.slice(0, 3).join("");
      if (combined3.length >= 8 && (combined3.includes(domainName) || domainName.startsWith(combined3.slice(0, 8)))) return true;
    }
  }
  return false;
}

function ddgExtractActualUrl(ddgUrl) {
  try {
    if (ddgUrl.includes("duckduckgo.com/l/")) {
      const parsed = new URL(ddgUrl);
      const uddg = parsed.searchParams.get("uddg");
      if (uddg) return decodeURIComponent(uddg);
    }
    return ddgUrl;
  } catch {
    return ddgUrl;
  }
}

// ---- DDG Server management ----
const DDG_SERVER_URL = "http://localhost:5001";
let ddgServerProcess = null;

async function isDdgServerRunning() {
  try {
    const resp = await fetch(`${DDG_SERVER_URL}/health`, { signal: AbortSignal.timeout(2000) });
    return resp.ok;
  } catch {
    return false;
  }
}

async function startDdgServer() {
  if (await isDdgServerRunning()) return;
  const { spawn } = await import("child_process");
  const scriptPath = path.join(__dirname, "ddg_server.py");
  ddgServerProcess = spawn("python", [scriptPath], {
    detached: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
  ddgServerProcess.stdout.on("data", (d) => console.log("[DDG]", d.toString().trim()));
  ddgServerProcess.stderr.on("data", (d) => console.error("[DDG ERR]", d.toString().trim()));
  // Chờ server sẵn sàng (tối đa 30s)
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    if (await isDdgServerRunning()) {
      console.log("DDG server sẵn sàng.");
      return;
    }
  }
  throw new Error("DDG server không khởi động được.");
}

app.get("/searchApiDDG", checkAuthenticated, async (req, res) => {
  const query = req.query.q;
  const hotelName = req.query.hotel_name || "";
  const hotelAddress = req.query.hotel_address || "";
  if (!query) return res.status(400).json({ error: "Thiếu tham số q" });

  try {
    // Đảm bảo DDG server đang chạy
    if (!(await isDdgServerRunning())) {
      await startDdgServer();
    }

    const resp = await fetch(`${DDG_SERVER_URL}/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, hotel_name: hotelName, hotel_address: hotelAddress }),
      signal: AbortSignal.timeout(120000),
    });

    const result = await resp.json();
    return res.json({ query, results: result.results || [] });
  } catch (error) {
    console.error("DDG search error:", error.message);
    return res.status(500).json({ error: "Lỗi tìm kiếm DuckDuckGo", details: error.message });
  }
});

app.get("/searchTavily", checkAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "hotelSearchTavily.html"));
});
app.get("/searchApiTavily", checkAuthenticated, async (req, res) => {
  console.log("Query string nhận được:", req.query); // 👈 dòng này để debug
  const query = req.query.q; // Default query if none provided

  if (!query) {
    return res.status(400).json({ error: "Thiếu tham số q" });
  }

  try {
    const result = await searchWithRetry(query);
    res.json(result);
  } catch (error) {
    console.error("Tavily error:", error);
    res.status(500).json({
      error: "Search Failed",
      details: error.message || error.toString(),
    });
  }
});

// Xử lý yêu cầu đăng nhập
app.post("/login", async (req, res) => {
  const usernameEnv = process.env.MY_USERNAME;
  const passwordEnv = process.env.MY_PASSWORD;
  const { username, password } = req.body;

  try {
    if (username == usernameEnv && password == passwordEnv) {
      req.session.isAuthenticated = true; // Đánh dấu user đã đăng nhập
      res.redirect("/SEARCHTAVILY"); // Redirect to a protected page after successful login
    } else {
      // Trả về trang thông báo rồi tự động redirect sau 5 giây
      res.status(401).send(`
      <h1>Sai tên đăng nhập hoặc mật khẩu</h1>
      <p>Trang sẽ tự động chuyển về trang đăng nhập sau 3 giây...</p>
      <script>
        setTimeout(() => {
          window.location.href = '/';
        }, 3000);
      </script>
    `);
    }
  } catch (error) {
    console.error("Lỗi khi kiểm tra đăng nhập:", error);
    res.status(500).send(`
      <h1>Lỗi máy chủ.</h1>
      <p>Trang sẽ tự động chuyển về trang đăng nhập sau 3 giây...</p>
      <script>
        setTimeout(() => {
          window.location.href = '/login';
        }, 3000);
      </script>
    `);
  }
});
// Route for logging out (to clear the session)
app.get("/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).send("Lỗi khi đăng xuất.");
    }
    res.redirect("/"); // Redirect to login page after logout
  });
});

app.listen(process.env.PORT || 3000, "0.0.0.0", () => {
  console.log(`Server đang chạy tại http://localhost:${process.env.PORT}`);
});
