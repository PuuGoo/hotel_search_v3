import { Router } from "express";
import axios from "axios";
import path from "path";
import { fileURLToPath } from "url";
import { tavily } from "@tavily/core";
import { checkAuthenticated, checkFeature } from "../middleware/auth.js";
import { validateSearchQuery } from "../middleware/validation.js";
import { rateLimitSearch } from "../middleware/rateLimit.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = Router();

/**
 * @swagger
 * /searchApiTavily:
 *   get:
 *     summary: Search with Tavily
 *     description: Search for hotels using Tavily API with automatic key rotation
 *     security:
 *       - sessionAuth: []
 *     parameters:
 *       - in: query
 *         name: q
 *         required: true
 *         schema:
 *           type: string
 *         description: Search query
 *     responses:
 *       200:
 *         description: Search results
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 results:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/SearchResult'
 *                 query:
 *                   type: string
 *       400:
 *         description: Missing query parameter
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Feature not enabled
 *       500:
 *         description: Search failed
 */

/**
 * @swagger
 * /searchApiGo:
 *   get:
 *     summary: Search with Google
 *     description: Search for hotels using Google Custom Search API with key rotation
 *     security:
 *       - sessionAuth: []
 *     parameters:
 *       - in: query
 *         name: q
 *         required: true
 *         schema:
 *           type: string
 *         description: Search query
 *     responses:
 *       200:
 *         description: Search results
 *       400:
 *         description: Missing query parameter
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Feature not enabled
 *       500:
 *         description: Search failed
 */

/**
 * @swagger
 * /searchApiDDG:
 *   get:
 *     summary: Search with DuckDuckGo
 *     description: Search for hotels using DuckDuckGo (via local DDG server)
 *     security:
 *       - sessionAuth: []
 *     parameters:
 *       - in: query
 *         name: q
 *         required: true
 *         schema:
 *           type: string
 *         description: Search query
 *       - in: query
 *         name: hotel_name
 *         schema:
 *           type: string
 *         description: Hotel name for context
 *       - in: query
 *         name: hotel_address
 *         schema:
 *           type: string
 *         description: Hotel address for context
 *     responses:
 *       200:
 *         description: Search results
 *       400:
 *         description: Missing query parameter
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Feature not enabled
 *       502:
 *         description: DDG server error
 *       500:
 *         description: Search failed
 */

// ---- Tavily API key rotation ----
const apiTavilyKeys = [
  process.env.TAVILY_API_KEY_1, process.env.TAVILY_API_KEY_2,
  process.env.TAVILY_API_KEY_3, process.env.TAVILY_API_KEY_4,
  process.env.TAVILY_API_KEY_5, process.env.TAVILY_API_KEY_6,
  process.env.TAVILY_API_KEY_7, process.env.TAVILY_API_KEY_8,
  process.env.TAVILY_API_KEY_9, process.env.TAVILY_API_KEY_10,
  process.env.TAVILY_API_KEY_11, process.env.TAVILY_API_KEY_12,
  process.env.TAVILY_API_KEY_13, process.env.TAVILY_API_KEY_14,
  process.env.TAVILY_API_KEY_15, process.env.TAVILY_API_KEY_16,
  process.env.TAVILY_API_KEY_17, process.env.TAVILY_API_KEY_18,
  process.env.TAVILY_API_KEY_19, process.env.TAVILY_API_KEY_20,
].filter(Boolean);

let currentKeyTavilyIndex = 0;
function getTavilyClient() {
  return tavily({ apiKey: apiTavilyKeys[currentKeyTavilyIndex] });
}

async function searchWithRetry(query) {
  if (apiTavilyKeys.length === 0) {
    throw new Error("No Tavily API keys configured");
  }
  let attempts = 0;
  const maxAttempts = apiTavilyKeys.length;

  while (attempts < maxAttempts) {
    const client = getTavilyClient();
    try {
      const result = await client.search(query);
      currentKeyTavilyIndex = 0;
      return result;
    } catch (error) {
      const status = error?.response?.status || 0;
      console.error("Tavily search error:", error.message);

      if ([403, 422, 429, 500].includes(status) || (error.message && error.message.includes("exceeds your plan's set usage limit"))) {
        console.warn(`Tavily key ${currentKeyTavilyIndex + 1} exhausted, rotating...`);
        currentKeyTavilyIndex++;
        if (currentKeyTavilyIndex >= apiTavilyKeys.length) {
          throw new Error("All Tavily API keys exhausted!");
        }
        attempts++;
      } else {
        throw error;
      }
    }
  }
  throw new Error("Tavily search failed after trying all API keys.");
}

