'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const metrics = require('../scripts/github_release_metrics');

const snapshot = (date, total, repo = total) => ({ date, total, repositories: { 'ux/app': repo }, releases: {}, assets: {} });

test('sums only valid release asset downloads', () => {
  assert.equal(metrics.sumAssetDownloads([{ downloads: 1057 }, { downloads: 6 }, { downloads: -1 }, null]), 1063);
  assert.equal(metrics.sumAssetDownloads('malformed'), 0);
});

test('normalised downloads propagate through every aggregate and replace a broken same-day snapshot', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'release-metrics-'));
  const historyPath = path.join(directory, 'github_releases_history.json');
  const brokenSnapshot = {
    date: '2026-09-10', total: 0,
    repositories: { 'ux/font': 0, 'ux/goblin': 0 },
    releases: { 'ux/font#11': 0, 'ux/font#10': 0, 'ux/goblin#20': 0 },
    assets: { 'ux/font#10#101': 1057 }
  };
  fs.writeFileSync(historyPath, `${JSON.stringify({ version: 1, metadata: {}, snapshots: [brokenSnapshot] })}\n`);

  const responses = new Map([
    ['/repos/ux/font/releases', [
      { id: 11, tag_name: 'v1.1', name: 'Font 1.1', draft: false, published_at: '2026-08-26T00:00:00Z' },
      { id: 10, tag_name: 'v1.0', name: 'Font 1.0', draft: false, published_at: '2025-07-18T00:00:00Z' }
    ]],
    ['/repos/ux/font/releases/11/assets', [
      { id: 111, name: 'font.sha256', download_count: 4, size: 92 },
      { id: 112, name: 'font.zip', download_count: 29, size: 100 },
      { id: 113, name: 'font.exe', download_count: 109, size: 200 }
    ]],
    ['/repos/ux/font/releases/10/assets', [{ id: 101, name: 'FontSizeTweak-v1.0.zip', download_count: 1057, size: 300 }]],
    ['/repos/ux/goblin/releases', [{ id: 20, tag_name: 'v0.2', name: 'Goblin 0.2', draft: false, published_at: '2026-08-23T00:00:00Z' }]],
    ['/repos/ux/goblin/releases/20/assets', [
      { id: 201, name: 'goblin.exe', download_count: 4, size: 400 },
      { id: 202, name: 'goblin.sha256', download_count: 0, size: 90 },
      { id: 203, name: 'goblin-old.exe', download_count: 10, size: 500 }
    ]]
  ]);
  const fetchImpl = async (url) => {
    const pathname = new URL(url).pathname;
    return { ok: true, status: 200, json: async () => responses.get(pathname) || [] };
  };

  const result = await metrics.run({
    fetchImpl, token: 'x', outputDirectory: directory, now: new Date('2026-09-10T12:00:00Z'),
    config: [{ repo: 'ux/font', label: 'Font' }, { repo: 'ux/goblin', label: 'Goblin' }]
  });
  const current = result.history.snapshots[0];
  assert.equal(result.history.snapshots.length, 1);
  assert.deepEqual(current.releases, { 'ux/font#11': 142, 'ux/font#10': 1057, 'ux/goblin#20': 14 });
  assert.deepEqual(current.repositories, { 'ux/font': 1199, 'ux/goblin': 14 });
  assert.equal(current.total, 1213);
  assert.equal(current.assets['ux/font#10#101'], 1057);
  assert.equal(result.summary.currentTotalDownloads, 1213);
  assert.equal(result.summary.highestDownloadedRelease.id, 'ux/font#10');
  assert.equal(result.summary.topRepository.repo, 'ux/font');
  assert.deepEqual(result.summary.milestones, { latestAchieved: 1000, next: 2500, progressPercent: 14.2 });
  assert.equal(JSON.parse(fs.readFileSync(historyPath, 'utf8')).snapshots[0].total, 1213);
});

