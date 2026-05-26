import re
import unicodedata
from urllib.parse import urlparse, parse_qs, unquote

from bs4 import BeautifulSoup

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


def normalize_text(text: str) -> str:
    if not text:
        return ""
    text = unicodedata.normalize("NFKD", text)
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = text.lower()
    text = re.sub(r"[^a-z0-9\s]", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def is_exact_name_match(hotel_name: str, result_title: str) -> bool:
    """Check if hotel name matches result title.
    Returns True if hotel name is contained in title or vice versa."""
    name_norm = normalize_text(hotel_name)
    title_norm = normalize_text(result_title)
    if not name_norm or not title_norm:
        return False
    # Exact match
    if name_norm == title_norm:
        return True
    # Hotel name contained in title (e.g., "Grand Hotel" in "Grand Hotel Hanoi")
    if name_norm in title_norm:
        return True
    # Title contained in hotel name (less common but possible)
    if title_norm in name_norm and len(title_norm) > 3:
        return True
    return False


def address_match_percentage(hotel_address: str, page_text: str) -> int:
    address_tokens = [t for t in normalize_text(hotel_address).split() if t]
    if not address_tokens:
        return 0

    page_norm = normalize_text(page_text)
    matched = sum(1 for token in address_tokens if token in page_norm)
    return round((matched / len(address_tokens)) * 100)


def choose_search_engine(google_ok: bool, ddg_ok: bool) -> str:
    if google_ok:
        return "google"
    if ddg_ok:
        return "duckduckgo"
    return ""


def extract_domain(url: str) -> str:
    try:
        return urlparse(url).netloc.lower().replace("www.", "", 1)
    except Exception:
        return ""


def extract_ddg_url(ddg_url: str) -> str:
    """Extract URL từ DuckDuckGo redirect URL."""
    try:
        if "duckduckgo.com/l/" in ddg_url:
            parsed = urlparse(ddg_url)
            uddg = parse_qs(parsed.query).get("uddg", [None])[0]
            if uddg:
                return unquote(uddg)
        return ddg_url
    except Exception:
        return ddg_url


def is_blacklisted(url: str) -> bool:
    if not url:
        return True
    try:
        domain = extract_domain(url)
        for bl in BLACKLISTED_DOMAINS:
            if domain == bl or domain.endswith("." + bl) or domain.startswith(bl + "."):
                return True
        return False
    except Exception:
        return True


def count_hotel_images(soup: BeautifulSoup) -> int:
    """Đếm ảnh liên quan đến khách sạn, bỏ qua icon/tracking/ads."""
    skip_patterns = [
        "logo", "icon", "favicon", "avatar", "sprite", "banner", "ad",
        "tracking", "pixel", "badge", "arrow", "button", "social",
        "facebook", "twitter", "instagram", "youtube", "share",
        "flag", "currency", "arrow", "chevron", "close", "menu",
        "search", "loading", "spinner", "placeholder",
    ]

    count = 0
    for img in soup.find_all("img"):
        width = img.get("width", "")
        height = img.get("height", "")
        try:
            w = int(re.sub(r"[^\d]", "", width)) if width else 0
            h = int(re.sub(r"[^\d]", "", height)) if height else 0
            if w and w < 80:
                continue
            if h and h < 80:
                continue
        except ValueError:
            pass

        class_str = " ".join(img.get("class", []))
        id_str = img.get("id", "")
        src = img.get("src", "") or img.get("data-src", "")
        alt = img.get("alt", "")
        combined = f"{class_str} {id_str} {src} {alt}".lower()

        if any(p in combined for p in skip_patterns):
            continue

        count += 1

    return count
