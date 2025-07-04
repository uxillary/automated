
[![YouTube Video Count](https://github.com/uxillary/automated/actions/workflows/video-count.yml/badge.svg)](https://github.com/uxillary/automated/actions/workflows/video-count.yml)

# 📊 automated

Welcome to **automated** – a GitHub-powered dashboard for tracking YouTube channel statistics, cryptocurrency prices (XMR + BTC), and daily GitHub activity streaks using GitHub Actions and GitHub Pages.

## 🔧 What This Repo Does

This repo uses GitHub Actions to automatically:
- Fetch **YouTube stats** (subscribers, views, videos) from multiple channels
- Track **Monero (XMR)** and **Bitcoin (BTC)** prices 3x daily
- Keep a **daily commit streak** alive with a timestamp file
- Display everything neatly on a public **GitHub Pages dashboard**

---

## 📺 YouTube Stats Tracker

- Pulls stats from 5 YouTube channels
- Appends to a `youtube.csv` for long-term tracking
- Updates a current snapshot in `docs/youtube.json`
- Outputs hosted live via GitHub Pages
- Displays graph for visual representation of growth over time.

📁 Files:
- `youtube/youtube.csv` – historical stats
- `docs/youtube.json` – latest snapshot (used on website)

⏱ Schedule: every **48 hours**

---

## 🪙 XMR & BTC Price Logger

- Fetches prices from CoinGecko
- Saves to `docs/xmr-btc.json` and `crypto/xmr-btc.csv`
- Useful for price widgets, system tray apps, or analytics

📁 Files:
- `docs/xmr-btc.json` – current price snapshot
- `crypto/xmr-btc.csv` – historical log

⏱ Schedule: 3x per day (08:00, 14:00, 20:00 UTC)

---

## 📆 Daily Streak Keeper

- Updates a timestamp file (`last-updated.txt`) once per day
- Helps maintain a daily commit streak even with no changes
- Minimal footprint, runs silently without pushing other files

📁 File:
- `last-updated.txt` – updated once daily

⏱ Schedule: every **day at 09:00 UTC**

---

## 🌐 GitHub Pages Dashboard

Live site:
➡️ https://uxillary.github.io/automated/

This renders the data visually with JavaScript. JSON is used for live stats display, while CSV files power long-term tracking.

---

## 🛠️ Setup Guide

To fork and use this yourself:
1. Create a **GitHub Personal Access Token** (for pushing data)
2. Get a **YouTube Data API Key**
3. Set up the required **GitHub Secrets**:
   - `YOUTUBE_API_KEY`

Optional (for commit stats, crypto, and streaks):
- Make sure GitHub Pages is enabled on `/docs`
- Set up any additional APIs if using altcoins

---

## 🧠 Future Ideas

- Chart.js or D3.js visuals
- Weekly summary card generator
- Discord bot integration
- Telegram alerts
- Webhooks for price thresholds

---

## 👨‍💻 Maintained by:
[**@uxillary**](https://github.com/uxillary) / [**AJ Studios**](https://ajstudios.dev)  
Inspired by automation, powered by caffeine, sustained by daily commits ☕

---

