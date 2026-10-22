// First-party, cookie-free page view analytics stored in Redis.
// One hash per site per day:  a:<site>:<date>  with fields
//   pv            total page views
//   p:<path>      views per page
//   r:<host>      views per referrer ("direct" when none)
//   c:<country>   views per country (from Vercel's geo header)
//   d:<device>    views per device type
// plus a HyperLogLog uv:<site>:<date> for unique visitors.
import { createHash, createHmac } from 'node:crypto';
import { appSecret } from './auth.js';
import { pipeline, toObject } from './store.js';
import { lastDays, ymd } from './util.js';

export const BOT_RE =
  /bot|crawl|spider|slurp|headless|lighthouse|pagespeed|preview|facebookexternalhit|embedly|whatsapp|telegram|curl|wget|python|axios|node-fetch|go-http|java\/|httpclient|monitor|uptime/i;

// Daily-rotating salt: visitors can be counted within a day but not tracked across days.
async function saltFor(date) {
  return createHmac('sha256', await appSecret()).update(date).digest('hex');
}

export function deviceOf(ua = '') {
  if (/iPad|Tablet|PlayBook|Silk|(Android(?!.*Mobile))/i.test(ua)) return 'tablet';
  if (/Mobi|iPhone|iPod|Android|Windows Phone/i.test(ua)) return 'mobile';
  return 'desktop';
}

export function cleanPath(p) {
  let path = String(p || '/').split(/[?#]/)[0] || '/';
  if (!path.startsWith('/')) path = `/${path}`;
  path = path.replace(/\/{2,}/g, '/');
  if (path.length > 1) path = path.replace(/\/$/, '');
  return path.slice(0, 120);
}

export function referrerHost(ref, siteHost) {
  if (!ref) return 'direct';
  try {
    const host = new URL(ref).hostname.replace(/^www\./, '');
    if (!host) return 'direct';
    if (siteHost && host === siteHost.replace(/^www\./, '')) return null; // internal navigation
    return host.slice(0, 80);
  } catch {
    return 'direct';
  }
}

/** Record one page view. Returns false when the hit was ignored. */
export async function recordHit({ site, path, ref, ua, ip, country, siteHost, now = new Date() }) {
  if (!site || BOT_RE.test(ua || '') || !ua) return false;
  const date = ymd(now);
  const key = `a:${site}:${date}`;
  const visitor = createHash('sha256')
    .update(`${await saltFor(date)}|${ip || ''}|${ua}|${site}`)
    .digest('hex')
    .slice(0, 20);

  const cmds = [
    ['HINCRBY', key, 'pv', 1],
    ['HINCRBY', key, `p:${cleanPath(path)}`, 1],
    ['HINCRBY', key, `c:${(country || '??').slice(0, 2).toUpperCase()}`, 1],
    ['HINCRBY', key, `d:${deviceOf(ua)}`, 1],
    ['PFADD', `uv:${site}:${date}`, visitor],
  ];
  const refHost = referrerHost(ref, siteHost);
  if (refHost) cmds.push(['HINCRBY', key, `r:${refHost}`, 1]);
  await pipeline(cmds);
  return true;
}

function topOf(map, n = 10) {
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([key, count]) => ({ key, count }));
}

/** Daily series and breakdowns for the last `days` days. */
export async function readStats(site, days = 30) {
  const dates = lastDays(days);
  const last7 = dates.slice(-7);
  const prev7 = dates.slice(-14, -7);
  const cmds = [];
  for (const d of dates) cmds.push(['HGETALL', `a:${site}:${d}`], ['PFCOUNT', `uv:${site}:${d}`]);
  cmds.push(['PFCOUNT', ...last7.map((d) => `uv:${site}:${d}`)]);
  cmds.push(['PFCOUNT', ...dates.map((d) => `uv:${site}:${d}`)]);
  if (prev7.length === 7) cmds.push(['PFCOUNT', ...prev7.map((d) => `uv:${site}:${d}`)]);
  const res = await pipeline(cmds);

  const series = [];
  const agg = { p: {}, r: {}, c: {}, d: {} };
  dates.forEach((date, i) => {
    const h = toObject(res[i * 2]);
    series.push({ date, pv: Number(h.pv || 0), uv: Number(res[i * 2 + 1] || 0) });
    for (const [field, value] of Object.entries(h)) {
      const m = /^([prcd]):(.*)$/.exec(field);
      if (m) agg[m[1]][m[2]] = (agg[m[1]][m[2]] || 0) + Number(value);
    }
  });
  const base = dates.length * 2;
  const sum = (arr) => arr.reduce((s, r) => s + r.pv, 0);
  return {
    series,
    totals: {
      pv7: sum(series.slice(-7)),
      pvPrev7: sum(series.slice(-14, -7)),
      uv7: Number(res[base] || 0),
      pv30: sum(series),
      uv30: Number(res[base + 1] || 0),
      uvPrev7: prev7.length === 7 ? Number(res[base + 2] || 0) : null,
    },
    top: {
      pages: topOf(agg.p, 15),
      referrers: topOf(agg.r, 10),
      countries: topOf(agg.c, 10),
      devices: topOf(agg.d, 3),
    },
  };
}
