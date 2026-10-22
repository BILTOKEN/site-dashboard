// Local stand-in for Vercel: serves public/ and runs api/*.js handlers.
// npm run dev  (uses an in-memory database and fake Google/Bing data)
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT) || 3000;
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
};

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) {
      const name = url.pathname.slice(5).replace(/[^a-z0-9-]/gi, '');
      const file = join(root, 'api', `${name}.js`);
      if (!existsSync(file)) {
        res.statusCode = 404;
        return res.end('Not found');
      }
      const mod = await import(pathToFileURL(file).href);
      return await mod.default(req, res);
    }
    const rel = normalize(url.pathname).replace(/^(\.\.[/\\])+/, '');
    const candidates = [join(root, 'public', rel), join(root, 'public', `${rel}.html`), join(root, 'public', rel, 'index.html')];
    const file = candidates.find((f) => f.startsWith(join(root, 'public')) && existsSync(f) && statSync(f).isFile());
    if (!file) {
      res.statusCode = 404;
      return res.end('Not found');
    }
    res.setHeader('Content-Type', types[extname(file)] || 'application/octet-stream');
    res.end(readFileSync(file));
  } catch (err) {
    console.error(err);
    res.statusCode = 500;
    res.end(String(err.stack || err));
  }
}).listen(port, async () => {
  console.log(`Dashboard dev server: http://localhost:${port}  (password: ${process.env.DASHBOARD_PASSWORD})`);
  if (process.env.SEED_SITE) await seed(process.env.SEED_SITE);
});

// SEED_SITE=http://127.0.0.1:8080 fills the in-memory store with a site and
// 30 days of fake page views, so the dashboard has something to show.
async function seed(url) {
  const { normalizeSite, saveSite } = await import('../lib/sites.js');
  const { recordHit } = await import('../lib/analytics.js');
  const { refreshSite } = await import('../lib/jobs.js');
  const site = await saveSite(normalizeSite({ name: '字幕转换站', url }));
  const pages = ['/', '/txt-to-srt', '/srt-to-txt', '/lrc-to-srt', '/srt-to-vtt', '/vtt-to-srt'];
  const refs = ['https://www.google.com/', 'https://www.google.com/', 'https://www.bing.com/', '', '', 'https://www.reddit.com/'];
  const uas = ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148'];
  const countries = ['US', 'US', 'IN', 'GB', 'DE', 'BR'];
  for (let day = 29; day >= 0; day--) {
    const n = Math.round(4 + (29 - day) * 0.8 + 3 * Math.sin(day));
    for (let i = 0; i < n; i++) {
      await recordHit({
        site: site.id,
        path: pages[(i + day) % pages.length],
        ref: refs[(i * 7 + day) % refs.length],
        ua: uas[i % 3 === 0 ? 1 : 0],
        ip: `10.0.${day}.${i % Math.max(2, n - 2)}`,
        country: countries[(i + day) % countries.length],
        siteHost: new URL(url).hostname,
        now: new Date(Date.now() - day * 86400000),
      });
    }
  }
  await refreshSite(site);
  console.log(`Seeded site "${site.id}"`);
}
