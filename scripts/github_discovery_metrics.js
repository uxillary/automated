'use strict';

const fs = require('node:fs');
const path = require('node:path');
const projects = require('./project_metrics_config');

const API = 'https://api.github.com';
const API_VERSION = '2022-11-28';
const METRICS = ['views', 'clones'];
const isCount = (value) => Number.isInteger(value) && value >= 0;
const dateFrom = (value) => {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toISOString().slice(0, 10);
};

function safeError(repo, metric, status, category) {
  return `${repo} ${metric} failed (${category}${status ? `, HTTP ${status}` : ''})`;
}

async function request(url, repo, metric, fetchImpl, token) {
  let response;
  try {
    response = await fetchImpl(url, { headers: {
      Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': API_VERSION, 'User-Agent': 'automated-github-discovery-metrics'
    } });
  } catch {
    throw new Error(safeError(repo, metric, null, 'network error'));
  }
  if (!response || response.status !== 200) {
    const status = response?.status;
    const category = status === 401 ? 'authentication failure' : status === 403 ? 'permission/rate limit failure' : status === 404 ? 'repository unavailable' : 'request failure';
    throw new Error(safeError(repo, metric, status, category));
  }
  let body;
  try { body = await response.json(); } catch { throw new Error(safeError(repo, metric, 200, 'malformed JSON')); }
  return body;
}

function parseTraffic(body, fields, repo, metric) {
  if (!body || !Array.isArray(body[metric])) throw new Error(safeError(repo, metric, 200, 'malformed response'));
  const rows = [];
  for (const item of body[metric]) {
    const date = dateFrom(item?.timestamp);
    if (!date || !isCount(item.count) || !isCount(item.uniques)) throw new Error(safeError(repo, metric, 200, 'invalid numeric/date data'));
    rows.push({ date, [fields[0]]: item.count, [fields[1]]: item.uniques });
  }
  return rows;
}

function parseRepository(body, repo) {
  const fields = { stars: body?.stargazers_count, forks: body?.forks_count, subscribers: body?.subscribers_count };
  if (Object.values(fields).some((value) => !isCount(value))) throw new Error(safeError(repo, 'repository totals', 200, 'invalid numeric data'));
  return fields;
}

function validateHistory(history) {
  if (!history || history.version !== 1 || !Array.isArray(history.observations)) throw new Error('Existing discovery history has an unsupported or malformed schema');
  const seen = new Set();
  for (const row of history.observations) {
    if (!row || typeof row.projectId !== 'string' || !dateFrom(`${row.date}T00:00:00Z`)) throw new Error('Existing discovery history contains an invalid observation');
    const key = `${row.projectId}/${row.date}`;
    if (seen.has(key)) throw new Error('Existing discovery history contains duplicate project/date observations');
    seen.add(key);
    for (const field of ['views', 'uniqueVisitors', 'clones', 'uniqueCloners', 'stars', 'forks', 'subscribers']) {
      if (row[field] !== null && row[field] !== undefined && !isCount(row[field])) throw new Error(`Existing discovery history contains invalid ${field}`);
    }
  }
  return history;
}

function upsertObservations(history, updates) {
  const map = new Map(history.observations.map((row) => [`${row.projectId}/${row.date}`, { ...row }]));
  for (const update of updates) {
    const key = `${update.projectId}/${update.date}`;
    const row = map.get(key) || { projectId: update.projectId, date: update.date, views: null, uniqueVisitors: null, clones: null, uniqueCloners: null, stars: null, forks: null, subscribers: null };
    for (const [field, value] of Object.entries(update)) if (field !== 'projectId' && field !== 'date') row[field] = value;
    map.set(key, row);
  }
  return { version: 1, metricDefinitions: history.metricDefinitions, projects: history.projects, observations: [...map.values()].sort((a, b) => a.projectId.localeCompare(b.projectId) || a.date.localeCompare(b.date)) };
}

function sumField(rows, field, dates) {
  const selected = rows.filter((row) => dates.has(row.date));
  if (selected.length !== dates.size || selected.some((row) => !isCount(row[field]))) return null;
  return selected.reduce((total, row) => total + row[field], 0);
}

