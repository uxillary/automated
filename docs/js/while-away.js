(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WhileAwayDashboard = api.createDashboard();
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';

  const STORAGE_KEY = 'automatedMetricsVisit.v1';
  const VERSION = 1;
  // Refreshes within this hour reuse the last meaningful visit baseline.
  const SESSION_MS = 60 * 60 * 1000;
  const COMMIT_WAIT_MS = 5000;
  const isCount = (value) => Number.isSafeInteger(value) && value >= 0;
  const finiteDate = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value));

  function normalizeSnapshot(value) {
    if (!value || value.version !== VERSION || !finiteDate(value.visitedAt) || !value.github || !isCount(value.github.totalDownloads) || !value.github.repositories || typeof value.github.repositories !== 'object' || Array.isArray(value.github.repositories)) return null;
    const repositories = {};
    for (const [repo, total] of Object.entries(value.github.repositories)) if (typeof repo === 'string' && isCount(total)) repositories[repo] = total;
    const youtube = {};
    for (const key of ['subscribers', 'views']) if (isCount(value.youtube?.[key])) youtube[key] = value.youtube[key];
    const records = {};
    if (isCount(value.github.records?.bestDay?.downloads) && finiteDate(`${value.github.records.bestDay.date}T00:00:00Z`)) records.bestDay = { downloads: value.github.records.bestDay.downloads, date: value.github.records.bestDay.date };
    if (isCount(value.github.records?.bestWeek?.downloads) && finiteDate(value.github.records.bestWeek.startDate) && finiteDate(value.github.records.bestWeek.endDate)) records.bestWeek = { downloads: value.github.records.bestWeek.downloads, startDate: value.github.records.bestWeek.startDate, endDate: value.github.records.bestWeek.endDate };
    return { version: VERSION, visitedAt: value.visitedAt, github: { totalDownloads: value.github.totalDownloads, repositories, records }, youtube };
  }

  function readSnapshot(storage) {
    try {
      const value = storage.getItem(STORAGE_KEY);
      return value == null ? null : normalizeSnapshot(JSON.parse(value));
    } catch { return null; }
  }

  function signed(value) {
    return value >= 0 ? `+${value.toLocaleString()}` : `−${Math.abs(value).toLocaleString()}`;
  }

  function visitLabel(visitedAt, now = Date.now()) {
    const then = new Date(visitedAt);
    const current = new Date(now);
    if (!Number.isFinite(then.getTime())) return 'a previous visit';
    const start = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
    const days = Math.max(0, Math.floor((start(current) - start(then)) / 86400000));
    if (days === 0) return 'Earlier today';
    if (days === 1) return 'Yesterday';
    if (days < 14) return `${days} days ago`;
    return then.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function compareVisits(previous, current, thresholds = []) {
    const old = normalizeSnapshot(previous);
    if (!old) return { type: 'first', next: normalizeSnapshot(current) };
    const now = Date.parse(current.visitedAt);
    const oldTime = Date.parse(old.visitedAt);
    const sameSession = Number.isFinite(now) && now >= oldTime && now - oldTime < SESSION_MS;
    const next = sameSession ? old : normalizeSnapshot(current);
    const currentGithub = current.github;
    if (!currentGithub || !isCount(currentGithub.totalDownloads)) return { type: 'unavailable', sameSession, next };
    if (currentGithub.totalDownloads < old.github.totalDownloads) return { type: 'reset', sameSession, next };

    const projects = [];
    for (const [repo, total] of Object.entries(currentGithub.repositories || {})) {
      if (!isCount(total)) continue;
      if (!Object.hasOwn(old.github.repositories, repo)) projects.push({ repo, type: 'new' });
      else if (total < old.github.repositories[repo]) projects.push({ repo, type: 'reset' });
      else projects.push({ repo, type: 'change', change: total - old.github.repositories[repo] });
    }
    projects.sort((a, b) => (b.change || 0) - (a.change || 0) || a.repo.localeCompare(b.repo));
    const crossedMilestones = [...new Set(thresholds.filter(isCount))]
      .filter((threshold) => old.github.totalDownloads < threshold && currentGithub.totalDownloads >= threshold)
      .sort((a, b) => a - b);
    const sinceDate = old.visitedAt.slice(0, 10);
    const records = [];
    const currentBestDay = currentGithub.records?.bestDay;
    const previousBestDay = old.github.records?.bestDay;
    if (currentBestDay && previousBestDay && currentBestDay.downloads > previousBestDay.downloads && currentBestDay.date > sinceDate) records.push({ type: 'day', downloads: currentBestDay.downloads });
    const currentBestWeek = currentGithub.records?.bestWeek;
    const previousBestWeek = old.github.records?.bestWeek;
    if (currentBestWeek && previousBestWeek && currentBestWeek.downloads > previousBestWeek.downloads && currentBestWeek.endDate > sinceDate) records.push({ type: 'week', downloads: currentBestWeek.downloads });
    const youtube = ['subscribers', 'views'].flatMap((key) => isCount(old.youtube[key]) && isCount(current.youtube?.[key])
      ? [{ key, change: current.youtube[key] - old.youtube[key] }] : []);
    return {
      type: 'returning', sameSession, next, previousAt: old.visitedAt,
      downloads: currentGithub.totalDownloads - old.github.totalDownloads,
      projects, youtube, crossedMilestones, records,
      removedRepositories: Object.keys(old.github.repositories).filter((repo) => !Object.hasOwn(currentGithub.repositories || {}, repo))
    };
  }

  function createDashboard(options = {}) {
    const storage = options.storage || (() => { try { return root.localStorage; } catch { return null; } })();
    const now = options.now || (() => Date.now());
    const previous = readSnapshot(storage);
    const startedAt = new Date(now()).toISOString();
    let github = null;
    let youtube = null;
    let analytics = null;
    let thresholds = [];
    let result = null;
    let saved = false;
    let youtubeReady = false;
    let timer = null;

    function makeCurrent() {
      if (!github) return null;
      const repositories = {};
      for (const item of Array.isArray(github.repositories) ? github.repositories : []) {
        if (typeof item?.repo === 'string' && isCount(item.downloads)) repositories[item.repo] = item.downloads;
      }
      const records = {};
      if (isCount(analytics?.bestDay?.downloads)) records.bestDay = { downloads: analytics.bestDay.downloads, date: analytics.bestDay.date };
      if (isCount(analytics?.bestWeek?.total)) records.bestWeek = { downloads: analytics.bestWeek.total, startDate: analytics.bestWeek.startDate, endDate: analytics.bestWeek.endDate };
      return normalizeSnapshot({ version: VERSION, visitedAt: startedAt, github: { totalDownloads: github.currentTotalDownloads, repositories, records }, youtube: { subscribers: youtube?.current?.subscribers, views: youtube?.current?.views } });
    }

    function render() {
      const section = root.document?.getElementById('whileAway');
      if (!section || !result) return;
      const summary = section.querySelector('#whileAwaySummary');
      const details = section.querySelector('#whileAwayDetails');
      section.hidden = false;
      const escape = (text) => String(text ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
      const fmt = (value) => Number(value).toLocaleString();
      if (result.type === 'first') {
        summary.textContent = 'Visit tracking is ready — changes will appear next time.';
        details.innerHTML = '';
      } else if (result.type === 'reset') {
        summary.textContent = 'Download comparison reset because the tracked total decreased.';
        details.innerHTML = '';
      } else if (result.type === 'unavailable') {
        summary.textContent = 'Visit comparison is unavailable for this visit.';
        details.innerHTML = '';
      } else {
        summary.textContent = result.downloads > 0
          ? `${signed(result.downloads)} downloads since your last visit · ${visitLabel(result.previousAt, now())}`
          : 'No new downloads since your last visit';
        const entries = result.projects.map((project) => {
          const label = github.repositories.find((item) => item.repo === project.repo)?.label || project.repo;
          const change = project.type === 'new' ? 'Newly tracked' : project.type === 'reset' ? 'Comparison reset' : signed(project.change);
          return `<div><dt>${escape(label)}</dt><dd>${escape(change)}</dd></div>`;
        });
        if (result.youtube.length) {
          const labels = { subscribers: 'Subscribers', views: 'Views' };
          entries.push(...result.youtube.map((item) => `<div><dt>${labels[item.key]}</dt><dd>${escape(signed(item.change))}</dd></div>`));
        }
        if (result.removedRepositories.length) entries.push(`<div class="while-away-note"><dt>Repositories no longer tracked</dt><dd>${result.removedRepositories.length}</dd></div>`);
        const events = [
          ...result.crossedMilestones.map((value) => `<li>Milestone crossed: ${fmt(value)} downloads</li>`),
          ...result.records.map((record) => `<li>New record: ${fmt(record.downloads)} downloads ${record.type === 'day' ? 'in one day' : 'in seven days'}</li>`)
        ];
        details.innerHTML = `${entries.length ? `<dl class="while-away-changes">${entries.join('')}</dl>` : ''}${events.length ? `<ul class="while-away-events">${events.join('')}</ul>` : ''}`;
      }
    }

    function persist() {
      if (saved || !github) return;
      const current = makeCurrent();
      if (!current) return;
      saved = true;
      try { storage?.setItem(STORAGE_KEY, JSON.stringify(result?.sameSession ? previous : current)); } catch { /* Local visit storage is optional. */ }
    }

    function schedulePersist() {
      if (!github || saved) return;
      if (youtubeReady) { persist(); return; }
      if (!timer) timer = setTimeout(persist, COMMIT_WAIT_MS);
    }

    return {
      setGithub(summary, downloadAnalytics) {
        github = summary;
        analytics = downloadAnalytics;
        thresholds = Array.isArray(summary?.milestoneThresholds) ? summary.milestoneThresholds : [];
        const current = makeCurrent();
        if (!current) return;
        result = compareVisits(previous, current, thresholds);
        render();
        schedulePersist();
      },
      setYoutube(value) {
        youtubeReady = true;
        youtube = value;
        if (github) {
          const current = makeCurrent();
          result = compareVisits(previous, current, thresholds);
          render();
          if (timer) clearTimeout(timer);
          persist();
        }
      }
    };
  }

  return { STORAGE_KEY, VERSION, SESSION_MS, normalizeSnapshot, readSnapshot, visitLabel, compareVisits, createDashboard };
});
