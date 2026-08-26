'use strict';

const fs = require('node:fs');
const path = require('node:path');

const USERNAME = 'uxillary';
const GRAPHQL_URL = 'https://api.github.com/graphql';
const REST_URL = 'https://api.github.com';
const API_VERSION = '2022-11-28';

function requireDate(value, label) {
  const date = value instanceof Date ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`${label} is not a valid date`);
  return date;
}

function addUtcYear(date) {
  const result = new Date(date);
  result.setUTCFullYear(result.getUTCFullYear() + 1);
  return result;
}

// GitHub accepts at most one calendar year. Represent each window as inclusive
// millisecond endpoints, so adjacent windows neither overlap nor leave a gap.
function createContributionWindows(fromValue, toValue) {
  const from = requireDate(fromValue, 'Contribution range start');
  const to = requireDate(toValue, 'Contribution range end');
  if (from > to) throw new Error('Contribution range start must not be after its end');

  const windows = [];
  let start = from;
  while (start <= to) {
    const anniversary = addUtcYear(start);
    const end = anniversary <= to ? new Date(anniversary.getTime() - 1) : new Date(to);
    windows.push({ from: start.toISOString(), to: end.toISOString() });
    start = new Date(end.getTime() + 1);
  }
  return windows;
}

function githubHeaders(token) {
  if (!token) throw new Error('GH_TOKEN is required');
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'User-Agent': 'uxillary-github-lifetime-stats',
    'X-GitHub-Api-Version': API_VERSION,
  };
}

async function readJson(response, context) {
  if (!response || typeof response.ok !== 'boolean') throw new Error(`${context}: malformed HTTP response`);
  if (!response.ok) throw new Error(`${context}: GitHub returned HTTP ${response.status}`);
  try {
    return await response.json();
  } catch (error) {
    throw new Error(`${context}: GitHub returned malformed JSON (${error.message})`);
  }
}

function assertGraphql(data, context) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(`${context}: malformed GraphQL response`);
  if (Object.hasOwn(data, 'errors') && !Array.isArray(data.errors)) throw new Error(`${context}: malformed GraphQL errors`);
  if (Array.isArray(data.errors) && data.errors.length) {
    const messages = data.errors.map((error) => error && error.message).filter(Boolean).join('; ');
    throw new Error(`${context}: GraphQL errors${messages ? `: ${messages}` : ''}`);
  }
  if (!data.data || typeof data.data !== 'object') throw new Error(`${context}: missing GraphQL data`);
  return data.data;
}

