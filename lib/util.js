// Small shared helpers: dates, JSON responses, request bodies, sitemaps.

export const DAY = 86400000;

/** YYYY-MM-DD for a Date (UTC). */
export function ymd(d = new Date()) {
  return new Date(d).toISOString().slice(0, 10);
}

/** YYYY-MM-DD n days before today (UTC). */
export function daysAgo(n) {
  return ymd(Date.now() - n * DAY);
}

/** Last n dates ending today (UTC), oldest first. */
export function lastDays(n) {
  return Array.from({ length: n }, (_, i) => daysAgo(n - 1 - i));
}

export function send(res, status, data, headers = {}) {
  res.statusCode = status;
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  if (data === undefined) {
    res.end();
    return;
  }
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(data));
}

/** Vercel usually parses the body; handle raw strings and streams too. */
export async function readBody(req) {
  if (req.body !== undefined && req.body !== null && req.body !== '') {
    if (typeof req.body === 'string') return safeJson(req.body);
    if (Buffer.isBuffer(req.body)) return safeJson(req.body.toString('utf8'));
    return req.body;
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 100_000) break;
    chunks.push(chunk);
  }
  return safeJson(Buffer.concat(chunks).toString('utf8'));
}

function safeJson(s) {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}

export function query(req) {
  return Object.fromEntries(new URL(req.url, 'http://x').searchParams);
}

/** Fetch a sitemap and return its page URLs (follows one level of sitemap index). */
export async function sitemapUrls(sitemapUrl, depth = 0) {
  const res = await fetch(sitemapUrl, { headers: { 'User-Agent': 'site-dashboard/1.0' } });
  if (!res.ok) throw new Error(`Sitemap HTTP ${res.status}`);
  const xml = await res.text();
  const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1].replace(/&amp;/g, '&'));
  if (/<sitemapindex/i.test(xml) && depth === 0) {
    const nested = await Promise.all(locs.slice(0, 5).map((u) => sitemapUrls(u, 1).catch(() => [])));
    return nested.flat();
  }
  return locs;
}

/** Run async fn over items with limited concurrency. */
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return out;
}

export function slugify(s) {
  return String(s)
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}
