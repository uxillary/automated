(function () {
  'use strict';

  const mount = document.getElementById('activityPulse');
  if (!mount) return;

  const base = location.pathname.includes('/automated') ? '/automated' : '';
  const format = (value, digits = 0) => value == null || !Number.isFinite(Number(value))
    ? '—'
    : Number(value).toLocaleString(undefined, { maximumFractionDigits: digits });
  const formatDate = (value) => {
    const date = value ? new Date(value) : null;
    return date && Number.isFinite(date.getTime())
      ? date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })
      : null;
  };
  const metric = (platform, icon, label, value, note, primary = false) => `
    <article class="pulse-metric${primary ? ' pulse-primary' : ''}" data-platform="${platform}">
      <span class="pulse-icon" aria-hidden="true"><i class="${icon}"></i></span>
      <span class="pulse-label">${label}</span>
      <strong class="pulse-value">${value}</strong>
      <span class="pulse-note">${note}</span>
    </article>`;

  const fetchJson = (path) => fetch(`${base}/metrics/${path}`, { cache: 'no-store' })
    .then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    });

  Promise.allSettled([
    fetchJson('github_releases_summary.json'),
    fetchJson('youtube_summary.json')
  ]).then(([githubResult, youtubeResult]) => {
    const github = githubResult.status === 'fulfilled' && githubResult.value.status !== 'awaiting_baseline'
      ? githubResult.value : null;
    const youtube = youtubeResult.status === 'fulfilled' ? youtubeResult.value : null;
    const updated = [
      github && (formatDate(github.latestSnapshotDate) && `GitHub snapshot ${formatDate(github.latestSnapshotDate)}`),
      youtube && (formatDate(youtube.last_updated) && `YouTube updated ${formatDate(youtube.last_updated)}`)
    ].filter(Boolean);
    document.getElementById('activityPulseUpdated').textContent = updated.length
      ? `Data dates: ${updated.join(' · ')}`
      : 'Data dates unavailable.';
    const metrics = [
      metric('github', 'fa-brands fa-github', 'Release downloads', format(github?.currentTotalDownloads), github ? 'Current tracked total' : 'Summary unavailable', true),
      metric('github', 'fa-solid fa-arrow-trend-up', 'Downloads gained · 7 days', format(github?.gain7Days), !github ? 'Summary unavailable' : github.gain7Days == null ? 'Comparison not available yet' : 'Across tracked releases'),
      metric('github', 'fa-solid fa-gauge-high', 'Downloads per day · 7 days', format(github?.averageDaily7Days, 1), !github ? 'Summary unavailable' : github.averageDaily7Days == null ? 'Comparison not available yet' : 'Recent daily average'),
      metric('youtube', 'fa-brands fa-youtube', 'Subscribers', format(youtube?.current?.subscribers), youtube ? 'Across tracked channels' : 'Summary unavailable', true),
      metric('youtube', 'fa-solid fa-eye', 'Channel views', format(youtube?.current?.views), youtube ? 'Across tracked channels' : 'Summary unavailable'),
      metric('youtube', 'fa-solid fa-user-plus', 'Subscribers per day · 7 days', format(youtube?.rolling?.subs_per_day_7, 2), !youtube ? 'Summary unavailable' : youtube.rolling?.subs_per_day_7 == null ? 'Recent pace not available yet' : 'Recent daily average')
    ];
    mount.innerHTML = metrics.join('');
    mount.setAttribute('aria-busy', 'false');
  }).catch(() => {
    mount.innerHTML = '<p class="pulse-state">Activity data is temporarily unavailable.</p>';
    mount.setAttribute('aria-busy', 'false');
  });
})();
