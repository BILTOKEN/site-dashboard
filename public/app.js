// Site dashboard front end. Plain JS, no build step.
const app = document.getElementById('app');
const tip = document.getElementById('tooltip');
const toastEl = document.getElementById('toast');
const topActions = document.getElementById('top-actions');

const CLICK_GOAL = 5000; // Google clicks in 28 days
const VIEW_GOAL = 10000; // page views in 30 days

// ------------------------------------------------------------------ helpers

function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  setAttrs(el, attrs);
  append(el, children);
  return el;
}

const SVGNS = 'http://www.w3.org/2000/svg';
function s(tag, attrs, ...children) {
  const el = document.createElementNS(SVGNS, tag);
  setAttrs(el, attrs);
  append(el, children);
  return el;
}

function setAttrs(el, attrs) {
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.setAttribute('class', v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

const nf = new Intl.NumberFormat('zh-CN');
function compact(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '–';
  const a = Math.abs(n);
  if (a < 1000) return nf.format(Math.round(n * 10) / 10);
  if (a < 1e6) return `${(n / 1000).toFixed(a < 10000 ? 1 : 0).replace(/\.0$/, '')}K`;
  return `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
}
const full = (n) => (n === null || n === undefined ? '–' : nf.format(Math.round(n)));
const pct = (x) => (x === null || x === undefined ? '–' : `${(x * 100).toFixed(1)}%`);
const pos = (x) => (x ? x.toFixed(1) : '–');
const shortDate = (d) => d.slice(5);

function ago(iso) {
  if (!iso) return '从未';
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (m < 1) return '刚刚';
  if (m < 60) return `${m} 分钟前`;
  const hrs = Math.round(m / 60);
  if (hrs < 48) return `${hrs} 小时前`;
  return `${Math.round(hrs / 24)} 天前`;
}

function toast(msg) {
  toastEl.textContent = msg;
  toastEl.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (toastEl.hidden = true), 3200);
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !path.startsWith('/api/login')) {
    renderLogin();
    throw new Error('请先登录');
  }
  if (!res.ok) throw new Error(data.error || `请求失败（${res.status}）`);
  return data;
}

async function copy(text, btn) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = h('textarea', {}, text);
    document.body.append(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  const old = btn.textContent;
  btn.textContent = '已复制';
  setTimeout(() => (btn.textContent = old), 1400);
}

// ------------------------------------------------------------------ icons & badges

function icon(kind) {
  if (kind === 'good') {
    return s('svg', { width: 14, height: 14, viewBox: '0 0 16 16', 'aria-hidden': 'true' },
      s('circle', { cx: 8, cy: 8, r: 8, fill: 'var(--good)' }),
      s('path', { d: 'M4.5 8.2l2.3 2.3 4.7-4.9', stroke: '#fff', 'stroke-width': 2, fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
  }
  if (kind === 'bad') {
    return s('svg', { width: 14, height: 14, viewBox: '0 0 16 16', 'aria-hidden': 'true' },
      s('circle', { cx: 8, cy: 8, r: 8, fill: 'var(--critical)' }),
      s('path', { d: 'M5.2 5.2l5.6 5.6M10.8 5.2l-5.6 5.6', stroke: '#fff', 'stroke-width': 2, 'stroke-linecap': 'round' }));
  }
  if (kind === 'warn') {
    return s('svg', { width: 14, height: 14, viewBox: '0 0 16 16', 'aria-hidden': 'true' },
      s('path', { d: 'M8 1l7.5 13.5H.5z', fill: 'var(--warning)' }),
      s('path', { d: 'M8 6v3.6M8 11.6v.4', stroke: '#0b0b0b', 'stroke-width': 1.8, 'stroke-linecap': 'round' }));
  }
  return s('svg', { width: 14, height: 14, viewBox: '0 0 16 16', 'aria-hidden': 'true' },
    s('circle', { cx: 8, cy: 8, r: 7, fill: 'none', stroke: 'var(--muted)', 'stroke-width': 2 }));
}

function statusBadge(u) {
  if (!u) return h('span', { class: 'status unknown' }, icon('unknown'), '还没检查');
  if (u.ok) return h('span', { class: 'status good' }, icon('good'), `在线 · ${full(u.ms)}ms`);
  return h('span', { class: 'status bad' }, icon('bad'), u.status ? `打不开（HTTP ${u.status}）` : '打不开');
}

const COVERAGE = {
  'Submitted and indexed': '已提交并收录',
  'Indexed, not submitted in sitemap': '已收录（不在站点地图里）',
  'Discovered - currently not indexed': '已发现，还没收录',
  'Crawled - currently not indexed': '已抓取，还没收录',
  'URL is unknown to Google': 'Google 还不知道这个网址',
  'Page with redirect': '网页会跳转',
  'Duplicate without user-selected canonical': '重复网页，没有指定规范网址',
  'Alternate page with proper canonical tag': '备用网页（有规范网址）',
  'Not checked yet': '还没检查',
};

function indexBadge(verdict) {
  if (verdict === 'PASS') return h('span', { class: 'status good' }, icon('good'), '已收录');
  if (verdict === 'PENDING' || verdict === 'UNKNOWN') return h('span', { class: 'status unknown' }, icon('unknown'), '待检查');
  return h('span', { class: 'status unknown' }, icon('warn'), '未收录');
}

const ERR_NAMES = { gsc: 'Google 搜索数据', index: 'Google 收录检查', bing: 'Bing', uptime: '在线检查' };
function errorLines(errors) {
  return Object.entries(errors || {}).map(([k, msg]) =>
    h('div', { class: 'err-line' }, icon('warn'), h('span', {}, `${ERR_NAMES[k] || k}：${msg}`)));
}

// ------------------------------------------------------------------ charts

function niceMax(v) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const f = v / p;
  const step = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return step * p;
}

/**
 * Line chart. series: [{ name, values, color }]. One y-axis only.
 * Includes crosshair tooltip, keyboard support and a table view.
 */
function lineChart({ dates, series, height = 190, area = false, format = compact }) {
  const wrap = h('div', { class: 'chart' });
  if (!dates.length || series.every((sr) => sr.values.every((v) => !v))) {
    wrap.append(h('div', { class: 'empty' }, '还没有数据'));
    return wrap;
  }
  if (series.length > 1) {
    wrap.append(h('div', { class: 'legend' }, series.map((sr) =>
      h('span', {}, h('i', { style: `background:${sr.color}` }), sr.name))));
  }
  const holder = h('div');
  wrap.append(holder);

  let idx = dates.length - 1;
  let geom = null;

  function draw() {
    const W = Math.max(280, holder.clientWidth || 600);
    const m = { l: 40, r: 46, t: 10, b: 24 };
    const w = W - m.l - m.r;
    const hgt = height - m.t - m.b;
    const max = niceMax(Math.max(...series.flatMap((sr) => sr.values.map((v) => v || 0))));
    const x = (i) => m.l + (dates.length === 1 ? w / 2 : (i / (dates.length - 1)) * w);
    const y = (v) => m.t + hgt - (v / max) * hgt;
    geom = { x, y, m, w, hgt };

    const svg = s('svg', { viewBox: `0 0 ${W} ${height}`, role: 'img', tabindex: 0, 'aria-label': series.map((sr) => sr.name).join('、') });
    for (const t of [0, max / 2, max]) {
      svg.append(s('line', { class: t === 0 ? 'base-line' : 'grid-line', x1: m.l, x2: m.l + w, y1: y(t), y2: y(t) }));
      svg.append(s('text', { x: m.l - 6, y: y(t) + 4, 'text-anchor': 'end' }, format(t)));
    }
    const ticks = [...new Set([0, Math.floor((dates.length - 1) / 2), dates.length - 1])];
    ticks.forEach((i, k) => {
      const anchor = k === 0 ? 'start' : k === ticks.length - 1 ? 'end' : 'middle';
      svg.append(s('text', { x: x(i), y: height - 6, 'text-anchor': anchor }, shortDate(dates[i])));
    });

    const ends = [];
    series.forEach((sr) => {
      const pts = sr.values.map((v, i) => [x(i), y(v || 0)]);
      const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('');
      if (area && series.length === 1) {
        svg.append(s('path', { d: `${d}L${x(dates.length - 1)},${y(0)}L${x(0)},${y(0)}Z`, fill: 'var(--series-1-wash)' }));
      }
      svg.append(s('path', { d, fill: 'none', stroke: sr.color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
      const last = pts[pts.length - 1];
      svg.append(s('circle', { cx: last[0], cy: last[1], r: 4, fill: sr.color, stroke: 'var(--surface)', 'stroke-width': 2 }));
      ends.push({ y: last[1], v: sr.values[sr.values.length - 1] || 0, x: last[0] });
    });
    // Direct end labels unless they would collide.
    const collide = ends.some((a, i) => ends.some((b, j) => i < j && Math.abs(a.y - b.y) < 14));
    if (!collide) {
      ends.forEach((e) => svg.append(s('text', { class: 'end-label', x: e.x + 8, y: e.y + 4 }, format(e.v))));
    }

    const cross = s('line', { class: 'cross', x1: 0, x2: 0, y1: m.t, y2: m.t + hgt, visibility: 'hidden' });
    svg.append(cross);
    const hit = s('rect', { x: m.l - 10, y: 0, width: w + 20, height, fill: 'transparent' });
    svg.append(hit);

    const show = (i, clientX, clientY) => {
      idx = Math.max(0, Math.min(dates.length - 1, i));
      cross.setAttribute('x1', x(idx));
      cross.setAttribute('x2', x(idx));
      cross.setAttribute('visibility', 'visible');
      tip.replaceChildren(
        h('div', { class: 't-date' }, dates[idx]),
        ...series.map((sr) => h('div', { class: 't-row' }, h('i', { style: `background:${sr.color}` }), h('b', {}, full(sr.values[idx] || 0)), h('span', {}, sr.name))),
      );
      tip.hidden = false;
      const rect = svg.getBoundingClientRect();
      const px = clientX ?? rect.left + (x(idx) / W) * rect.width;
      const py = clientY ?? rect.top + 20;
      const tw = tip.offsetWidth;
      tip.style.left = `${Math.min(window.innerWidth - tw - 8, Math.max(8, px + 14))}px`;
      tip.style.top = `${Math.max(8, py - 10)}px`;
    };
    const hide = () => {
      cross.setAttribute('visibility', 'hidden');
      tip.hidden = true;
    };
    svg.addEventListener('pointermove', (e) => {
      const rect = svg.getBoundingClientRect();
      const px = ((e.clientX - rect.left) / rect.width) * W;
      show(Math.round(((px - m.l) / w) * (dates.length - 1)), e.clientX, e.clientY);
    });
    svg.addEventListener('pointerleave', hide);
    svg.addEventListener('focus', () => show(idx));
    svg.addEventListener('blur', hide);
    svg.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') show(idx - 1);
      if (e.key === 'ArrowRight') show(idx + 1);
    });
    holder.replaceChildren(svg);
  }

  new ResizeObserver(() => draw()).observe(holder);
  requestAnimationFrame(draw);

  const table = h('table', {},
    h('thead', {}, h('tr', {}, h('th', {}, '日期'), series.map((sr) => h('th', { class: 'n' }, sr.name)))),
    h('tbody', {}, dates.map((d, i) => h('tr', {}, h('td', {}, d), series.map((sr) => h('td', { class: 'n' }, full(sr.values[i] || 0)))))));
  wrap.append(h('details', { class: 'table-view' }, h('summary', {}, '查看数据表'), h('div', { class: 'table-wrap' }, table)));
  return wrap;
}

function sparkline(values) {
  const W = 120;
  const H = 32;
  if (!values.length || values.every((v) => !v)) return h('span', { class: 'muted small' }, '还没有访问');
  const max = Math.max(...values, 1);
  const x = (i) => 4 + (i / Math.max(1, values.length - 1)) * (W - 10);
  const y = (v) => H - 5 - (v / max) * (H - 10);
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const last = values.length - 1;
  return s('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, 'aria-hidden': 'true' },
    s('path', { d, fill: 'none', stroke: 'var(--series-1)', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
    s('circle', { cx: x(last), cy: y(values[last]), r: 4, fill: 'var(--series-1)', stroke: 'var(--surface)', 'stroke-width': 2 }));
}

function meter(value, goal, label) {
  const ratio = Math.max(0, Math.min(1, (value || 0) / goal));
  return h('div', {},
    h('div', { class: 'meter-label' }, h('span', {}, label), h('span', { class: 'num' }, `${full(value || 0)} / ${full(goal)}`)),
    h('div', { class: 'meter', role: 'meter', 'aria-valuemin': 0, 'aria-valuemax': goal, 'aria-valuenow': value || 0, 'aria-label': label },
      h('span', { style: `width:${(ratio * 100).toFixed(1)}%` })));
}

function tile(label, value, delta) {
  return h('div', { class: 'tile' }, h('div', { class: 'label' }, label), h('div', { class: 'value' }, value), delta || null);
}

function deltaEl(cur, prev, label = '比上周') {
  if (prev === null || prev === undefined) return null;
  if (!prev && !cur) return h('div', { class: 'delta' }, `${label}持平`);
  if (!prev) return h('div', { class: 'delta up' }, `${label}新增`);
  const p = ((cur - prev) / prev) * 100;
  const cls = p > 0.5 ? 'up' : p < -0.5 ? 'down' : '';
  return h('div', { class: `delta ${cls}` }, `${label} ${p > 0 ? '+' : ''}${p.toFixed(0)}%`);
}

function simpleTable(headers, rows, emptyText = '还没有数据') {
  if (!rows.length) return h('div', { class: 'empty' }, emptyText);
  return h('div', { class: 'table-wrap' }, h('table', {},
    h('thead', {}, h('tr', {}, headers.map(([t, num]) => h('th', { class: num ? 'n' : null }, t)))),
    h('tbody', {}, rows.map((r) => h('tr', {}, r.map((c, i) => h('td', { class: headers[i][1] ? 'n' : headers[i][2] || null }, c)))))));
}

function verdict(clicks28, pv30, index, hasGoogle) {
  const ready = ['可以考虑变现', '已经过门槛。连续两周保持在这个水平再动手：买域名、升级 Vercel Pro（$20/月）、申请广告。'];
  const close = ['接近', '流量在涨，但还没到能覆盖成本的水平。继续优化带来流量的页面。'];
  if ((clicks28 || 0) > CLICK_GOAL || (pv30 || 0) > VIEW_GOAL) return ready;
  if (!hasGoogle) {
    if ((pv30 || 0) >= 2000) return close;
    return ['还早', '30 天页面浏览不到 2000。粗算每千次浏览只有 1–2 美元广告收入，现在花钱变现会亏。'];
  }
  const allIndexed = index && index.total > 0 && index.indexed === index.total;
  if (!allIndexed || (clicks28 || 0) < 1000) return ['还早', '先等 Google 把页面收录完，再看每天有没有稳定的搜索点击。现在花钱变现会亏。'];
  return close;
}

// ------------------------------------------------------------------ views

async function boot() {
  let status;
  try {
    status = await api('/api/status');
  } catch (e) {
    app.replaceChildren(h('div', { class: 'notice error' }, `后台连不上：${e.message}`));
    return;
  }
  window.__status = status;
  if (!status.loggedIn) return renderLogin(status);
  topActions.hidden = false;
  route();
}

function renderLogin(status = window.__status || {}) {
  topActions.hidden = true;
  const c = status.configured || {};
  if (!c.store && !c.password) {
    app.replaceChildren(h('div', { class: 'card login' }, h('h2', {}, '后台还差一步'),
      h('p', {}, '数据库还没连接。在 Vercel 项目里打开 Storage，创建一个 Upstash（Redis）免费数据库并连接到这个项目，然后重新部署。')));
    return;
  }
  const setup = !c.password;
  const err = h('p', { class: 'err-line', hidden: true });
  const input = h('input', { type: 'password', autocomplete: setup ? 'new-password' : 'current-password', required: true, minlength: setup ? 8 : null });
  const confirm = setup ? h('input', { type: 'password', autocomplete: 'new-password', required: true }) : null;
  const btn = h('button', { class: 'btn btn-primary', type: 'submit' }, setup ? '设置密码并进入' : '登录');
  const form = h('form', { class: 'card login', onsubmit: async (e) => {
    e.preventDefault();
    err.hidden = true;
    if (setup && input.value !== confirm.value) {
      err.textContent = '两次输入的密码不一样';
      err.hidden = false;
      return;
    }
    btn.disabled = true;
    try {
      await api('/api/login', { method: 'POST', body: { password: input.value, setup } });
      boot();
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
    } finally {
      btn.disabled = false;
    }
  } },
  h('h2', {}, setup ? '第一次使用：设置登录密码' : '登录网站后台'),
  setup ? h('p', { class: 'small muted' }, '至少 8 位，别和其他账号用同一个密码。设置后只能用这个密码登录。') : null,
  h('label', { class: 'field' }, '密码', input),
  setup ? h('label', { class: 'field' }, '再输一次', confirm) : null,
  err, btn);
  app.replaceChildren(form);
  input.focus();
}

function setupNotice(status) {
  const c = status.configured || {};
  const blocks = [];
  if (status.memoryStore && c.store) blocks.push(h('div', { class: 'notice warn' }, '现在用的是临时内存数据库（只适合本地测试），数据不会保存。'));
  const optional = [];
  if (!c.google) optional.push('Google 搜索数据（点击、排名、收录）：还没接入。需要在 Vercel 环境变量里加 GSC_SERVICE_ACCOUNT_JSON。');
  if (!c.bing) optional.push('Bing 数据：还没接入。需要在 Vercel 环境变量里加 BING_API_KEY。');
  if (optional.length) {
    blocks.push(h('details', { class: 'notice' }, h('summary', { style: 'cursor:pointer' }, '可选：接入 Google / Bing 数据（访问量和在线监测不需要这一步）'),
      h('ul', {}, optional.map((t) => h('li', {}, t)))));
  }
  if (c.google && status.serviceAccountEmail) {
    const b = h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => copy(status.serviceAccountEmail, b) }, '复制');
    blocks.push(h('div', { class: 'notice' },
      h('div', {}, '每个网站都要在 Search Console 里把下面这个邮箱加为用户（设置 → 用户和权限 → 添加用户 → 受限），后台才能读到数据：'),
      h('div', { class: 'snippet', style: 'margin-top:8px' }, h('code', {}, status.serviceAccountEmail), b)));
  }
  return blocks;
}

function route() {
  tip.hidden = true;
  const hash = location.hash.replace(/^#/, '') || '/';
  const [, view, id] = hash.split('/');
  if (view === 'site' && id) return renderSite(decodeURIComponent(id));
  if (view === 'add') return renderForm();
  if (view === 'edit' && id) return renderForm(decodeURIComponent(id));
  return renderOverview();
}

async function renderOverview() {
  app.replaceChildren(h('div', { class: 'empty' }, '加载中…'));
  let data;
  try {
    data = await api('/api/sites');
  } catch (e) {
    app.replaceChildren(...setupNotice(window.__status), h('div', { class: 'notice error' }, e.message));
    return;
  }
  const sites = data.sites;
  const head = h('div', { class: 'page-head' },
    h('div', {}, h('h1', {}, '所有网站'), h('p', { class: 'sub' }, `共 ${sites.length} 个网站 · 每天早上 6 点左右自动更新一次`)));
  if (!sites.length) {
    app.replaceChildren(head, ...setupNotice(window.__status),
      h('div', { class: 'card' }, h('h2', {}, '还没有网站'), h('p', { class: 'muted' }, '添加第一个网站后，后台会马上拉一次数据。'), h('a', { class: 'btn btn-primary', href: '#/add' }, '添加网站')));
    return;
  }
  const cards = sites.map((x) => {
    const clicks = x.gsc?.totals28?.clicks;
    const t = x.traffic;
    const tiles = x.gsc
      ? [
        tile('访客（7天）', compact(t.uv7), deltaEl(t.uv7, t.uvPrev7)),
        tile('Google 点击（28天）', compact(clicks)),
        tile('Google 收录', x.index ? `${x.index.indexed}/${x.index.total}` : '–'),
        tile('平均排名', pos(x.gsc?.totals28?.position)),
      ]
      : [
        tile('访客（7天）', compact(t.uv7), deltaEl(t.uv7, t.uvPrev7)),
        tile('页面浏览（7天）', compact(t.pv7), deltaEl(t.pv7, t.pvPrev7)),
      ];
    return h('a', { class: 'card site-card', href: `#/site/${encodeURIComponent(x.site.id)}` },
      h('div', { class: 'row' }, h('div', { style: 'min-width:0' }, h('div', { class: 'name' }, x.site.name), h('div', { class: 'url' }, x.site.url)), statusBadge(x.uptime)),
      h('div', { class: 'tiles' }, tiles),
      h('div', { class: 'row' }, h('span', { class: 'small muted' }, `页面浏览（14天）${full(t.daily.reduce((a, b) => a + b, 0))}`), sparkline(t.daily)),
      x.gsc ? meter(clicks, CLICK_GOAL, '变现门槛：28 天 Google 点击') : meter(t.pv30, VIEW_GOAL, '变现门槛：30 天页面浏览'),
      errorLines(x.errors),
      h('div', { class: 'small muted' }, `数据更新于 ${ago(x.updatedAt)}`));
  });
  app.replaceChildren(head, ...setupNotice(window.__status), h('div', { class: 'cards' }, cards));
}

