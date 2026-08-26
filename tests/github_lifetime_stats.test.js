'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const stats = require('../scripts/github_lifetime_stats');

function response(body, { status = 200, link = null } = {}) {
  return { ok: status >= 200 && status < 300, status, json: async () => body, headers: { get: (name) => name === 'link' ? link : null } };
}

test('windows completely cover the range without overlaps or gaps, including leap day', () => {
  const start = new Date('2019-02-28T12:34:56.000Z');
  const end = new Date('2021-03-02T12:34:56.000Z');
  const windows = stats.createContributionWindows(start, end);
  assert.equal(windows[0].from, start.toISOString());
  assert.equal(windows.at(-1).to, end.toISOString());
  assert.ok(windows.some((window) => window.to.startsWith('2020-02-28')));
  for (let index = 1; index < windows.length; index++) {
    assert.equal(Date.parse(windows[index].from), Date.parse(windows[index - 1].to) + 1);
  }
});

test('lifetime contributions sums several windows', async () => {
  const totals = [4, 7, 9];
  const fetchImpl = async (_url, options) => {
    const request = JSON.parse(options.body);
    if (request.query.includes('createdAt')) return response({ data: { user: { createdAt: '2020-01-01T00:00:00Z' } } });
    return response({ data: { user: { contributionsCollection: { contributionCalendar: { totalContributions: totals.shift() } } } } });
  };
  assert.equal(await stats.calculateLifetimeContributions(fetchImpl, 'token', 'uxillary', new Date('2022-01-02T00:00:00Z')), 20);
});

test('GraphQL errors and missing fields fail', async () => {
  await assert.rejects(() => stats.requestContributionTotal(async () => response({ errors: [{ message: 'bad query' }] }), 'token', 'uxillary', { from: '2020-01-01Z', to: '2020-02-01Z' }), /GraphQL errors: bad query/);
  await assert.rejects(() => stats.requestContributionTotal(async () => response({ data: { user: {} } }), 'token', 'uxillary', { from: '2020-01-01Z', to: '2020-02-01Z' }), /missing or invalid/);
});

test('REST pagination follows repository and release next links and sums assets', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.includes('/users/uxillary/repos') && !url.includes('page=2')) return response([{ name: 'one', full_name: 'uxillary/one', fork: false, owner: { login: 'uxillary' } }], { link: '<https://api.github.com/users/uxillary/repos?type=owner&per_page=100&page=2>; rel="next"' });
    if (url.includes('/users/uxillary/repos') && url.includes('page=2')) return response([{ name: 'two', full_name: 'uxillary/two', fork: false, owner: { login: 'uxillary' } }]);
    if (url.includes('/one/releases') && !url.includes('page=2')) return response([{ draft: false, prerelease: false, assets: [{ download_count: 2 }] }], { link: '<https://api.github.com/repos/uxillary/one/releases?per_page=100&page=2>; rel="next"' });
    if (url.includes('/one/releases')) return response([{ draft: false, prerelease: true, assets: [{ download_count: 3 }, { download_count: 4 }] }]);
    return response([{ draft: true, prerelease: false, assets: [{ download_count: 1000 }] }, { draft: false, prerelease: false, assets: [{ download_count: 5 }] }]);
  };
  assert.equal(await stats.calculateReleaseDownloads(fetchImpl, 'token'), 14);
  assert.equal(calls.length, 5);
  assert.match(calls[0], /\/users\/uxillary\/repos\?type=owner/);
});

test('release lookup does not depend on which account owns the token', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.includes('/users/target/repos')) return response([
      { name: 'app', full_name: 'target/app', fork: false, owner: { login: 'target' } },
    ]);
    return response([{ draft: false, assets: [{ download_count: 12 }] }]);
  };
  assert.equal(await stats.calculateReleaseDownloads(fetchImpl, 'token', 'target'), 12);
  assert.equal(calls[0], 'https://api.github.com/users/target/repos?type=owner&per_page=100');
});

test('all forks are excluded before release lookup', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.includes('/users/uxillary/repos')) return response([
      { name: 'created-here', full_name: 'uxillary/created-here', fork: false, owner: { login: 'uxillary' } },
      { name: 'unavailable-upstream', full_name: 'uxillary/unavailable-upstream', fork: true, owner: { login: 'uxillary' } },
      { name: 'another-fork', full_name: 'uxillary/another-fork', fork: true, owner: { login: 'uxillary' } },
    ]);
    if (url.includes('/created-here/releases')) return response([
      { draft: false, assets: [{ download_count: 8 }] },
    ]);
    throw new Error(`A fork release endpoint must not be requested: ${url}`);
  };

  assert.equal(await stats.calculateReleaseDownloads(fetchImpl, 'token'), 8);
  assert.equal(calls.length, 2);
  assert.match(calls[1], /\/created-here\/releases/);
});

test('invalid release asset counts fail', () => {
  for (const count of [-1, 1.5, Infinity, '2']) assert.throws(() => stats.sumReleaseAssetDownloads([{ draft: false, assets: [{ download_count: count }] }]), /invalid/);
});

test('an API failure leaves both existing output files untouched', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'github-stats-'));
  fs.writeFileSync(path.join(directory, 'lifetime-contributions.txt'), '10\n');
  fs.writeFileSync(path.join(directory, 'release-downloads.txt'), '20\n');
  const fetchImpl = async (_url, options) => {
    const request = JSON.parse(options.body);
    if (request.query.includes('createdAt')) return response({ data: { user: { createdAt: '2024-01-01T00:00:00Z' } } });
    return response({}, { status: 500 });
  };
  await assert.rejects(() => stats.run({ fetchImpl, token: 'token', outputDirectory: directory, now: new Date('2024-02-01T00:00:00Z') }), /HTTP 500/);
  assert.equal(fs.readFileSync(path.join(directory, 'lifetime-contributions.txt'), 'utf8'), '10\n');
  assert.equal(fs.readFileSync(path.join(directory, 'release-downloads.txt'), 'utf8'), '20\n');
});

test('a zero lifetime result does not overwrite existing output files', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'github-stats-zero-'));
  fs.writeFileSync(path.join(directory, 'lifetime-contributions.txt'), '10\n');
  fs.writeFileSync(path.join(directory, 'release-downloads.txt'), '20\n');
  const fetchImpl = async (url, options) => {
    if (url.includes('/users/uxillary/repos')) return response([]);
    const request = JSON.parse(options.body);
    if (request.query.includes('createdAt')) return response({ data: { user: { createdAt: '2024-01-01T00:00:00Z' } } });
    return response({ data: { user: { contributionsCollection: { contributionCalendar: { totalContributions: 0 } } } } });
  };
  await assert.rejects(
    () => stats.run({ fetchImpl, token: 'token', outputDirectory: directory, now: new Date('2024-02-01T00:00:00Z') }),
    /zero lifetime contributions.*token visibility/,
  );
  assert.equal(fs.readFileSync(path.join(directory, 'lifetime-contributions.txt'), 'utf8'), '10\n');
  assert.equal(fs.readFileSync(path.join(directory, 'release-downloads.txt'), 'utf8'), '20\n');
});

test('generated files contain only a base-10 integer and newline', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'github-stats-output-'));
  stats.writeIntegerOutputs(directory, 123, 456);
  for (const filename of ['lifetime-contributions.txt', 'release-downloads.txt']) {
    assert.match(fs.readFileSync(path.join(directory, filename), 'utf8'), /^\d+\n$/);
  }
});
