'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const away = require('../docs/js/while-away');

const baseTime = Date.parse('2026-09-20T10:00:00Z');
const visit = (overrides = {}) => ({
  version: 1,
  visitedAt: new Date(baseTime - 4 * 86400000).toISOString(),
  github: { totalDownloads: 100, repositories: { 'uxillary/font-size-tweak': 90, 'uxillary/maintenance-goblin': 10 }, records: { bestDay: { downloads: 8, date: '2026-09-10' }, bestWeek: { downloads: 35, startDate: '2026-09-01', endDate: '2026-09-07' } } },
  youtube: { subscribers: 80, views: 1000 },
  ...overrides
});
const current = (overrides = {}) => ({
  version: 1,
  visitedAt: new Date(baseTime).toISOString(),
  github: { totalDownloads: 131, repositories: { 'uxillary/font-size-tweak': 121, 'uxillary/maintenance-goblin': 10 }, records: { bestDay: { downloads: 9, date: '2026-09-19' }, bestWeek: { downloads: 38, startDate: '2026-09-13', endDate: '2026-09-19' } } },
  youtube: { subscribers: 84, views: 2284 },
  ...overrides
});

test('first visit establishes a valid baseline without claiming zero change', () => {
  const result = away.compareVisits(null, current());
  assert.equal(result.type, 'first');
  assert.equal(result.next.github.totalDownloads, 131);
});

test('returning visit reports downloads, repository changes, YouTube, milestones, and new records', () => {
  const result = away.compareVisits(visit(), current(), [100, 250, 500, 1000, 2500]);
  assert.equal(result.type, 'returning');
  assert.equal(result.downloads, 31);
  assert.deepEqual(result.projects.map(({ repo, type, change }) => [repo, type, change]), [
    ['uxillary/font-size-tweak', 'change', 31], ['uxillary/maintenance-goblin', 'change', 0]
  ]);
  assert.deepEqual(result.youtube, [{ key: 'subscribers', change: 4 }, { key: 'views', change: 1284 }]);
  assert.deepEqual(result.crossedMilestones, []);
  assert.deepEqual(result.records.map(({ type, downloads }) => [type, downloads]), [['day', 9], ['week', 38]]);
});

test('zero changes remain a valid no-change comparison', () => {
  const same = visit({ visitedAt: new Date(baseTime - 86400000).toISOString() });
  const result = away.compareVisits(same, { ...same, visitedAt: new Date(baseTime).toISOString() });
  assert.equal(result.type, 'returning');
  assert.equal(result.downloads, 0);
  assert.ok(result.projects.every((project) => project.change === 0));
});

test('decreased lifetime total resets the comparison and creates a safe baseline', () => {
  const result = away.compareVisits(visit(), current({ github: { totalDownloads: 99, repositories: {} } }));
  assert.equal(result.type, 'reset');
  assert.equal(result.next.github.totalDownloads, 99);
});

test('new repositories are marked newly tracked, removed repositories are omitted from changes', () => {
  const result = away.compareVisits(visit(), current({ github: { totalDownloads: 130, repositories: { 'uxillary/font-size-tweak': 120, 'uxillary/new-app': 10 } } }));
  assert.deepEqual(result.projects.map(({ repo, type }) => [repo, type]), [['uxillary/font-size-tweak', 'change'], ['uxillary/new-app', 'new']]);
  assert.deepEqual(result.removedRepositories, ['uxillary/maintenance-goblin']);
});

test('repository decreases are never shown as negative download changes', () => {
  const result = away.compareVisits(visit(), current({ github: { totalDownloads: 131, repositories: { 'uxillary/font-size-tweak': 89, 'uxillary/maintenance-goblin': 42 } } }));
  assert.equal(result.projects.find((project) => project.repo.endsWith('font-size-tweak')).type, 'reset');
  assert.equal(result.projects.find((project) => project.repo.endsWith('maintenance-goblin')).change, 32);
});

test('YouTube changes require compatible values in both visits', () => {
  const previous = visit({ youtube: {} });
  assert.deepEqual(away.compareVisits(previous, current()).youtube, []);
});

