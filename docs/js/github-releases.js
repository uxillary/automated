(function () {
  'use strict';

  const section = document.getElementById('githubReleases');
  if (!section) return;

  const STORAGE_KEY = 'githubDownloadExplorer.v1';
  const VALID_MODES = ['cumulative', 'daily', 'trend'];
  const VALID_RANGES = ['7', '30', '90', 'all'];
  const fmt = (value, digits = 0) => value == null ? 'Collecting data' : Number(value).toLocaleString(undefined, { maximumFractionDigits: digits });
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const base = location.pathname.includes('/automated') ? '/automated' : '';
  let chart = null;
  let mode = 'daily';
  let range = 'all';
  let history = null;
  let snapshots = [];

  function readPreferences() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      return {
        mode: VALID_MODES.includes(saved.mode) ? saved.mode : null,
        range: VALID_RANGES.includes(saved.range) ? saved.range : null
      };
    } catch {
      return { mode: null, range: null };
    }
  }

  function savePreferences() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ mode, range })); } catch { /* Storage can be disabled. */ }
  }

  function dayNumber(date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return null;
    const value = Date.parse(`${date}T00:00:00Z`);
    return Number.isFinite(value) && new Date(value).toISOString().slice(0, 10) === date ? value / 86400000 : null;
  }

  function normalizeSnapshots(rows) {
    return (Array.isArray(rows) ? rows : [])
      .filter((item) => item && dayNumber(item.date) != null && typeof item.total === 'number' && Number.isFinite(item.total) && item.total >= 0)
      .map((item) => ({ date: item.date, day: dayNumber(item.date), total: Number(item.total) }))
      .sort((a, b) => a.day - b.day);
  }

  function dailyPoints() {
    const points = [];
    for (let i = 1; i < snapshots.length; i += 1) {
      const previous = snapshots[i - 1];
      const current = snapshots[i];
      if (current.day - previous.day !== 1) continue;
      const downloads = current.total - previous.total;
      if (downloads < 0) continue;
      points.push({ date: current.date, day: current.day, value: downloads });
    }
    return points;
  }

  function rollingAverage(points) {
    const result = [];
    for (let end = 6; end < points.length; end += 1) {
      const window = points.slice(end - 6, end + 1);
      if (window[6].day - window[0].day !== 6) continue;
      const total = window.reduce((sum, point) => sum + point.value, 0);
      result.push({ date: window[6].date, day: window[6].day, value: total / 7 });
    }
    return result;
  }

  function calendarSeries(points) {
    if (!snapshots.length) return [];
    const byDay = new Map(points.map((point) => [point.day, point]));
    const result = [];
    for (let day = snapshots[0].day; day <= snapshots[snapshots.length - 1].day; day += 1) {
      const date = new Date(day * 86400000).toISOString().slice(0, 10);
      const point = byDay.get(day);
      result.push({ date, day, value: point?.value ?? null });
    }
    return result;
  }

  function inSelectedRange(point) {
    if (range === 'all' || !snapshots.length) return true;
    const days = Number(range);
    return point.day >= snapshots[snapshots.length - 1].day - days + 1;
  }

  function chartPoints() {
    if (mode === 'cumulative') return snapshots.filter(inSelectedRange).map((item) => ({ date: item.date, day: item.day, value: item.total }));
    const daily = dailyPoints();
    return calendarSeries(mode === 'trend' ? rollingAverage(daily) : daily).filter(inSelectedRange);
  }

  function themeColors() {
    const styles = getComputedStyle(document.documentElement);
    return { fg: styles.getPropertyValue('--fg').trim(), muted: styles.getPropertyValue('--muted').trim(), border: styles.getPropertyValue('--border').trim() };
  }

  function formatDate(date, includeYear = false) {
    return new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, {
      month: 'short', day: 'numeric', ...(includeYear ? { year: 'numeric' } : {}), timeZone: 'UTC'
    });
  }

  function syncControls() {
    section.querySelectorAll('[data-github-view]').forEach((button) => {
      const selected = button.dataset.githubView === mode;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
    });
    section.querySelectorAll('[data-github-range]').forEach((button) => {
      const selected = button.dataset.githubRange === range;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
    const selectedTab = section.querySelector(`[data-github-view="${mode}"]`);
    document.getElementById('githubDownloadsPanel').setAttribute('aria-labelledby', selectedTab.id);
  }

  function renderActivitySummary() {
    const points = dailyPoints().filter(inSelectedRange);
    const totalEl = document.getElementById('githubPeriodDownloads');
    const averageEl = document.getElementById('githubPeriodAverage');
    const peakEl = document.getElementById('githubPeriodPeak');
    if (!points.length) {
      totalEl.textContent = '—';
      averageEl.textContent = '—';
      peakEl.textContent = '—';
      return;
    }
    const total = points.reduce((sum, point) => sum + point.value, 0);
    const peak = points.reduce((best, point) => point.value > best.value ? point : best, points[0]);
    totalEl.textContent = fmt(total);
    averageEl.textContent = `${fmt(total / points.length, 1)} / day`;
    peakEl.textContent = `${fmt(peak.value)} · ${formatDate(peak.date)}`;
  }

  function rangeName() {
    return range === 'all' ? 'all available history' : `last ${range} days`;
  }

  function chartStatus(points) {
    if (mode === 'cumulative') {
      if (!points.length) return 'No snapshots are available for this time range.';
      return `${points.length} recorded snapshots · History begins when automated tracking started. Period totals use valid adjacent daily changes.`;
    }
    if (mode === 'daily') {
      const validCount = points.filter((point) => point.value != null).length;
      if (!validCount) return 'No valid daily totals are available for this time range. The first snapshot, gaps, and decreasing totals are omitted.';
      return `${validCount} valid daily totals in ${rangeName()} · Baseline, gaps, and decreasing totals are omitted.`;
    }
    const validCount = points.filter((point) => point.value != null).length;
    if (!validCount) return 'A 7-day average needs seven consecutive valid daily observations. No complete window is available in this range.';
    return `${validCount} rolling values in ${rangeName()} · Seven consecutive valid daily totals; gaps and decreases break the window. No projection.`;
  }

  function renderChart() {
    const canvas = document.getElementById('githubDownloadsChart');
    const empty = document.getElementById('githubChartEmpty');
    const status = document.getElementById('githubChartStatus');
    const points = chartPoints();
    const colors = themeColors();
    status.textContent = chartStatus(points);
    renderActivitySummary();

    if (chart) {
      chart.destroy();
      chart = null;
    }
    if (!points.some((point) => point.value != null)) {
      canvas.hidden = true;
      empty.hidden = false;
      empty.textContent = status.textContent;
      canvas.setAttribute('aria-label', `No GitHub ${mode} chart data available for ${rangeName()}.`);
      return;
    }

    canvas.hidden = false;
    empty.hidden = true;
    const isBar = mode === 'daily';
    const label = mode === 'cumulative' ? 'Cumulative downloads' : mode === 'daily' ? 'Daily downloads' : '7-day average';
    const availablePoints = points.filter((point) => point.value != null);
    canvas.setAttribute('aria-label', `${label} for ${rangeName()}, from ${formatDate(availablePoints[0].date, true)} to ${formatDate(availablePoints[availablePoints.length - 1].date, true)}. ${status.textContent}`);
    chart = new Chart(canvas, {
      type: isBar ? 'bar' : 'line',
      data: {
        labels: points.map((point) => point.date),
        datasets: [{
          label,
          data: points.map((point) => point.value),
          borderColor: '#36c9a0',
          backgroundColor: isBar ? 'rgba(54,201,160,.55)' : 'rgba(54,201,160,.12)',
          borderDash: mode === 'trend' ? [5, 4] : [],
          fill: false,
          tension: mode === 'trend' ? 0.2 : 0,
          pointRadius: points.length > 60 ? 0 : 3,
          borderWidth: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 300 },
        interaction: { intersect: false, mode: 'index' },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: (items) => items.length ? formatDate(points[items[0].dataIndex].date, true) : '',
              label: (item) => mode === 'cumulative'
                ? `${fmt(item.raw)} total downloads`
                : mode === 'daily'
                  ? `${fmt(item.raw)} download${item.raw === 1 ? '' : 's'}`
                  : `7-day average: ${fmt(item.raw, 1)} downloads/day`
            }
          }
        },
        color: colors.fg,
        scales: {
          x: { ticks: { color: colors.muted, maxTicksLimit: 8, callback: (value) => points[Number(value)] ? formatDate(points[Number(value)].date) : '' }, grid: { display: false } },
          y: { beginAtZero: mode !== 'cumulative', ticks: { color: colors.muted }, grid: { color: colors.border } }
        }
      }
    });
  }

  function setMode(nextMode) {
    if (!VALID_MODES.includes(nextMode)) return;
    mode = nextMode;
    syncControls();
    savePreferences();
    if (history) renderChart();
  }

  function setRange(nextRange) {
    if (!VALID_RANGES.includes(nextRange)) return;
    range = nextRange;
    syncControls();
    savePreferences();
    if (history) renderChart();
  }

  function render(summary) {
    const cards = [
      ['Total Downloads', summary.currentTotalDownloads, 'Across tracked applications'],
      ['Last 7 Days', summary.gain7Days, summary.gain7Days == null ? 'Waiting for a 7-day comparison' : 'Latest available 7-day gain'],
      ['Last 30 Days', summary.gain30Days, summary.gain30Days == null ? 'Waiting for a 30-day comparison' : 'Latest available 30-day gain'],
      ['Downloads / Day', summary.averageDaily7Days, summary.averageDaily7Days == null ? 'Waiting for a 7-day comparison' : 'Recent 7-day average']
    ];
    document.getElementById('githubKpis').innerHTML = cards.map(([label, value, sub]) => `<article class="kpi-card"><span class="kpi-label">${label}</span><div class="kpi-value">${fmt(value, label === 'Downloads / Day' ? 1 : 0)}</div><div class="kpi-sub">${sub}</div></article>`).join('');

    const apps = summary.repositories || [];
    const total = summary.currentTotalDownloads || 0;
    document.getElementById('githubApps').innerHTML = `<h3 class="section-title icon-heading"><i class="fa-solid fa-box-open" aria-hidden="true"></i>App Performance</h3><p class="table-subtitle">Cumulative downloads and recent growth.</p><div class="app-list">${apps.map((app) => {
      const badges = `${summary.topRepository?.repo === app.repo ? '<span class="highlight-pill">Most downloaded</span>' : ''}${summary.fastestGrowingRepository?.repo === app.repo ? '<span class="highlight-pill">Fastest growing</span>' : ''}`;
      const share = total ? app.downloads / total * 100 : 0;
      return `<div class="app-row"><div class="app-row-header"><div><strong>${escapeHtml(app.label)}</strong>${badges}<div class="app-row-meta">${app.gain7 == null ? 'Recent gain collecting' : `+${fmt(app.gain7)} in 7 days`} · ${share.toFixed(1)}% share</div></div><strong>${fmt(app.downloads)}</strong></div><div class="metric-track" aria-label="${share.toFixed(1)} percent of downloads"><span class="metric-fill" style="width:${share}%"></span></div></div>`;
    }).join('') || '<p class="github-state">No release assets found in the tracked repositories.</p>'}</div>`;

    const milestone = summary.milestones;
    document.getElementById('githubMilestone').innerHTML = `<h3 class="section-title icon-heading"><i class="fa-solid fa-flag-checkered" aria-hidden="true"></i>Next Milestone</h3>${milestone?.next == null ? `<div class="milestone-value">${fmt(total)}</div><p class="milestone-copy">All configured milestones achieved.</p>` : `<div class="milestone-value">${fmt(milestone.next)} downloads</div><p class="milestone-copy">${milestone.latestAchieved ? `${fmt(milestone.latestAchieved)} achieved` : 'Working toward the first milestone'}.</p><div class="milestone-track"><span class="milestone-fill" style="width:${milestone.progressPercent}%"></span></div><div class="milestone-percent">${fmt(milestone.progressPercent, 1)}%</div>`}`;

    const insights = [
      ['Top release', summary.highestDownloadedRelease ? `${summary.highestDownloadedRelease.name} · ${fmt(summary.highestDownloadedRelease.downloads)}` : 'No release assets'],
      ['Top asset', summary.highestDownloadedAsset ? `${summary.highestDownloadedAsset.name} · ${fmt(summary.highestDownloadedAsset.downloads)}` : 'No release assets'],
      ['Newest release', summary.newestRelease ? `${summary.newestRelease.name} · ${new Date(summary.newestRelease.publishedAt).toLocaleDateString()}` : 'No published releases'],
      ['Tracked releases', fmt(summary.trackedReleaseCount)]
    ];
    document.getElementById('githubReleaseInsights').innerHTML = insights.map(([label, value]) => `<div class="github-insight"><span>${label}</span><strong>${escapeHtml(value)}</strong></div>`).join('');
    renderChart();
  }

  section.addEventListener('click', (event) => {
    const modeButton = event.target.closest('[data-github-view]');
    if (modeButton) {
      setMode(modeButton.dataset.githubView);
      return;
    }
    const rangeButton = event.target.closest('[data-github-range]');
    if (rangeButton) setRange(rangeButton.dataset.githubRange);
  });

  section.addEventListener('keydown', (event) => {
    const tab = event.target.closest('[role="tab"][data-github-view]');
    if (!tab) return;
    const tabs = [...section.querySelectorAll('[role="tab"][data-github-view]')];
    const currentIndex = tabs.indexOf(tab);
    let nextIndex = currentIndex;
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = tabs.length - 1;
    else return;
    event.preventDefault();
    tabs[nextIndex].focus();
    setMode(tabs[nextIndex].dataset.githubView);
  });

  window.addEventListener('themechange', () => { if (history) renderChart(); });

  Promise.all([
    fetch(`${base}/metrics/github_releases_summary.json`, { cache: 'no-store' }).then((response) => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json(); }),
    fetch(`${base}/metrics/github_releases_history.json`, { cache: 'no-store' }).then((response) => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json(); })
  ]).then(([summary, loadedHistory]) => {
    history = loadedHistory;
    snapshots = normalizeSnapshots(history?.snapshots);
    if (summary.status === 'awaiting_baseline' || !snapshots.length) throw new Error('The first release snapshot has not been collected yet.');

    const preferences = readPreferences();
    const span = snapshots[snapshots.length - 1].day - snapshots[0].day + 1;
    mode = preferences.mode || 'daily';
    range = preferences.range || (span >= 30 ? '30' : 'all');
    syncControls();
    render(summary);
  }).catch((error) => {
    document.getElementById('githubKpis').innerHTML = `<article class="kpi-card"><span class="kpi-label">GitHub Releases</span><div class="kpi-value">Baseline pending</div><div class="kpi-sub">${escapeHtml(error.message)}</div></article>`;
    document.getElementById('githubChartStatus').textContent = 'Release history will appear after the first successful workflow run.';
    document.getElementById('githubChartEmpty').hidden = false;
    document.getElementById('githubChartEmpty').textContent = 'GitHub release history is not available yet.';
    document.getElementById('githubDownloadsChart').hidden = true;
    document.getElementById('githubApps').querySelector('.github-state').textContent = 'No snapshot is available yet.';
    document.getElementById('githubMilestone').querySelector('.github-state').textContent = 'Milestone progress starts with the baseline.';
    document.getElementById('githubReleaseInsights').innerHTML = '<p class="github-state">Release insights start with the baseline.</p>';
  });
})();
