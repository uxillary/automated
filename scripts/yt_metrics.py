#!/usr/bin/env python3
import json, os, sys, glob
from pathlib import Path
import pandas as pd
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
SEARCH_DIRS = [ROOT / "data", ROOT / "docs"]
OUT_DIR = ROOT / "data" / "metrics"
OUT_DIR.mkdir(parents=True, exist_ok=True)

REQUIRED_COLS = {"date", "total_subscribers", "total_videos", "total_views"}

def find_input_csv():
    candidates = []
    for base in SEARCH_DIRS:
        if not base.exists():
            continue
        for p in base.rglob("*.csv"):
            try:
                # read only header + first 3 rows to validate quickly
                df = pd.read_csv(p, nrows=3)
                if REQUIRED_COLS.issubset(set(c.lower() for c in df.columns)):
                    # score by row count to prefer the longest time series
                    full = pd.read_csv(p)
                    candidates.append((len(full), p))
            except Exception:
                pass
    if not candidates:
        return None
    candidates.sort(reverse=True)  # longest first
    return candidates[0][1]

def ceil_to(n, step):
    return int(np.ceil(n / step) * step)

def main():
    src = find_input_csv()
    if src is None:
        print("yt-metrics: no suitable CSV found. Expected columns:", REQUIRED_COLS)
        return 0

    df = pd.read_csv(src)
    # Normalize columns
    df.columns = [c.lower() for c in df.columns]
    # Parse date (UTC)
    df["date"] = pd.to_datetime(df["date"], utc=True, errors="coerce")
    df = df.dropna(subset=["date"]).sort_values("date").reset_index(drop=True)

    # Ensure numeric
    for col in ["total_subscribers", "total_videos", "total_views"]:
        df[col] = pd.to_numeric(df[col], errors="coerce")
    df = df.dropna(subset=["total_subscribers", "total_videos", "total_views"]).reset_index(drop=True)

    # Deltas (per entry; assume roughly daily cadence)
    df["subs_delta"]  = df["total_subscribers"].diff().fillna(0)
    df["views_delta"] = df["total_views"].diff().fillna(0)
    df["videos_delta"] = df["total_videos"].diff().fillna(0)

    # Rolling averages (7d, 30d) on deltas
    for w in (7, 30):
        df[f"subs_day_avg_{w}"]  = df["subs_delta"].rolling(w, min_periods=1).mean()
        df[f"views_day_avg_{w}"] = df["views_delta"].rolling(w, min_periods=1).mean()
        df[f"videos_day_avg_{w}"] = df["videos_delta"].rolling(w, min_periods=1).mean()

    # Ratios (instant)
    df["views_per_video"] = df["total_views"] / df["total_videos"].replace(0, np.nan)
    df["views_per_sub"]   = df["total_views"] / df["total_subscribers"].replace(0, np.nan)
    df["subs_per_video"]  = df["total_subscribers"] / df["total_videos"].replace(0, np.nan)

    # Projection (linear) on last 30 points (or all if fewer)
    last_n = min(30, len(df))
    t = (df["date"] - df["date"].iloc[0]).dt.total_seconds() / 86400.0  # days
    y = df["total_subscribers"].astype(float)
    if last_n >= 3 and y.iloc[-1] > 0:
        x = t.iloc[-last_n:].to_numpy()
        y_ = y.iloc[-last_n:].to_numpy()
        try:
            slope, intercept = np.polyfit(x, y_, 1)  # subs/day
        except Exception:
            slope, intercept = 0.0, y.iloc[-1]
    else:
        slope, intercept = 0.0, (y.iloc[-1] if len(y) else 0.0)

    now_row = df.iloc[-1]
    current_subs  = int(now_row["total_subscribers"])
    current_views = int(now_row["total_views"])
    current_videos = int(now_row["total_videos"])
    last_date_iso = now_row["date"].isoformat()

    # Choose next milestones
    next_50  = ceil_to(current_subs, 50)
    next_100 = ceil_to(current_subs, 100)
    hard_1k  = 1000

    def eta_for(target):
        if slope <= 0:
            return None, None
        days_needed = (target - current_subs) / slope
        if days_needed < 0:
            return 0.0, df["date"].iloc[-1].isoformat()
        eta_ts = df["date"].iloc[-1] + pd.to_timedelta(days_needed, unit="D")
        return float(days_needed), eta_ts.isoformat()

    eta_50_days,  eta_50_date  = eta_for(next_50)
    eta_100_days, eta_100_date = eta_for(next_100)
    eta_1k_days,  eta_1k_date  = eta_for(hard_1k)

    summary = {
        "last_updated": last_date_iso,
        "current": {
            "subscribers": current_subs,
            "views": current_views,
            "videos": current_videos,
        },
        "rolling": {
            "subs_per_day_7": float(now_row.get("subs_day_avg_7", np.nan)),
            "subs_per_day_30": float(now_row.get("subs_day_avg_30", np.nan)),
            "views_per_day_7": float(now_row.get("views_day_avg_7", np.nan)),
            "views_per_day_30": float(now_row.get("views_day_avg_30", np.nan)),
        },
        "ratios": {
            "views_per_video": float(now_row.get("views_per_video", np.nan)),
            "views_per_sub": float(now_row.get("views_per_sub", np.nan)),
            "subs_per_video": float(now_row.get("subs_per_video", np.nan)),
        },
        "projection": {
            "slope_subs_per_day": float(slope),
            "next_50":  {"target": next_50,  "eta_days": eta_50_days,  "eta_date": eta_50_date},
            "next_100": {"target": next_100, "eta_days": eta_100_days, "eta_date": eta_100_date},
            "to_1000":  {"target": hard_1k,  "eta_days": eta_1k_days,  "eta_date": eta_1k_date},
        },
        "source_csv": str(src.relative_to(ROOT)),
        "outputs": {
            "enriched_csv": "data/metrics/youtube_enriched.csv",
            "summary_json": "data/metrics/youtube_summary.json"
        }
    }

    # Save outputs
    df.to_csv(OUT_DIR / "youtube_enriched.csv", index=False)
    with open(OUT_DIR / "youtube_summary.json", "w", encoding="utf-8") as f:
        json.dump(summary, f, ensure_ascii=False, indent=2)

    print("yt-metrics: wrote outputs",
          OUT_DIR / "youtube_enriched.csv",
          OUT_DIR / "youtube_summary.json")
    return 0

if __name__ == "__main__":
    sys.exit(main())