test('same-day snapshot is replaced while all other history is preserved', () => {
  const old = { version: 1, metadata: { repositories: {}, releases: { old: { name: 'Removed release' } }, assets: {} }, snapshots: [snapshot('2026-01-01', 10), snapshot('2026-01-02', 12)] };
  const result = metrics.upsertSnapshot(old, snapshot('2026-01-02', 15), { repositories: {}, releases: {}, assets: {} });
  assert.deepEqual(result.snapshots.map((s) => [s.date, s.total]), [['2026-01-01', 10], ['2026-01-02', 15]]);
  assert.equal(result.metadata.releases.old.name, 'Removed release');
});

test('daily deltas leave the baseline unavailable and calculate later changes', () => {
  assert.deepEqual(metrics.dailyDeltas([snapshot('2026-01-01', 10), snapshot('2026-01-03', 16)]), [
    { date: '2026-01-01', downloads: null }, { date: '2026-01-03', downloads: 6 }
  ]);
});

test('7 and 30 day comparisons require a sufficiently old observation', () => {
  const rows = [snapshot('2026-01-01', 10), snapshot('2026-01-08', 24), snapshot('2026-01-31', 50)];
  assert.equal(metrics.comparison(rows.slice(0, 2), 7, 'total'), 14);
  assert.equal(metrics.comparison(rows.slice(0, 2), 30, 'total'), null);
  assert.equal(metrics.comparison(rows, 30, 'total'), 40);
});

test('first run summary is honest about unavailable history', () => {
  const history = { metadata: { repositories: { 'ux/app': { label: 'App' } }, releases: {}, assets: {} }, snapshots: [snapshot('2026-01-01', 10)] };
  const summary = metrics.buildSummary(history);
  assert.equal(summary.currentTotalDownloads, 10);
  assert.equal(summary.gainSincePreviousSnapshot, null);
  assert.equal(summary.gain7Days, null);
  assert.equal(summary.averageDaily30Days, null);
});

test('missing history has an awaiting baseline state', () => {
  assert.deepEqual(metrics.buildSummary({ snapshots: [] }), { version: 1, status: 'awaiting_baseline', latestSnapshotDate: null });
});

test('milestones calculate achieved, next, and interval progress', () => {
  assert.deepEqual(metrics.calculateMilestones(175, [100, 250, 500]), { latestAchieved: 100, next: 250, progressPercent: 50 });
});

test('configuration is an explicit validated allow-list', () => {
  assert.deepEqual(metrics.validateConfig([{ repo: 'ux/app' }]), [{ repo: 'ux/app', label: 'app' }]);
  assert.throws(() => metrics.validateConfig([{ repo: 'ux/app' }, { repo: 'ux/app' }]), /duplicate/);
  assert.throws(() => metrics.validateConfig([{ repo: 'invalid' }]), /Invalid/);
});

test('malformed API data fails before files can be overwritten', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'release-metrics-'));
  const historyPath = path.join(directory, 'github_releases_history.json');
  fs.writeFileSync(historyPath, '{"keep":true}\n');
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ unexpected: true }) });
  await assert.rejects(() => metrics.run({ fetchImpl, token: 'x', outputDirectory: directory, config: [{ repo: 'ux/app' }] }), /Malformed/);
  assert.equal(fs.readFileSync(historyPath, 'utf8'), '{"keep":true}\n');
});

test('collector ignores draft and malformed releases and never discovers other repositories', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    const data = url.includes('/assets') ? [{ id: 9, name: 'app.zip', download_count: 3, size: 40 }] : [
      { id: 1, tag_name: 'v1', name: '', draft: false, prerelease: false, published_at: '2026-01-01T00:00:00Z' },
      { id: 2, tag_name: 'v2', draft: true }, { nonsense: true }
    ];
    return { ok: true, status: 200, json: async () => data };
  };
  const result = await metrics.collectRepositories([{ repo: 'ux/app', label: 'App' }], fetchImpl, 'x');
  assert.equal(result[0].releases.length, 1);
  assert.equal(result[0].releases[0].assets[0].downloads, 3);
  assert.ok(calls.every((url) => url.includes('/repos/ux/app/')));
});
