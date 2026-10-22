// Fake Google / Bing responses for local development (MOCK_EXTERNAL=1).
// Deterministic so tests and screenshots are stable.

function days(start, end) {
  const out = [];
  for (let d = new Date(`${start}T00:00:00Z`); d <= new Date(`${end}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

function wave(i, base, amp) {
  return Math.max(0, Math.round(base + i * 0.9 + amp * Math.sin(i / 2.3)));
}

const QUERIES = ['txt to srt', 'srt to txt', 'lrc to srt', 'srt to vtt', 'vtt to srt', 'convert txt to srt', 'text to srt', 'srt to lrc'];
const PAGES = ['/txt-to-srt', '/srt-to-txt', '/lrc-to-srt', '/srt-to-vtt', '/vtt-to-srt', '/', '/srt-to-lrc'];

export function mockGoogle(url, body = {}) {
  if (url.includes('urlInspection')) {
    const indexed = /txt|lrc-to|\/$/.test(body.inspectionUrl);
    return {
      inspectionResult: {
        indexStatusResult: indexed
          ? { verdict: 'PASS', coverageState: 'Submitted and indexed', lastCrawlTime: '2026-10-20T08:12:00Z' }
          : { verdict: 'NEUTRAL', coverageState: 'Discovered - currently not indexed' },
      },
    };
  }
  const dims = body.dimensions || [];
  const site = decodeURIComponent(url.split('/sites/')[1] || '').replace(/\/searchAnalytics.*/, '');
  const scale = site.includes('second') ? 0.4 : 1;
  if (dims[0] === 'date') {
    return {
      rows: days(body.startDate, body.endDate).map((date, i) => {
        const impressions = Math.round(wave(i, 40, 12) * 6 * scale);
        const clicks = Math.round(wave(i, 4, 3) * scale);
        return { keys: [date], clicks, impressions, ctr: impressions ? clicks / impressions : 0, position: 18 - i * 0.2 };
      }),
    };
  }
  if (dims[0] === 'query' || dims[0] === 'page') {
    const list = dims[0] === 'query' ? QUERIES : PAGES.map((p) => site.replace(/\/$/, '') + p);
    return {
      rows: list.map((k, i) => {
        const impressions = Math.round((900 - i * 95) * scale);
        const clicks = Math.round((60 - i * 7) * scale);
        return { keys: [k], clicks, impressions, ctr: clicks / impressions, position: 8 + i * 2.5 };
      }),
    };
  }
  return { rows: [{ clicks: Math.round(310 * scale), impressions: Math.round(9800 * scale), ctr: 0.032, position: 14.2 }] };
}

export function mockBing(method) {
  const today = new Date();
  const stamp = (offset) => `/Date(${Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - offset)}-0700)/`;
  if (method === 'GetRankAndTrafficStats') {
    return Array.from({ length: 30 }, (_, i) => ({ Date: stamp(30 - i), Clicks: wave(i, 1, 1), Impressions: wave(i, 12, 5) }));
  }
  if (method === 'GetQueryStats') {
    return QUERIES.slice(0, 5).map((q, i) => ({ Query: q, Clicks: 5 - i, Impressions: 120 - i * 18, AvgImpressionPosition: 6 + i, Date: stamp(7) }));
  }
  if (method === 'GetCrawlStats') {
    return Array.from({ length: 10 }, (_, i) => ({ Date: stamp(10 - i), CrawledPages: 3 + i, InIndex: Math.min(7, 1 + Math.floor(i / 2)), CrawlErrors: 0 }));
  }
  return [];
}
