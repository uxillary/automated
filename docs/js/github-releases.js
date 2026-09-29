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
      .map((item) => ({ date: item.date, day: dayNumber(item.date), total: Number(item.total), repositories: item.repositories && typeof item.repositories === 'object' ? item.repositories : {} }))
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

  function renderPatterns(analytics) {
    const root = document.getElementById('githubPatterns');
    const stats = document.getElementById('githubPatternStats');
    const weekdaysRoot = document.getElementById('githubWeekdays');
    const observation = document.getElementById('githubPatternObservation');
    const note = document.getElementById('githubPatternNote');
    const period = analytics.comparison;
    const periodValue = period
      ? `${fmt(period.recent)} recent · ${fmt(period.previous)} previous<br><span class="github-pattern-detail">${period.difference > 0 ? '+' : ''}${fmt(period.difference)} downloads${period.percent == null ? ' · percentage unavailable (previous period was 0)' : ` · ${period.percent > 0 ? '+' : ''}${fmt(period.percent, 1)}%`}</span>`
      : 'Collecting data · need 14 complete consecutive days';
    const items = [
      ['Last 7 days vs previous 7', periodValue, 'momentum'],
      ['Active download streak', `${fmt(analytics.streaks.current)} days`],
      ['Typical day · median', `${fmt(analytics.median, 1)} downloads<br><span class="github-pattern-detail">Average: ${fmt(analytics.mean, 1)} / day</span>`],
      ['Strongest observed weekday', analytics.weekdays.strongest ? `${analytics.weekdays.strongest.name}<br><span class="github-pattern-detail">${fmt(analytics.weekdays.strongest.average, 1)} / day · ${analytics.weekdays.strongest.count} observed days</span>` : 'Collecting data']
    ];
    stats.innerHTML = items.map(([label, value, extra]) => `<div${extra ? ` class="${extra}"` : ''}><dt>${label}</dt><dd>${value}</dd></div>`).join('');
    const maximum = Math.max(1, ...analytics.weekdays.groups.map((item) => item.average || 0));
    weekdaysRoot.innerHTML = `<h4>Average by weekday</h4><ul>${analytics.weekdays.groups.map((item) => {
      const detail = item.count ? `${fmt(item.average, 1)} downloads/day · ${item.count} observed ${item.count === 1 ? 'day' : 'days'}` : 'Unavailable · no observations';
      const width = item.count ? item.average / maximum * 100 : 0;
      return `<li aria-label="${item.name}: ${detail}."><span class="github-weekday-name">${item.name.slice(0, 3)}</span><span class="github-weekday-track" aria-hidden="true"><span style="width:${width}%"></span></span><span class="github-weekday-value">${item.count ? `${fmt(item.average, 1)} · ${item.count}` : '—'}</span></li>`;
    }).join('')}</ul>`;
    observation.textContent = analytics.observation || 'Patterns will appear as valid daily history accumulates.';
    note.textContent = `Based on ${analytics.validDayCount} recorded download ${analytics.validDayCount === 1 ? 'day' : 'days'}; patterns become more useful as history grows. Statistics use all available history, independent of the chart range.`;
    root.setAttribute('aria-busy', 'false');
  }

  function renderMilestones(summary, analytics) {
    const mount = document.getElementById('githubMilestone');
    const thresholdsFromSummary = Array.isArray(summary.milestoneThresholds);
    const thresholds = thresholdsFromSummary ? summary.milestoneThresholds : [summary.milestones?.latestAchieved, summary.milestones?.next].filter(Number.isFinite);
    const historyState = window.GitHubDownloadPatterns.milestoneHistory(snapshots, thresholds);
    const currentTotal = Number.isFinite(summary.currentTotalDownloads) ? summary.currentTotalDownloads : historyState.currentTotal;
    const summaryMilestone = summary.milestones;
    const next = summaryMilestone ? summaryMilestone.next : historyState.next;
    const progress = summaryMilestone?.progressPercent ?? historyState.progressPercent;
    const remaining = currentTotal == null || next == null ? currentTotal == null ? null : 0 : Math.max(0, next - currentTotal);
    const thresholdLabel = (value) => value >= 1000 && value % 1000 === 0 ? `${fmt(value / 1000)}K` : fmt(value);
    const statuses = {
      'before-history': 'Reached before tracked history', achieved: 'Reached', target: 'Current target', future: 'Future'
    };
    const timeline = thresholds.length
      ? `<ol class="milestone-timeline" aria-label="Download milestone history">${historyState.items.map((item) => `<li class="milestone-step is-${item.status}" aria-label="${fmt(item.threshold)} downloads: ${statuses[item.status]}${item.reachedDate ? ` ${formatDate(item.reachedDate, true)}` : ''}."><span class="milestone-state">${item.status === 'achieved' || item.status === 'before-history' ? '✓' : item.status === 'target' ? '→' : '·'} ${statuses[item.status]}</span><strong>${thresholdLabel(item.threshold)}</strong>${item.status === 'achieved' ? `<span class="milestone-date">Reached ${formatDate(item.reachedDate, true)}</span>` : item.status === 'before-history' ? '<span class="milestone-date">Before tracked history</span>' : item.status === 'target' && item.reachedDate ? `<span class="milestone-date">Previously reached ${formatDate(item.reachedDate, true)}</span>` : '<span class="milestone-date">&nbsp;</span>'}</li>`).join('')}</ol>`
      : '<p class="milestone-copy">Milestone sequence is unavailable in the current summary.</p>';

    const daily = analytics.daily;
    const latestDay = daily.at(-1) || null;
    const bestDayIsCurrent = Boolean(latestDay && analytics.bestDay && latestDay.downloads === analytics.bestDay.downloads);
    const latestWeek = daily.length >= 7 ? daily.slice(-7) : [];
    const latestWeekComplete = latestWeek.length === 7 && latestWeek[6].day - latestWeek[0].day === 6;
    const latestWeekTotal = latestWeekComplete ? latestWeek.reduce((sum, point) => sum + point.downloads, 0) : null;
    const bestWeekIsCurrent = Boolean(latestWeekComplete && analytics.bestWeek && latestWeekTotal === analytics.bestWeek.total);
    const records = [
      ['Best download day', analytics.bestDay ? `${fmt(analytics.bestDay.downloads)} downloads<br><span class="milestone-record-detail">${formatDate(analytics.bestDay.date, true)}</span>${bestDayIsCurrent ? '<span class="record-badge">Current record</span>' : ''}` : 'Collecting valid daily history'],
      ['Best 7-day period · highest average', analytics.bestWeek ? `${fmt(analytics.bestWeek.total)} downloads<br><span class="milestone-record-detail">${formatDate(analytics.bestWeek.startDate)}–${formatDate(analytics.bestWeek.endDate)} · ${fmt(analytics.bestWeek.total / 7, 1)} / day</span>${bestWeekIsCurrent ? '<span class="record-badge">Current record</span>' : ''}` : 'Collecting 7 consecutive valid days'],
      ['Longest active download streak', `${fmt(analytics.streaks.longest)} days`]
    ];
    const top = next == null
      ? thresholds.length || summaryMilestone ? '<p class="milestone-copy">Highest configured milestone reached.</p>' : '<p class="milestone-copy">Milestone details are unavailable in the current summary.</p>'
      : `<div class="milestone-next"><span>Next milestone</span><strong>${fmt(next)} downloads</strong><span>${remaining == null ? 'Collecting current total' : `${fmt(remaining)} to go`}</span></div>`;
    const progressMarkup = next != null && progress != null
      ? `<div class="milestone-progress" role="progressbar" aria-label="Progress toward ${fmt(next)} downloads" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress}" aria-valuetext="${fmt(progress, 1)} percent complete; ${fmt(remaining)} downloads remaining"><span class="milestone-fill" style="width:${Math.max(0, Math.min(100, progress))}%"></span></div><p class="milestone-progress-label">${fmt(progress, 1)}% complete · ${fmt(remaining)} downloads remaining</p>`
      : '';
    mount.className = 'card github-milestones-card';
    mount.innerHTML = `<h3 class="section-title icon-heading"><i class="fa-solid fa-flag-checkered" aria-hidden="true"></i>Milestones &amp; Records</h3><div class="milestone-overview"><div class="milestone-total"><span>Total downloads</span><strong>${fmt(currentTotal)}</strong></div>${top}</div>${progressMarkup}${timeline}${!thresholdsFromSummary && thresholds.length ? '<p class="milestone-history-note">Milestone sequence uses only thresholds present in the available summary.</p>' : ''}<div class="milestone-records"><h4>Personal records</h4><dl>${records.map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`).join('')}</dl></div>`;
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

  function projectSparkline(label, points, endDate) {
    const width = 112;
    const height = 26;
    const inset = 2;
    const endDay = window.GitHubDownloadPatterns.dayNumber(endDate);
    const startDay = endDay - 13;
    const maximum = Math.max(1, ...points.map((point) => point.downloads));
    const plotted = points.map((point) => ({
      ...point,
      x: inset + ((point.day - startDay) / 13) * (width - inset * 2),
      y: height - inset - (point.downloads / maximum) * (height - inset * 2)
    }));
    const segments = [];
    for (const point of plotted) {
      const current = segments.at(-1);
      if (!current || point.day !== current.at(-1).day + 1) segments.push([point]);
      else current.push(point);
    }
    const paths = segments.filter((segment) => segment.length > 1).map((segment) => `<path d="${segment.map((point, index) => `${index ? 'L' : 'M'}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ')}"></path>`).join('');
    const singlePoints = segments.filter((segment) => segment.length === 1).flat().map((point) => `<circle cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="1.7"></circle>`).join('');
    const total = points.reduce((sum, point) => sum + point.downloads, 0);
    const accessibleSummary = points.length
      ? `${points.length} valid daily observations in the last 14 calendar days; ${fmt(total)} downloads total.`
      : 'No valid daily observations in the last 14 calendar days.';
    return `<svg class="project-sparkline" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(label)} sparkline: ${accessibleSummary}" focusable="false"><path class="sparkline-baseline" d="M${inset},${height - inset} H${width - inset}"></path>${paths}${singlePoints}</svg>`;
  }

  function renderProjectPerformance(summary) {
    const mount = document.getElementById('githubApps');
    const projects = summary.repositories;
    const latestSnapshot = snapshots.at(-1);
    const total = summary.currentTotalDownloads;
    const reconciles = window.GitHubDownloadPatterns.reconcileProjectTotals(projects, total, latestSnapshot?.repositories);
    if (!reconciles) {
      mount.innerHTML = '<h3 class="section-title icon-heading"><i class="fa-solid fa-boxes-stacked" aria-hidden="true"></i>Project Performance</h3><p class="project-data-state" role="status">Project totals do not reconcile with the tracked overall total. Project comparison is temporarily unavailable.</p>';
      return;
    }
    const orderedProjects = window.GitHubDownloadPatterns.sortProjects(projects);
    const rows = orderedProjects.map((project) => {
      const analytics = window.GitHubDownloadPatterns.projectAnalytics(snapshots, project.repo, summary.latestSnapshotDate);
      const current = analytics.currentTotal;
      const share = window.GitHubDownloadPatterns.sharePercent(project.downloads, total);
      const shareLabel = share == null ? 'Share unavailable · total is 0' : `${fmt(share, 1)}% of tracked total`;
      const shareMarkup = share == null
        ? '<div class="project-share project-share-unavailable" aria-hidden="true"><span></span></div>'
        : `<div class="project-share" role="progressbar" aria-label="Share of tracked downloads for ${escapeHtml(project.label)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${share.toFixed(1)}" aria-valuetext="${fmt(share, 1)} percent of tracked downloads"><span style="width:${Math.max(0, Math.min(100, share))}%"></span></div>`;
      const recent7 = analytics.recent7 == null ? 'Collecting data' : `+${fmt(analytics.recent7)}`;
      const recent30 = analytics.recent30 == null ? 'Collecting data' : `+${fmt(analytics.recent30)}`;
      let momentum = 'Collecting comparison data';
      if (analytics.comparison) {
        const comparison = analytics.comparison;
        if (comparison.previous === 0 && comparison.recent > 0) momentum = 'Activity resumed';
        else if (comparison.difference === 0) momentum = 'No change vs previous 7d';
        else {
          const arrow = comparison.difference > 0 ? '↑' : '↓';
          const amount = Math.abs(comparison.percent);
          momentum = `${arrow} ${amount < 1 ? '<1' : fmt(amount)}% vs previous 7d`;
        }
      }
      const sparkline = projectSparkline(project.label, analytics.sparkline, summary.latestSnapshotDate);
      return `<article class="project-row"><div class="project-row-main"><div class="project-name-block"><h4>${escapeHtml(project.label)}</h4><p>${current == null ? 'Collecting data' : `${fmt(current)} downloads`} · ${shareLabel}</p></div><strong class="project-total">${fmt(current)}</strong></div>${shareMarkup}<div class="project-row-detail"><div class="project-recent"><span>Last 7 days</span><strong>${recent7}</strong><span>Last 30 days</span><strong>${recent30}</strong></div><div class="project-momentum"><span>Recent activity</span><strong>${analytics.activity}</strong><span class="project-momentum-detail">${momentum}</span></div><div class="project-sparkline-wrap">${sparkline}</div></div></article>`;
    }).join('');
    mount.innerHTML = `<h3 class="section-title icon-heading"><i class="fa-solid fa-boxes-stacked" aria-hidden="true"></i>Project Performance</h3><p class="table-subtitle">Tracked release downloads by repository.</p><div class="project-list">${rows || '<p class="github-state">No tracked repositories are available.</p>'}</div>`;
  }

  function render(summary) {
    const cards = [
      ['Total Downloads', summary.currentTotalDownloads, 'Across tracked applications'],
      ['Last 7 Days', summary.gain7Days, summary.gain7Days == null ? 'Waiting for a 7-day comparison' : 'Latest available 7-day gain'],
      ['Last 30 Days', summary.gain30Days, summary.gain30Days == null ? 'Waiting for a 30-day comparison' : 'Latest available 30-day gain'],
      ['Downloads / Day', summary.averageDaily7Days, summary.averageDaily7Days == null ? 'Waiting for a 7-day comparison' : 'Recent 7-day average']
    ];
    document.getElementById('githubKpis').innerHTML = cards.map(([label, value, sub]) => `<article class="kpi-card"><span class="kpi-label">${label}</span><div class="kpi-value">${fmt(value, label === 'Downloads / Day' ? 1 : 0)}</div><div class="kpi-sub">${sub}</div></article>`).join('');

    renderProjectPerformance(summary);

    const downloadAnalytics = window.GitHubDownloadPatterns.analyze(snapshots);
    renderMilestones(summary, downloadAnalytics);

    const insights = [
      ['Top release', summary.highestDownloadedRelease ? `${summary.highestDownloadedRelease.name} · ${fmt(summary.highestDownloadedRelease.downloads)}` : 'No release assets'],
      ['Top asset', summary.highestDownloadedAsset ? `${summary.highestDownloadedAsset.name} · ${fmt(summary.highestDownloadedAsset.downloads)}` : 'No release assets'],
      ['Newest release', summary.newestRelease ? `${summary.newestRelease.name} · ${new Date(summary.newestRelease.publishedAt).toLocaleDateString()}` : 'No published releases'],
      ['Tracked releases', fmt(summary.trackedReleaseCount)]
    ];
    document.getElementById('githubReleaseInsights').innerHTML = insights.map(([label, value]) => `<div class="github-insight"><span>${label}</span><strong>${escapeHtml(value)}</strong></div>`).join('');
    renderPatterns(downloadAnalytics);
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
