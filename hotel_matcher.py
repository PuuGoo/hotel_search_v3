"""Hotel URL matching — search + evaluate + pick best URL."""

from datetime import datetime

from hotel_url_finder import is_exact_name_match, address_match_percentage, extract_ddg_url, is_blacklisted
from hotel_gallery import extract_gallery_images


def log(msg: str):
    try:
        print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)
    except (UnicodeEncodeError, UnicodeDecodeError):
        try:
            safe_msg = msg.encode('ascii', errors='replace').decode('ascii')
            print(f"[{datetime.now().strftime('%H:%M:%S')}] {safe_msg}", flush=True)
        except Exception:
            pass  # Silently ignore logging failures


def google_search(page, query: str) -> list[dict]:
    page.goto("https://www.google.com", wait_until="domcontentloaded", timeout=30000)
    page.wait_for_timeout(1000)
    box = page.locator("textarea[name='q']")
    box.fill(query)
    box.press("Enter")
    page.wait_for_load_state("domcontentloaded")
    page.wait_for_timeout(2000)

    results = []
    links = page.locator("a:has(h3)")
    count = min(links.count(), 10)
    for i in range(count):
        link = links.nth(i)
        href = link.get_attribute("href") or ""
        title = link.inner_text().strip().split("\n")[0]
        if href and title and href.startswith("http"):
            results.append({"url": href, "title": title})
    return results


def ddg_search(page, query: str) -> list[dict]:
    encoded_query = query.replace(" ", "+")
    page.goto(f"https://duckduckgo.com/?q={encoded_query}", wait_until="domcontentloaded", timeout=30000)
    page.wait_for_timeout(3000)

    results = []
    for selector in [
        "article[data-testid='result'] a[data-testid='result-title-a']",
        "a[data-testid='result-title-a']",
        "h2 a",
        ".result__a",
    ]:
        links = page.locator(selector)
        count = links.count()
        if count > 0:
            log(f"Found {count} results with selector: {selector}")
            for i in range(min(count, 10)):
                link = links.nth(i)
                href = link.get_attribute("href") or ""
                title = (link.text_content() or "").strip()
                if href and title:
                    href = extract_ddg_url(href)
                    results.append({"url": href, "title": title})
            break
    return results


def pick_url_for_hotel(page, hotel_name: str, hotel_address: str) -> tuple:
    """Search, evaluate, and pick the best URL for a hotel.

    Returns: (url, engine, score, img_count, status)
    """
    query = f"{hotel_name} {hotel_address}".strip()
    log(f"Searching: {query}")

    def evaluate_results(results, engine):
        log(f"  [{engine}] {len(results)} results found")
        matches = []
        for i, r in enumerate(results):
            if is_blacklisted(r["url"]):
                log(f"  [{engine}] #{i+1} SKIP blacklisted: {r['url']}")
                continue
            name_ok = is_exact_name_match(hotel_name, r["title"])
            if not name_ok:
                log(f"  [{engine}] #{i+1} SKIP name mismatch: {r['title']}")
                continue
            detail = page.context.new_page()
            try:
                detail.goto(r["url"], wait_until="domcontentloaded", timeout=30000)
                detail.wait_for_timeout(2000)
                detail.keyboard.press("Escape")
                detail.wait_for_timeout(500)
                text = detail.inner_text("body")
                score = address_match_percentage(hotel_address, text)

                img_count = extract_gallery_images(detail, hotel_name)

                log(f"  [{engine}] #{i+1} title=OK addr={score}% imgs={img_count} url={r['url']}")
                if score >= 70:
                    matches.append((r["url"], engine, score, img_count, "matched"))
                else:
                    log(f"  [{engine}] #{i+1} SKIP addr below 70%")
            except Exception as e:
                log(f"  [{engine}] #{i+1} ERROR: {e}")
            finally:
                detail.close()
        return matches

    all_matches = []

    try:
        d_results = ddg_search(page, query)
    except Exception:
        d_results = []
    if d_results:
        all_matches.extend(evaluate_results(d_results, "duckduckgo"))

    if all_matches:
        best = max(all_matches, key=lambda m: m[3])
        log(f"  >>> BEST: imgs={best[3]} addr={best[2]}% engine={best[1]} url={best[0]}")
        return best

    log(f"  >>> No match found")
    return "", "", 0, 0, "no-valid-result"