async function renderSite(id) {
  app.replaceChildren(h('div', { class: 'empty' }, '加载中…'));
  let data;
  try {
    data = await api(`/api/site?id=${encodeURIComponent(id)}`);
  } catch (e) {
    app.replaceChildren(h('div', { class: 'notice error' }, e.message), h('a', { href: '#/' }, '← 返回'));
    return;
  }
  const { site, snap, stats, uptime } = data;
  const gsc = snap.gsc;
  const bing = snap.bing;
  const index = snap.index;
  const t = stats.totals;

  const refreshBtn = h('button', { class: 'btn btn-ghost', type: 'button', onclick: async () => {
    refreshBtn.disabled = true;
    refreshBtn.textContent = '刷新中…';
    try {
      const r = await api(`/api/refresh?id=${encodeURIComponent(id)}`, { method: 'POST' });
      toast(Object.keys(r.errors || {}).length ? '已刷新，有部分数据出错，见页面提示' : '已刷新');
      renderSite(id);
    } catch (e) {
      toast(e.message);
      refreshBtn.disabled = false;
      refreshBtn.textContent = '立即刷新';
    }
  } }, '立即刷新');

  const head = h('div', { class: 'page-head' },
    h('div', { style: 'min-width:0' },
      h('div', { class: 'small' }, h('a', { href: '#/' }, '← 所有网站')),
      h('h1', {}, site.name),
      h('p', { class: 'sub' }, h('a', { href: site.url, target: '_blank', rel: 'noopener' }, site.url), ' · ', statusBadge(snap.uptime), h('span', { class: 'muted' }, ` · 数据更新于 ${ago(snap.updatedAt)}`))),
    h('div', { class: 'top-actions' }, refreshBtn, h('a', { class: 'btn btn-ghost', href: `#/edit/${encodeURIComponent(id)}` }, '编辑')));

  const errs = Object.keys(snap.errors || {}).length ? h('div', { class: 'notice error' }, h('strong', {}, '部分数据没拉到'), errorLines(snap.errors)) : null;

  const hasGoogle = Boolean(gsc);
  const tiles = h('div', { class: 'tiles wide card' },
    tile('访客（7天）', compact(t.uv7), deltaEl(t.uv7, t.uvPrev7)),
    tile('页面浏览（7天）', compact(t.pv7), deltaEl(t.pv7, t.pvPrev7)),
    tile('访客（30天）', compact(t.uv30)),
    tile('页面浏览（30天）', compact(t.pv30)),
    hasGoogle ? tile('Google 点击（28天）', compact(gsc.totals28?.clicks)) : null,
    hasGoogle ? tile('平均排名（28天）', pos(gsc.totals28?.position)) : null,
    index ? tile('Google 收录', `${index.indexed}/${index.total}`) : null,
    bing && bing.inIndex !== null ? tile('Bing 收录', full(bing.inIndex)) : null);

  const [label, advice] = verdict(gsc?.totals28?.clicks, t.pv30, index, hasGoogle);
  const money = h('div', { class: 'card' },
    h('div', { class: 'row', style: 'margin-bottom:10px' }, h('h2', { style: 'margin:0' }, '变现判断'), h('strong', {}, label)),
    h('div', { class: hasGoogle ? 'grid grid-2' : 'grid' }, hasGoogle ? meter(gsc.totals28?.clicks, CLICK_GOAL, '28 天 Google 点击') : null, meter(t.pv30, VIEW_GOAL, '30 天页面浏览')),
    h('p', { class: 'small muted', style: 'margin:10px 0 0' }, advice));

  const traffic = h('div', { class: 'card' }, h('h2', {}, '访问量（30天，自己统计）'),
    lineChart({ dates: stats.series.map((d) => d.date), series: [
      { name: '页面浏览', values: stats.series.map((d) => d.pv), color: 'var(--series-1)' },
      { name: '访客', values: stats.series.map((d) => d.uv), color: 'var(--series-2)' },
    ] }));

  const gDates = (gsc?.daily || []).map((d) => d.date);
  const googleCharts = h('div', { class: 'grid grid-2' },
    h('div', { class: 'card' }, h('h2', {}, 'Google 点击（每天）'), lineChart({ dates: gDates, area: true, series: [{ name: '点击', values: (gsc?.daily || []).map((d) => d.clicks), color: 'var(--series-1)' }] })),
    h('div', { class: 'card' }, h('h2', {}, 'Google 展示（每天）'), lineChart({ dates: gDates, area: true, series: [{ name: '展示', values: (gsc?.daily || []).map((d) => d.impressions), color: 'var(--series-1)' }] })));

  const bDates = (bing?.daily || []).map((d) => d.date);
  const bingCharts = h('div', { class: 'grid grid-2' },
    h('div', { class: 'card' }, h('h2', {}, 'Bing 点击（每天）'), lineChart({ dates: bDates, area: true, series: [{ name: '点击', values: (bing?.daily || []).map((d) => d.clicks), color: 'var(--series-1)' }] })),
    h('div', { class: 'card' }, h('h2', {}, 'Bing 展示（每天）'), lineChart({ dates: bDates, area: true, series: [{ name: '展示', values: (bing?.daily || []).map((d) => d.impressions), color: 'var(--series-1)' }] })));

  const pathOf = (u) => {
    try {
      return new URL(u).pathname;
    } catch {
      return u;
    }
  };
  const countRows = (list) => list.map((r) => [r.key, full(r.count)]);
  const ownTables = h('div', { class: 'grid grid-2' },
    h('div', { class: 'card' }, h('h2', {}, '热门页面（30天）'), simpleTable([['页面', false, 'url'], ['浏览', true]], countRows(stats.top.pages))),
    h('div', { class: 'card' }, h('h2', {}, '访问来源（30天）'), simpleTable([['来源', false, 'url'], ['浏览', true]], countRows(stats.top.referrers.map((r) => ({ ...r, key: r.key === 'direct' ? '直接访问' : r.key }))))),
    h('div', { class: 'card' }, h('h2', {}, '国家/地区（30天）'), simpleTable([['国家', false], ['浏览', true]], countRows(stats.top.countries))),
    h('div', { class: 'card' }, h('h2', {}, '设备（30天）'), simpleTable([['设备', false], ['浏览', true]], countRows(stats.top.devices.map((r) => ({ ...r, key: { desktop: '电脑', mobile: '手机', tablet: '平板' }[r.key] || r.key }))))));

  const qRow = (r) => [r.key, full(r.clicks), full(r.impressions), pct(r.ctr), pos(r.position)];
  const googleTables = h('div', { class: 'grid grid-2' },
    h('div', { class: 'card' }, h('h2', {}, 'Google 热门搜索词（28天）'),
      simpleTable([['搜索词', false], ['点击', true], ['展示', true], ['点击率', true], ['排名', true]], (gsc?.queries || []).map(qRow), '还没有搜索词数据')),
    h('div', { class: 'card' }, h('h2', {}, 'Google 热门页面（28天）'),
      simpleTable([['页面', false, 'url'], ['点击', true], ['展示', true], ['点击率', true], ['排名', true]], (gsc?.pages || []).map((r) => qRow({ ...r, key: pathOf(r.key) })), '还没有页面数据')));

  const bingTable = h('div', { class: 'card' }, h('h2', {}, 'Bing 热门搜索词'),
    simpleTable([['搜索词', false], ['点击', true], ['展示', true], ['平均排名', true]], (bing?.queries || []).map((r) => [r.query, full(r.clicks), full(r.impressions), pos(r.position)]), '还没有 Bing 搜索词数据'));

  const indexCard = h('div', { class: 'card' }, h('h2', {}, `收录状态（Google，${index ? `${index.indexed}/${index.total}` : '–'}）`),
    simpleTable([['页面', false, 'url'], ['状态', false], ['说明', false], ['上次抓取', false]],
      (index?.urls || []).map((r) => [pathOf(r.url), indexBadge(r.verdict), COVERAGE[r.coverage] || r.coverage || '–', r.lastCrawl ? r.lastCrawl.slice(0, 10) : '–']),
      '还没有检查收录。确认已连接 Google，并且站点地图地址正确。'),
    h('p', { class: 'small muted', style: 'margin:8px 0 0' }, '每个网址最多 3 天检查一次（Google 每天每个网站限 2000 次）。'));

  const upCard = h('div', { class: 'card' }, h('h2', {}, '在线记录'),
    simpleTable([['时间', false], ['状态', false], ['响应', true]],
      uptime.slice(0, 15).map((u) => [new Date(u.t).toLocaleString('zh-CN', { hour12: false }), statusBadge(u), u.ms ? `${full(u.ms)}ms` : '–']), '还没有记录'));

  const snippetText = `<script defer src="${location.origin}/t.js" data-site="${site.id}"></script>`;
  const cbtn = h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => copy(snippetText, cbtn) }, '复制');
  const snippet = h('div', { class: 'card' }, h('h2', {}, '统计代码'),
    h('p', { class: 'small muted', style: 'margin-top:0' }, '把下面这行加到网站每个页面的 </head> 前面。不用 cookie，不记录个人信息。想排除你自己的访问：在网站任意网址后面加 ?sd_ignore=1 打开一次（加 ?sd_ignore=0 恢复）。'),
    h('div', { class: 'snippet' }, h('code', {}, snippetText), cbtn));

  const c = window.__status?.configured || {};
  const googleBlocks = c.google || gsc || index ? [googleCharts, googleTables, indexCard] : [];
  const bingBlocks = c.bing || bing ? [bingCharts, bingTable] : [];
  const notConnected = !googleBlocks.length || !bingBlocks.length
    ? h('p', { class: 'small muted' }, `${!googleBlocks.length ? 'Google' : ''}${!googleBlocks.length && !bingBlocks.length ? ' 和 ' : ''}${!bingBlocks.length ? 'Bing' : ''} 的搜索数据还没接入，接入后这里会多出点击、排名和收录。`)
    : null;
  app.replaceChildren(head, ...(errs ? [errs] : []), tiles, money, traffic, ownTables, ...googleBlocks, ...bingBlocks, notConnected || '', upCard, snippet);
}

