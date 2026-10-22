// "Refresh now" from the dashboard: one site (?id=) or all sites.
import { isLoggedIn } from '../lib/auth.js';
import { refreshAll, refreshSite } from '../lib/jobs.js';
import { getSite } from '../lib/sites.js';
import { query, send } from '../lib/util.js';

export default async function handler(req, res) {
  if (!(await isLoggedIn(req))) return send(res, 401, { error: 'Not logged in' });
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
  const { id } = query(req);
  try {
    if (id) {
      const site = await getSite(id);
      if (!site) return send(res, 404, { error: 'Site not found' });
      const snap = await refreshSite(site);
      return send(res, 200, { ok: true, errors: snap.errors });
    }
    return send(res, 200, { ok: true, ...(await refreshAll()) });
  } catch (err) {
    return send(res, 500, { error: String(err.message || err) });
  }
}
