import sys
import json
import time
import re
import requests
from concurrent.futures import ThreadPoolExecutor, as_completed
from urllib.parse import urlparse, parse_qs, unquote
from bs4 import BeautifulSoup
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.chrome.options import Options
from webdriver_manager.chrome import ChromeDriverManager

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

def extract_domain(url):
    try:
        return urlparse(url).netloc.lower().replace("www.", "", 1)
    except:
        return ""

def is_blacklisted(url):
    if not url:
        return True
    try:
        domain = extract_domain(url)
        parts = domain.split(".")
        for bl in BLACKLISTED_DOMAINS:
            bl_parts = bl.split(".")
            if len(parts) >= len(bl_parts) and parts[-len(bl_parts):] == bl_parts:
                return True
        return False
    except:
        return True

def extract_ddg_url(ddg_url):
    try:
        if "duckduckgo.com/l/" in ddg_url:
            parsed = urlparse(ddg_url)
            uddg = parse_qs(parsed.query).get("uddg", [None])[0]
            if uddg:
                return unquote(uddg)
        return ddg_url
    except:
        return ddg_url

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

def fetch_page_text_requests(url, timeout=6):
    """Fetch trang bằng requests (nhanh hơn Selenium nhiều)."""
    try:
        resp = requests.get(url, headers=HEADERS, timeout=timeout, allow_redirects=True)
        soup = BeautifulSoup(resp.text, "html.parser")
        # Bỏ script/style
        for tag in soup(["script", "style", "noscript"]):
            tag.decompose()
        return soup.get_text(separator=" ", strip=True)
    except:
        return ""

def search_ddg_selenium(query):
    """Dùng Selenium chỉ để search DDG, trả về list candidates."""
    chrome_options = Options()
    chrome_options.add_argument("--headless")
    chrome_options.add_argument("--no-sandbox")
    chrome_options.add_argument("--disable-dev-shm-usage")
    chrome_options.add_argument("--disable-blink-features=AutomationControlled")
    chrome_options.add_argument("--disable-extensions")
    chrome_options.add_argument(f"user-agent={HEADERS['User-Agent']}")

    service = Service(ChromeDriverManager().install())
    driver = webdriver.Chrome(service=service, options=chrome_options)

    candidates = []
    try:
        search_url = "https://duckduckgo.com/html/?q=" + query.replace(" ", "+")
        driver.get(search_url)
        time.sleep(2)

        link_els = driver.find_elements(By.CSS_SELECTOR, "a.result__a")
        snippet_els = driver.find_elements(By.CSS_SELECTOR, ".result__snippet")

        for i, link in enumerate(link_els):
            try:
                ddg_href = link.get_attribute("href")
                url = extract_ddg_url(ddg_href)
                if not url or "/y.js?" in url or "ad_domain=" in url:
                    continue
                title = link.text.strip()
                snippet = snippet_els[i].text.strip() if i < len(snippet_els) else ""
                candidates.append({"url": url, "title": title, "snippet": snippet})
            except:
                continue
    finally:
        driver.quit()

    return candidates

def score_candidate(item, hotel_name, hotel_address):
    """Fetch trang và tính điểm — chạy song song."""
    url = item["url"]
    page_text = fetch_page_text_requests(url)
    if page_text:
        score = calc_match_score(hotel_name, hotel_address, page_text)
    else:
        # Fallback: dùng title + snippet từ DDG
        fallback = item["title"] + " " + item["snippet"]
        score = calc_match_score(hotel_name, hotel_address, fallback)
    return {
        "url": url,
        "title": item["title"],
        "content": item["snippet"],
        "score": score / 100.0,
        "match_percentage": score,
    }

def search(query, hotel_name, hotel_address):
    # Bước 1: Dùng Selenium lấy danh sách link từ DDG
    candidates = search_ddg_selenium(query)

    if not candidates:
        return []

    # Bước 2: Fetch và score song song bằng requests (tối đa 5 thread)
    results = []
    with ThreadPoolExecutor(max_workers=5) as executor:
        futures = {executor.submit(score_candidate, item, hotel_name, hotel_address): item
                   for item in candidates}
        for future in as_completed(futures):
            try:
                results.append(future.result())
            except:
                pass

    # Sắp xếp theo điểm giảm dần
    results.sort(key=lambda x: x["match_percentage"], reverse=True)
    return results

if __name__ == "__main__":
    query = sys.argv[1] if len(sys.argv) > 1 else ""
    hotel_name = sys.argv[2] if len(sys.argv) > 2 else ""
    hotel_address = sys.argv[3] if len(sys.argv) > 3 else ""

    if not query:
        print(json.dumps({"error": "No query"}))
        sys.exit(1)
    try:
        results = search(query, hotel_name, hotel_address)
        print(json.dumps({"results": results}))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)
