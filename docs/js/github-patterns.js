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
    const recent = periodTotal(daily, latestDay, days);
    const previous = periodTotal(daily, latestDay, days, days);
    if (recent == null || previous == null) return null;
    return { recent, previous, difference: recent - previous, percent: previous === 0 ? null : (recent - previous) / previous * 100 };
  }

  function periodTotal(daily, latestDay, days = 7, offset = 0) {
    const byDay = new Map(daily.map((point) => [point.day, point.downloads]));
    let total = 0;
    for (let index = 0; index < days; index += 1) {
      const value = byDay.get(latestDay - offset - index);
      if (value == null) return null;
      total += value;
    }
    return total;
  }

  function projectAnalytics(snapshots, repository, latestDate) {
    const rows = (Array.isArray(snapshots) ? snapshots : [])
      .filter((item) => item && dayNumber(item.date) != null && Number.isFinite(item.total) && item.total >= 0)
      .map((item) => {
        const value = item.repositories && Object.hasOwn(item.repositories, repository) ? item.repositories[repository] : null;
        return { date: item.date, day: dayNumber(item.date), total: Number.isFinite(value) && value >= 0 ? value : null };
      })
      .sort((a, b) => a.day - b.day);
    const daily = [];
    for (let index = 1; index < rows.length; index += 1) {
      const previous = rows[index - 1];
      const current = rows[index];
      if (current.day - previous.day !== 1 || previous.total == null || current.total == null) continue;
      const downloads = current.total - previous.total;
      if (downloads >= 0) daily.push({ date: current.date, day: current.day, downloads });
    }
    const latestDay = dayNumber(latestDate) ?? rows.at(-1)?.day ?? null;
    const recent7 = latestDay == null ? null : periodTotal(daily, latestDay, 7);
    const recent30 = latestDay == null ? null : periodTotal(daily, latestDay, 30);
    return {
      currentTotal: rows.at(-1)?.total ?? null,
      daily,
      recent7,
      recent30,
      comparison: latestDay == null ? null : periodComparison(daily, latestDay, 7),
      activity: recent7 == null ? 'Collecting data' : recent7 > 0 ? 'Active' : 'No recent downloads',
      sparkline: latestDay == null ? [] : daily.filter((point) => point.day >= latestDay - 13 && point.day <= latestDay)
    };
  }

  function sharePercent(value, total) {
    return Number.isFinite(value) && Number.isFinite(total) && total > 0 ? value / total * 100 : null;
  }

  function reconcileProjectTotals(projects, overallTotal, snapshotRepositories) {
    if (!Array.isArray(projects) || !snapshotRepositories || typeof snapshotRepositories !== 'object' || !Number.isFinite(overallTotal)) return false;
    const keys = Object.keys(snapshotRepositories).sort();
    const projectKeys = projects.map((project) => project.repo).sort();
    if (keys.length !== projectKeys.length || keys.some((key, index) => key !== projectKeys[index])) return false;
    const snapshotTotal = keys.reduce((sum, key) => sum + snapshotRepositories[key], 0);
    const summaryTotal = projects.reduce((sum, project) => {
      if (!Number.isFinite(project.downloads) || project.downloads < 0 || project.downloads !== snapshotRepositories[project.repo]) return NaN;
      return sum + project.downloads;
    }, 0);
    return Number.isFinite(summaryTotal) && summaryTotal === overallTotal && snapshotTotal === overallTotal;
  }

  function sortProjects(projects) {
    return [...(Array.isArray(projects) ? projects : [])].sort((a, b) => b.downloads - a.downloads || (a.repo < b.repo ? -1 : a.repo > b.repo ? 1 : 0));
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

  function intensityBands(values) {
    const sorted = (Array.isArray(values) ? values : []).filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
    const cutoffs = sorted.length ? [0.25, 0.5, 0.75].map((quantile) => sorted[Math.ceil(sorted.length * quantile) - 1]) : [];
    const levels = (value) => !cutoffs.length ? 0 : value <= cutoffs[0] ? 1 : value <= cutoffs[1] ? 2 : value <= cutoffs[2] ? 3 : 4;
    const bounds = sorted.length ? [
      { min: sorted[0], max: cutoffs[0] },
      { min: cutoffs[0] + 1, max: cutoffs[1] },
      { min: cutoffs[1] + 1, max: cutoffs[2] },
      { min: cutoffs[2] + 1, max: sorted.at(-1) }
    ] : Array.from({ length: 4 }, () => ({ min: null, max: null }));
    return {
      cutoffs,
      levels,
      bands: bounds.map((bound, index) => ({
        level: index + 1,
        min: bound.min <= bound.max ? bound.min : null,
        max: bound.min <= bound.max ? bound.max : null,
        count: bound.min <= bound.max ? sorted.filter((value) => levels(value) === index + 1).length : 0
      }))
    };
  }

  function heatmapCalendar(snapshots, windowDays = 365) {
    const { rows, daily } = validDaily(snapshots);
    if (!rows.length) return { startDate: null, endDate: null, weeks: [], validDays: 0, positiveDays: 0, zeroDays: 0, unavailableDays: 0, bands: intensityBands([]).bands };
    const span = Number.isInteger(windowDays) && windowDays > 0 ? Math.min(windowDays, 365) : 365;
    const endDay = rows.at(-1).day;
    const startDay = Math.max(rows[0].day, endDay - span + 1);
    const byDay = new Map(daily.filter((point) => point.day >= startDay && point.day <= endDay).map((point) => [point.day, point]));
    const positiveValues = [...byDay.values()].filter((point) => point.downloads > 0).map((point) => point.downloads);
    const intensity = intensityBands(positiveValues);
    const leading = (new Date(startDay * DAY).getUTCDay() + 6) % 7;
    const dateCount = endDay - startDay + 1;
    const weekCount = Math.ceil((leading + dateCount) / 7);
    const weeks = Array.from({ length: weekCount }, (_, weekIndex) => Array.from({ length: 7 }, (_, weekday) => {
      const day = startDay - leading + weekIndex * 7 + weekday;
      if (day < startDay || day > endDay) return null;
      const date = new Date(day * DAY).toISOString().slice(0, 10);
      const point = byDay.get(day);
      if (!point) return { date, day, weekday, downloads: null, status: 'unavailable', level: 0 };
      const isZero = point.downloads === 0;
      return { date, day, weekday, downloads: point.downloads, status: isZero ? 'zero' : 'activity', level: isZero ? 0 : intensity.levels(point.downloads) };
    }));
    const validDays = byDay.size;
    const positiveDays = positiveValues.length;
    const zeroDays = validDays - positiveDays;
    return {
      startDate: new Date(startDay * DAY).toISOString().slice(0, 10),
      endDate: new Date(endDay * DAY).toISOString().slice(0, 10),
      startDay, endDay, weeks, validDays, positiveDays, zeroDays,
      unavailableDays: dateCount - validDays,
      bands: intensity.bands
    };
  }

  function milestoneHistory(snapshots, thresholds) {
    const { rows } = validDaily(snapshots);
    const milestones = [...new Set((Array.isArray(thresholds) ? thresholds : []).filter((value) => Number.isFinite(value) && value > 0))].sort((a, b) => a - b);
    const first = rows[0] || null;
    const latest = rows.at(-1) || null;
    const currentTotal = latest?.total ?? null;
    const next = currentTotal == null ? milestones[0] ?? null : milestones.find((value) => currentTotal < value) ?? null;
    const achieved = currentTotal == null ? null : [...milestones].reverse().find((value) => currentTotal >= value) ?? null;
    const progressPercent = currentTotal == null ? null : next == null ? 100 : Math.round(Math.max(0, Math.min(100, ((currentTotal - (achieved || 0)) / (next - (achieved || 0))) * 100)) * 10) / 10;
    const items = milestones.map((threshold) => {
      if (!first) return { threshold, status: 'future', reachedDate: null };
      if (threshold <= first.total) return { threshold, status: 'before-history', reachedDate: null };
      let reachedDate = null;
      for (let index = 1; index < rows.length; index += 1) {
        if (rows[index - 1].total < threshold && rows[index].total >= threshold) {
          reachedDate = rows[index].date;
          break;
        }
      }
      return { threshold, status: threshold === next ? 'target' : reachedDate ? 'achieved' : 'future', reachedDate };
    });
    return { currentTotal, latestSnapshotDate: latest?.date ?? null, next, downloadsRemaining: currentTotal == null || next == null ? currentTotal == null ? null : 0 : next - currentTotal, achieved, progressPercent, items };
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

  return { dayNumber, validDaily, median, periodTotal, periodComparison, projectAnalytics, sharePercent, reconcileProjectTotals, sortProjects, streaks, weekdaySummary, bestDay, bestWeek, intensityBands, heatmapCalendar, milestoneHistory, analyze };
});
