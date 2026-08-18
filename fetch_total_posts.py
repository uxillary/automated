import re
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path


SITES = (
    "https://infinite-curios.pages.dev/posts-count.txt",
    "https://ajstudios-online.pages.dev/posts-count.txt",
    "https://aspartameawareness.org/posts-count.txt",
)
USER_AGENT = {"User-Agent": "PostCounter/1.0 (+https://github.com/uxillary/automated)"}
COUNT_PATTERN = re.compile(r"\A\s*(\d+)\s*\Z")


def fetch_count(url):
    """Fetch a post count, raising an error for unavailable or malformed sources."""
    cache_buster = int(time.time() // 3600)
    request = urllib.request.Request(
        f"{url}?bust={cache_buster}", headers=USER_AGENT
    )
    with urllib.request.urlopen(request, timeout=20) as response:
        body = response.read().decode("utf-8")

    match = COUNT_PATTERN.fullmatch(body)
    if not match:
        raise ValueError(f"Invalid post count returned by {url}: {body!r}")
    return int(match.group(1))


def update_blog_total(sites=SITES, output_dir=Path("docs")):
    """Fetch every source before updating the snapshot and history files."""
    counts = {url: fetch_count(url) for url in sites}
    total = sum(counts.values())

    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "blog-total.txt").write_text(str(total), encoding="utf-8")
    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    with (output_dir / "blog-total.csv").open("a", encoding="utf-8") as history:
        history.write(f"{timestamp},{total}\n")

    return counts, total


def main():
    counts, total = update_blog_total()
    for url, count in counts.items():
        print(f"{url}: {count}")
    print(f"Total blog posts: {total}")


if __name__ == "__main__":
    main()