function buildSummary(history) {
  const output = [];
  for (const project of history.projects) {
    const rows = history.observations.filter((row) => row.projectId === project.id).sort((a, b) => a.date.localeCompare(b.date));
    const latest = rows.at(-1) || null;
    const latestTotals = [...rows].reverse().find((row) => isCount(row.stars) && isCount(row.forks) && isCount(row.subscribers)) || null;
    const endDate = latest?.date || null;
    const days = new Set();
    if (endDate) for (let n = 0; n < 7; n += 1) days.add(new Date(Date.parse(`${endDate}T00:00:00Z`) - n * 86400000).toISOString().slice(0, 10));
    const spanRows = rows.filter((row) => days.has(row.date));
    const completeDays = (field) => spanRows.filter((row) => isCount(row[field])).length;
    const sum7 = (field) => sumField(rows, field, days);
    output.push({
      projectId: project.id, label: project.label, repository: project.github,
      latestObservationDate: endDate,
      latestDailyViews: latest?.views ?? null, latestDailyUniqueVisitors: latest?.uniqueVisitors ?? null,
      latestDailyClones: latest?.clones ?? null, latestDailyUniqueCloners: latest?.uniqueCloners ?? null,
      currentStars: latestTotals?.stars ?? null, currentForks: latestTotals?.forks ?? null, currentSubscribers: latestTotals?.subscribers ?? null,
      views7Days: sum7('views'), uniqueVisitorsDaily7Days: spanRows.filter((row) => isCount(row.uniqueVisitors)).map((row) => ({ date: row.date, uniqueVisitors: row.uniqueVisitors })),
      clones7Days: sum7('clones'), uniqueClonersDaily7Days: spanRows.filter((row) => isCount(row.uniqueCloners)).map((row) => ({ date: row.date, uniqueCloners: row.uniqueCloners })),
      availableHistoryStart: rows[0]?.date || null, availableHistoryEnd: endDate,
      coverage: { observations: rows.length, daysWithViews: completeDays('views'), daysWithClones: completeDays('clones'), expectedDaysIn7DayWindow: endDate ? 7 : 0,
        views7DaysComplete: Boolean(endDate && completeDays('views') === 7), clones7DaysComplete: Boolean(endDate && completeDays('clones') === 7),
        state: !rows.length ? 'no_data' : rows.some((row) => row.views === null || row.clones === null) ? 'partial' : 'available' }
    });
  }
  return { version: 1, status: output.some((item) => item.latestObservationDate) ? 'ready' : 'no_data', projects: output };
}

function atomicWrite(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(data, null, 2)}\n`, { flag: 'w' });
  fs.renameSync(tempPath, filePath);
}

async function collectProject(project, fetchImpl, token, now = new Date()) {
  const errors = [];
  const updates = [];
  for (const metric of METRICS) {
    const fields = metric === 'views' ? ['views', 'uniqueVisitors'] : ['clones', 'uniqueCloners'];
    try {
      const body = await request(`${API}/repos/${project.github}/traffic/${metric}`, project.github, metric, fetchImpl, token);
      updates.push(...parseTraffic(body, fields, project.github, metric).map((row) => ({ projectId: project.id, ...row })));
    } catch (error) { errors.push(error.message); }
  }
  try {
    const body = await request(`${API}/repos/${project.github}`, project.github, 'repository totals', fetchImpl, token);
    const totals = parseRepository(body, project.github);
    const date = now.toISOString().slice(0, 10);
    updates.push({ projectId: project.id, date, ...totals });
  } catch (error) { errors.push(error.message); }
  return { updates, errors };
}

async function run(options = {}) {
  const token = options.token || process.env.METRICS_GITHUB_TOKEN;
  if (!token) throw new Error('METRICS_GITHUB_TOKEN is required');
  const fetchImpl = options.fetchImpl || global.fetch;
  const configured = options.projects || projects;
  const directory = options.outputDirectory || path.join(__dirname, '..', 'docs', 'metrics');
  const historyPath = path.join(directory, 'github_discovery_history.json');
  const summaryPath = path.join(directory, 'github_discovery_summary.json');
  let history = { version: 1, metricDefinitions: { views: 'Repository page views', uniqueVisitors: 'GitHub-reported daily unique visitors; do not sum across days', clones: 'Full repository clones, not fetches or installs', uniqueCloners: 'GitHub-reported daily unique cloners; do not sum across days', stars: 'Current stargazer count', forks: 'Current fork count', subscribers: 'Current repository notification subscribers' }, projects: configured.map((p) => ({ id: p.id, label: p.label, github: p.github })), observations: [] };
  if (fs.existsSync(historyPath)) history = validateHistory(JSON.parse(fs.readFileSync(historyPath, 'utf8')));
  history.projects = configured.map((p) => ({ id: p.id, label: p.label, github: p.github }));

  const now = options.now || new Date();
  const results = await Promise.all(configured.map((project) => collectProject(project, fetchImpl, token, now)));
  const updates = results.flatMap((result) => result.updates);
  const errors = results.flatMap((result) => result.errors);
  if (!updates.length) throw new Error(`GitHub discovery collection produced no valid metrics; ${errors.join('; ') || 'no data returned'}`);
  const updated = upsertObservations(history, updates);
  const summary = buildSummary(updated);
  atomicWrite(historyPath, updated);
  atomicWrite(summaryPath, summary);
  for (const error of errors) (options.log || console.error)(error);
  if (errors.length && (options.log || console.error) === console.error) console.error(`GitHub discovery collection completed with ${errors.length} partial failure(s).`);
  return { history: updated, summary, errors };
}

module.exports = { API, METRICS, dateFrom, request, parseTraffic, parseRepository, validateHistory, upsertObservations, buildSummary, collectProject, run };

if (require.main === module) run().catch((error) => { console.error(error.message); process.exitCode = 1; });
