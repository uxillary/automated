(async function () {
  const SUMMARY_URL = '/automated/metrics/youtube_summary.json'
    .replace('/automated/', (location.pathname.includes('/automated') ? '/automated/' : '/'));
  // Graceful: try both with and without /automated prefix
  const tryUrls = [
    SUMMARY_URL,
    '/metrics/youtube_summary.json'
  ];

  function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    Object.entries(attrs).forEach(([k, v]) => {
      if (k === 'class') node.className = v;
      else if (k.startsWith('on') && typeof v === 'function') node[k] = v;
      else node.setAttribute(k, v);
    });
    [].concat(children).forEach(c => node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c));
    return node;
  }

  function fmt(n, digits = 0) {
    if (n == null || Number.isNaN(n)) return '—';
    return Number(n).toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits });
  }

  function fmtDate(d) {
    return new Date(d).toLocaleDateString('en-US', {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC'
    });
  }


  // replace the pill helper
  const pill = (emoji, label, value, cls='') =>
    el('div', { class: `pill ${cls}` }, [
      el('span', { class: 'emoji' }, emoji + ' '),
      el('span', { class: 'label' }, label + ' '),
      el('span', { class: 'value' }, value)
    ]);

  async function fetchSummary() {
    let lastErr;
    for (const u of tryUrls) {
      try {
        const res = await fetch(u, { cache: 'no-store' });
        if (res.ok) return res.json();
        lastErr = new Error(`HTTP ${res.status}`);
      } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error('Unable to load metrics summary');
  }

  
  function renderCard(s) {
    const proj = s.projection || {};
    const roll = s.rolling || {};
    const ratios = s.ratios || {};

    const row1 = el('div', { class: 'pills' }, [
      pill('📈','Subs/day (7d)',  fmt(roll.subs_per_day_7, 2), 'pill--sub'),
      pill('📈','Subs/day (30d)', fmt(roll.subs_per_day_30, 2), 'pill--sub'),
      pill('👀','Views/day (7d)', fmt(roll.views_per_day_7, 0), 'pill--view'),
      pill('👀','Views/day (30d)',fmt(roll.views_per_day_30, 0), 'pill--view')
    ]);

    const row2 = el('div', { class: 'pills' }, [
      pill('▶️','Views/Video', fmt(ratios.views_per_video, 0), 'pill--ratio'),
      pill('🙋','Views/Sub',   fmt(ratios.views_per_sub, 0),   'pill--ratio'),
      pill('➕','Subs/Video',  fmt(ratios.subs_per_video, 2),  'pill--ratio')
    ]);

    // Reformat ETAs: integer days + Month Year
    const etaDays = o => (o && o.eta_days != null) ? Math.round(o.eta_days).toString() : '—';
    const etaMY   = o => (o && o.eta_date) ? new Date(o.eta_date).toLocaleDateString(undefined,{month:'short',year:'numeric'}) : '—';

    const row3 = el('div', { class: 'pills' }, [
      pill('🚀','ETA 750',  `${etaDays(proj.next_50)} days · ${etaMY(proj.next_50)}`, 'pill--sub'),
      pill('🎯','ETA 800',  `${etaDays(proj.next_100)} days · ${etaMY(proj.next_100)}`, 'pill--sub'),
      pill('🏁','ETA 1000', `${etaDays(proj.to_1000)} days · ${etaMY(proj.to_1000)}`, 'pill--sub')
    ]);

    const root = el('section', { class: 'im-card' }, [
      el('h3', { class: 'im-title' }, 'Metrics'),
      row1, row2, row3,
      el('div', { class: 'im-foot' }, [
        el('span', { class: 'im-muted' }, `Last updated: ${new Date(s.last_updated).toUTCString().replace(' GMT','')}`)
      ])
    ]);

    // Attach near the existing chart if possible
    const anchors = [
      document.querySelector('#metricsMount'),
      document.querySelector('#chartCard'),
      document.querySelector('#youtube-chart'),
      document.querySelector('#chart'),
      document.querySelector('.chart-container'),
      document.querySelector('main'),
      document.body
    ].filter(Boolean);

    const anchor = anchors[0] || document.body;
    if (anchor.id === 'metricsMount') {
      anchor.replaceWith(root);
    } else {
      anchor.parentNode.insertBefore(root, anchor.nextSibling);
    }
  }

  // Inject minimal styles (scoped names)
  
const css = `
.im-card{margin:0;background:#fff;border-radius:16px;padding:16px 18px;box-shadow:0 8px 24px rgba(0,0,0,.06);border:1px solid rgba(2,6,23,.10)}
.im-title{margin:0 0 10px;font-size:1.05rem;font-weight:700}
.im-foot{margin-top:8px}
.im-muted{font-size:.85rem;opacity:.8}
`;
  const style = el('style', {}, css);
  document.head.appendChild(style);

  try {
    const summary = await fetchSummary();
    if (summary && summary.current) renderCard(summary);
  } catch (e) {
    // Silent fail to avoid breaking the page
    console.debug('Metrics card unavailable:', e?.message || e);
  }
})();
