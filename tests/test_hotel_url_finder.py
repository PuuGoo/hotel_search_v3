import unittest

from hotel_url_finder import (
    normalize_text,
    is_exact_name_match,
    address_match_percentage,
    choose_search_engine,
)


class HotelUrlFinderLogicTests(unittest.TestCase):
    def test_exact_name_match_ignores_case_and_punctuation(self):
        self.assertTrue(is_exact_name_match("Khach San ABC", "Khách sạn ABC!!!"))

    def test_exact_name_match_fails_when_different_words(self):
        self.assertFalse(is_exact_name_match("Khach San ABC", "Khach San ABD"))

    def test_address_match_percentage_meets_threshold(self):
        address = "123 Nguyen Trai, Quan 1, Ho Chi Minh"
        page_text = "Welcome. Address: 123 Nguyen Trai Street, Quan 1, Ho Chi Minh City, Vietnam"
        self.assertGreaterEqual(address_match_percentage(address, page_text), 70)

    def test_choose_search_engine_prefers_google_then_duckduckgo(self):
        self.assertEqual(choose_search_engine(google_ok=False, ddg_ok=True), "duckduckgo")
        self.assertEqual(choose_search_engine(google_ok=True, ddg_ok=True), "google")


if __name__ == "__main__":
    unittest.main()
