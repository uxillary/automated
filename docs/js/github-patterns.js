(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GitHubDownloadPatterns = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const DAY = 86400000;
  const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const dayNumber = (date) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return null;
    const value = Date.parse(`${date}T00:00:00Z`);
    return Number.isFinite(value) && new Date(value).toISOString().slice(0, 10) === date ? value / DAY : null;
  };

  function validDaily(snapshots) {
    const rows = (Array.isArray(snapshots) ? snapshots : [])
      .filter((item) => item && dayNumber(item.date) != null && Number.isFinite(item.total) && item.total >= 0)
      .map((item) => ({ date: item.date, day: dayNumber(item.date), total: item.total }))
      .sort((a, b) => a.day - b.day);
    const result = [];
    for (let index = 1; index < rows.length; index += 1) {
      const previous = rows[index - 1];
      const current = rows[index];
      const downloads = current.total - previous.total;
      if (current.day - previous.day === 1 && downloads >= 0) result.push({ date: current.date, day: current.day, downloads });
    }
    return { rows, daily: result };
  }

  function median(values) {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  function periodComparison(daily, latestDay, days = 7) {
    const byDay = new Map(daily.map((point) => [point.day, point.downloads]));
    const sums = [];
    for (const offset of [0, days]) {
      let total = 0;
      for (let index = 0; index < days; index += 1) {
        const value = byDay.get(latestDay - offset - index);
        if (value == null) return null;
        total += value;
      }
      sums.push(total);
    }
    const recent = sums[0];
    const previous = sums[1];
    return { recent, previous, difference: recent - previous, percent: previous === 0 ? null : (recent - previous) / previous * 100 };
  }

  function streaks(daily, latestDay) {
    const byDay = new Map(daily.map((point) => [point.day, point.downloads]));
    let current = 0;
    for (let day = latestDay; byDay.get(day) > 0; day -= 1) current += 1;
    let longest = 0;
    let run = 0;
    let priorDay = null;
    for (const point of daily) {
      run = point.downloads > 0 && point.day === priorDay + 1 ? run + 1 : point.downloads > 0 ? 1 : 0;
      longest = Math.max(longest, run);
      priorDay = point.day;
    }
    return { current, longest };
  }

  function weekdaySummary(daily) {
    const groups = WEEKDAYS.map((name) => ({ name, count: 0, total: 0, average: null }));
    for (const point of daily) {
      const group = groups[new Date(point.day * DAY).getUTCDay()];
      group.count += 1;
      group.total += point.downloads;
    }
    groups.forEach((group) => { if (group.count) group.average = group.total / group.count; });
    const observed = groups.filter((group) => group.count);
    observed.sort((a, b) => b.average - a.average || b.count - a.count || WEEKDAYS.indexOf(a.name) - WEEKDAYS.indexOf(b.name));
    return { groups, strongest: observed[0] || null };
  }

  function bestDay(daily) {
    return daily.reduce((best, point) => !best || point.downloads > best.downloads || (point.downloads === best.downloads && point.day > best.day) ? point : best, null);
  }

  function bestWeek(daily) {
    let best = null;
    for (let end = 6; end < daily.length; end += 1) {
      const window = daily.slice(end - 6, end + 1);
      if (window[6].day - window[0].day !== 6) continue;
      const total = window.reduce((sum, point) => sum + point.downloads, 0);
      if (!best || total > best.total || (total === best.total && window[6].day > best.endDay)) {
        best = { startDate: window[0].date, endDate: window[6].date, startDay: window[0].day, endDay: window[6].day, total };
      }
    }
    return best;
  }

  function analyze(snapshots) {
    const { rows, daily } = validDaily(snapshots);
    const latestDay = rows.length ? rows[rows.length - 1].day : null;
    const values = daily.map((point) => point.downloads);
    const weekdays = weekdaySummary(daily);
    const comparison = latestDay == null ? null : periodComparison(daily, latestDay);
    const runs = latestDay == null ? { current: 0, longest: 0 } : streaks(daily, latestDay);
    let observation = '';
    if (comparison) {
      const direction = comparison.difference > 0 ? 'above' : comparison.difference < 0 ? 'below' : 'the same as';
      observation = comparison.percent == null
        ? `Recent 7-day activity is ${comparison.recent > comparison.previous ? 'above' : comparison.recent < comparison.previous ? 'below' : 'the same as'} the previous 7 days (${comparison.recent} vs ${comparison.previous} downloads).`
        : `Recent 7-day activity is ${Math.abs(comparison.percent).toFixed(0)}% ${direction} the previous 7 days.`;
    } else if (runs.current >= 7) observation = `Downloads have remained active for ${runs.current} consecutive recorded days.`;
    else if (weekdays.strongest && daily.length >= 7) observation = `${weekdays.strongest.name} currently has the highest observed daily average.`;
    return { daily, validDayCount: daily.length, median: median(values), mean: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null, comparison, streaks: runs, weekdays, bestDay: bestDay(daily), bestWeek: bestWeek(daily), observation };
  }

  return { dayNumber, validDaily, median, periodComparison, streaks, weekdaySummary, bestDay, bestWeek, analyze };
});
