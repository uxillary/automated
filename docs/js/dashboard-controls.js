(function () {
  const STORAGE_KEY = 'ytDashboardPrefs.v1';
  const TIME_RANGES = [
    { key: '7', label: '7 days', days: 7 },
    { key: '30', label: '30 days', days: 30 },
    { key: '90', label: '90 days', days: 90 },
    { key: '180', label: '180 days', days: 180 },
    { key: '365', label: '365 days', days: 365 },
    { key: 'all', label: 'All time', days: null }
  ];
  const DATASETS = [
    { key: 'subscribers', label: 'Subscribers' },
    { key: 'views', label: 'Views' },
    { key: 'videos', label: 'Videos' },
    { key: 'averages', label: 'Averages (7d)' }
  ];
  const FOCUS_MODES = ['overview', 'growth', 'efficiency', 'milestones'];

  const state = {
    timeRange: '30',
    selectedChannels: new Set(),
    datasetToggles: { subscribers: true, views: true, videos: true, averages: true },
    sortKey: 'subscribers',
    sortDir: 'desc',
    selectedChannel: null,
    focusMode: 'overview'
  };

  const fmt = (n, digits = 0) => n == null || Number.isNaN(n) ? '—' : Number(n).toLocaleString(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits
  });
  const ratio = (a, b) => b > 0 ? a / b : null;
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

  const readPrefs = () => {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    } catch {
      return {};
    }
  };

  const writePrefs = () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      timeRange: state.timeRange,
      selectedChannels: Array.from(state.selectedChannels),
      datasetToggles: state.datasetToggles,
      focusMode: state.focusMode
    }));
  };

  const chartSubtitle = document.querySelector('#chartCard .chart-subtitle');
  const selectionBadge = document.getElementById('selectionBadge');

  const ctx = {
    channels: [],
    channelStats: [],
    historyRows: [],
    chart: null,
    lastComputed: null
  };

  const getThemeColors = () => {
    const style = getComputedStyle(document.documentElement);
    return {
      fg: style.getPropertyValue('--fg').trim() || '#e5e7eb',
      muted: style.getPropertyValue('--muted').trim() || '#9ca3af',
      border: style.getPropertyValue('--border').trim() || 'rgba(148,163,184,.24)'
    };
  };

  const setChartColors = () => {
    if (!ctx.chart) return;
    const colors = getThemeColors();
    ctx.chart.options.color = colors.fg;
    Object.values(ctx.chart.options.scales || {}).forEach((scale) => {
      if (scale.ticks) scale.ticks.color = colors.muted;
      if (scale.grid) scale.grid.color = colors.border;
    });
  };

  const buildControls = () => {
    const timeMount = document.getElementById('timeRangeControls');
    const channelMount = document.getElementById('channelFilterControls');
    const datasetMount = document.getElementById('datasetToggleControls');
    const focusMount = document.getElementById('focusModeControls');

    timeMount.innerHTML = TIME_RANGES.map((r) =>
      `<button class="chip-btn ${state.timeRange === r.key ? 'active' : ''}" data-time-range="${r.key}">${r.label}</button>`
    ).join('');

    channelMount.innerHTML = ctx.channels.map((channel) => {
      const checked = state.selectedChannels.has(channel) ? 'checked' : '';
      return `<label class="filter-pill"><input type="checkbox" data-channel-filter="${channel}" ${checked}> <span>${channel}</span></label>`;
    }).join('');

    datasetMount.innerHTML = DATASETS.map((d) => {
      const checked = state.datasetToggles[d.key] ? 'checked' : '';
      return `<label class="filter-pill"><input type="checkbox" data-dataset-toggle="${d.key}" ${checked}> <span>${d.label}</span></label>`;
    }).join('');

    focusMount.innerHTML = FOCUS_MODES.map((mode) =>
      `<button class="chip-btn ${state.focusMode === mode ? 'active' : ''}" data-focus-mode="${mode}">${mode[0].toUpperCase()}${mode.slice(1)}</button>`
    ).join('');
  };

  const momentumLabel = (d, baseline = 1) => {
    if (d == null || Number.isNaN(d)) return 'insufficient data';
    const threshold = Math.max(Math.abs(baseline) * 0.05, 0.1);
    if (d > threshold) return 'accelerating';
    if (d < -threshold) return 'cooling';
    return 'steady';
  };

  const rollingAverage = (arr, w) => arr.map((_, i) => {
    const start = Math.max(0, i - w + 1);
    const slice = arr.slice(start, i + 1).filter((v) => v != null);
    if (!slice.length) return null;
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  });

  const aggregateHistory = () => {
    if (!state.selectedChannels.size) {
      return { labels: [], subscribers: [], views: [], videos: [], subsAvg7: [], viewsAvg7: [] };
    }
    const byDate = new Map();
    for (const row of ctx.historyRows) {
      if (!state.selectedChannels.has(row.channel)) continue;
      const key = row.dateKey;
      if (!byDate.has(key)) {
        byDate.set(key, { dateObj: row.dateObj, subscribers: 0, videos: 0, views: 0 });
      }
      const d = byDate.get(key);
      d.subscribers += row.subscribers;
      d.videos += row.videos;
      d.views += row.views;
    }

    const points = Array.from(byDate.entries())
      .sort((a, b) => a[1].dateObj - b[1].dateObj)
      .map(([dateKey, totals]) => ({ dateKey, ...totals }));

    const selectedRange = TIME_RANGES.find((r) => r.key === state.timeRange) || TIME_RANGES[1];
    let filteredPoints = points;
    if (selectedRange.days && points.length) {
      const maxDate = points[points.length - 1].dateObj;
      const minDate = new Date(maxDate);
      minDate.setUTCDate(minDate.getUTCDate() - (selectedRange.days - 1));
      filteredPoints = points.filter((p) => p.dateObj >= minDate);
      if (!filteredPoints.length) filteredPoints = points.slice(-Math.min(selectedRange.days, points.length));
    }

    const labels = filteredPoints.map((p) => p.dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
    const subscribers = filteredPoints.map((p) => p.subscribers);
    const views = filteredPoints.map((p) => p.views);
    const videos = filteredPoints.map((p) => p.videos);
    const subsDelta = subscribers.map((v, i) => i === 0 ? null : v - subscribers[i - 1]);
    const viewsDelta = views.map((v, i) => i === 0 ? null : v - views[i - 1]);

    return {
      labels,
      subscribers,
      views,
      videos,
      subsAvg7: rollingAverage(subsDelta, 7),
      viewsAvg7: rollingAverage(viewsDelta, 7)
    };
  };

  const renderKpis = (computed) => {
    const kpiGrid = document.getElementById('kpiGrid');
    const subscribers = computed.subscribers;
    const views = computed.views;
    const videos = computed.videos;
    const subsAvg7 = computed.subsAvg7;
    const viewsAvg7 = computed.viewsAvg7;

    const lastSubs = subscribers.at(-1) ?? 0;
    const lastViews = views.at(-1) ?? 0;
    const lastVideos = videos.at(-1) ?? 0;
    const subs7 = subsAvg7.at(-1);
    const views7 = viewsAvg7.at(-1);
    const subs30 = subsAvg7.length ? rollingAverage(subscribers.map((v, i) => i === 0 ? null : v - subscribers[i - 1]), 30).at(-1) : null;
    const views30 = viewsAvg7.length ? rollingAverage(views.map((v, i) => i === 0 ? null : v - views[i - 1]), 30).at(-1) : null;

    const subsMomentum = subs7 != null && subs30 != null ? subs7 - subs30 : null;
    const viewsMomentum = views7 != null && views30 != null ? views7 - views30 : null;

    const items = [
      { label: 'Total Subscribers', value: fmt(lastSubs), sub: `${state.selectedChannels.size} selected channels` },
      { label: 'Total Views', value: fmt(lastViews), sub: 'Lifetime cumulative views' },
      { label: 'Total Videos', value: fmt(lastVideos), sub: 'Published videos' },
      { label: '7-day Subs/day', value: fmt(subs7, 0), sub: 'From visible date range' },
      { label: '7-day Views/day', value: fmt(views7, 0), sub: 'From visible date range' },
      { label: 'Views per Video', value: fmt(ratio(lastViews, lastVideos), 0), sub: `Range: ${TIME_RANGES.find((r) => r.key === state.timeRange)?.label}` },
      { label: 'Subscriber Momentum', value: subsMomentum == null ? '—' : `${subsMomentum > 0 ? '+' : ''}${fmt(subsMomentum, 0)}/day`, sub: `7d vs 30d: ${momentumLabel(subsMomentum, subs30 || 1)}` },
      { label: 'View Momentum', value: viewsMomentum == null ? '—' : `${viewsMomentum > 0 ? '+' : ''}${fmt(viewsMomentum, 0)}/day`, sub: `7d vs 30d: ${momentumLabel(viewsMomentum, views30 || 1)}` }
    ];

    kpiGrid.innerHTML = items.map((item) => `
      <article class="kpi-card">
        <span class="kpi-label">${item.label}</span>
        <div class="kpi-value">${item.value}</div>
        <div class="kpi-sub">${item.sub}</div>
      </article>
    `).join('');
  };

  const renderTable = () => {
    const tbody = document.querySelector('#statsTable tbody');
    const activeChannel = state.selectedChannel && state.selectedChannels.has(state.selectedChannel) ? state.selectedChannel : null;

    const sorted = [...ctx.channelStats].sort((a, b) => {
      const va = a[state.sortKey];
      const vb = b[state.sortKey];
      const mul = state.sortDir === 'asc' ? 1 : -1;
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      return (va - vb) * mul;
    });

    let totalSubs = 0, totalViews = 0, totalVideos = 0;
    tbody.innerHTML = '';
    for (const rowData of sorted) {
      const selected = state.selectedChannels.has(rowData.name);
      if (selected) {
        totalSubs += rowData.subscribers;
        totalViews += rowData.views;
        totalVideos += rowData.videos;
      }

      const tr = document.createElement('tr');
      tr.dataset.channelName = rowData.name;
      if (!selected) tr.classList.add('is-dimmed');
      if (activeChannel && rowData.name === activeChannel) tr.classList.add('is-highlight');
      tr.innerHTML = `
        <td class="channel">${rowData.name}</td>
        <td class="right">${fmt(rowData.subscribers)}</td>
        <td class="right">${fmt(rowData.videos)}</td>
        <td class="right">${fmt(rowData.views)}</td>
        <td class="right">${fmt(rowData.viewsPerVideo, 0)}</td>
        <td class="right">${fmt(rowData.subsPerVideo, 0)}</td>
        <td class="right">${fmt(rowData.viewsPerSub, 0)}</td>
        <td class="right">${rowData.date || '—'}</td>
      `;
      tbody.appendChild(tr);
    }

    const totalRow = document.createElement('tr');
    totalRow.className = 'totals';
    totalRow.innerHTML = `
      <td class="right">Selected Total</td>
      <td class="right">${fmt(totalSubs)}</td>
      <td class="right">${fmt(totalVideos)}</td>
      <td class="right">${fmt(totalViews)}</td>
      <td class="right">${fmt(ratio(totalViews, totalVideos), 0)}</td>
      <td class="right">${fmt(ratio(totalSubs, totalVideos), 0)}</td>
      <td class="right">${fmt(ratio(totalViews, totalSubs), 0)}</td>
      <td></td>
    `;
    tbody.appendChild(totalRow);

    document.querySelectorAll('th.sortable').forEach((th) => {
      const active = th.dataset.sortKey === state.sortKey;
      th.classList.toggle('active', active);
      th.querySelector('.sort-arrow').textContent = active ? (state.sortDir === 'asc' ? '↑' : '↓') : '';
    });
  };

  const updateFocusMode = () => {
    document.querySelectorAll('[data-focus-group]').forEach((el) => {
      const groups = (el.getAttribute('data-focus-group') || '').split(/\s+/);
      el.style.display = groups.includes(state.focusMode) ? '' : 'none';
    });
  };

  const updateChart = () => {
    const computed = aggregateHistory();
    ctx.lastComputed = computed;

    if (!ctx.chart) {
      const colors = getThemeColors();
      const chartCtx = document.getElementById('growthChart').getContext('2d');
      ctx.chart = new Chart(chartCtx, {
        type: 'line',
        data: {
          labels: [],
          datasets: [
            { key: 'subscribers', label: 'Total Subscribers', data: [], borderColor: '#1e90ff', tension: 0.3, pointRadius: 3, yAxisID: 'y_subs' },
            { key: 'videos', label: 'Total Videos', data: [], borderColor: '#ff6347', tension: 0.3, pointRadius: 3, yAxisID: 'y_vids' },
            { key: 'views', label: 'Total Views', data: [], borderColor: '#32cd32', tension: 0.3, pointRadius: 3, yAxisID: 'y_views' },
            { key: 'subsAvg', label: 'Subs (7-day avg)', data: [], borderColor: '#1e90ff', borderDash: [6, 6], pointRadius: 0, tension: 0.2, yAxisID: 'y_subs_avg' },
            { key: 'viewsAvg', label: 'Views (7-day avg)', data: [], borderColor: '#32cd32', borderDash: [6, 6], pointRadius: 0, tension: 0.2, yAxisID: 'y_views_avg' }
          ]
        },
        options: {
          responsive: true,
          color: colors.fg,
          scales: {
            y_subs: { type: 'linear', position: 'left', title: { display: true, text: 'Subscribers' }, ticks: { color: colors.muted }, grid: { color: colors.border }, beginAtZero: false },
            y_vids: { type: 'linear', position: 'right', title: { display: true, text: 'Videos' }, ticks: { color: colors.muted }, grid: { drawOnChartArea: false, color: colors.border }, beginAtZero: false },
            y_views: { type: 'linear', position: 'right', offset: true, title: { display: true, text: 'Views' }, ticks: { color: colors.muted }, grid: { drawOnChartArea: false, color: colors.border }, beginAtZero: false },
            y_subs_avg: { type: 'linear', position: 'left', display: true, grid: { drawOnChartArea: false, color: colors.border }, ticks: { color: colors.muted }, beginAtZero: true },
            y_views_avg: { type: 'linear', position: 'right', display: true, offset: true, grid: { drawOnChartArea: false, color: colors.border }, ticks: { color: colors.muted }, beginAtZero: true },
            x: { ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 15, color: colors.muted }, grid: { color: colors.border } }
          },
          plugins: {
            legend: { labels: { color: colors.muted, usePointStyle: true, pointStyle: 'line' } },
            tooltip: { mode: 'index', intersect: false }
          }
        }
      });
      window.ytChart = ctx.chart;
    }

    ctx.chart.data.labels = computed.labels;
    const map = {
      subscribers: computed.subscribers,
      views: computed.views,
      videos: computed.videos,
      subsAvg: computed.subsAvg7,
      viewsAvg: computed.viewsAvg7
    };

    ctx.chart.data.datasets.forEach((d) => {
      d.data = map[d.key] || [];
      if (d.key.endsWith('Avg')) {
        ctx.chart.getDatasetMeta(ctx.chart.data.datasets.indexOf(d)).hidden = !state.datasetToggles.averages;
      } else {
        ctx.chart.getDatasetMeta(ctx.chart.data.datasets.indexOf(d)).hidden = !state.datasetToggles[d.key];
      }
      d.borderWidth = state.selectedChannel ? 3 : 2;
      d.borderColor = state.selectedChannel
        ? (d.borderColor.includes('255') ? d.borderColor : d.borderColor)
        : d.borderColor;
    });

    setChartColors();
    ctx.chart.update('none');

    if (selectionBadge) {
      if (!state.selectedChannels.size) {
        selectionBadge.textContent = 'No channels selected';
      } else if (state.selectedChannels.size === 1) {
        selectionBadge.textContent = `${Array.from(state.selectedChannels)[0]} selected`;
      } else {
        selectionBadge.textContent = `${state.selectedChannels.size} channels selected`;
      }
    }
    if (chartSubtitle) {
      const range = TIME_RANGES.find((r) => r.key === state.timeRange)?.label || '30 days';
      chartSubtitle.textContent = `${state.selectedChannel || 'Selected channels'} • ${range} • Toggle datasets to reduce clutter`;
    }

    renderKpis(computed);
    window.dashboardSelection = {
      timeRange: state.timeRange,
      selectedChannels: Array.from(state.selectedChannels),
      selectedChannel: state.selectedChannel,
      computed
    };
    window.dispatchEvent(new CustomEvent('dashboard:selectionchange', { detail: window.dashboardSelection }));
  };

  const sync = () => {
    buildControls();
    updateFocusMode();
    renderTable();
    updateChart();
    writePrefs();
  };

  const attachEvents = () => {
    document.addEventListener('click', (event) => {
      const timeBtn = event.target.closest('[data-time-range]');
      const focusBtn = event.target.closest('[data-focus-mode]');
      const th = event.target.closest('th.sortable');
      const row = event.target.closest('#statsTable tbody tr[data-channel-name]');

      if (timeBtn) {
        state.timeRange = timeBtn.dataset.timeRange;
        return sync();
      }
      if (focusBtn) {
        state.focusMode = focusBtn.dataset.focusMode;
        return sync();
      }
      if (th) {
        const k = th.dataset.sortKey;
        if (state.sortKey === k) state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
        else { state.sortKey = k; state.sortDir = 'desc'; }
        return renderTable();
      }
      if (row) {
        const channel = row.dataset.channelName;
        state.selectedChannel = state.selectedChannel === channel ? null : channel;
        if (state.selectedChannel) {
          state.selectedChannels = new Set([state.selectedChannel]);
        }
        return sync();
      }
    });

    document.addEventListener('change', (event) => {
      const channelCb = event.target.closest('[data-channel-filter]');
      const datasetCb = event.target.closest('[data-dataset-toggle]');

      if (channelCb) {
        const c = channelCb.dataset.channelFilter;
        if (channelCb.checked) state.selectedChannels.add(c);
        else state.selectedChannels.delete(c);
        if (state.selectedChannel && !state.selectedChannels.has(state.selectedChannel)) state.selectedChannel = null;
        return sync();
      }

      if (datasetCb) {
        state.datasetToggles[datasetCb.dataset.datasetToggle] = datasetCb.checked;
        return sync();
      }
    });
  };

  const loadData = async () => {
    const base = location.pathname.includes('/automated') ? '/automated' : '';
    const [channels, historyCsv] = await Promise.all([
      fetch(`${base}/youtube.json`).then((r) => r.json()),
      fetch(`${base}/youtube/youtube-history-sum.csv`).then((r) => r.text())
    ]);

    ctx.channels = Object.keys(channels).map((k) => k.replace(/_/g, ' '));
    ctx.channelStats = Object.entries(channels).map(([k, v]) => {
      const name = k.replace(/_/g, ' ');
      const subscribers = Number(v.subscribers || 0);
      const views = Number(v.views || 0);
      const videos = Number(v.videos || 0);
      return {
        name,
        subscribers,
        views,
        videos,
        viewsPerVideo: ratio(views, videos),
        subsPerVideo: ratio(subscribers, videos),
        viewsPerSub: ratio(views, subscribers),
        date: v.date
      };
    });

    ctx.historyRows = csvParse(historyCsv).map((r) => {
      const name = (r.channel || '').replace(/_/g, ' ');
      const dt = new Date(r.date.replace(' UTC', 'Z'));
      return {
        channel: name,
        dateObj: dt,
        dateKey: dt.toISOString().slice(0, 10),
        subscribers: Number(r.subscribers || 0),
        views: Number(r.views || 0),
        videos: Number(r.videos || 0)
      };
    });

    const prefs = readPrefs();
    if (prefs.timeRange && TIME_RANGES.some((r) => r.key === prefs.timeRange)) state.timeRange = prefs.timeRange;
    if (prefs.datasetToggles) state.datasetToggles = { ...state.datasetToggles, ...prefs.datasetToggles };
    if (prefs.focusMode && FOCUS_MODES.includes(prefs.focusMode)) state.focusMode = prefs.focusMode;

    const validSavedChannels = (prefs.selectedChannels || []).filter((c) => ctx.channels.includes(c));
    state.selectedChannels = validSavedChannels.length ? new Set(validSavedChannels) : new Set(ctx.channels);
  };

  loadData()
    .then(() => {
      attachEvents();
      sync();
    })
    .catch((err) => {
      console.error('Dashboard controls failed:', err);
      const tbody = document.querySelector('#statsTable tbody');
      if (tbody) tbody.innerHTML = '<tr><td colspan="8">Unable to load dashboard data.</td></tr>';
    });

  window.addEventListener('themechange', setChartColors);
})();
