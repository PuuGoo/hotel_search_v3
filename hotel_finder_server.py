"""
Hotel Finder Server - chạy liên tục, tái sử dụng Playwright browser.
Frontend gọi qua HTTP POST /search
"""
import os
os.environ['PYTHONIOENCODING'] = 'utf-8'

import sys
# Fix encoding for Windows console
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')
else:
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

from http.server import HTTPServer, BaseHTTPRequestHandler
import json
import threading
import time
from playwright.sync_api import sync_playwright
from playwright_stealth import Stealth

from hotel_matcher import pick_url_for_hotel

PORT = 5002

# Global Playwright objects
pw = None
browser = None
context = None
page = None
lock = threading.Lock()


def start_playwright():
    """Khởi động Playwright với stealth mode."""
    global pw, browser, context, page
    stealth = Stealth()
    pw_raw = sync_playwright()
    pw = stealth.use_sync(pw_raw).start()
    browser = pw.chromium.launch(headless=True)
    context = browser.new_context()
    page = context.new_page()
    print("Playwright browser started with stealth mode.", flush=True)


def search_hotel(hotel_name, hotel_address):
    """Tìm URL cho 1 khách sạn."""
    with lock:
        # Tạo page mới cho mỗi search để tránh state pollution
        search_page = context.new_page()
        try:
            url, engine, score, img_count, status = pick_url_for_hotel(search_page, hotel_name, hotel_address)
            return {
                "url": url,
                "engine": engine,
                "score": score,
                "image_count": img_count,
                "status": status,
            }
        except Exception as e:
            error_msg = str(e)
            # Handle encoding errors gracefully
            if 'charmap' in error_msg or 'encode' in error_msg.lower():
                # The search likely succeeded but logging failed
                # Return a generic error
                return {
                    "url": "",
                    "engine": "",
                    "score": 0,
                    "image_count": 0,
                    "status": "error",
                    "error": "Encoding error during search",
                }
            return {
                "url": "",
                "engine": "",
                "score": 0,
                "image_count": 0,
                "status": "error",
                "error": error_msg,
            }
        finally:
            search_page.close()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        print(f"[HTTP] {format % args}", flush=True)

    def do_GET(self):
        if self.path == "/health":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"status": "ok"}).encode())
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        if self.path == "/search":
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length)
            try:
                data = json.loads(body)
                hotel_name = data.get("hotel_name", "")
                hotel_address = data.get("hotel_address", "")
                print(f"[Search] Received: {hotel_name} | {hotel_address}", flush=True)

                result = search_hotel(hotel_name, hotel_address)
                print(f"[Search] Result: {result}", flush=True)
                resp = json.dumps(result).encode()

                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(resp)))
                self.end_headers()
                self.wfile.write(resp)
            except Exception as e:
                print(f"[Search] Error: {e}", flush=True)
                err = json.dumps({"error": str(e)}).encode()
                self.send_response(500)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(err)
        else:
            self.send_response(404)
            self.end_headers()


if __name__ == "__main__":
    print("Starting Playwright browser with stealth...", flush=True)
    start_playwright()
    print(f"Hotel Finder server running at http://localhost:{PORT}", flush=True)
    server = HTTPServer(("localhost", PORT), Handler)
    server.serve_forever()
