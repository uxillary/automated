'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const metrics = require('../scripts/github_discovery_metrics');
const releaseConfig = require('../scripts/github_release_config');

const project = { id: 'app', label: 'App', github: 'owner/app' };
const day = (date, count, uniques = count) => ({ timestamp: `${date}T00:00:00Z`, count, uniques });
const response = (status, body) => ({ status, json: async () => body });
const repoBody = (stars = 2, forks = 3, subscribers = 4) => ({ stargazers_count: stars, forks_count: forks, subscribers_count: subscribers });
const history = (observations = []) => ({ version: 1, metricDefinitions: {}, projects: [project], observations });
const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'github-discovery-'));

function mockedFetch(routes, seen = []) {
  return async (url, options) => {
    seen.push({ url, options });
    const result = routes[new URL(url).pathname];
    return typeof result === 'function' ? result(url, options) : result || response(404, {});
  };
}

test('canonical project identity feeds release tracking without duplicate repository lists', () => {
  assert.deepEqual(releaseConfig, [
    { repo: 'uxillary/font-size-tweak', label: 'FontSize Tweak' },
    { repo: 'uxillary/maintenance-goblin', label: 'Maintenance Goblin' }
  ]);
});

test('first run backfills all returned daily traffic rows and snapshots repository totals', async () => {
  const directory = temp();
  const result = await metrics.run({ token: 'never-write-this-token', fetchImpl: mockedFetch({
    '/repos/owner/app/traffic/views': response(200, { views: [day('2026-09-16', 0, 0), day('2026-09-17', 5, 3)] }),
    '/repos/owner/app/traffic/clones': response(200, { clones: [day('2026-09-16', 2, 1), day('2026-09-17', 4, 2)] }),
    '/repos/owner/app': response(200, repoBody())
  }), outputDirectory: directory, projects: [project], now: new Date('2026-09-17T04:00:00Z'), log: () => {} });
  assert.deepEqual(result.history.observations.map((row) => row.date), ['2026-09-16', '2026-09-17']);
  assert.equal(result.history.observations[0].views, 0);
  assert.equal(result.history.observations[0].clones, 2);
  assert.deepEqual([result.history.observations[1].stars, result.history.observations[1].forks, result.history.observations[1].subscribers], [2, 3, 4]);
  assert.equal(fs.existsSync(path.join(directory, 'github_discovery_history.json')), true);
});

test('upsert by project/date deduplicates reruns and accepts revised source values', () => {
  const first = metrics.upsertObservations(history(), [{ projectId: 'app', date: '2026-01-01', views: 4 }]);
  const again = metrics.upsertObservations(first, [{ projectId: 'app', date: '2026-01-01', views: 9 }]);
  assert.equal(again.observations.length, 1);
  assert.equal(again.observations[0].views, 9);
});

test('rolling-window disappearance preserves older observations', () => {
  const old = { projectId: 'app', date: '2026-01-01', views: 7, uniqueVisitors: 5, clones: 2, uniqueCloners: 1, stars: 2, forks: 3, subscribers: 4 };
  const preserved = metrics.upsertObservations(history([old]), [{ projectId: 'app', date: '2026-02-01', views: 1 }]);
  assert.deepEqual(preserved.observations.map((row) => row.date), ['2026-01-01', '2026-02-01']);
});

test('views success with clones failure retains zero and represents unavailable as null', async () => {
  const directory = temp();
  const result = await metrics.run({ token: 'secret-do-not-leak', fetchImpl: mockedFetch({
    '/repos/owner/app/traffic/views': response(200, { views: [day('2026-09-17', 0, 0)] }),
    '/repos/owner/app/traffic/clones': response(403, {}), '/repos/owner/app': response(200, repoBody())
  }), outputDirectory: directory, projects: [project], now: new Date('2026-09-17T00:00:00Z'), log: () => {} });
  const row = result.history.observations.find((item) => item.date === '2026-09-17');
  assert.equal(row.views, 0);
  assert.equal(row.uniqueVisitors, 0);
  assert.equal(row.clones, null);
  assert.equal(row.uniqueCloners, null);
  assert.equal(result.errors.length, 1);
  assert.doesNotMatch(fs.readFileSync(path.join(directory, 'github_discovery_history.json'), 'utf8'), /secret-do-not-leak|Authorization/);
});

test('clones success with views failure remains collectible', async () => {
  const result = await metrics.collectProject(project, mockedFetch({
    '/repos/owner/app/traffic/views': response(401, {}),
    '/repos/owner/app/traffic/clones': response(200, { clones: [day('2026-09-17', 8, 6)] }),
    '/repos/owner/app': response(200, repoBody())
  }), 'hidden', new Date('2026-09-17T00:00:00Z'));
  assert.equal(result.updates.find((item) => item.date === '2026-09-17').clones, 8);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /owner\/app views failed \(authentication failure, HTTP 401\)/);
});

