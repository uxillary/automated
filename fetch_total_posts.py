import urllib.request, urllib.error, time
from datetime import datetime

SITES = [
    "https://404cache.net/posts-count.txt",
    "https://ajstudios.dev/posts-count.txt",
    "https://aspartameawareness.org/posts-count.txt",
]

UA = {"User-Agent": "PostCounter/1.0 (+https://github.com/uxillary/automated)"}

def fetch_int(url):
    bust = int(time.time() // 3600)  # cache-buster
    req = urllib.request.Request(f"{url}?bust={bust}", headers=UA)
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            text = r.read().decode("utf-8", "ignore").strip()
            return int("".join(ch for ch in text if ch.isdigit() or ch in "+-"))
    except Exception:
        return 0  # if unreachable, count as 0

total = sum(fetch_int(url) for url in SITES)

# write to single file
with open("docs/blog-total.txt", "w", encoding="utf-8") as f:
    f.write(str(total))

# append to CSV history
now = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S UTC")
with open("docs/blog-total.csv", "a", encoding="utf-8") as fcsv:
    fcsv.write(f"{now},{total}\n")
