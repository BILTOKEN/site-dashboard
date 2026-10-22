// List / add / edit / delete monitored sites, with a summary for the overview.
import { readStats } from '../lib/analytics.js';
import { isLoggedIn } from '../lib/auth.js';
import { refreshSite } from '../lib/jobs.js';
import { deleteSite, getSite, listSites, normalizeSite, saveSite } from '../lib/sites.js';
import { getJson, storeConfigured } from '../lib/store.js';
import { query, readBody, send } from '../lib/util.js';

async function summary(site) {
  const [snap, stats] = await Promise.all([getJson(`snap:${site.id}`), readStats(site.id, 30)]);
  const s = snap || {};
  return {
    site,
    updatedAt: s.updatedAt || null,
    uptime: s.uptime || null,
    gsc: s.gsc ? { totals28: s.gsc.totals28, daily: s.gsc.daily.map((d) => d.clicks) } : null,
    index: s.index ? { indexed: s.index.indexed, total: s.index.total } : null,
    bing: s.bing ? { totals30: s.bing.totals30, inIndex: s.bing.inIndex } : null,
    traffic: { ...stats.totals, daily: stats.series.slice(-14).map((d) => d.pv) },
    errors: s.errors || {},
  };
}

export default async function handler(req, res) {
  if (!(await isLoggedIn(req))) return send(res, 401, { error: 'Not logged in' });
  if (!storeConfigured()) return send(res, 503, { error: 'Database is not connected yet.' });

  try {
    if (req.method === 'GET') {
      const sites = await listSites();
      return send(res, 200, { sites: await Promise.all(sites.map(summary)) });
    }

    if (req.method === 'POST') {
      const body = await readBody(req);
      const existing = body.id ? await getSite(body.id) : null;
      const site = normalizeSite(body, existing);
      if (!existing && (await getSite(site.id))) {
        return send(res, 409, { error: `A site with id "${site.id}" already exists.` });
      }
      await saveSite(site);
      // First data pull right away so the new site is not empty.
      if (!existing) await refreshSite(site).catch(() => null);
      return send(res, 200, { site });
    }

    if (req.method === 'DELETE') {
      const { id } = query(req);
      if (!id) return send(res, 400, { error: 'Missing id' });
      await deleteSite(id);
      return send(res, 200, { ok: true });
    }

    return send(res, 405, { error: 'Method not allowed' });
  } catch (err) {
    return send(res, 400, { error: String(err.message || err) });
  }
}