test('repository totals preserve decreases', () => {
  const old = { projectId: 'app', date: '2026-09-16', stars: 9, forks: 8, subscribers: 7 };
  const updated = metrics.upsertObservations(history([old]), [{ projectId: 'app', date: '2026-09-17', stars: 2, forks: 1, subscribers: 0 }]);
  assert.deepEqual([updated.observations.at(-1).stars, updated.observations.at(-1).forks, updated.observations.at(-1).subscribers], [2, 1, 0]);
});

test('malformed and negative API counts are rejected instead of coerced', () => {
  assert.throws(() => metrics.parseTraffic({ views: [day('2026-09-17', -1)] }, ['views', 'uniqueVisitors'], project.github, 'views'), /invalid numeric\/date data/);
  assert.throws(() => metrics.parseTraffic({ views: [{ timestamp: 'bad', count: '2', uniques: 1 }] }, ['views', 'uniqueVisitors'], project.github, 'views'), /invalid numeric\/date data/);
  assert.throws(() => metrics.parseRepository(repoBody(-1), project.github), /invalid numeric data/);
});

test('one repository failure does not discard another repository success', async () => {
  const directory = temp();
  const second = { id: 'other', label: 'Other', github: 'owner/other' };
  const result = await metrics.run({ token: 'hidden', outputDirectory: directory, projects: [project, second], now: new Date('2026-09-17T00:00:00Z'), log: () => {}, fetchImpl: mockedFetch({
    '/repos/owner/app/traffic/views': response(200, { views: [day('2026-09-17', 3)] }),
    '/repos/owner/app/traffic/clones': response(200, { clones: [] }), '/repos/owner/app': response(200, repoBody()),
    '/repos/owner/other/traffic/views': response(404, {}), '/repos/owner/other/traffic/clones': response(404, {}), '/repos/owner/other': response(404, {})
  }) });
  assert.equal(result.history.observations.length, 1);
  assert.equal(result.history.observations[0].projectId, 'app');
  assert.equal(result.errors.length, 3);
});

test('all permission failures fail without writing empty output', async () => {
  const directory = temp();
  const fetchImpl = mockedFetch({
    '/repos/owner/app/traffic/views': response(403, {}), '/repos/owner/app/traffic/clones': response(403, {}), '/repos/owner/app': response(403, {})
  });
  await assert.rejects(() => metrics.run({ token: 'hidden', fetchImpl, outputDirectory: directory, projects: [project], log: () => {} }), /no valid metrics/);
  assert.equal(fs.existsSync(path.join(directory, 'github_discovery_history.json')), false);
});

test('summary requires complete 7-day coverage and reports daily unique values without summing them', () => {
  const observations = [];
  for (let n = 0; n < 7; n += 1) {
    const date = new Date(Date.parse('2026-09-17T00:00:00Z') - n * 86400000).toISOString().slice(0, 10);
    observations.push({ projectId: 'app', date, views: 2, uniqueVisitors: 1, clones: 3, uniqueCloners: 2, stars: 5, forks: 1, subscribers: 0 });
  }
  const summary = metrics.buildSummary(history(observations)).projects[0];
  assert.equal(summary.views7Days, 14);
  assert.equal(summary.clones7Days, 21);
  assert.equal(summary.uniqueVisitorsDaily7Days.length, 7);
  assert.equal(summary.uniqueClonersDaily7Days.length, 7);
  assert.equal(Object.hasOwn(summary, 'uniqueVisitors7Days'), false);
  assert.equal(summary.coverage.views7DaysComplete, true);
  assert.deepEqual([summary.availableHistoryStart, summary.availableHistoryEnd], ['2026-09-11', '2026-09-17']);
});

test('summary represents absent metrics as null and reports incomplete coverage', () => {
  const summary = metrics.buildSummary(history([{ projectId: 'app', date: '2026-09-17', views: null, uniqueVisitors: null, clones: 0, uniqueCloners: 0 }])).projects[0];
  assert.equal(summary.latestDailyViews, null);
  assert.equal(summary.latestDailyClones, 0);
  assert.equal(summary.views7Days, null);
  assert.equal(summary.clones7Days, null);
  assert.equal(summary.coverage.state, 'partial');
});

test('authentication errors and generated files never reveal the token', async () => {
  const token = 'sensitive-token-value';
  let headers;
  await assert.rejects(() => metrics.request('https://api.github.com/repos/owner/app/traffic/views', 'owner/app', 'views', async (_url, options) => { headers = options.headers; return response(403, {}); }, token), (error) => {
    assert.doesNotMatch(error.message, /sensitive-token-value|Bearer/);
    return true;
  });
  assert.equal(headers.Authorization, `Bearer ${token}`);
});