async function renderForm(id) {
  let site = null;
  if (id) {
    try {
      site = (await api(`/api/site?id=${encodeURIComponent(id)}`)).site;
    } catch (e) {
      app.replaceChildren(h('div', { class: 'notice error' }, e.message));
      return;
    }
  }
  const field = (name, label, hint, value, placeholder) => {
    const input = h('input', { name, value: value || '', placeholder: placeholder || '', autocomplete: 'off' });
    return h('label', { class: 'field' }, label, input, hint ? h('small', {}, hint) : null);
  };
  const err = h('div', { class: 'notice error', hidden: true });
  const save = h('button', { class: 'btn btn-primary', type: 'submit' }, id ? '保存' : '添加并拉取数据');
  const form = h('form', { class: 'card', style: 'max-width:640px', onsubmit: async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(form));
    save.disabled = true;
    save.textContent = id ? '保存中…' : '添加中，正在拉第一次数据…';
    err.hidden = true;
    try {
      const r = await api('/api/sites', { method: 'POST', body: { ...fd, id: site?.id } });
      location.hash = `#/site/${encodeURIComponent(r.site.id)}`;
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
      save.disabled = false;
      save.textContent = id ? '保存' : '添加并拉取数据';
    }
  } },
  h('h2', {}, id ? '编辑网站' : '添加网站'),
  err,
  field('name', '名称', '自己看的名字，比如“字幕转换站”。', site?.name),
  field('url', '网址', '网站首页地址。', site?.url, 'https://example.com'),
  h('details', { open: id ? true : null }, h('summary', { class: 'small muted', style: 'cursor:pointer;margin-bottom:12px' }, '高级设置（一般不用改）'),
    field('gscProperty', 'Search Console 资源', '网址前缀资源填完整网址（结尾带 /）；网域资源填 sc-domain:example.com。不填就用网址。', site?.gscProperty, 'https://example.com/'),
    field('bingSiteUrl', 'Bing 网站地址', '和 Bing Webmaster 里登记的一致。不填就用网址。', site?.bingSiteUrl, 'https://example.com/'),
    field('sitemapUrl', '站点地图地址', '用来检查每个页面的收录状态。', site?.sitemapUrl, 'https://example.com/sitemap.xml')),
  h('div', { class: 'row' }, h('div', { class: 'top-actions' }, save, h('a', { class: 'btn btn-ghost', href: id ? `#/site/${encodeURIComponent(id)}` : '#/' }, '取消')),
    id ? deleteButton(id) : null));
  app.replaceChildren(h('div', { class: 'page-head' }, h('div', {}, h('div', { class: 'small' }, h('a', { href: '#/' }, '← 所有网站')))), form);
}

