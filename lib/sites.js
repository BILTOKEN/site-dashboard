// The list of monitored websites, stored as one Redis hash: id -> JSON.
import { cmd, pipeline, toObject } from './store.js';
import { slugify } from './util.js';

const KEY = 'sites';

function origin(url) {
  return new URL(url).origin;
}

/** Validate and fill defaults. Throws a readable error for bad input. */
export function normalizeSite(input, existing = null) {
  const name = String(input.name ?? existing?.name ?? '').trim();
  let url = String(input.url ?? existing?.url ?? '').trim();
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Please enter a valid website address, e.g. https://example.com');
  }
  if (!parsed.hostname.includes('.')) throw new Error('Please enter a valid website address, e.g. https://example.com');
  url = `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}` || parsed.origin;

  // Names may be Chinese, which slugify drops, so fall back to the domain.
  const hostId = parsed.hostname.replace(/^www\./, '').replace(/\.(vercel\.app|netlify\.app|pages\.dev|github\.io)$/, '');
  const id = existing?.id || slugify(input.id || '') || slugify(name) || slugify(hostId);
  if (!id) throw new Error('Could not derive an id for this site.');

  const pick = (k, fallback) => {
    const v = String(input[k] ?? existing?.[k] ?? '').trim();
    return v || fallback;
  };
  return {
    id,
    name: name || parsed.hostname,
    url,
    gscProperty: pick('gscProperty', `${origin(url)}/`),
    bingSiteUrl: pick('bingSiteUrl', `${origin(url)}/`),
    sitemapUrl: pick('sitemapUrl', `${origin(url)}/sitemap.xml`),
    createdAt: existing?.createdAt || new Date().toISOString(),
  };
}

export async function listSites() {
  const raw = toObject(await cmd('HGETALL', KEY));
  return Object.values(raw)
    .map((v) => {
      try {
        return JSON.parse(v);
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function getSite(id) {
  const v = await cmd('HGET', KEY, id);
  return v ? JSON.parse(v) : null;
}

export async function siteExists(id) {
  return (await cmd('HEXISTS', KEY, id)) === 1;
}

export async function saveSite(site) {
  await cmd('HSET', KEY, site.id, JSON.stringify(site));
  return site;
}

export async function deleteSite(id) {
  await pipeline([
    ['HDEL', KEY, id],
    ['DEL', `snap:${id}`, `uptime:${id}`, `index:${id}`],
  ]);
}
