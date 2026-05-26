"""Hotel gallery image extraction using Playwright."""

from datetime import datetime


def log(msg: str):
    try:
        print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)
    except (UnicodeEncodeError, UnicodeDecodeError):
        try:
            safe_msg = msg.encode('ascii', errors='replace').decode('ascii')
            print(f"[{datetime.now().strftime('%H:%M:%S')}] {safe_msg}", flush=True)
        except Exception:
            pass  # Silently ignore logging failures


def extract_gallery_images(page, hotel_name: str = "") -> int:
    """Extract ảnh khách sạn - click vào gallery để xem tất cả ảnh."""
    gallery_opened = False

    # Tìm và click nút "See All Photos" / "View Gallery"
    try:
        gallery_btn = page.evaluate("""
            () => {
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
            }
        """)
        if gallery_btn:
            page.mouse.click(gallery_btn['x'], gallery_btn['y'])
            page.wait_for_timeout(3000)
            gallery_opened = True
            log(f"    Opened gallery via: See All X Photos button")
    except Exception:
        pass

    # Đợi và scroll để load thêm ảnh
    if gallery_opened:
        page.wait_for_timeout(2000)
        for _ in range(10):
            page.evaluate("window.scrollBy(0, 1000)")
            page.wait_for_timeout(500)

    # Đếm ảnh
    img_count = page.evaluate("""
        () => {
            const EXCLUDE_IMG = /logo|icon|favicon|avatar|sprite|banner|ad-|tracking|pixel|badge|arrow|button|social|facebook|twitter|instagram|youtube|share|flag|currency|chevron|close|menu|search|loading|spinner|placeholder|payment|partner|award|store|app-store|google-play/i;

            const urls = new Set();
            const imgs = document.querySelectorAll('img');

            for (const img of imgs) {
                const w = img.naturalWidth || img.width || parseInt(img.getAttribute('width')) || 0;
                const h = img.naturalHeight || img.height || parseInt(img.getAttribute('height')) || 0;
                if ((w > 0 && w < 80) || (h > 0 && h < 80)) continue;

                const cls = (img.className || '').toLowerCase();
                const src = (img.src || img.dataset.src || '').toLowerCase();
                const alt = (img.alt || '').toLowerCase();
                if (EXCLUDE_IMG.test(cls + ' ' + src + ' ' + alt)) continue;

                const finalSrc = img.src || img.dataset.src || '';
                if (finalSrc && finalSrc.startsWith('http')) {
                    urls.add(finalSrc.split('?')[0]);
                }
            }
            return urls.size;
        }
    """)

    # Đóng gallery nếu đã mở
    if gallery_opened:
        page.keyboard.press("Escape")
        page.wait_for_timeout(500)

    return img_count
