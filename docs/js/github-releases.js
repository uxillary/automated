(function () {
  'use strict';

  const section = document.getElementById('githubReleases');
  if (!section) return;

  const fmt = (value, digits = 0) => value == null ? 'Collecting data' : Number(value).toLocaleString(undefined, { maximumFractionDigits: digits });
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]);
  const base = location.pathname.includes('/automated') ? '/automated' : '';
  let chart = null;
  let view = 'cumulative';
  let history = null;

  function themeColors() {
    const styles = getComputedStyle(document.documentElement);
    return { fg: styles.getPropertyValue('--fg').trim(), muted: styles.getPropertyValue('--muted').trim(), border: styles.getPropertyValue('--border').trim() };
  }

  function chartPoints() {
    const snapshots = history?.snapshots || [];
    return snapshots.map((item, index) => ({
      date: item.date,
      value: view === 'cumulative' ? item.total : (index ? Math.max(0, item.total - snapshots[index - 1].total) : null)
    }));
  }

  function renderChart() {
    const canvas = document.getElementById('githubDownloadsChart');
    const points = chartPoints();
    const colors = themeColors();
    if (chart) chart.destroy();
    chart = new Chart(canvas, {
      type: view === 'daily' ? 'bar' : 'line',
      data: { labels: points.map((p) => p.date), datasets: [{
        label: view === 'daily' ? 'Daily downloads' : 'Cumulative downloads', data: points.map((p) => p.value),
        borderColor: '#36c9a0', backgroundColor: view === 'daily' ? 'rgba(54,201,160,.55)' : 'rgba(54,201,160,.12)',
        fill: view === 'cumulative', tension: 0.25, pointRadius: points.length > 60 ? 0 : 3, borderWidth: 2
      }] },
      options: { responsive: true, maintainAspectRatio: false, interaction: { intersect: false, mode: 'index' },
        plugins: { legend: { display: false } }, color: colors.fg,
        scales: { x: { ticks: { color: colors.muted, maxTicksLimit: 8 }, grid: { display: false } }, y: { beginAtZero: view === 'daily', ticks: { color: colors.muted }, grid: { color: colors.border } } }
      }
    });
    const status = document.getElementById('githubChartStatus');
    status.textContent = points.length < 2 ? 'Baseline established — growth appears after the next snapshot.' : `${points.length} daily snapshots · ${view === 'daily' ? 'change between observations' : 'cumulative asset downloads'}`;
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

  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-github-view]');
    if (!button) return;
    view = button.dataset.githubView;
    section.querySelectorAll('[data-github-view]').forEach((item) => { const active = item === button; item.classList.toggle('active', active); item.setAttribute('aria-pressed', String(active)); });
    renderChart();
  });
  window.addEventListener('themechange', () => { if (history) renderChart(); });

  Promise.all([
    fetch(`${base}/metrics/github_releases_summary.json`, { cache: 'no-store' }).then((response) => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json(); }),
    fetch(`${base}/metrics/github_releases_history.json`, { cache: 'no-store' }).then((response) => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json(); })
  ]).then(([summary, loadedHistory]) => {
    history = loadedHistory;
    if (summary.status === 'awaiting_baseline') throw new Error('The first release snapshot has not been collected yet.');
    render(summary);
  }).catch((error) => {
    document.getElementById('githubKpis').innerHTML = `<article class="kpi-card"><span class="kpi-label">GitHub Releases</span><div class="kpi-value">Baseline pending</div><div class="kpi-sub">${escapeHtml(error.message)}</div></article>`;
    document.getElementById('githubChartStatus').textContent = 'Release history will appear after the first successful workflow run.';
    document.getElementById('githubApps').querySelector('.github-state').textContent = 'No snapshot is available yet.';
    document.getElementById('githubMilestone').querySelector('.github-state').textContent = 'Milestone progress starts with the baseline.';
    document.getElementById('githubReleaseInsights').innerHTML = '<p class="github-state">Release insights start with the baseline.</p>';
  });
})();
