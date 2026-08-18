import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

import fetch_total_posts


class FetchTotalPostsTests(unittest.TestCase):
    def test_configured_sources_use_current_blog_hosts(self):
        self.assertEqual(
            fetch_total_posts.SITES,
            (
                "https://infinite-curios.pages.dev/posts-count.txt",
                "https://ajstudios-online.pages.dev/posts-count.txt",
                "https://aspartameawareness.org/posts-count.txt",
            ),
        )

    @patch("fetch_total_posts.urllib.request.urlopen")
    def test_fetch_count_accepts_an_integer(self, urlopen):
        response = MagicMock()
        response.__enter__.return_value.read.return_value = b"42\n"
        urlopen.return_value = response

        self.assertEqual(fetch_total_posts.fetch_count("https://example.com/count"), 42)

    @patch("fetch_total_posts.urllib.request.urlopen")
    def test_fetch_count_rejects_malformed_content(self, urlopen):
        response = MagicMock()
        response.__enter__.return_value.read.return_value = b"posts: 42"
        urlopen.return_value = response

        with self.assertRaisesRegex(ValueError, "Invalid post count"):
            fetch_total_posts.fetch_count("https://example.com/count")

    def test_source_failure_does_not_replace_existing_total(self):
        with tempfile.TemporaryDirectory() as directory:
            output_dir = Path(directory)
            total_file = output_dir / "blog-total.txt"
            total_file.write_text("99", encoding="utf-8")

            with patch("fetch_total_posts.fetch_count", side_effect=[10, OSError("offline")]):
                with self.assertRaisesRegex(OSError, "offline"):
                    fetch_total_posts.update_blog_total(
                        ("https://one.example", "https://two.example"), output_dir
                    )

            self.assertEqual(total_file.read_text(encoding="utf-8"), "99")
            self.assertFalse((output_dir / "blog-total.csv").exists())

    def test_success_writes_sum_and_history(self):
        with tempfile.TemporaryDirectory() as directory:
            output_dir = Path(directory)
            with patch("fetch_total_posts.fetch_count", side_effect=[10, 20, 3]):
                counts, total = fetch_total_posts.update_blog_total(
                    ("one", "two", "three"), output_dir
                )

            self.assertEqual(counts, {"one": 10, "two": 20, "three": 3})
            self.assertEqual(total, 33)
            self.assertEqual(
                (output_dir / "blog-total.txt").read_text(encoding="utf-8"), "33"
            )
            self.assertRegex(
                (output_dir / "blog-total.csv").read_text(encoding="utf-8"),
                r" UTC,33\n$",
            )


if __name__ == "__main__":
    unittest.main()
