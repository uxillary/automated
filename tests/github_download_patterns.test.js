'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const patterns = require('../docs/js/github-patterns');
const heatmapCss = fs.readFileSync(require.resolve('../docs/css/github-releases.css'), 'utf8');

const dateAt = (day) => new Date(day * 86400000).toISOString().slice(0, 10);
const snapshotsFromDaily = (start, changes) => {
  let total = 100;
  const snapshots = [{ date: dateAt(start), total }];
  changes.forEach((change, index) => {
    total += change;
    snapshots.push({ date: dateAt(start + index + 1), total });
  });
  return snapshots;
};

test('median handles odd, even, and empty inputs', () => {
  assert.equal(patterns.median([1, 9, 3]), 3);
  assert.equal(patterns.median([1, 9, 3, 5]), 4);
  assert.equal(patterns.median([]), null);
});

test('7-day comparison uses two complete calendar periods and handles zero previous total', () => {
  const { daily } = patterns.validDaily(snapshotsFromDaily(100, Array(14).fill(2)));
  assert.deepEqual(patterns.periodComparison(daily, 114), { recent: 14, previous: 14, difference: 0, percent: 0 });
  assert.equal(patterns.periodComparison(daily.slice(1), 114), null);

  const zeroPrevious = patterns.validDaily(snapshotsFromDaily(200, [...Array(7).fill(0), ...Array(7).fill(3)])).daily;
  assert.deepEqual(patterns.periodComparison(zeroPrevious, 214), { recent: 21, previous: 0, difference: 21, percent: null });
});

test('streaks count positive valid days and break on zeros, gaps, and resets', () => {
  const { daily, rows } = patterns.validDaily(snapshotsFromDaily(300, [2, 2, 0, 1, 1]));
  assert.deepEqual(patterns.streaks(daily, rows.at(-1).day), { current: 2, longest: 2 });

  const reset = [
    { date: dateAt(400), total: 100 }, { date: dateAt(401), total: 105 },
    { date: dateAt(402), total: 103 }, { date: dateAt(403), total: 108 }
  ];
  const resetSeries = patterns.validDaily(reset);
  assert.deepEqual(resetSeries.daily.map((point) => point.downloads), [5, 5]);
  assert.deepEqual(patterns.streaks(resetSeries.daily, resetSeries.rows.at(-1).day), { current: 1, longest: 1 });

  const gap = patterns.validDaily([{ date: dateAt(500), total: 0 }, { date: dateAt(501), total: 1 }, { date: dateAt(503), total: 2 }]);
  assert.deepEqual(gap.daily.map((point) => point.downloads), [1]);
  assert.deepEqual(patterns.streaks(gap.daily, gap.rows.at(-1).day), { current: 0, longest: 1 });
});

test('weekday averages include observed valid days and leave unobserved weekdays empty', () => {
  const { daily } = patterns.validDaily(snapshotsFromDaily(20632, [2, 4, 6])); // Monday through Wednesday deltas
  const result = patterns.weekdaySummary(daily);
  assert.deepEqual(result.groups.filter((group) => group.count).map(({ name, count, average }) => ({ name, count, average })), [
    { name: 'Monday', count: 1, average: 2 },
    { name: 'Tuesday', count: 1, average: 4 },
    { name: 'Wednesday', count: 1, average: 6 }
  ]);
  assert.equal(result.groups.find((group) => group.name === 'Thursday').average, null);
  assert.equal(result.strongest.name, 'Wednesday');
});

test('best day and best seven-day window use deterministic most-recent tie breaks', () => {
  const { daily } = patterns.validDaily(snapshotsFromDaily(600, [1, 8, 1, 1, 1, 1, 1, 8, 1, 1, 1, 1, 1]));
  assert.equal(patterns.bestDay(daily).date, dateAt(608));
  const best = patterns.bestWeek(daily);
  assert.equal(best.total, 21);
  assert.equal(best.endDate, dateAt(608));
});

