# 🟢 Automated

> ✨ A repo that does absolutely nothing...  
> ...except **everything I need**.

![Daily Streak Status](https://github.com/uxillary/automated/actions/workflows/daily.yml/badge.svg)

A collection of automated GitHub Actions tracking various stats and updates across my projects.
I will add other automated tasks here in future.

## 🔧 What This Repo Does

This repo runs background GitHub Actions to:

- 🟦 **Fetch YouTube stats** for all my channels (subs, videos, views)
- 🟠 **Track XMR + BTC mining stats** (via SupportXMR and Freebitco.in)
- 🟩 **Update a daily streak file** to maintain GitHub contribution activity, as seen in my youtube video

Everything updates **automatically**, cleanly logged in JSON, CSV, or TXT formats for later use in dashboards, visualizations, or integrations.

---

## 🚀 Features

### 🎥 YouTube Stats

- Collects data for:
  - Main
  - Fortnite
  - Troubleshooting
  - Adamsmr
  - AJ Studios
- Updates every **48 hours**
- JSON snapshot → `docs/youtube.json`
- CSV history → `youtube/youtube.csv`
- View stats: [GitHub Page Link](https://uxillary.github.io/automated/) (once you’ve published)

---

### ₿ XMR + BTC Tracker

- Gets your **current Monero price** (SupportXMR)
- Tracks **btc price** 
- Updates **3x daily**
- Output: `crypto/xmr-btc.json` (or CSV if added later)

---

### 📆 Daily Streak Keeper

- Writes `last-updated.txt` daily at 9AM UTC
- Helps maintain your green contribution graph ✅

---

## 🧪 GitHub Actions Used

| Workflow            | Trigger        | Output Location     |
|---------------------|----------------|----------------------|
| youtube.yml         | 48h + Manual   | `docs/youtube.json` |
| xmr-btc.yml         | 3x daily       | `crypto/xmr-btc.*`  |
| daily.yml           | Daily at 9AM   | `last-updated.txt`  |

---

## 🪄 Want to Use This?

1. **Fork this repo**
2. Go to `Settings > Secrets and Variables > Actions` and add:
   - `YOUTUBE_API_KEY`
   - Any other secrets for your own endpoints
3. Enable GitHub Pages (use `/docs` folder)
4. Customise workflows or HTML page as needed!

---

## 🔗 Related Projects

- Personal dashboard site: [`AJ Studios`](https://ajstudios.dev)
- GitHub profile: [`@admjski`](https://github.com/uxillary)

---

## 📎 License

MIT — Use freely, credit appreciated.

