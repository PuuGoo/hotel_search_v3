"""
DDG Search Server - chạy liên tục, tái sử dụng Chrome driver.
Node.js gọi qua HTTP POST /search
"""
from http.server import HTTPServer, BaseHTTPRequestHandler
import json
import time
import re
import threading
import requests as req_lib
from concurrent.futures import ThreadPoolExecutor, as_completed
from urllib.parse import urlparse, parse_qs, unquote, parse_qsl
from bs4 import BeautifulSoup
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.chrome.options import Options
from webdriver_manager.chrome import ChromeDriverManager

PORT = 5001

BLACKLISTED_DOMAINS = [
    "booking.com", "agoda.com", "expedia.com", "hotels.com", "tripadvisor.com",
    "airbnb.com", "kayak.com", "trivago.com", "priceline.com", "orbitz.com",
    "travelocity.com", "hotelbeds.com", "traveloka.com", "klook.com", "viator.com",
    "tiket.com", "dorms.com", "hostelworld.com", "hostelbookers.com",
    "google.com", "bing.com", "facebook.com", "instagram.com", "twitter.com",
    "youtube.com", "wikipedia.org", "yelp.com", "foursquare.com",
    "trip.com", "ctrip.com", "hoteles.com", "hrs.com", "hotelopia.com",
    "venere.com", "lastminute.com", "ebookers.com", "otel.com", "goibibo.com",
    "makemytrip.com", "cleartrip.com", "yatra.com", "guestreservations.com",
]

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9",
}

# Global driver + lock
driver = None
driver_lock = threading.Lock()

def create_driver():
    chrome_options = Options()
    chrome_options.add_argument("--headless")
    chrome_options.add_argument("--no-sandbox")
    chrome_options.add_argument("--disable-dev-shm-usage")
    chrome_options.add_argument("--disable-blink-features=AutomationControlled")
    chrome_options.add_argument("--disable-extensions")
    chrome_options.add_argument(f"user-agent={HEADERS['User-Agent']}")
    service = Service(ChromeDriverManager().install())
    return webdriver.Chrome(service=service, options=chrome_options)

def get_driver():
    global driver
    if driver is None:
        driver = create_driver()
    return driver

def reset_driver():
    global driver
    try:
        if driver:
            driver.quit()
    except Exception:
        pass
    driver = create_driver()

def extract_ddg_url(ddg_url):
    try:
        if "duckduckgo.com/l/" in ddg_url:
            parsed = urlparse(ddg_url)
            uddg = parse_qs(parsed.query).get("uddg", [None])[0]
            if uddg:
                return unquote(uddg)
        return ddg_url
    except Exception:
        return ddg_url

def is_blacklisted(url):
    if not url:
        return True
    try:
        domain = urlparse(url).netloc.lower().replace("www.", "", 1)
        parts = domain.split(".")
        for bl in BLACKLISTED_DOMAINS:
            bl_parts = bl.split(".")
            if len(parts) >= len(bl_parts) and parts[-len(bl_parts):] == bl_parts:
                return True
        return False
    except Exception:
        return True

def normalize_text(text):
    if not text:
        return ""
    text = text.lower()
    text = re.sub(r'[^\w\s]', ' ', text)
    text = re.sub(r'\s+', ' ', text)
    return text.strip()

def calc_match_score(hotel_name, hotel_address, page_text):
    page_norm = normalize_text(page_text)
    stop_words = {'hotel', 'resort', 'spa', 'inn', 'suites', 'suite', 'lodge',
                  'hostel', 'motel', 'the', 'a', 'an', 'at', 'in', 'on', 'by',
                  'and', 'of', 'de', 'do', 'da', 'le', 'la', 'el'}
    name_tokens = [t for t in normalize_text(hotel_name).split()
                   if t and t not in stop_words and len(t) >= 3]
    addr_tokens = [t for t in normalize_text(hotel_address).split()
                   if t and t not in stop_words and len(t) >= 3]
    if not name_tokens:
        return 0
    name_matched = sum(1 for t in name_tokens if t in page_norm)
    name_score = (name_matched / len(name_tokens)) * 70
    addr_score = 0
    if addr_tokens:
        addr_matched = sum(1 for t in addr_tokens if t in page_norm)
        addr_score = (addr_matched / len(addr_tokens)) * 30
    return min(round(name_score + addr_score), 100)

def fetch_page_text(url, timeout=6):
    try:
        resp = req_lib.get(url, headers=HEADERS, timeout=timeout, allow_redirects=True)
        soup = BeautifulSoup(resp.text, "html.parser")
        for tag in soup(["script", "style", "noscript"]):
            tag.decompose()
        return soup.get_text(separator=" ", strip=True)
    except Exception:
        return ""

def score_candidate(item, hotel_name, hotel_address):
    url = item["url"]
    page_text = fetch_page_text(url)
    if page_text:
        score = calc_match_score(hotel_name, hotel_address, page_text)
    else:
        fallback = item["title"] + " " + item["snippet"]
        score = calc_match_score(hotel_name, hotel_address, fallback)
    return {
        "url": url,
        "title": item["title"],
        "content": item["snippet"],
        "score": score / 100.0,
        "match_percentage": score,
    }

def do_search(query, hotel_name, hotel_address):
    global driver
    candidates = []

    with driver_lock:
        try:
            d = get_driver()
            search_url = "https://duckduckgo.com/html/?q=" + query.replace(" ", "+")
            d.get(search_url)
            time.sleep(2)

            link_els = d.find_elements(By.CSS_SELECTOR, "a.result__a")
            snippet_els = d.find_elements(By.CSS_SELECTOR, ".result__snippet")

            for i, link in enumerate(link_els):
                try:
                    ddg_href = link.get_attribute("href")
                    url = extract_ddg_url(ddg_href)
                    if not url or "/y.js?" in url or "ad_domain=" in url:
                        continue
                    title = link.text.strip()
                    snippet = snippet_els[i].text.strip() if i < len(snippet_els) else ""
                    candidates.append({"url": url, "title": title, "snippet": snippet})
                except Exception:
                    continue
        except Exception as e:
            # Driver bị lỗi, reset lại
            reset_driver()
            raise e

    if not candidates:
        return []

    # Fetch song song bằng requests
    results = []
    with ThreadPoolExecutor(max_workers=5) as executor:
        futures = {executor.submit(score_candidate, item, hotel_name, hotel_address): item
                   for item in candidates}
        for future in as_completed(futures):
            try:
                results.append(future.result())
            except Exception:
                pass

    results.sort(key=lambda x: x["match_percentage"], reverse=True)
    return results


class Handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass  # tắt log mặc định

    def do_GET(self):
        if self.path == "/health":
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b"ok")
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        if self.path != "/search":
            self.send_response(404)
            self.end_headers()
            return

        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length)
        try:
            data = json.loads(body)
            query = data.get("query", "")
            hotel_name = data.get("hotel_name", "")
            hotel_address = data.get("hotel_address", "")

            results = do_search(query, hotel_name, hotel_address)
            resp = json.dumps({"results": results}).encode()

            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(resp)))
            self.end_headers()
            self.wfile.write(resp)
        except Exception as e:
            err = json.dumps({"error": str(e)}).encode()
            self.send_response(500)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(err)


if __name__ == "__main__":
    print(f"Starting Chrome driver...", flush=True)
    get_driver()
    print(f"DDG server running at http://localhost:{PORT}", flush=True)
    server = HTTPServer(("localhost", PORT), Handler)
    server.serve_forever()