test('best week never spans a missing date or a reset interval', () => {
  const gap = patterns.validDaily([
    { date: dateAt(700), total: 0 }, { date: dateAt(701), total: 10 }, { date: dateAt(702), total: 20 },
    { date: dateAt(704), total: 30 }, { date: dateAt(705), total: 40 }, { date: dateAt(706), total: 50 },
    { date: dateAt(707), total: 60 }, { date: dateAt(708), total: 70 }, { date: dateAt(709), total: 80 }
  ]).daily;
  assert.equal(patterns.bestWeek(gap), null);

  const reset = patterns.validDaily([
    { date: dateAt(800), total: 0 }, { date: dateAt(801), total: 10 }, { date: dateAt(802), total: 20 },
    { date: dateAt(803), total: 30 }, { date: dateAt(804), total: 40 }, { date: dateAt(805), total: 50 },
    { date: dateAt(806), total: 60 }, { date: dateAt(807), total: 50 }, { date: dateAt(808), total: 60 },
    { date: dateAt(809), total: 70 }, { date: dateAt(810), total: 80 }, { date: dateAt(811), total: 90 },
    { date: dateAt(812), total: 100 }
  ]).daily;
  assert.equal(patterns.bestWeek(reset), null);
});

test('milestone history records the first observed crossing date and pre-history achievements', () => {
  const crossed = patterns.milestoneHistory([
    { date: '2026-10-01', total: 90 }, { date: '2026-10-02', total: 100 }, { date: '2026-10-05', total: 260 }
  ], [100, 250, 500]);
  assert.deepEqual(crossed.items, [
    { threshold: 100, status: 'achieved', reachedDate: '2026-10-02' },
    { threshold: 250, status: 'achieved', reachedDate: '2026-10-05' },
    { threshold: 500, status: 'target', reachedDate: null }
  ]);
  assert.equal(crossed.next, 500);
  assert.equal(crossed.downloadsRemaining, 240);
  assert.equal(crossed.progressPercent, 4);

  const baselineAlreadyAbove = patterns.milestoneHistory([{ date: '2026-10-01', total: 300 }], [100, 250, 500]);
  assert.deepEqual(baselineAlreadyAbove.items.slice(0, 2), [
    { threshold: 100, status: 'before-history', reachedDate: null },
    { threshold: 250, status: 'before-history', reachedDate: null }
  ]);
  assert.equal(baselineAlreadyAbove.items[2].status, 'target');
});

test('milestones handle exact equality, interval progress, resets, highest threshold, and sparse history', () => {
  const equal = patterns.milestoneHistory([
    { date: '2026-10-01', total: 90 }, { date: '2026-10-02', total: 100 }
  ], [100, 250, 500]);
  assert.equal(equal.items[0].reachedDate, '2026-10-02');
  assert.equal(equal.next, 250);
  assert.equal(equal.downloadsRemaining, 150);
  assert.equal(equal.progressPercent, 0);

  const interval = patterns.milestoneHistory([{ date: '2026-10-01', total: 175 }], [100, 250, 500]);
  assert.equal(interval.next, 250);
  assert.equal(interval.progressPercent, 50);

  const reset = patterns.milestoneHistory([
    { date: '2026-10-01', total: 90 }, { date: '2026-10-02', total: 110 }, { date: '2026-10-03', total: 80 }
  ], [100, 250]);
  assert.deepEqual(reset.items[0], { threshold: 100, status: 'target', reachedDate: '2026-10-02' });
  assert.equal(reset.currentTotal, 80);
  assert.equal(reset.downloadsRemaining, 20);

  const beyond = patterns.milestoneHistory([{ date: '2026-10-01', total: 12000 }], [100, 250, 500, 1000, 2500, 5000, 10000]);
  assert.equal(beyond.next, null);
  assert.equal(beyond.downloadsRemaining, 0);
  assert.equal(beyond.progressPercent, 100);
  assert.equal(beyond.items.at(-1).status, 'before-history');

  const empty = patterns.milestoneHistory([], [100, 250]);
  assert.equal(empty.currentTotal, null);
  assert.equal(empty.next, 100);
  assert.equal(empty.progressPercent, null);
  const belowFirst = patterns.milestoneHistory([{ date: '2026-10-01', total: 80 }], [100, 250]);
  assert.equal(belowFirst.next, 100);
  assert.equal(belowFirst.downloadsRemaining, 20);
  assert.equal(belowFirst.progressPercent, 80);
  assert.equal(patterns.milestoneHistory([{ date: '2026-10-01', total: 150 }], []).next, null);
});

