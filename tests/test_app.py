from __future__ import annotations

import threading
import unittest
from urllib.request import urlopen

from profile_tool.app import ProfileToolHandler, ThreadingHTTPServer


class StaticBrandAssetTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), ProfileToolHandler)
        cls.server.quiet = True
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base_url = f"http://127.0.0.1:{cls.server.server_address[1]}"

    @classmethod
    def tearDownClass(cls) -> None:
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=2)

    def fetch(self, path: str) -> tuple[str, bytes]:
        with urlopen(f"{self.base_url}{path}") as response:
            return response.headers.get_content_type(), response.read()

    def test_index_uses_prism_identity_and_approved_subtitle(self) -> None:
        content_type, body = self.fetch("/")
        text = body.decode("utf-8")
        self.assertEqual(content_type, "text/html")
        self.assertIn("<title>PRISM</title>", text)
        self.assertIn("Power-demand Reconstruction, Integration and Scaling Model", text)
        self.assertIn(
            "Create future grid-demand profiles from peak and energy targets, "
            "with optional rooftop solar adjustment.",
            text,
        )

    def test_prism_assets_are_served_with_expected_types(self) -> None:
        expected = {
            "/prism-logo.svg": "image/svg+xml",
            "/prism-brand.js": "application/javascript",
            "/fonts/RussoOne-Regular.ttf": "font/ttf",
            "/fonts/OFL-RussoOne.txt": "text/plain",
        }
        for path, content_type in expected.items():
            with self.subTest(path=path):
                actual, body = self.fetch(path)
                self.assertEqual(actual, content_type)
                self.assertTrue(body)


if __name__ == "__main__":
    unittest.main()
