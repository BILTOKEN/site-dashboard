// Daily job triggered by Vercel Cron (see vercel.json).
// With CRON_SECRET set, only Vercel's signed request is accepted. Without it,
// the job is rate-limited to once every 20 hours so it cannot be abused.
import { isCron } from '../lib/auth.js';
import { refreshAll } from '../lib/jobs.js';
import { cmd } from '../lib/store.js';
import { send } from '../lib/util.js';

const MIN_GAP = 20 * 60 * 60 * 1000;

export default async function handler(req, res) {
  if (process.env.CRON_SECRET && !isCron(req)) return send(res, 401, { error: 'Unauthorized' });
  try {
    if (!process.env.CRON_SECRET) {
      const last = Number((await cmd('GET', 'cron:last')) || 0);
      if (Date.now() - last < MIN_GAP) return send(res, 429, { error: 'Already ran recently' });
      await cmd('SET', 'cron:last', String(Date.now()));
    }
    return send(res, 200, { ok: true, ...(await refreshAll()) });
  } catch (err) {
    return send(res, 500, { error: String(err.message || err) });
  }
}
