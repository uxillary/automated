(async function () {
  const base = location.pathname.includes('/automated') ? '/automated' : '';
  const summaryUrls = [`${base}/metrics/youtube_summary.json`, '/metrics/youtube_summary.json'];
  const channelsUrls = [`${base}/youtube.json`, '/youtube.json'];

  const fetchAnyJSON = async (urls) => {
    let lastErr;
    for (const url of urls) {
      try {
        const res = await fetch(url, { cache: 'no-store' });
        if (res.ok) return res.json();
        lastErr = new Error(`HTTP ${res.status}`);
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr || new Error('Unable to load JSON');
  };

  const fmt = (n, digits = 0) => (
    n == null || Number.isNaN(n)
      ? '—'
      : Number(n).toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits })
  );

  const safeRatio = (a, b) => (b > 0 ? a / b : null);
  const asRows = (channels) => Object.entries(channels || {}).map(([name, stats]) => {
    const subscribers = Number(stats.subscribers || 0);
    const views = Number(stats.views || 0);
    const videos = Number(stats.videos || 0);
    return {
      name: name.replace(/_/g, ' '),
      subscribers,
      views,
      videos,
      viewsPerVideo: safeRatio(views, videos),
      subsPerVideo: safeRatio(subscribers, videos),
      viewsPerSub: safeRatio(views, subscribers)
    };
  });

  const maxBy = (arr, key) => arr.filter(x => x[key] != null).sort((a, b) => b[key] - a[key])[0] || null;
  const minBy = (arr, key) => arr.filter(x => x[key] != null).sort((a, b) => a[key] - b[key])[0] || null;

  const momentumLabel = (delta, baseline = 1) => {
    if (delta == null || Number.isNaN(delta)) return 'insufficient data';
    const threshold = Math.max(Math.abs(baseline) * 0.05, 0.1);
    if (delta > threshold) return 'accelerating';
    if (delta < -threshold) return 'cooling';
    return 'steady';
  };

  const formatEta = (days, dateISO) => {
    if (days == null || !Number.isFinite(days) || days <= 0 || !dateISO) return 'Unavailable';
    const d = new Date(dateISO);
    return `${Math.round(days)} days · ${d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}`;
  };

  const buildHighlights = (rows) => {
    const largestAudience = maxBy(rows, 'subscribers');
    const mostVideos = maxBy(rows, 'videos');
    const bestViewsPerVideo = maxBy(rows, 'viewsPerVideo');
    const bestSubsPerVideo = maxBy(rows, 'subsPerVideo');
    const smallest = minBy(rows, 'subscribers');
    const smallestStrong = rows
      .filter(r => smallest && r.subscribers <= (smallest.subscribers * 2) && r.viewsPerVideo != null)
      .sort((a, b) => b.viewsPerVideo - a.viewsPerVideo)[0] || null;

    return [
      ['Largest audience', largestAudience ? `${largestAudience.name} · ${fmt(largestAudience.subscribers)}` : '—'],
      ['Most videos', mostVideos ? `${mostVideos.name} · ${fmt(mostVideos.videos)}` : '—'],
      ['Best views/video', bestViewsPerVideo ? `${bestViewsPerVideo.name} · ${fmt(bestViewsPerVideo.viewsPerVideo, 0)}` : '—'],
      ['Best subs/video', bestSubsPerVideo ? `${bestSubsPerVideo.name} · ${fmt(bestSubsPerVideo.subsPerVideo, 2)}` : '—'],
      ['Smallest + efficient', smallestStrong ? `${smallestStrong.name} · ${fmt(smallestStrong.viewsPerVideo, 0)} views/video` : '—']
    ];
  };

  const buildInsights = (summary, rows) => {
    const roll = summary?.rolling || {};
    const subsMomentum = roll.subs_per_day_7 != null && roll.subs_per_day_30 != null
      ? Number(roll.subs_per_day_7) - Number(roll.subs_per_day_30)
      : null;
    const viewsMomentum = roll.views_per_day_7 != null && roll.views_per_day_30 != null
      ? Number(roll.views_per_day_7) - Number(roll.views_per_day_30)
      : null;

    const bestViewsPerVideo = maxBy(rows, 'viewsPerVideo');
    const worstViewsPerVideo = minBy(rows, 'viewsPerVideo');
    const outputLeader = maxBy(rows, 'videos');

    const insights = [];
    if (subsMomentum != null) {
      insights.push(`Subscriber growth is ${momentumLabel(subsMomentum, Number(roll.subs_per_day_30 || 1))} (${subsMomentum > 0 ? '+' : ''}${fmt(subsMomentum, 2)}/day vs 30-day pace).`);
    }
    if (viewsMomentum != null) {
      insights.push(`View momentum is ${momentumLabel(viewsMomentum, Number(roll.views_per_day_30 || 1))} (${viewsMomentum > 0 ? '+' : ''}${fmt(viewsMomentum, 0)}/day vs 30-day pace).`);
    }
    if (bestViewsPerVideo && worstViewsPerVideo && bestViewsPerVideo.viewsPerVideo > (worstViewsPerVideo.viewsPerVideo || 0) * 1.8) {
      insights.push(`${bestViewsPerVideo.name} is outperforming on a per-upload basis (${fmt(bestViewsPerVideo.viewsPerVideo, 0)} views/video).`);
    }
    if (outputLeader && worstViewsPerVideo && outputLeader.name === worstViewsPerVideo.name && outputLeader.videos >= 20) {
      insights.push(`${outputLeader.name} leads upload volume but has weaker per-video efficiency right now.`);
    }
    if (roll.subs_per_day_7 != null && roll.subs_per_day_30 != null && Number(roll.subs_per_day_7) > Number(roll.subs_per_day_30) * 1.5) {
      insights.push('Recent subscriber pace is materially stronger than the long-term baseline.');
    }
    return insights.slice(0, 5);
  };

  const renderHighlights = (highlights) => {
    const mount = document.getElementById('channelHighlightsMount');
    if (!mount) return;
    mount.innerHTML = `
      <h3 class="section-title">Channel Highlights</h3>
      <p class="table-subtitle">Current snapshot rankings from latest channel totals.</p>
      <div class="rank-list">
        ${highlights.map(([label, value]) => `
          <div class="rank-item">
            <span class="rank-label">${label}</span>
            <span class="rank-value">${value}</span>
          </div>
        `).join('')}
      </div>
    `;
  };

  const renderInsights = (insights) => {
    const mount = document.getElementById('insightsMount');
    if (!mount) return;
    mount.innerHTML = `
      <h3 class="section-title">What This Means</h3>
      <p class="table-subtitle">Rule-based observations from current metrics.</p>
      <ul class="insight-list">
        ${insights.length
          ? insights.map(item => `<li>${item}</li>`).join('')
          : '<li>Not enough complete data for concise insights yet.</li>'}
      </ul>
    `;
  };

  const renderStyles = () => {
    const style = document.createElement('style');
    style.textContent = `
      #insightGrid .card{padding:16px 18px}
      .rank-list{display:grid;gap:10px;margin-top:12px}
      .rank-item{display:flex;justify-content:space-between;gap:12px;padding:10px 12px;border:1px solid var(--border);border-radius:12px;background:var(--surface-soft)}
      .rank-label{font-size:.82rem;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;font-weight:640}
      .rank-value{font-weight:700;text-align:right}
      .insight-list{margin:12px 0 0;padding-left:18px;display:grid;gap:8px}
      .insight-list li{color:var(--fg)}
    `;
    document.head.appendChild(style);
  };

  try {
    renderStyles();
    const [summary, channels] = await Promise.all([fetchAnyJSON(summaryUrls), fetchAnyJSON(channelsUrls)]);
    const allRows = asRows(channels);

    const renderFromSelection = (selection) => {
      if (!selection?.selectedChannels?.length) {
        renderHighlights([]);
        renderInsights(['No channels selected. Enable at least one channel to see highlights and insights.']);
        return;
      }
      const selectedSet = new Set(selection.selectedChannels);
      const rows = allRows.filter((row) => selectedSet.has(row.name));
      const insights = buildInsights(summary, rows);
      const rangeLabelMap = { '7': '7 days', '30': '30 days', '90': '90 days', all: 'all time' };
      insights.unshift(`Insights based on ${selection.selectedChannels.length} selected channel(s) over ${rangeLabelMap[selection.timeRange] || 'selected range'}.`);
      renderHighlights(buildHighlights(rows));
      renderInsights(insights);
    };

    renderFromSelection(window.dashboardSelection || {
      timeRange: '30',
      selectedChannels: allRows.map((r) => r.name)
    });

    window.addEventListener('dashboard:selectionchange', (event) => {
      renderFromSelection(event.detail || {});
    });
  } catch (err) {
    console.debug('yt-insights unavailable:', err?.message || err);
  }

  // Expose formatter for milestone/scenario cards.
  window.ytInsightFormatEta = formatEta;
})();
