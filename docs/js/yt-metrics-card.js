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

    const pill = (label, value) =>
      el('div', { class: 'im-pill' }, [
        el('span', { class: 'im-pill-label' }, label),
        el('span', { class: 'im-pill-value' }, value)
      ]);

    const etaText = (obj) => {
      if (!obj || obj.eta_days == null) return '—';
      return `${fmt(obj.eta_days, 1)}d (${new Date(obj.eta_date).toUTCString().replace(' GMT', '')})`;
    };

    const root = el('section', { class: 'im-card' }, [
      el('h3', { class: 'im-title' }, 'Metrics'),
      el('div', { class: 'im-row' }, [
        pill('Subs/day (7d)', fmt(roll.subs_per_day_7, 2)),
        pill('Subs/day (30d)', fmt(roll.subs_per_day_30, 2)),
        pill('Views/day (7d)', fmt(roll.views_per_day_7, 0)),
        pill('Views/day (30d)', fmt(roll.views_per_day_30, 0)),
      ]),
      el('div', { class: 'im-row' }, [
        pill('Views/Video', fmt(ratios.views_per_video, 0)),
        pill('Views/Sub', fmt(ratios.views_per_sub, 0)),
        pill('Subs/Video', fmt(ratios.subs_per_video, 2)),
      ]),
      el('div', { class: 'im-row' }, [
        pill(`ETA ${proj.next_50?.target || 'next 50'}`, etaText(proj.next_50)),
        pill(`ETA ${proj.next_100?.target || 'next 100'}`, etaText(proj.next_100)),
        pill('ETA 1000', etaText(proj.to_1000)),
      ]),
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
.im-card{margin:0;background:#fff;border-radius:16px;padding:16px 18px;box-shadow:0 8px 24px rgba(0,0,0,.06);color:#111}
@media (prefers-color-scheme: dark){
  .im-card{background:#141417;border:1px solid rgba(255,255,255,.08);color:#eaeaea}
  .im-pill{background:rgba(255,255,255,.08);color:#eaeaea}
  .im-title{color:#eaeaea}
  .im-muted{color:#9aa0a6}
}
.im-title{margin:0 0 10px;font-size:1.1rem;font-weight:700}
.im-row{display:flex;flex-wrap:wrap;gap:10px;margin:10px 0}
.im-pill{display:flex;gap:8px;align-items:center;padding:8px 12px;border-radius:999px;background:#f1f3f5}
.im-pill-label{font-size:.85rem;opacity:.8}
.im-pill-value{font-weight:700}
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
