'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const patterns = require('../docs/js/github-patterns');

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
