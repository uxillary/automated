'use strict';

const fs = require('node:fs');
const path = require('node:path');
const configuredRepositories = require('./github_release_config');

const API = 'https://api.github.com';
const DAY_MS = 86_400_000;
const MILESTONES = [100, 250, 500, 1000, 2500, 5000, 10000];

const validCount = (value) => Number.isInteger(value) && value >= 0 ? value : 0;

function sumAssetDownloads(assets) {
  return Array.isArray(assets) ? assets.reduce((sum, asset) => sum + validCount(asset?.downloads), 0) : 0;
}

function validateConfig(config) {
  if (!Array.isArray(config) || !config.length) throw new Error('At least one repository must be configured');
  const seen = new Set();
  return config.map((item) => {
    if (!item || typeof item.repo !== 'string' || !/^[^/]+\/[^/]+$/.test(item.repo) || seen.has(item.repo)) {
      throw new Error(`Invalid or duplicate configured repository: ${item?.repo || '(missing)'}`);
    }
    seen.add(item.repo);
    return { repo: item.repo, label: typeof item.label === 'string' && item.label.trim() ? item.label.trim() : item.repo.split('/')[1] };
  });
}

async function fetchPages(url, fetchImpl, token) {
  const output = [];
  for (let page = 1; page <= 100; page += 1) {
    const separator = url.includes('?') ? '&' : '?';
    const response = await fetchImpl(`${url}${separator}per_page=100&page=${page}`, {
      headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'automated-release-metrics' }
    });
    if (!response.ok) throw new Error(`GitHub API request failed (${response.status}) for ${url}`);
    const body = await response.json();
    if (!Array.isArray(body)) throw new Error(`Malformed GitHub API response for ${url}`);
    output.push(...body);
    if (body.length < 100) return output;
  }
  throw new Error(`Pagination safety limit exceeded for ${url}`);
}

async function collectRepositories(config, fetchImpl, token) {
  const allowed = validateConfig(config);
  const repositories = [];
  for (const configured of allowed) {
    const rawReleases = await fetchPages(`${API}/repos/${configured.repo}/releases`, fetchImpl, token);
    const releases = [];
    for (const release of rawReleases) {
      if (!release || release.draft === true || !Number.isInteger(release.id) || typeof release.tag_name !== 'string') continue;
      const rawAssets = await fetchPages(`${API}/repos/${configured.repo}/releases/${release.id}/assets`, fetchImpl, token);
      const assets = rawAssets.filter((asset) => asset && Number.isInteger(asset.id) && typeof asset.name === 'string').map((asset) => ({
        id: String(asset.id), name: asset.name, downloads: validCount(asset.download_count), size: validCount(asset.size)
      }));
      releases.push({
        id: String(release.id), name: typeof release.name === 'string' && release.name ? release.name : release.tag_name,
        tag: release.tag_name, publishedAt: typeof release.published_at === 'string' ? release.published_at : null,
        prerelease: release.prerelease === true, assets
      });
    }
    repositories.push({ ...configured, releases });
  }
  return repositories;
}

function buildCurrent(repositories, date) {
  const snapshot = { date, total: 0, repositories: {}, releases: {}, assets: {} };
  const metadata = { repositories: {}, releases: {}, assets: {} };
  for (const repository of repositories) {
    let repoTotal = 0;
    metadata.repositories[repository.repo] = { label: repository.label };
    for (const release of repository.releases) {
      const releaseKey = `${repository.repo}#${release.id}`;
      const releaseTotal = sumAssetDownloads(release.assets);
      snapshot.releases[releaseKey] = releaseTotal;
      metadata.releases[releaseKey] = { repository: repository.repo, name: release.name, tag: release.tag, publishedAt: release.publishedAt, prerelease: release.prerelease };
      for (const asset of release.assets) {
        const assetKey = `${repository.repo}#${release.id}#${asset.id}`;
        snapshot.assets[assetKey] = asset.downloads;
        metadata.assets[assetKey] = { repository: repository.repo, release: releaseKey, name: asset.name, size: asset.size };
      }
      repoTotal += releaseTotal;
    }
    snapshot.repositories[repository.repo] = repoTotal;
    snapshot.total += repoTotal;
  }
  return { snapshot, metadata };
}

function upsertSnapshot(history, snapshot, metadata) {
  const existing = history && Array.isArray(history.snapshots) ? history.snapshots : [];
  const snapshots = existing.filter((item) => item && item.date !== snapshot.date);
  snapshots.push(snapshot);
  snapshots.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const priorMetadata = history?.metadata || {};
  return {
    version: 1,
    metadata: {
      repositories: { ...(priorMetadata.repositories || {}), ...metadata.repositories },
      releases: { ...(priorMetadata.releases || {}), ...metadata.releases },
      assets: { ...(priorMetadata.assets || {}), ...metadata.assets }
    },
    snapshots
  };
}

