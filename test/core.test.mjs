import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.MEMORY_STORE = '1';
process.env.MOCK_EXTERNAL = '1';
delete process.env.DASHBOARD_PASSWORD;
process.env.CRON_SECRET = 'cron-test';

const store = await import('../lib/store.js');
const { normalizeSite, saveSite, listSites, getSite, deleteSite } = await import('../lib/sites.js');
const { recordHit, readStats, cleanPath, referrerHost, deviceOf } = await import('../lib/analytics.js');
const { bingDate, bingTraffic, bingCrawl, bingQueries } = await import('../lib/bing.js');
const { checkPassword, sessionCookie, isLoggedIn, isCron, setPassword, passwordConfigured, _resetAuthCache } = await import('../lib/auth.js');
const { refreshSite } = await import('../lib/jobs.js');

test('normalizeSite fills defaults and validates', () => {
  const s = normalizeSite({ name: 'Subtitle Converter', url: 'subtitle-converter-jade.vercel.app/' });
  assert.equal(s.id, 'subtitle-converter');
  assert.equal(s.url, 'https://subtitle-converter-jade.vercel.app');
  assert.equal(s.gscProperty, 'https://subtitle-converter-jade.vercel.app/');
  assert.equal(s.sitemapUrl, 'https://subtitle-converter-jade.vercel.app/sitemap.xml');
  assert.throws(() => normalizeSite({ url: 'not a url' }), /valid website/);
  assert.equal(normalizeSite({ name: '字幕转换站', url: 'https://subtitle-converter-jade.vercel.app' }).id, 'subtitle-converter-jade');
  assert.equal(normalizeSite({ name: '字幕转换站', url: 'https://www.example.com' }).id, 'example-com');
  const edited = normalizeSite({ name: 'New name', gscProperty: 'sc-domain:example.com' }, s);
  assert.equal(edited.id, s.id);
  assert.equal(edited.gscProperty, 'sc-domain:example.com');
  assert.equal(edited.createdAt, s.createdAt);
});

test('sites CRUD in the store', async () => {
  store._resetMemory();
  await saveSite(normalizeSite({ name: 'A', url: 'https://a.example.com' }));
  await saveSite(normalizeSite({ name: 'B', url: 'https://b.example.com' }));
  assert.deepEqual((await listSites()).map((s) => s.id), ['a', 'b']);
  assert.equal((await getSite('a')).url, 'https://a.example.com');
  await deleteSite('a');
  assert.deepEqual((await listSites()).map((s) => s.id), ['b']);
});

test('analytics helpers', () => {
  assert.equal(cleanPath('/srt-to-txt/?x=1#top'), '/srt-to-txt');
  assert.equal(cleanPath(''), '/');
  assert.equal(referrerHost('', 'site.com'), 'direct');
  assert.equal(referrerHost('https://www.google.com/search?q=x', 'site.com'), 'google.com');
  assert.equal(referrerHost('https://site.com/other', 'site.com'), null);
  assert.equal(deviceOf('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148'), 'mobile');
  assert.equal(deviceOf('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130'), 'desktop');
});

test('recordHit counts views, unique visitors, breakdowns and skips bots', async () => {
  store._resetMemory();
  const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130';
  const base = { site: 's1', siteHost: 's1.com', country: 'us' };
  await recordHit({ ...base, path: '/', ref: 'https://www.google.com/', ua, ip: '1.1.1.1' });
  await recordHit({ ...base, path: '/srt-to-txt', ref: 'https://s1.com/', ua, ip: '1.1.1.1' });
  await recordHit({ ...base, path: '/srt-to-txt', ref: '', ua: `${ua} Mobile iPhone`, ip: '2.2.2.2' });
  assert.equal(await recordHit({ ...base, path: '/', ua: 'Googlebot/2.1', ip: '3.3.3.3' }), false);
  const stats = await readStats('s1', 7);
  assert.equal(stats.totals.pv7, 3);
  assert.equal(stats.totals.uv7, 2);
  assert.deepEqual(stats.top.pages[0], { key: '/srt-to-txt', count: 2 });
  assert.deepEqual(stats.top.referrers.map((r) => r.key).sort(), ['direct', 'google.com']);
  assert.deepEqual(stats.top.countries, [{ key: 'US', count: 3 }]);
  assert.equal(stats.series.length, 7);
});