function deleteButton(id) {
  let armed = false;
  const b = h('button', { class: 'btn btn-danger', type: 'button', onclick: async () => {
    if (!armed) {
      armed = true;
      b.textContent = '确定删除？再点一次';
      setTimeout(() => {
        armed = false;
        b.textContent = '删除网站';
      }, 4000);
      return;
    }
    try {
      await api(`/api/sites?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      toast('已删除（访问统计数据保留）');
      location.hash = '#/';
    } catch (e) {
      toast(e.message);
    }
  } }, '删除网站');
  return b;
}

document.addEventListener('click', async (e) => {
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'logout') {
    await fetch('/api/login', { method: 'DELETE', credentials: 'same-origin' });
    renderLogin();
  }
  if (act === 'refresh-all') {
    const btn = e.target.closest('button');
    btn.disabled = true;
    btn.textContent = '刷新中…';
    try {
      const r = await api('/api/refresh', { method: 'POST' });
      toast(`已刷新 ${r.refreshed.length} 个网站${r.skipped ? `，${r.skipped} 个留到下次` : ''}`);
      route();
    } catch (ex) {
      toast(ex.message);
    } finally {
      btn.disabled = false;
      btn.textContent = '全部刷新';
    }
  }
});

window.addEventListener('hashchange', route);
boot();
