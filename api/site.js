// Everything about one site for the detail page.
import { readStats } from '../lib/analytics.js';
import { isLoggedIn } from '../lib/auth.js';
import { getSite } from '../lib/sites.js';
import { cmd, getJson } from '../lib/store.js';
import { query, send } from '../lib/util.js';

export default async function handler(req, res) {
  if (!(await isLoggedIn(req))) return send(res, 401, { error: 'Not logged in' });
  const { id } = query(req);
  const site = id ? await getSite(id) : null;
  if (!site) return send(res, 404, { error: 'Site not found' });

  const [snap, stats, uptimeRaw] = await Promise.all([
    getJson(`snap:${id}`),
    readStats(id, 30),
    cmd('LRANGE', `uptime:${id}`, 0, 89),
  ]);
  const uptime = (uptimeRaw || [])
    .map((x) => {
      try {
        return JSON.parse(x);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  return send(res, 200, { site, snap: snap || {}, stats, uptime });
}
