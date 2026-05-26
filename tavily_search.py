"""
Tavily Search Server - Tìm kiếm khách sạn với tích hợp extract ảnh.
"""
from flask import Flask, render_template, request, jsonify
from tavily import TavilyClient
from playwright.sync_api import sync_playwright
from playwright_stealth import Stealth
import os
import re
import threading

app = Flask(__name__)

# Tavily API key (set as environment variable)
TAVILY_API_KEY = os.environ.get("TAVILY_API_KEY", "")

EXCLUDE_IMG_PATTERN = re.compile(
    r'logo|icon|favicon|avatar|sprite|banner|ad-|tracking|pixel|badge|arrow|button|'
    r'social|facebook|twitter|instagram|youtube|share|flag|currency|chevron|close|'
    r'menu|search|loading|spinner|placeholder|payment|partner|award|store|'
    r'app-store|google-play',
    re.IGNORECASE
)


def extract_hotel_images(url: str) -> dict:
    """Extract ảnh khách sạn từ URL sử dụng Playwright."""
    try:
        with Stealth().use_sync(sync_playwright()) as p:
            browser = p.chromium.launch(headless=True)
            context = browser.new_context()
            page = context.new_page()

            page.goto(url, wait_until="domcontentloaded", timeout=30000)
            page.wait_for_timeout(2000)
            page.keyboard.press("Escape")
            page.wait_for_timeout(500)

            # Tìm và click nút gallery
            gallery_btn = page.evaluate("""() => {
                const els = document.querySelectorAll('div, span, a, button');
                for (const el of els) {
                    const text = (el.innerText || '').trim();
                    if (/see all \\d+ photos/i.test(text) || /view all \\d+ photos/i.test(text)) {
                        const rect = el.getBoundingClientRect();
                        if (rect.width < 300 && rect.height < 100) {
                            return {x: rect.x + rect.width/2, y: rect.y + rect.height/2};
                        }
                    }
                }
                return null;
            }""")

            gallery_opened = False
            if gallery_btn:
                page.mouse.click(gallery_btn['x'], gallery_btn['y'])
                page.wait_for_timeout(3000)
                gallery_opened = True

            # Scroll để load ảnh
            if gallery_opened:
                page.wait_for_timeout(2000)
                for _ in range(10):
                    page.evaluate("window.scrollBy(0, 1000)")
                    page.wait_for_timeout(500)

            # Extract ảnh
            result = page.evaluate("""() => {
                const EXCLUDE = /logo|icon|favicon|avatar|sprite|banner|ad-|tracking|pixel|badge|arrow|button|social|facebook|twitter|instagram|youtube|share|flag|currency|chevron|close|menu|search|loading|spinner|placeholder|payment|partner|award|store|app-store|google-play/i;

                const urls = new Set();
                const imgs = document.querySelectorAll('img');

                for (const img of imgs) {
                    const w = img.naturalWidth || img.width || parseInt(img.getAttribute('width')) || 0;
                    const h = img.naturalHeight || img.height || parseInt(img.getAttribute('height')) || 0;
                    if ((w > 0 && w < 80) || (h > 0 && h < 80)) continue;

                    const cls = (img.className || '').toLowerCase();
                    const src = (img.src || '').toLowerCase();
                    const alt = (img.alt || '').toLowerCase();
                    if (EXCLUDE.test(cls + ' ' + src + ' ' + alt)) continue;

                    const finalSrc = img.src || '';
                    if (finalSrc && finalSrc.startsWith('http')) {
                        urls.add(finalSrc.split('?')[0]);
                    }
                }
                return {count: urls.size, urls: Array.from(urls).slice(0, 50)};
            }""")

            browser.close()
            return result
    except Exception as e:
        return {"count": 0, "urls": [], "error": str(e)}


def search_tavily(query: str) -> list:
    """Search sử dụng Tavily API."""
    if not TAVILY_API_KEY:
        return [{"error": "TAVILY_API_KEY not set"}]

    client = TavilyClient(api_key=TAVILY_API_KEY)
    response = client.search(query, max_results=10)

    results = []
    for r in response.get("results", []):
        results.append({
            "title": r.get("title", ""),
            "url": r.get("url", ""),
            "content": r.get("content", "")[:200],
        })
    return results


@app.route("/")
def index():
    return render_template("tavily_search.html")


@app.route("/api/search", methods=["POST"])
def api_search():
    data = request.json
    query = data.get("query", "")
    extract_images = data.get("extract_images", False)

    results = search_tavily(query)

    if extract_images:
        for r in results[:3]:  # Chỉ extract 3 kết quả đầu
            if r.get("url"):
                images = extract_hotel_images(r["url"])
                r["image_count"] = images["count"]
                r["sample_images"] = images["urls"][:5]

    return jsonify({"results": results})


@app.route("/api/extract-images", methods=["POST"])
def api_extract_images():
    data = request.json
    url = data.get("url", "")

    if not url:
        return jsonify({"error": "URL required"}), 400

    images = extract_hotel_images(url)
    return jsonify(images)


if __name__ == "__main__":
    app.run(debug=True, port=5002)
