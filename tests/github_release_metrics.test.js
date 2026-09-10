'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const metrics = require('../scripts/github_release_metrics');

const snapshot = (date, total, repo = total) => ({ date, total, repositories: { 'ux/app': repo }, releases: {}, assets: {} });

test('sums only valid release asset downloads', () => {
  assert.equal(metrics.sumAssetDownloads([{ download_count: 4 }, { download_count: 6 }, { download_count: -1 }, null]), 10);
  assert.equal(metrics.sumAssetDownloads('malformed'), 0);
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