test('auth: first-visit password, signed cookie, cron header', async () => {
  store._resetMemory();
  _resetAuthCache();
  assert.equal(await passwordConfigured(), false);
  await assert.rejects(setPassword('short'), /8/);
  await setPassword('long-enough-pw');
  assert.equal(await passwordConfigured(), true);
  await assert.rejects(setPassword('another-password'), /已经设置/);
  assert.equal(await checkPassword('long-enough-pw'), true);
  assert.equal(await checkPassword('nope'), false);
  const cookie = (await sessionCookie({ headers: { host: 'localhost:3000' } })).split(';')[0];
  assert.equal(await isLoggedIn({ headers: { cookie } }), true);
  assert.equal(await isLoggedIn({ headers: { cookie: cookie.replace(/.$/, 'x') } }), false);
  assert.equal(await isLoggedIn({ headers: {} }), false);
  assert.equal(isCron({ headers: { authorization: 'Bearer cron-test' } }), true);
  assert.equal(isCron({ headers: { authorization: 'Bearer wrong' } }), false);
  _resetAuthCache();
});

test('bing parsing', async () => {
  assert.equal(bingDate('/Date(1399014000000-0700)/'), '2014-05-02');
  assert.equal(bingDate('garbage'), null);
  const traffic = await bingTraffic('https://x.com/');
  assert.equal(traffic.length, 30);
  assert.ok(traffic[0].date < traffic[29].date);
  const crawl = await bingCrawl('https://x.com/');
  assert.equal(crawl[crawl.length - 1].inIndex, 5);
  const q = await bingQueries('https://x.com/');
  assert.equal(q[0].query, 'txt to srt');
});

test('refreshSite with mocked Google/Bing and a stubbed sitemap + uptime', async () => {
  store._resetMemory();
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/sitemap.xml')) {
      const xml = `<?xml version="1.0"?><urlset>${['/', '/srt-to-txt', '/txt-to-srt', '/srt-to-vtt'].map((p) => `<url><loc>https://s1.com${p}</loc></url>`).join('')}</urlset>`;
      return new Response(xml, { status: 200 });
    }
    return new Response('<html>ok</html>', { status: 200 });
  };
  try {
    const site = normalizeSite({ name: 'S1', url: 'https://s1.com' });
    await saveSite(site);
    const snap = await refreshSite(site);
    assert.deepEqual(snap.errors, {});
    assert.equal(snap.uptime.ok, true);
    assert.equal(snap.gsc.daily.length, 31);
    assert.equal(snap.gsc.totals28.clicks, 310);
    assert.equal(snap.gsc.queries[0].key, 'txt to srt');
    assert.equal(snap.index.total, 4);
    assert.equal(snap.index.indexed, 3); // "/", "/srt-to-txt", "/txt-to-srt" are PASS in the mock
    assert.ok(snap.bing.daily.length > 0);
    assert.equal(snap.bing.inIndex, 5);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('refreshSite keeps going when one source fails', async () => {
  store._resetMemory();
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/sitemap.xml')) return new Response('nope', { status: 404 });
    throw new Error('network down');
  };
  try {
    const site = normalizeSite({ name: 'S2', url: 'https://s2.com' });
    const snap = await refreshSite(site);
    assert.equal(snap.uptime.ok, false);
    assert.match(snap.errors.index, /Sitemap HTTP 404/);
    assert.ok(snap.gsc); // Google data still came through
  } finally {
    globalThis.fetch = realFetch;
  }
});