async function graphqlRequest(fetchImpl, token, query, variables, context) {
  let response;
  try {
    response = await fetchImpl(GRAPHQL_URL, {
      method: 'POST',
      headers: { ...githubHeaders(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    });
  } catch (error) {
    throw new Error(`${context}: request failed (${error.message})`);
  }
  return assertGraphql(await readJson(response, context), context);
}

async function getAccountCreatedAt(fetchImpl, token, username = USERNAME) {
  const data = await graphqlRequest(fetchImpl, token,
    'query($login: String!) { user(login: $login) { createdAt } }', { login: username },
    `Fetching account creation date for ${username}`);
  if (!data.user) throw new Error(`Fetching account creation date for ${username}: user is missing`);
  if (typeof data.user.createdAt !== 'string') throw new Error(`Fetching account creation date for ${username}: createdAt is missing`);
  return requireDate(data.user.createdAt, 'GitHub createdAt');
}

async function requestContributionTotal(fetchImpl, token, username, window) {
  const context = `Fetching contributions for ${username} from ${window.from} to ${window.to}`;
  const data = await graphqlRequest(fetchImpl, token, `
    query($login: String!, $from: DateTime!, $to: DateTime!) {
      user(login: $login) {
        contributionsCollection(from: $from, to: $to) {
          contributionCalendar { totalContributions }
        }
      }
    }`, { login: username, from: window.from, to: window.to }, context);
  const total = data.user?.contributionsCollection?.contributionCalendar?.totalContributions;
  if (!Number.isSafeInteger(total) || total < 0) throw new Error(`${context}: totalContributions is missing or invalid`);
  return total;
}

async function calculateLifetimeContributions(fetchImpl, token, username = USERNAME, now = new Date()) {
  const createdAt = await getAccountCreatedAt(fetchImpl, token, username);
  const windows = createContributionWindows(createdAt, requireDate(now, 'Current time'));
  let total = 0;
  for (const window of windows) {
    total += await requestContributionTotal(fetchImpl, token, username, window);
    if (!Number.isSafeInteger(total)) throw new Error('Lifetime contribution total exceeds the safe integer range');
  }
  return total;
}

function nextLink(linkHeader) {
  if (!linkHeader) return null;
  for (const part of linkHeader.split(',')) {
    const match = part.match(/^\s*<([^>]+)>;\s*rel="([^"]+)"\s*$/);
    if (match && match[2].split(/\s+/).includes('next')) return match[1];
  }
  return null;
}

async function getPaginatedRest(fetchImpl, token, initialUrl, context) {
  const items = [];
  const visited = new Set();
  let url = initialUrl;
  while (url) {
    if (visited.has(url)) throw new Error(`${context}: pagination loop detected at ${url}`);
    visited.add(url);
    let response;
    try {
      response = await fetchImpl(url, { headers: githubHeaders(token) });
    } catch (error) {
      throw new Error(`${context}: request failed for ${url} (${error.message})`);
    }
    const page = await readJson(response, `${context} (${url})`);
    if (!Array.isArray(page)) throw new Error(`${context} (${url}): expected an array`);
    items.push(...page);
    url = nextLink(response.headers?.get?.('link'));
  }
  return items;
}

function sumReleaseAssetDownloads(releases, context = 'releases') {
  if (!Array.isArray(releases)) throw new Error(`${context}: expected an array`);
  let total = 0;
  for (const release of releases) {
    if (!release || typeof release !== 'object') throw new Error(`${context}: malformed release`);
    if (release.draft) continue;
    if (!Array.isArray(release.assets)) throw new Error(`${context}: release assets are missing`);
    for (const asset of release.assets) {
      const count = asset?.download_count;
      if (!Number.isSafeInteger(count) || count < 0) throw new Error(`${context}: release asset download_count is invalid`);
      total += count;
      if (!Number.isSafeInteger(total)) throw new Error(`${context}: download total exceeds the safe integer range`);
    }
  }
  return total;
}

async function calculateReleaseDownloads(fetchImpl, token, username = USERNAME) {
  const repositories = await getPaginatedRest(fetchImpl, token,
    `${REST_URL}/users/${encodeURIComponent(username)}/repos?type=owner&per_page=100`,
    `Fetching public repositories owned by ${username}`);
  let total = 0;
  for (const repository of repositories) {
    const fullName = repository?.full_name;
    if (typeof fullName !== 'string' || typeof repository?.name !== 'string' ||
        repository?.owner?.login?.toLowerCase() !== username.toLowerCase()) {
      throw new Error(`Fetching repositories owned by ${username}: malformed or unexpected repository`);
    }
    const releases = await getPaginatedRest(fetchImpl, token,
      `${REST_URL}/repos/${encodeURIComponent(repository.owner.login)}/${encodeURIComponent(repository.name)}/releases?per_page=100`,
      `Fetching releases for ${fullName}`);
    total += sumReleaseAssetDownloads(releases, `Repository ${fullName}`);
    if (!Number.isSafeInteger(total)) throw new Error('Release download total exceeds the safe integer range');
  }
  return total;
}

function formatInteger(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Output value must be a non-negative safe integer');
  return `${value}\n`;
}

function writeIntegerOutputs(outputDirectory, lifetimeContributions, releaseDownloads) {
  const outputs = [
    ['lifetime-contributions.txt', formatInteger(lifetimeContributions)],
    ['release-downloads.txt', formatInteger(releaseDownloads)],
  ];
  fs.mkdirSync(outputDirectory, { recursive: true });
  for (const [filename, content] of outputs) fs.writeFileSync(path.join(outputDirectory, filename), content, 'utf8');
}

async function run({ fetchImpl = globalThis.fetch, token = process.env.GH_TOKEN, outputDirectory = 'docs', now = new Date() } = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('This script requires Node.js with built-in fetch support');
  // Complete and validate both remote calculations before touching either file.
  const lifetime = await calculateLifetimeContributions(fetchImpl, token, USERNAME, now);
  const downloads = await calculateReleaseDownloads(fetchImpl, token, USERNAME);
  // A zero lifetime total indicates an authentication/API visibility problem
  // for this established account, not valid statistics. Never replace known
  // values with a silently empty API result.
  if (lifetime === 0) throw new Error(`GitHub returned zero lifetime contributions for ${USERNAME}; check API_GITHUB token visibility`);
  writeIntegerOutputs(outputDirectory, lifetime, downloads);
  console.log(`GitHub lifetime statistics updated for ${USERNAME}: ${lifetime} contributions, ${downloads} release downloads.`);
  return { lifetime, downloads };
}

module.exports = {
  calculateLifetimeContributions,
  calculateReleaseDownloads,
  createContributionWindows,
  formatInteger,
  getPaginatedRest,
  requestContributionTotal,
  run,
  sumReleaseAssetDownloads,
  writeIntegerOutputs,
};

if (require.main === module) run().catch((error) => { console.error(error.message); process.exitCode = 1; });
