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

  // Add “Next Milestones” badge (if JSON exists)
  try {
    const s = await getJSON(jsonUrls);
    const proj = s?.projection || {};
    const toText = (o)=>!o||o.eta_days==null ? '—' : `${o.target}: ${o.eta_days.toFixed(1)}d (${new Date(o.eta_date).toUTCString().replace(' GMT','')})`;

    const wrap = document.createElement('div');
    wrap.className = 'yt-eta';
    wrap.innerHTML = `
      <div class="yt-eta-card">
        <div class="yt-eta-title">Next Milestones</div>
        <div class="yt-eta-items pills">
          <span class="pill"><span class="value">${toText(proj.next_50)}</span></span>
          <span class="pill"><span class="value">${toText(proj.next_100)}</span></span>
          <span class="pill"><span class="value">${toText(proj.to_1000)}</span></span>
        </div>
      </div>`;
    const style = document.createElement('style');
    style.textContent = `
  .yt-eta-card{background:transparent;border:0;padding:0}
  .yt-eta-title{font-weight:700;margin-bottom:8px}
`;
    document.head.appendChild(style);

    const slot = document.querySelector('#milestonesMount') || document.querySelector('#chartCard') || document.body;
    slot.innerHTML = '';
    slot.appendChild(wrap);
  } catch (e) {
    console.debug('yt-overlays: summary JSON unavailable (ok):', e?.message || e);
  }
})();
