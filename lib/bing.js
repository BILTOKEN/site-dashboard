// Bing Webmaster Tools API (JSON endpoint, API key from Bing Webmaster → Settings → API Access).
import { mockBing } from './mock.js';

const BASE = 'https://ssl.bing.com/webmaster/api.svc/json';

export function bingConfigured() {
  return process.env.MOCK_EXTERNAL === '1' || Boolean(process.env.BING_API_KEY);
}

/** "/Date(1399014000000-0700)/" -> "2014-05-02" (UTC calendar date of the timestamp). */
export function bingDate(value) {
  const m = /Date\((-?\d+)/.exec(String(value || ''));
  if (!m) return null;
  return new Date(Number(m[1])).toISOString().slice(0, 10);
}

// Bing returns PascalCase fields; read them without caring about case.
function field(obj, name) {
  if (!obj) return undefined;
  const k = Object.keys(obj).find((x) => x.toLowerCase() === name.toLowerCase());
  return k === undefined ? undefined : obj[k];
}

async function call(method, siteUrl) {
  if (process.env.MOCK_EXTERNAL === '1') return mockBing(method, siteUrl);
  const key = process.env.BING_API_KEY;
  if (!key) throw new Error('Bing API key is not configured (BING_API_KEY).');
  const url = `${BASE}/${method}?siteUrl=${encodeURIComponent(siteUrl)}&apikey=${encodeURIComponent(key)}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = null;
  }
  if (!res.ok) {
    const msg = (data && (data.Message || data.message)) || text.slice(0, 160) || `HTTP ${res.status}`;
    throw new Error(`Bing ${method}: ${msg}`);
  }
  return Array.isArray(data?.d) ? data.d : [];
}

/** Daily clicks and impressions from Bing search. */
export async function bingTraffic(siteUrl) {
  const rows = await call('GetRankAndTrafficStats', siteUrl);
  return rows
    .map((r) => ({
      date: bingDate(field(r, 'Date')),
      clicks: Number(field(r, 'Clicks') || 0),
      impressions: Number(field(r, 'Impressions') || 0),
    }))
    .filter((r) => r.date)
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Top queries. Bing reports them in weekly buckets, so we sum across the returned period. */
export async function bingQueries(siteUrl) {
  const rows = await call('GetQueryStats', siteUrl);
  const byQuery = new Map();
  for (const r of rows) {
    const q = String(field(r, 'Query') || '').trim();
    if (!q) continue;
    const cur = byQuery.get(q) || { query: q, clicks: 0, impressions: 0, positionSum: 0, n: 0 };
    cur.clicks += Number(field(r, 'Clicks') || 0);
    cur.impressions += Number(field(r, 'Impressions') || 0);
    const pos = Number(field(r, 'AvgImpressionPosition') || 0);
    if (pos > 0) {
      cur.positionSum += pos;
      cur.n++;
    }
    byQuery.set(q, cur);
  }
  return [...byQuery.values()]
    .map((q) => ({ query: q.query, clicks: q.clicks, impressions: q.impressions, position: q.n ? q.positionSum / q.n : null }))
    .sort((a, b) => b.impressions - a.impressions || b.clicks - a.clicks)
    .slice(0, 20);
}

/** Crawl stats; the latest row's InIndex is the number of pages Bing has indexed. */
export async function bingCrawl(siteUrl) {
  const rows = await call('GetCrawlStats', siteUrl);
  return rows
    .map((r) => ({
      date: bingDate(field(r, 'Date')),
      crawled: Number(field(r, 'CrawledPages') || 0),
      inIndex: Number(field(r, 'InIndex') || 0),
      errors: Number(field(r, 'CrawlErrors') || 0),
    }))
    .filter((r) => r.date)
    .sort((a, b) => a.date.localeCompare(b.date));
}
