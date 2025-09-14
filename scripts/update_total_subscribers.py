#!/usr/bin/env python3
"""Update total-subscribers.txt from docs/youtube-sum.json.

This script reads the per-channel statistics stored in
``docs/youtube-sum.json`` and writes the aggregated subscriber count to
``docs/total-subscribers.txt``. The previous approach relied on a value
passed through the GitHub Actions environment which sometimes resulted
in the placeholder value ``0``. By deriving the total directly from the
JSON file we ensure the text file always reflects the latest fetched
statistics.
"""

from __future__ import annotations

import json
from pathlib import Path

def main() -> None:
    json_path = Path("docs/youtube-sum.json")
    total_path = Path("docs/total-subscribers.txt")

    # Load per-channel stats. If the file is missing or malformed, raise
    # a clear error so the workflow fails rather than silently writing 0.
    data = json.loads(json_path.read_text(encoding="utf-8"))

    total = sum(int(ch.get("subscribers", 0)) for ch in data.values())
    # Write the value with a trailing newline so that `cat` prints it cleanly
    total_path.write_text(f"{total}\n", encoding="utf-8")
    print(f"Wrote total subscriber count: {total}")

if __name__ == "__main__":
    main()