test('project daily changes exclude the baseline, gaps, missing project values, and decreases', () => {
  const snapshots = [
    { date: '2026-11-01', total: 100, repositories: { app: 50 } },
    { date: '2026-11-02', total: 110, repositories: { app: 55 } },
    { date: '2026-11-03', total: 120, repositories: {} },
    { date: '2026-11-04', total: 130, repositories: { app: 65 } },
    { date: '2026-11-05', total: 140, repositories: { app: 60 } },
    { date: '2026-11-06', total: 150, repositories: { app: 62 } }
  ];
  const result = patterns.projectAnalytics(snapshots, 'app', '2026-11-06');
  assert.equal(result.currentTotal, 62);
  assert.deepEqual(result.daily.map(({ date, downloads }) => [date, downloads]), [['2026-11-02', 5], ['2026-11-06', 2]]);
  assert.equal(result.recent7, null);
  assert.equal(result.activity, 'Collecting data');
});

test('project recent periods distinguish zero activity, active periods, zero baselines, and insufficient history', () => {
  const start = 20758; // 2026-11-01
  const snapshotsForProject = (changes) => {
    let projectTotal = 0;
    let overallTotal = 0;
    return [{ date: dateAt(start), total: overallTotal, repositories: { app: projectTotal } }, ...changes.map((change, index) => {
      projectTotal += change;
      overallTotal += change;
      return { date: dateAt(start + index + 1), total: overallTotal, repositories: { app: projectTotal } };
    })];
  };
  const resumed = patterns.projectAnalytics(snapshotsForProject([...Array(7).fill(0), ...Array(7).fill(3)]), 'app', dateAt(start + 14));
  assert.equal(resumed.recent7, 21);
  assert.equal(resumed.activity, 'Active');
  assert.deepEqual(resumed.comparison, { recent: 21, previous: 0, difference: 21, percent: null });
  assert.equal(patterns.projectAnalytics(snapshotsForProject(Array(7).fill(0)), 'app', dateAt(start + 7)).activity, 'No recent downloads');
  assert.equal(patterns.projectAnalytics(snapshotsForProject([2, 0]), 'app', dateAt(start + 2)).activity, 'Collecting data');
  const thirtyDays = patterns.projectAnalytics(snapshotsForProject(Array(30).fill(1)), 'app', dateAt(start + 30));
  assert.equal(thirtyDays.recent30, 30);
  assert.equal(thirtyDays.recent7, 7);
});

test('project shares are safe at zero totals and sort deterministically by downloads then repository', () => {
  assert.equal(patterns.sharePercent(0, 0), null);
  assert.equal(patterns.sharePercent(1, 0), null);
  assert.equal(patterns.sharePercent(75, 100), 75);
  const shares = [patterns.sharePercent(75, 100), patterns.sharePercent(25, 100)];
  assert.equal(shares.reduce((sum, value) => sum + value, 0), 100);
  assert.deepEqual(patterns.sortProjects([
    { repo: 'z/app', downloads: 25 }, { repo: 'b/app', downloads: 75 }, { repo: 'a/app', downloads: 75 }
  ]).map((project) => project.repo), ['a/app', 'b/app', 'z/app']);
});

test('project and overall current totals must reconcile with the latest repository snapshot', () => {
  const projects = [{ repo: 'a', downloads: 75 }, { repo: 'b', downloads: 25 }];
  assert.equal(patterns.reconcileProjectTotals(projects, 100, { a: 75, b: 25 }), true);
  assert.equal(patterns.reconcileProjectTotals(projects, 101, { a: 75, b: 25 }), false);
  assert.equal(patterns.reconcileProjectTotals(projects, 100, { a: 74, b: 26 }), false);
  assert.equal(patterns.reconcileProjectTotals(null, 100, { a: 100 }), false);
});

test('heatmap distinguishes the baseline, valid zero days, and activity on a Monday-first calendar', () => {
  const calendar = patterns.heatmapCalendar(snapshotsFromDaily(20706, [0, 4])); // 2026-09-10 through 2026-09-12
  assert.equal(calendar.startDate, '2026-09-10');
  assert.equal(calendar.endDate, '2026-09-12');
  assert.deepEqual([calendar.validDays, calendar.positiveDays, calendar.zeroDays, calendar.unavailableDays], [2, 1, 1, 1]);
  assert.deepEqual(calendar.weeks[0].slice(0, 6).map((cell) => cell && [cell.date, cell.status, cell.downloads]), [
    null, null, null, ['2026-09-10', 'unavailable', null], ['2026-09-11', 'zero', 0], ['2026-09-12', 'activity', 4]
  ]);
});

