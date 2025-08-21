(async function () {
  // Base-path helper: works on / and /automated
  const base = location.pathname.includes('/automated') ? '/automated' : '';
  const csvUrls = [ `${base}/metrics/youtube_enriched.csv`, '/metrics/youtube_enriched.csv' ];
  const jsonUrls = [ `${base}/metrics/youtube_summary.json`,  '/metrics/youtube_summary.json' ];

  // Small utils
  const getText = async (urls) => {
    let e; for (const u of urls) { try { const r = await fetch(u, {cache:'no-store'}); if (r.ok) return r.text(); e = new Error(`HTTP ${r.status}`);} catch (err){e=err;} } throw e||new Error('fetch failed');
  };
  const getJSON = async (urls) => {
    let e; for (const u of urls) { try { const r = await fetch(u, {cache:'no-store'}); if (r.ok) return r.json(); e = new Error(`HTTP ${r.status}`);} catch (err){e=err;} } throw e||new Error('fetch failed');
  };
  const parseCSV = (t) => {
    const [hdr, ...rows] = t.trim().split(/\r?\n/);
    const cols = hdr.split(',');
    return rows.map(l => {
      const o = {}, parts = l.split(',');
      cols.forEach((c,i)=>o[c]=parts[i]);
      return o;
    });
  };
  const until = (fn, ms=6000) => new Promise(res=>{
    const t0=Date.now(); (function tick(){ const v=fn(); if(v||Date.now()-t0>ms) return res(v); requestAnimationFrame(tick); })();
  });

  // Wait for the main chart
  const chart = await until(()=>window.ytChart);
  if (!chart) { console.debug('yt-overlays: chart not found'); return; }

  // Add moving-average overlays (if CSV exists and not already provided)
  const hasAvg = chart.data.datasets.some(d => /7-day avg/i.test(d.label||''));
  if (!hasAvg) {
    try {
      const csv = await getText(csvUrls);
      const df  = parseCSV(csv);
      if (df && df.length) {
        const labels   = df.map(r => new Date(r.date).toISOString());
        const subsAvg7 = df.map(r => (r.subs_day_avg_7===''?null:+r.subs_day_avg_7));
        const viewsAvg7= df.map(r => (r.views_day_avg_7===''?null:+r.views_day_avg_7));

        // Ensure labels cover entire series if needed
        if (chart.data.labels.length < labels.length) chart.data.labels = labels;

        const subsColor  = (chart.data.datasets[0]?.borderColor) || 'rgba(30,144,255,.8)';
        const viewsColor = (chart.data.datasets.find(d=>d.yAxisID==='y_views')?.borderColor) || 'rgba(50,205,50,.8)';

        // Add compact axes for moving averages if not present
        chart.options.scales = chart.options.scales || {};
        chart.options.scales.y_subs_avg = chart.options.scales.y_subs_avg || {
          type: 'linear',
          position: 'left',
          display: true,
          grid: { drawOnChartArea: false },
          ticks: { stepSize: 1 },
          min: 0,
          suggestedMax: 3,
          title: { display: false }
        };
        chart.options.scales.y_views_avg = chart.options.scales.y_views_avg || {
          type: 'linear',
          position: 'right',
          display: true,
          offset: true,
          grid: { drawOnChartArea: false },
          ticks: { stepSize: 500 },
          min: 0,
          suggestedMax: 3000,
          title: { display: false }
        };

        chart.data.datasets.push(
          { label:'Subs (7-day avg)',  data:subsAvg7,  yAxisID:'y_subs_avg',  borderWidth:1, borderDash:[6,6], pointRadius:0, tension:.2, borderColor:subsColor,  fill:false },
          { label:'Views (7-day avg)', data:viewsAvg7, yAxisID:'y_views_avg', borderWidth:1, borderDash:[6,6], pointRadius:0, tension:.2, borderColor:viewsColor, fill:false }
        );
        chart.update('none');
      }
    } catch (e) {
      console.debug('yt-overlays: enriched CSV unavailable (ok):', e?.message || e);
    }
  }

  
// --- milestone ETA card (emoji + table) ---
try {
  const summary = await getJSON(jsonUrls);
  const proj = summary?.projection || {};

  const roundDays = (d) => (d == null ? '—' : Math.round(d).toString());
  const monYear = (iso) => {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
  };
  const rows = [
    { target: proj.next_50?.target ?? 750,  obj: proj.next_50 },
    { target: proj.next_100?.target ?? 800, obj: proj.next_100 },
    { target: 1000,                          obj: proj.to_1000 },
  ];

  const wrap = document.createElement('div');
  wrap.className = 'yt-eta';
  wrap.innerHTML = `
    <div class="yt-eta-card">
      <div class="yt-eta-title">Next Milestones</div>
      <table class="mini-table">
        <thead>
          <tr>
            <th>🎯 Target</th>
            <th>⏱ Days</th>
            <th>📅 ETA (Subs)</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(r => `
            <tr>
              <td>${r.target.toLocaleString()}</td>
              <td>${roundDays(r.obj?.eta_days)}</td>
              <td>${monYear(r.obj?.eta_date)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>`;

  // lean styles (let global CSS do most of the work)
  const style = document.createElement('style');
  style.textContent = `
    .yt-eta-title{font-weight:700;margin-bottom:10px}
  `;
  document.head.appendChild(style);

  const slot = document.querySelector('#milestonesMount')
            || document.querySelector('#chartCard')
            || document.body;
  slot.innerHTML = '';
  slot.appendChild(wrap);
} catch (e) {
  console.debug('yt-overlays: milestone badge unavailable:', e?.message || e);
}

})();
