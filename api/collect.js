// Public endpoint that receives page views from t.js on your websites.
// Hits are only counted when the site id is registered and the request comes
// from that site's own domain.
import { recordHit } from '../lib/analytics.js';
import { listSites } from '../lib/sites.js';
import { storeConfigured } from '../lib/store.js';
import { readBody, send } from '../lib/util.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

let cache = { at: 0, hosts: new Map() };

async function siteHosts(force = false) {
  if (!force && Date.now() - cache.at < 5 * 60 * 1000) return cache.hosts;
  const sites = await listSites();
  cache = { at: Date.now(), hosts: new Map(sites.map((s) => [s.id, new URL(s.url).hostname.replace(/^www\./, '')])) };
  return cache.hosts;
}

function hostOf(value) {
  try {
    return new URL(value).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return send(res, 204, undefined, CORS);
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' }, CORS);
  if (!storeConfigured()) return send(res, 204, undefined, CORS);

  try {
    const body = await readBody(req);
    const id = String(body.s || '').slice(0, 40);
    let hosts = await siteHosts();
    if (!hosts.has(id)) hosts = await siteHosts(true);
    const siteHost = hosts.get(id);
    if (!siteHost) return send(res, 204, undefined, CORS);

    // Only accept hits sent from the registered domain (or its subdomains).
    const from = hostOf(req.headers.origin || req.headers.referer || '');
    if (from && from !== siteHost && !from.endsWith(`.${siteHost}`)) return send(res, 204, undefined, CORS);

    await recordHit({
      site: id,
      path: body.p,
      ref: body.r,
      ua: String(req.headers['user-agent'] || ''),
      ip: String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || '',
      country: String(req.headers['x-vercel-ip-country'] || ''),
      siteHost,
    });
  } catch {
    // Never break the visitor's page because of analytics.
  }
  return send(res, 204, undefined, CORS);
}
