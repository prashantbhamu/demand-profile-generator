from __future__ import annotations

import csv
import io
import json
import threading
import unittest
import uuid
from urllib.error import HTTPError
from urllib.request import Request, urlopen

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

    def post_multipart(
        self,
        path: str,
        fields: dict[str, str],
        files: dict[str, tuple[str, bytes]],
    ) -> tuple[int, dict]:
        boundary = f"----codex-{uuid.uuid4().hex}"
        chunks: list[bytes] = []
        for name, value in fields.items():
            chunks.extend(
                [
                    f"--{boundary}\r\n".encode(),
                    f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode(),
                    str(value).encode(),
                    b"\r\n",
                ]
            )
        for name, (filename, data) in files.items():
            chunks.extend(
                [
                    f"--{boundary}\r\n".encode(),
                    (
                        f'Content-Disposition: form-data; name="{name}"; '
                        f'filename="{filename}"\r\n'
                    ).encode(),
                    b"Content-Type: text/csv\r\n\r\n",
                    data,
                    b"\r\n",
                ]
            )
        chunks.append(f"--{boundary}--\r\n".encode())
        request = Request(
            f"{self.base_url}{path}",
            data=b"".join(chunks),
            headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
            method="POST",
        )
        try:
            with urlopen(request) as response:
                return response.status, json.loads(response.read())
        except HTTPError as error:
            return error.code, json.loads(error.read())

    def test_index_uses_prism_identity_and_approved_subtitle(self) -> None:
        content_type, body = self.fetch("/")
        text = body.decode("utf-8")
        self.assertEqual(content_type, "text/html")
        self.assertIn("<title>PRISM</title>", text)
        self.assertIn("Power-demand Reconstruction, Integration &amp; Scaling Model", text)
        self.assertIn(
            '<span class="prism-initial">R</span>'
            '<span class="prism-suffix">econstruction,</span>',
            text,
        )
        self.assertIn(
            '<span class="prism-joiner">&amp;</span>'
            '<span class="prism-initial">S</span>',
            text,
        )
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

    def test_prism_mark_uses_fifteen_percent_shorter_trajectories(self) -> None:
        _, body = self.fetch("/prism-logo.svg")
        text = body.decode("utf-8")
        self.assertIn('id="prism-input-trajectory" d="M25.4 92', text)
        for output_id in range(1, 4):
            self.assertIn(f'id="prism-output-trajectory-{output_id}"', text)
        self.assertEqual(text.count("306.2"), 3)

    def test_base_profile_validation_reports_resolution_and_contextual_coverage(self) -> None:
        output = io.StringIO()
        writer = csv.writer(output, lineterminator="\n")
        writer.writerow(["demand"])
        for _ in range(365 * 24):
            writer.writerow([100])
        status, payload = self.post_multipart(
            "/validate-base-profile",
            {"base_financial_year": "2024"},
            {"base_profile": ("base.csv", output.getvalue().encode())},
        )
        self.assertEqual(status, 200)
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["periods_per_day"], 24)
        self.assertTrue(payload["coverage_valid"])

    def test_target_validation_separates_structure_from_year_coverage(self) -> None:
        target_csv = b"DateTime,target\n2025-04-01,100\n2026-04-01,110\n"
        status, payload = self.post_multipart(
            "/validate-target-file",
            {
                "target_kind": "peak",
                "projection_start_year": "2025",
                "projection_end_year": "2027",
                "profile_name": "",
            },
            {"peak_projection": ("peak.csv", target_csv)},
        )
        self.assertEqual(status, 200)
        self.assertTrue(payload["ok"])
        self.assertFalse(payload["coverage_valid"])
        self.assertIn("2027", payload["coverage_error"])

    def test_target_validation_returns_actionable_schema_error(self) -> None:
        status, payload = self.post_multipart(
            "/validate-target-file",
            {
                "target_kind": "energy",
                "projection_start_year": "2025",
                "projection_end_year": "2025",
                "profile_name": "",
            },
            {"energy_projection": ("energy.csv", b"year,value\n2025,100\n")},
        )
        self.assertEqual(status, 400)
        self.assertFalse(payload["ok"])
        self.assertIn("DateTime", payload["error"])


if __name__ == "__main__":
    unittest.main()