function comparison(history, days, field, key) {
  if (!Array.isArray(history) || history.length < 2) return null;
  const latest = history.at(-1);
  const target = new Date(`${latest.date}T00:00:00Z`).getTime() - days * DAY_MS;
  const baseline = [...history].reverse().find((item) => new Date(`${item.date}T00:00:00Z`).getTime() <= target);
  if (!baseline) return null;
  const currentValue = key == null ? latest[field] : latest[field]?.[key];
  const baselineValue = key == null ? baseline[field] : baseline[field]?.[key];
  return Number.isFinite(currentValue) && Number.isFinite(baselineValue) ? Math.max(0, currentValue - baselineValue) : null;
}

function dailyDeltas(snapshots) {
  return (snapshots || []).map((snapshot, index) => ({
    date: snapshot.date,
    downloads: index === 0 ? null : Math.max(0, snapshot.total - snapshots[index - 1].total)
  }));
}

function calculateMilestones(total, thresholds = MILESTONES) {
  const sorted = [...thresholds].filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
  const achieved = [...sorted].reverse().find((n) => total >= n) || null;
  const next = sorted.find((n) => total < n) || null;
  const floor = achieved || 0;
  const progress = next == null ? 100 : Math.max(0, Math.min(100, ((total - floor) / (next - floor)) * 100));
  return { latestAchieved: achieved, next, progressPercent: Math.round(progress * 10) / 10 };
}

const maxEntry = (object) => Object.entries(object || {}).sort((a, b) => b[1] - a[1])[0] || null;

function buildSummary(history) {
  const snapshots = history.snapshots || [];
  if (!snapshots.length) return { version: 1, status: 'awaiting_baseline', latestSnapshotDate: null };
  const latest = snapshots.at(-1);
  const previous = snapshots.length > 1 ? Math.max(0, latest.total - snapshots.at(-2).total) : null;
  const gain7 = comparison(snapshots, 7, 'total');
  const gain30 = comparison(snapshots, 30, 'total');
  const repositoryTotals = Object.entries(latest.repositories).map(([repo, downloads]) => ({
    repo, label: history.metadata.repositories[repo]?.label || repo, downloads,
    gain7: comparison(snapshots, 7, 'repositories', repo), gain30: comparison(snapshots, 30, 'repositories', repo)
  }));
  const releaseTotals = Object.entries(latest.releases).map(([id, downloads]) => ({ id, ...history.metadata.releases[id], downloads }));
  const assetTotals = Object.entries(latest.assets).map(([id, downloads]) => ({ id, ...history.metadata.assets[id], downloads }));
  const topRepo = [...repositoryTotals].sort((a, b) => b.downloads - a.downloads)[0] || null;
  const fastestRepo = repositoryTotals.filter((r) => r.gain7 != null).sort((a, b) => b.gain7 - a.gain7)[0] || null;
  const topRelease = maxEntry(latest.releases);
  const topAsset = maxEntry(latest.assets);
  const newestRelease = [...releaseTotals].filter((r) => r.publishedAt).sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)))[0] || null;
  return {
    version: 1, status: 'ready', latestSnapshotDate: latest.date, currentTotalDownloads: latest.total,
    gainSincePreviousSnapshot: previous, gain7Days: gain7, gain30Days: gain30,
    averageDaily7Days: gain7 == null ? null : gain7 / 7, averageDaily30Days: gain30 == null ? null : gain30 / 30,
    trackedRepositoryCount: repositoryTotals.length, trackedReleaseCount: releaseTotals.length,
    repositories: repositoryTotals, releases: releaseTotals, assets: assetTotals,
    topRepository: topRepo, fastestGrowingRepository: fastestRepo,
    highestDownloadedRelease: topRelease ? releaseTotals.find((r) => r.id === topRelease[0]) : null,
    highestDownloadedAsset: topAsset ? assetTotals.find((a) => a.id === topAsset[0]) : null,
    newestRelease, milestones: calculateMilestones(latest.total), daily: dailyDeltas(snapshots)
  };
}

async function run(options = {}) {
  const fetchImpl = options.fetchImpl || global.fetch;
  const token = options.token || process.env.GH_TOKEN;
  if (!token) throw new Error('GH_TOKEN is required');
  const outputDirectory = options.outputDirectory || path.join(__dirname, '..', 'docs', 'metrics');
  const date = (options.now || new Date()).toISOString().slice(0, 10);
  const historyPath = path.join(outputDirectory, 'github_releases_history.json');
  let history = { version: 1, metadata: { repositories: {}, releases: {}, assets: {} }, snapshots: [] };
  if (fs.existsSync(historyPath)) history = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
  const repositories = await collectRepositories(options.config || configuredRepositories, fetchImpl, token);
  const current = buildCurrent(repositories, date);
  const updated = upsertSnapshot(history, current.snapshot, current.metadata);
  const summary = buildSummary(updated);
  fs.mkdirSync(outputDirectory, { recursive: true });
  fs.writeFileSync(historyPath, `${JSON.stringify(updated, null, 2)}\n`);
  fs.writeFileSync(path.join(outputDirectory, 'github_releases_summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  return { history: updated, summary };
}

module.exports = { MILESTONES, sumAssetDownloads, validateConfig, fetchPages, collectRepositories, buildCurrent, upsertSnapshot, comparison, dailyDeltas, calculateMilestones, buildSummary, run };

if (require.main === module) run().catch((error) => { console.error(error.message); process.exitCode = 1; });
