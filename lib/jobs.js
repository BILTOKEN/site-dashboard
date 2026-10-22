// Pull fresh data for a site: uptime, Google Search Console, index status, Bing.
// Each part fails independently; the previous good data is kept on failure.
import { bingConfigured, bingCrawl, bingQueries, bingTraffic } from './bing.js';
import { googleConfigured, inspectUrl, searchAnalytics } from './google.js';
import { listSites } from './sites.js';
import { cmd, getJson, pipeline, setJson, toObject } from './store.js';
import { DAY, daysAgo, mapLimit, sitemapUrls } from './util.js';

const INSPECT_PER_RUN = 40;
const RECHECK_AFTER = 3 * DAY;

export async function checkUptime(site) {
  const started = Date.now();
  const entry = { t: new Date().toISOString() };
  try {
    const res = await fetch(site.url, {
      redirect: 'follow',
      headers: { 'User-Agent': 'site-dashboard-uptime/1.0' },
      signal: AbortSignal.timeout(15000),
    });
    entry.status = res.status;
    entry.ok = res.ok;
    await res.arrayBuffer().catch(() => null);
  } catch (err) {
    entry.ok = false;
    entry.status = 0;
    entry.error = String(err.message || err).slice(0, 120);
  }
  entry.ms = Date.now() - started;
  await pipeline([
    ['LPUSH', `uptime:${site.id}`, JSON.stringify(entry)],
    ['LTRIM', `uptime:${site.id}`, 0, 89],
  ]);
  return entry;
}

async function fetchGsc(site) {
  const start = daysAgo(30);
  const end = daysAgo(0);
  const start28 = daysAgo(27);
  const [daily, totals, queries, pages] = await Promise.all([
    searchAnalytics(site.gscProperty, { startDate: start, endDate: end, dimensions: ['date'], rowLimit: 100 }),
    searchAnalytics(site.gscProperty, { startDate: start28, endDate: end }),
    searchAnalytics(site.gscProperty, { startDate: start28, endDate: end, dimensions: ['query'], rowLimit: 25 }),
    searchAnalytics(site.gscProperty, { startDate: start28, endDate: end, dimensions: ['page'], rowLimit: 25 }),
  ]);
  const row = (r) => ({ clicks: r.clicks || 0, impressions: r.impressions || 0, ctr: r.ctr || 0, position: r.position || 0 });
  const t = (totals.rows || [])[0];
  return {
    daily: (daily.rows || []).map((r) => ({ date: r.keys[0], ...row(r) })).sort((a, b) => a.date.localeCompare(b.date)),
    totals28: t ? row(t) : { clicks: 0, impressions: 0, ctr: 0, position: 0 },
    queries: (queries.rows || []).map((r) => ({ key: r.keys[0], ...row(r) })),
    pages: (pages.rows || []).map((r) => ({ key: r.keys[0], ...row(r) })),
    updatedAt: new Date().toISOString(),
  };
}

async function fetchIndex(site) {
  const urls = [...new Set(await sitemapUrls(site.sitemapUrl))].slice(0, 500);
  const known = toObject(await cmd('HGETALL', `index:${site.id}`));
  const now = Date.now();
  const due = urls
    .map((u) => {
      let prev = null;
      try {
        prev = known[u] ? JSON.parse(known[u]) : null;
      } catch {
        prev = null;
      }
      return { url: u, last: prev ? Date.parse(prev.checkedAt) : 0 };
    })
    .filter((x) => !x.last || now - x.last > RECHECK_AFTER)
    .sort((a, b) => a.last - b.last)
    .slice(0, INSPECT_PER_RUN);

  const results = await mapLimit(due, 3, (x) => inspectUrl(site.gscProperty, x.url).catch((e) => ({ url: x.url, error: e.message })));
  const ok = results.filter((r) => !r.error);
  if (ok.length) await cmd('HSET', `index:${site.id}`, ...ok.flatMap((r) => [r.url, JSON.stringify(r)]));
  const firstError = results.find((r) => r.error);
  if (!ok.length && firstError) throw new Error(firstError.error);

  const merged = toObject(await cmd('HGETALL', `index:${site.id}`));
  const list = urls.map((u) => {
    try {
      return merged[u] ? JSON.parse(merged[u]) : { url: u, verdict: 'PENDING', coverage: 'Not checked yet' };
    } catch {
      return { url: u, verdict: 'PENDING', coverage: 'Not checked yet' };
    }
  });
  return {
    total: urls.length,
    indexed: list.filter((r) => r.verdict === 'PASS').length,
    urls: list,
    updatedAt: new Date().toISOString(),
  };
}

async function fetchBing(site) {
  const [daily, queries, crawl] = await Promise.all([
    bingTraffic(site.bingSiteUrl),
    bingQueries(site.bingSiteUrl).catch(() => []),
    bingCrawl(site.bingSiteUrl).catch(() => []),
  ]);
  const since = daysAgo(30);
  const recent = daily.filter((r) => r.date >= since);
  const last = crawl[crawl.length - 1];
  return {
    daily: recent,
    totals30: recent.reduce((s, r) => ({ clicks: s.clicks + r.clicks, impressions: s.impressions + r.impressions }), { clicks: 0, impressions: 0 }),
    queries,
    inIndex: last ? last.inIndex : null,
    crawled: last ? last.crawled : null,
    updatedAt: new Date().toISOString(),
  };
}

/** Refresh one site. Returns the new snapshot. */
export async function refreshSite(site) {
  const key = `snap:${site.id}`;
  const prev = (await getJson(key)) || {};
  const snap = { ...prev, errors: {} };

  const tasks = [
    ['uptime', () => checkUptime(site)],
    ['gsc', googleConfigured() ? () => fetchGsc(site) : null],
    ['index', googleConfigured() ? () => fetchIndex(site) : null],
    ['bing', bingConfigured() ? () => fetchBing(site) : null],
  ];
  await Promise.all(
    tasks.map(async ([name, fn]) => {
      if (!fn) return;
      try {
        snap[name] = await fn();
      } catch (err) {
        snap.errors[name] = String(err.message || err).slice(0, 300);
      }
    }),
  );
  snap.updatedAt = new Date().toISOString();
  await setJson(key, snap);
  return snap;
}

/** Refresh every site, oldest snapshot first, within a time budget. */
export async function refreshAll({ budgetMs = 45000 } = {}) {
  const started = Date.now();
  const sites = await listSites();
  const snaps = await pipeline(sites.map((s) => ['GET', `snap:${s.id}`]));
  const order = sites
    .map((s, i) => {
      let updated = 0;
      try {
        updated = snaps[i] ? Date.parse(JSON.parse(snaps[i]).updatedAt) || 0 : 0;
      } catch {
        updated = 0;
      }
      return { site: s, updated };
    })
    .sort((a, b) => a.updated - b.updated);

  const done = [];
  for (const { site } of order) {
    if (Date.now() - started > budgetMs) break;
    const snap = await refreshSite(site);
    done.push({ id: site.id, errors: snap.errors });
  }
  return { refreshed: done, skipped: sites.length - done.length };
}