test('heatmap weeks retain seven weekday slots and blanks without inventing dates', () => {
  const calendar = patterns.heatmapCalendar(snapshotsFromDaily(20706, Array(19).fill(1)));
  assert.equal(calendar.weeks.length, 4);
  assert.ok(calendar.weeks.every((week) => week.length === 7));
  assert.deepEqual(calendar.weeks.flat().filter(Boolean).map(({ date }) => date),
    Array.from({ length: 20 }, (_, index) => dateAt(20706 + index)));
  assert.equal(calendar.weeks.flat().filter((cell) => cell === null).length, 8);

  const partial = patterns.heatmapCalendar([{ date: '2026-09-10', total: 1 }]);
  assert.equal(partial.weeks.length, 1);
  assert.equal(partial.weeks[0].length, 7);
  assert.equal(partial.weeks[0].filter((cell) => cell === null).length, 6);
  assert.deepEqual(partial.weeks[0].filter(Boolean).map(({ date }) => date), ['2026-09-10']);
});

test('heatmap CSS fixes cell and week geometry against global button sizing', () => {
  assert.match(heatmapCss, /\.github-download-heatmap\{--heatmap-cell:12px;--heatmap-gap:3px/);
  assert.match(heatmapCss, /\.github-heatmap-week\{[^}]*grid-template-rows:repeat\(7,var\(--heatmap-cell\)\)[^}]*height:102px/);
  assert.match(heatmapCss, /\.github-heatmap-cell\{[^}]*min-height:var\(--heatmap-cell\)[^}]*max-height:var\(--heatmap-cell\)/);
  assert.match(heatmapCss, /\.github-heatmap-empty\{[^}]*min-height:var\(--heatmap-cell\)[^}]*max-height:var\(--heatmap-cell\)/);
});

test('heatmap marks gaps and reset deltas unavailable while retaining later valid days', () => {
  const snapshots = [
    { date: '2026-01-01', total: 100 }, { date: '2026-01-02', total: 101 },
    { date: '2026-01-04', total: 103 }, { date: '2026-01-05', total: 99 }, { date: '2026-01-06', total: 100 }
  ];
  const calendar = patterns.heatmapCalendar(snapshots);
  const cells = calendar.weeks.flat().filter(Boolean);
  assert.deepEqual(cells.map(({ date, status }) => [date, status]), [
    ['2026-01-01', 'unavailable'], ['2026-01-02', 'activity'], ['2026-01-03', 'unavailable'],
    ['2026-01-04', 'unavailable'], ['2026-01-05', 'unavailable'], ['2026-01-06', 'activity']
  ]);
  assert.equal(calendar.validDays, 2);
  assert.equal(calendar.unavailableDays, 4);
});

test('heatmap intensity uses four nearest-rank quantile bands and keeps ties together', () => {
  const four = patterns.intensityBands([1, 2, 3, 4]);
  assert.deepEqual([1, 2, 3, 4].map((value) => four.levels(value)), [1, 2, 3, 4]);
  assert.deepEqual(four.bands.map(({ min, max, count }) => [min, max, count]), [[1, 1, 1], [2, 2, 1], [3, 3, 1], [4, 4, 1]]);
  const tied = patterns.intensityBands([5, 5, 10]);
  assert.deepEqual([5, 5, 10].map((value) => tied.levels(value)), [1, 1, 3]);
  assert.deepEqual(tied.bands.map(({ count }) => count), [2, 0, 1, 0]);
  assert.equal(patterns.intensityBands([]).levels(1), 0);
});

test('heatmap caps its calendar window at 365 days and handles empty and baseline-only histories', () => {
  const longHistory = snapshotsFromDaily(20000, Array(400).fill(1));
  const calendar = patterns.heatmapCalendar(longHistory, 900);
  assert.equal(calendar.validDays, 365);
  assert.equal(calendar.startDay, calendar.endDay - 364);
  assert.equal(calendar.startDate, dateAt(calendar.startDay));
  assert.deepEqual(patterns.heatmapCalendar([]), {
    startDate: null, endDate: null, weeks: [], validDays: 0, positiveDays: 0, zeroDays: 0, unavailableDays: 0,
    bands: [1, 2, 3, 4].map((level) => ({ level, min: null, max: null, count: 0 }))
  });
  const baseline = patterns.heatmapCalendar([{ date: '2026-09-10', total: 0 }]);
  assert.equal(baseline.validDays, 0);
  assert.equal(baseline.unavailableDays, 1);
});