test('crosses one or several configured canonical milestones without inventing dates', () => {
  const previous = visit({ github: { totalDownloads: 490, repositories: {} } });
  const now = current({ github: { totalDownloads: 2600, repositories: {} } });
  const result = away.compareVisits(previous, now, [100, 250, 500, 1000, 2500]);
  assert.deepEqual(result.crossedMilestones, [500, 1000, 2500]);
  assert.equal(result.crossedMilestones.some((item) => item.reachedDate), false);
});

test('record events require an improved recorded value after the prior visit date', () => {
  const previous = visit({ visitedAt: '2026-09-18T18:00:00Z' });
  const result = away.compareVisits(previous, current());
  assert.deepEqual(result.records.map((record) => record.type), ['day', 'week']);
  const olderRecord = current({ github: { ...current().github, records: { bestDay: { downloads: 10, date: '2026-09-18' } } } });
  assert.equal(away.compareVisits(previous, olderRecord).records.length, 0);
});

test('same-session refresh retains the prior baseline; an older visit establishes a new baseline', () => {
  const saved = visit({ visitedAt: new Date(baseTime - 5 * 60000).toISOString() });
  const sameSession = away.compareVisits(saved, current());
  assert.equal(sameSession.sameSession, true);
  assert.equal(sameSession.next.github.totalDownloads, 100);
  const oldVisit = visit({ visitedAt: new Date(baseTime - 2 * 3600000).toISOString() });
  const newSession = away.compareVisits(oldVisit, current());
  assert.equal(newSession.sameSession, false);
  assert.equal(newSession.next.github.totalDownloads, 131);
});

test('invalid JSON, incompatible schema, corrupt fields, and unavailable storage fail gracefully', () => {
  assert.equal(away.readSnapshot({ getItem: () => '{bad json' }), null);
  assert.equal(away.readSnapshot({ getItem: () => JSON.stringify({ ...visit(), version: 2 }) }), null);
  assert.equal(away.readSnapshot({ getItem: () => JSON.stringify({ ...visit(), github: { totalDownloads: -1, repositories: {} } }) }), null);
  assert.equal(away.readSnapshot(null), null);
  assert.doesNotThrow(() => away.createDashboard({ storage: null, now: () => baseTime }));
});

test('dashboard writes only after current GitHub data is available and leaves same-session storage untouched', () => {
  const memory = new Map([[away.STORAGE_KEY, JSON.stringify(visit({ visitedAt: new Date(baseTime - 5 * 60000).toISOString() }))]]);
  const storage = { getItem: (key) => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value) };
  const tracker = away.createDashboard({ storage, now: () => baseTime });
  const before = memory.get(away.STORAGE_KEY);
  const gh = current().github;
  tracker.setGithub({ currentTotalDownloads: gh.totalDownloads, repositories: Object.entries(gh.repositories).map(([repo, downloads]) => ({ repo, downloads, label: repo })) }, { bestDay: null, bestWeek: null });
  assert.equal(memory.get(away.STORAGE_KEY), before);
  tracker.setYoutube(current().youtube && { current: current().youtube });
  assert.equal(memory.get(away.STORAGE_KEY), before);
});

test('new-session baseline persists after comparison display and storage write failures are harmless', () => {
  const memory = new Map([[away.STORAGE_KEY, JSON.stringify(visit({ visitedAt: new Date(baseTime - 2 * 3600000).toISOString() }))]]);
  const storage = { getItem: (key) => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value) };
  const tracker = away.createDashboard({ storage, now: () => baseTime });
  const gh = current().github;
  tracker.setGithub({ currentTotalDownloads: gh.totalDownloads, repositories: Object.entries(gh.repositories).map(([repo, downloads]) => ({ repo, downloads, label: repo })) }, { bestDay: null, bestWeek: null });
  tracker.setYoutube({ current: current().youtube });
  assert.equal(JSON.parse(memory.get(away.STORAGE_KEY)).github.totalDownloads, 131);
  const failing = away.createDashboard({ storage: { getItem: () => null, setItem: () => { throw new Error('disabled'); } }, now: () => baseTime });
  assert.doesNotThrow(() => { failing.setGithub(current().github, {}); failing.setYoutube(null); });
});
