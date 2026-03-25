(async function () {
  const base = location.pathname.includes('/automated') ? '/automated' : '';
  const summaryUrls = [`${base}/metrics/youtube_summary.json`, '/metrics/youtube_summary.json'];
  const channelsUrls = [`${base}/youtube.json`, '/youtube.json'];
  const historyUrls = [`${base}/youtube/youtube-history-sum.csv`, '/youtube/youtube-history-sum.csv'];

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

  const fetchAnyText = async (urls) => {
    let lastErr;
    for (const url of urls) {
      try {
        const res = await fetch(url, { cache: 'no-store' });
        if (res.ok) return res.text();
        lastErr = new Error(`HTTP ${res.status}`);
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr || new Error('Unable to load text');
  };

  const fmt = (n, digits = 0) => (
    n == null || Number.isNaN(n)
      ? '—'
      : Number(n).toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits })
  );

  const safeRatio = (a, b) => (b > 0 ? a / b : null);
  const DAY_MS = 86400000;

  const csvParse = (text) => {
    const [header, ...lines] = text.trim().split(/\r?\n/);
    const cols = header.split(',');
    return lines.filter(Boolean).map((line) => {
      const parts = line.split(',');
      const row = {};
      cols.forEach((c, i) => { row[c] = parts[i]; });
      return row;
    });
  };

  const toRows = (channels) => Object.entries(channels || {}).map(([name, stats]) => {
    const subscribers = Number(stats.subscribers || 0);
    const views = Number(stats.views || 0);
    const videos = Number(stats.videos || 0);
    return {
      name: name.replace(/_/g, ' '),
      subscribers,
      views,
      videos,
      viewsPerVideo: safeRatio(views, videos),
      subsPerVideo: safeRatio(subscribers, videos)
    };
  });

  const maxBy = (arr, key) => arr.filter((x) => x[key] != null).sort((a, b) => b[key] - a[key])[0] || null;

  const renderStyles = () => {
    const style = document.createElement('style');
    style.textContent = `
      #insightGrid .card,#creatorSignalsGrid .card{padding:16px 18px}
      .rank-list{display:grid;gap:10px;margin-top:12px}
      .rank-item{display:flex;justify-content:space-between;gap:12px;padding:10px 12px;border:1px solid var(--border);border-radius:12px;background:var(--surface-soft)}
      .rank-label{font-size:.82rem;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;font-weight:640}
      .rank-value{font-weight:700;text-align:right}
      .insight-group{margin-top:12px}
      .insight-group h4{margin:0 0 8px;font-size:.88rem;color:var(--muted);text-transform:uppercase;letter-spacing:.05em}
      .insight-list{margin:0;padding-left:18px;display:grid;gap:8px}
      .chip-list{display:grid;gap:8px;margin-top:10px}
      .signal-chip{border:1px solid var(--border);border-radius:12px;padding:9px 11px;background:var(--surface-soft)}
      .signal-chip.warning{border-color:rgba(248,113,113,.45)}
      .signal-chip.opportunity{border-color:rgba(52,211,153,.45)}
      .micro{font-size:.8rem;color:var(--muted)}
      .focus-card{margin-top:12px;padding:10px 12px;border:1px solid var(--border);border-radius:12px;background:var(--surface-soft)}
    `;
    document.head.appendChild(style);
  };

  const normalizeDailyHistory = (historyRows) => {
    const byChannelDate = new Map();
    historyRows.forEach((row) => {
      const channel = (row.channel || '').replace(/_/g, ' ');
      const dateObj = new Date(String(row.date || '').replace(' UTC', 'Z'));
      if (Number.isNaN(dateObj.getTime())) return;
      const dateKey = dateObj.toISOString().slice(0, 10);
      const key = `${channel}__${dateKey}`;
      const existing = byChannelDate.get(key);
      if (!existing || dateObj > existing.snapshotAt) {
        byChannelDate.set(key, {
          channel,
          dateKey,
          snapshotAt: dateObj,
          subscribers: Number(row.subscribers || 0),
          views: Number(row.views || 0),
          videos: Number(row.videos || 0)
        });
      }
    });

    const byChannel = new Map();
    Array.from(byChannelDate.values()).forEach((row) => {
      if (!byChannel.has(row.channel)) byChannel.set(row.channel, []);
      byChannel.get(row.channel).push(row);
    });

    byChannel.forEach((rows) => rows.sort((a, b) => a.snapshotAt - b.snapshotAt));
    return byChannel;
  };

  const computeChannelActivity = (channelRows, latestDate) => {
    if (!channelRows?.length) return null;
    const events = [];
    const nonUploadTransitions = [];
    for (let i = 1; i < channelRows.length; i += 1) {
      const prev = channelRows[i - 1];
      const curr = channelRows[i];
      const videoDelta = curr.videos - prev.videos;
      const subsDelta = curr.subscribers - prev.subscribers;
      const viewsDelta = curr.views - prev.views;
      const dayGap = Math.max(1, Math.round((curr.snapshotAt - prev.snapshotAt) / DAY_MS));
      const transition = { date: curr.snapshotAt, videoDelta, subsDelta, viewsDelta, dayGap };
      if (videoDelta > 0) events.push(transition);
      else nonUploadTransitions.push(transition);
    }

    const recent7 = events.filter((e) => (latestDate - e.date) / DAY_MS <= 7).reduce((sum, e) => sum + e.videoDelta, 0);
    const recent30 = events.filter((e) => (latestDate - e.date) / DAY_MS <= 30).reduce((sum, e) => sum + e.videoDelta, 0);
    const lastEvent = events.at(-1);
    const daysSinceLastUpload = lastEvent ? Math.max(0, Math.round((latestDate - lastEvent.date) / DAY_MS)) : null;

    const spanDays = Math.max(1, Math.round((channelRows.at(-1).snapshotAt - channelRows[0].snapshotAt) / DAY_MS) + 1);
    const coverageRatio = channelRows.length / spanDays;
    const maxGap = channelRows.slice(1).reduce((m, row, idx) => {
      const gap = Math.max(1, Math.round((row.snapshotAt - channelRows[idx].snapshotAt) / DAY_MS));
      return Math.max(m, gap);
    }, 1);
    const reliableStreak = coverageRatio >= 0.65 && maxGap <= 2;

    let streak = null;
    if (reliableStreak && lastEvent) {
      streak = 1;
      for (let i = events.length - 2; i >= 0; i -= 1) {
        const gap = Math.round((events[i + 1].date - events[i].date) / DAY_MS);
        if (gap === 1) streak += 1;
        else break;
      }
    }

    const avgUploadSubs = events.length ? events.reduce((s, e) => s + e.subsDelta, 0) / events.length : null;
    const avgUploadViews = events.length ? events.reduce((s, e) => s + e.viewsDelta, 0) / events.length : null;
    const avgNonUploadSubs = nonUploadTransitions.length ? nonUploadTransitions.reduce((s, e) => s + e.subsDelta, 0) / nonUploadTransitions.length : null;
    const avgNonUploadViews = nonUploadTransitions.length ? nonUploadTransitions.reduce((s, e) => s + e.viewsDelta, 0) / nonUploadTransitions.length : null;

    return {
      recent7,
      recent30,
      daysSinceLastUpload,
      streak,
      reliableStreak,
      events,
      avgUploadSubs,
      avgUploadViews,
      avgNonUploadSubs,
      avgNonUploadViews
    };
  };

  const buildNarrative = ({ summary, rows, selectedRows, selectedActivity, latestDate }) => {
    const positives = [];
    const watchouts = [];
    const opportunities = [];

    const viewsLeader = maxBy(selectedRows, 'viewsPerVideo');
    const largestAudience = maxBy(selectedRows, 'subscribers');

    const activeChannels = selectedActivity.filter((c) => c.activity?.daysSinceLastUpload != null && c.activity.daysSinceLastUpload <= 30);
    const inactiveChannels = selectedActivity.filter((c) => c.activity?.daysSinceLastUpload != null && c.activity.daysSinceLastUpload > 45);

    if (activeChannels.length) positives.push(`${activeChannels.length}/${selectedActivity.length} selected channels show upload activity in the last 30 days.`);

    const impactReady = selectedActivity.filter((c) => (c.activity?.events?.length || 0) >= 2);
    if (impactReady.length) {
      const avgUploadViews = impactReady.reduce((s, c) => s + (c.activity.avgUploadViews || 0), 0) / impactReady.length;
      const avgNonUploadViews = impactReady.reduce((s, c) => s + (c.activity.avgNonUploadViews || 0), 0) / impactReady.length;
      if (avgUploadViews > avgNonUploadViews * 1.1) positives.push('Recent upload-active periods align with stronger short-term view growth.');
      if (avgUploadViews < avgNonUploadViews * 0.9) watchouts.push('Upload periods are active, but short-term view lift is currently modest.');
    }

    if (inactiveChannels.length) {
      const oldest = inactiveChannels.sort((a, b) => (b.activity.daysSinceLastUpload || 0) - (a.activity.daysSinceLastUpload || 0))[0];
      watchouts.push(`${oldest.name} has gone ${fmt(oldest.activity.daysSinceLastUpload)} days without a visible upload event.`);
    }

    if (viewsLeader) {
      const leaderActivity = selectedActivity.find((c) => c.name === viewsLeader.name)?.activity;
      if ((leaderActivity?.recent30 || 0) <= 1) opportunities.push(`${viewsLeader.name} has the best views/video ratio with low recent output — potential focus opportunity.`);
    }

    const smallEfficient = selectedRows
      .filter((r) => r.subscribers <= 100 && r.viewsPerVideo != null)
      .sort((a, b) => b.viewsPerVideo - a.viewsPerVideo)[0];
    if (smallEfficient) opportunities.push(`${smallEfficient.name} is relatively small but efficient on a per-video basis.`);

    const staleDays = Math.round((Date.now() - new Date(summary?.last_updated || latestDate).getTime()) / DAY_MS);
    const freshness = staleDays > 3
      ? `Data freshness: ${staleDays} days old (stale warning).`
      : `Data freshness: updated ${fmt(staleDays)} day(s) ago.`;

    const focusCandidates = selectedActivity
      .map((c) => {
        const efficiency = selectedRows.find((r) => r.name === c.name)?.viewsPerVideo || 0;
        const momentum = c.activity?.avgUploadViews != null && c.activity?.avgNonUploadViews != null
          ? c.activity.avgUploadViews - c.activity.avgNonUploadViews
          : 0;
        const inactivityPenalty = (c.activity?.daysSinceLastUpload || 999) > 30 ? -250 : 0;
        return { name: c.name, score: efficiency + momentum + inactivityPenalty, efficiency, momentum, inactive: c.activity?.daysSinceLastUpload || null };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 2);

    const focusText = focusCandidates.length
      ? focusCandidates.map((c) => `${c.name}: ${fmt(c.efficiency, 0)} views/video${c.momentum > 0 ? ', improving during upload-active periods' : ''}${c.inactive > 30 ? ', currently inactive' : ''}.`).join(' ')
      : 'Confidence is low due to sparse activity history in the selected set.';

    return {
      positives,
      watchouts,
      opportunities,
      freshness,
      focusText,
      largestAudience,
      viewsLeader
    };
  };

  const renderHighlights = (rows, narrative) => {
    const mount = document.getElementById('channelHighlightsMount');
    if (!mount) return;

    const highlights = [
      ['Largest audience', narrative.largestAudience ? `${narrative.largestAudience.name} · ${fmt(narrative.largestAudience.subscribers)}` : '—'],
      ['Best views/video', narrative.viewsLeader ? `${narrative.viewsLeader.name} · ${fmt(narrative.viewsLeader.viewsPerVideo, 0)}` : '—'],
      ['Top subs/video', maxBy(rows, 'subsPerVideo') ? `${maxBy(rows, 'subsPerVideo').name} · ${fmt(maxBy(rows, 'subsPerVideo').subsPerVideo, 2)}` : '—'],
      ['Most uploads', maxBy(rows, 'videos') ? `${maxBy(rows, 'videos').name} · ${fmt(maxBy(rows, 'videos').videos)}` : '—']
    ];

    mount.innerHTML = `
      <h3 class="section-title">Channel Highlights</h3>
      <p class="table-subtitle">Latest snapshot rankings for selected channels.</p>
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

  const renderInsights = (narrative) => {
    const mount = document.getElementById('insightsMount');
    if (!mount) return;

    const listOrFallback = (items, fallback) => items.length
      ? `<ul class="insight-list">${items.map((x) => `<li>${x}</li>`).join('')}</ul>`
      : `<div class="micro">${fallback}</div>`;

    mount.innerHTML = `
      <h3 class="section-title">Creator Insight Narrative</h3>
      <p class="table-subtitle">Grouped, rule-based signals from current and historical snapshots.</p>
      <div class="insight-group">
        <h4>What’s going well</h4>
        ${listOrFallback(narrative.positives, 'No strong positive pattern in the selected slice yet.')}
      </div>
      <div class="insight-group">
        <h4>Watch-outs</h4>
        ${listOrFallback(narrative.watchouts, 'No immediate warning signal from available history.')}
      </div>
      <div class="insight-group">
        <h4>Opportunities</h4>
        ${listOrFallback(narrative.opportunities, 'No clear opportunity stood out with high confidence.')}
      </div>
    `;
  };

  const renderActivity = (selectedActivity, narrative, summary) => {
    const mount = document.getElementById('activityMount');
    if (!mount) return;

    const byRecent = [...selectedActivity].sort((a, b) => (a.activity?.daysSinceLastUpload ?? 999) - (b.activity?.daysSinceLastUpload ?? 999));
    const chips = byRecent.slice(0, 5).map((row) => {
      const a = row.activity;
      if (!a) return `<div class="signal-chip warning"><strong>${row.name}</strong><div class="micro">Insufficient upload history.</div></div>`;
      const status = a.daysSinceLastUpload == null ? 'unknown' : (a.daysSinceLastUpload <= 30 ? 'active' : 'inactive');
      return `<div class="signal-chip ${status === 'inactive' ? 'warning' : ''}"><strong>${row.name}</strong><div class="micro">${fmt(a.recent7)} uploads (7d) · ${fmt(a.recent30)} uploads (30d) · ${a.daysSinceLastUpload == null ? 'last upload unknown' : `${fmt(a.daysSinceLastUpload)} days since last upload`} ${a.reliableStreak && a.streak != null ? `· streak ${fmt(a.streak)} day(s)` : '· streak hidden (sparse snapshots)'}</div></div>`;
    }).join('');

    mount.innerHTML = `
      <h3 class="section-title">Activity & Consistency</h3>
      <p class="table-subtitle">Upload signals are inferred from day-over-day video-count changes in tracked snapshots.</p>
      <div class="chip-list">${chips || '<div class="micro">No activity data available for selected channels.</div>'}</div>
      <div class="insight-group">
        <h4>Dashboard health</h4>
        <div class="micro">${narrative.freshness}</div>
        <div class="micro">Last update: ${summary?.last_updated ? new Date(summary.last_updated).toLocaleString() : 'Unavailable'}.</div>
      </div>
    `;
  };

  const renderFocus = (narrative) => {
    const mount = document.getElementById('focusMount');
    if (!mount) return;

    const cards = [
      ...narrative.opportunities.slice(0, 2).map((text) => `<div class="signal-chip opportunity">Opportunity: ${text}</div>`),
      ...narrative.watchouts.slice(0, 2).map((text) => `<div class="signal-chip warning">Warning: ${text}</div>`)
    ].slice(0, 4);

    mount.innerHTML = `
      <h3 class="section-title">Where to Focus Next</h3>
      <p class="table-subtitle">Rule-based recommendation from efficiency, momentum alignment, and activity recency.</p>
      <div class="focus-card">${narrative.focusText}</div>
      <div class="chip-list">${cards.join('') || '<div class="micro">Not enough reliable signals for opportunity/warning cards yet.</div>'}</div>
    `;
  };

  try {
    renderStyles();
    const [summary, channels, historyCsv] = await Promise.all([
      fetchAnyJSON(summaryUrls),
      fetchAnyJSON(channelsUrls),
      fetchAnyText(historyUrls)
    ]);

    const allRows = toRows(channels);
    const historyByChannel = normalizeDailyHistory(csvParse(historyCsv));
    const latestDate = Array.from(historyByChannel.values())
      .flatMap((rows) => rows.map((r) => r.snapshotAt))
      .sort((a, b) => b - a)[0] || new Date();

    const renderFromSelection = (selection) => {
      if (!selection?.selectedChannels?.length) {
        renderHighlights([], { largestAudience: null, viewsLeader: null });
        renderInsights({ positives: [], watchouts: [], opportunities: [] });
        renderActivity([], { freshness: 'Data unavailable.' }, summary);
        renderFocus({ focusText: 'Select at least one channel to generate a focus recommendation.', opportunities: [], watchouts: [] });
        return;
      }

      const selectedSet = new Set(selection.selectedChannels);
      const rows = allRows.filter((row) => selectedSet.has(row.name));
      const selectedActivity = rows.map((row) => ({
        name: row.name,
        activity: computeChannelActivity(historyByChannel.get(row.name), latestDate)
      }));

      const narrative = buildNarrative({ summary, rows: allRows, selectedRows: rows, selectedActivity, latestDate });
      renderHighlights(rows, narrative);
      renderInsights(narrative);
      renderActivity(selectedActivity, narrative, summary);
      renderFocus(narrative);
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
})();