// ---- Google API key rotation ----
const apiGoogleKeys = [
  process.env.GO_API_KEY_1, process.env.GO_API_KEY_2,
  process.env.GO_API_KEY_3, process.env.GO_API_KEY_4,
  process.env.GO_API_KEY_5, process.env.GO_API_KEY_6,
  process.env.GO_API_KEY_7, process.env.GO_API_KEY_8,
  process.env.GO_API_KEY_9, process.env.GO_API_KEY_10,
].filter(Boolean);

const SEARCH_ENGINE_ID = process.env.GOOGLE_SEARCH_ENGINE_ID;
let currentKeyGoogleIndex = 0;

async function callGoogleSearchAPI(query, apiKey) {
  const response = await axios.get("https://www.googleapis.com/customsearch/v1", {
    params: { key: apiKey, cx: SEARCH_ENGINE_ID, q: query },
  });
  return response.data;
}

async function searchWithRetryGo(query) {
  if (apiGoogleKeys.length === 0) {
    throw new Error("No Google API keys configured");
  }
  let attempts = 0;
  const maxAttempts = apiGoogleKeys.length;

  while (attempts < maxAttempts) {
    const apiKey = apiGoogleKeys[currentKeyGoogleIndex];
    try {
      const result = await callGoogleSearchAPI(query, apiKey);
      currentKeyGoogleIndex = 0;
      return result;
    } catch (error) {
      const status = error?.response?.status || 0;
      if ([403, 429].includes(status)) {
        console.warn(`Google key #${currentKeyGoogleIndex + 1} limited (status ${status}). Rotating...`);
        currentKeyGoogleIndex++;
        if (currentKeyGoogleIndex >= apiGoogleKeys.length) {
          throw new Error("All Google API keys exhausted or limited.");
        }
        attempts++;
      } else {
        console.error("Google API error:", error.response?.data || error.message);
        throw error;
      }
    }
  }
  throw new Error("Google search failed after trying all API keys.");
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

process.on("exit", () => {
  if (ddgServerProcess) {
    ddgServerProcess.kill();
  }
});

async function startDdgServer() {
  if (await isDdgServerRunning()) return;
  const { spawn } = await import("child_process");
  const scriptPath = path.join(__dirname, "..", "ddg_server.py");
  ddgServerProcess = spawn("python", [scriptPath], {
    detached: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
  ddgServerProcess.stdout.on("data", (d) => console.log("[DDG]", d.toString().trim()));
  ddgServerProcess.stderr.on("data", (d) => console.error("[DDG ERR]", d.toString().trim()));
  ddgServerProcess.on("exit", (code) => {
    console.log(`DDG server exited with code ${code}`);
    ddgServerProcess = null;
  });
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    if (await isDdgServerRunning()) {
      console.log("DDG server ready.");
      return;
    }
  }
  throw new Error("DDG server failed to start.");
}

// ---- Routes ----

// Google search page
router.get("/searchGo", checkAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "hotelSearchGoogle.html"));
});

// Google search API
router.get("/searchApiGo", checkAuthenticated, rateLimitSearch, validateSearchQuery, async (req, res) => {
  const query = req.query.q;
  try {
    const result = await searchWithRetryGo(query);
    res.json(result);
  } catch (error) {
    console.error("Google error:", error.message);
    res.status(500).json({ error: "Search Failed" });
  }
});

// Tavily search page
router.get("/searchTavily", checkAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "hotelSearchTavily.html"));
});

// Tavily search API
router.get("/searchApiTavily", checkAuthenticated, checkFeature("tavily"), rateLimitSearch, validateSearchQuery, async (req, res) => {
  const query = req.query.q;
  try {
    const result = await searchWithRetry(query);
    res.json(result);
  } catch (error) {
    console.error("Tavily error:", error.message);
    res.status(500).json({ error: "Search Failed" });
  }
});

// DDG search API
router.get("/searchApiDDG", checkAuthenticated, checkFeature("ddg"), rateLimitSearch, validateSearchQuery, async (req, res) => {
  const query = req.query.q;
  const hotelName = (req.query.hotel_name || "").toString().replace(/[<>]/g, "").trim().slice(0, 500);
  const hotelAddress = (req.query.hotel_address || "").toString().replace(/[<>]/g, "").trim().slice(0, 500);

  try {
    if (!(await isDdgServerRunning())) {
      await startDdgServer();
    }

    const resp = await fetch(`${DDG_SERVER_URL}/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, hotel_name: hotelName, hotel_address: hotelAddress }),
      signal: AbortSignal.timeout(120000),
    });

    if (!resp.ok) {
      console.error(`DDG server returned ${resp.status}`);
      return res.status(502).json({ error: "DuckDuckGo server error" });
    }

    const result = await resp.json();
    return res.json({ query, results: result.results || [] });
  } catch (error) {
    console.error("DDG search error:", error.message);
    return res.status(500).json({ error: "DuckDuckGo search error" });
  }
});

export default router;
