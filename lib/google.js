// Google Search Console API with a service account. Signs the OAuth JWT with
// node:crypto, so no Google client library is needed.
import { createSign } from 'node:crypto';
import { mockGoogle } from './mock.js';

const SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
let cached = { token: '', exp: 0, email: '' };

export function serviceAccount() {
  const raw = process.env.GSC_SERVICE_ACCOUNT_JSON || '';
  if (!raw.trim()) return null;
  let text = raw.trim();
  if (!text.startsWith('{')) {
    try {
      text = Buffer.from(text, 'base64').toString('utf8');
    } catch {
      return null;
    }
  }
  try {
    const sa = JSON.parse(text);
    if (!sa.client_email || !sa.private_key) return null;
    return { ...sa, private_key: sa.private_key.replace(/\\n/g, '\n') };
  } catch {
    return null;
  }
}

export function googleConfigured() {
  return process.env.MOCK_EXTERNAL === '1' || Boolean(serviceAccount());
}

export function serviceAccountEmail() {
  if (process.env.MOCK_EXTERNAL === '1') return 'dashboard-reader@demo-project.iam.gserviceaccount.com';
  return serviceAccount()?.client_email || '';
}

async function accessToken() {
  const sa = serviceAccount();
  if (!sa) throw new Error('Google service account is not configured (GSC_SERVICE_ACCOUNT_JSON).');
  const now = Math.floor(Date.now() / 1000);
  if (cached.token && cached.email === sa.client_email && cached.exp - 60 > now) return cached.token;

  const aud = sa.token_uri || 'https://oauth2.googleapis.com/token';
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = `${enc({ alg: 'RS256', typ: 'JWT' })}.${enc({ iss: sa.client_email, scope: SCOPE, aud, iat: now, exp: now + 3600 })}`;
  const signature = createSign('RSA-SHA256').update(unsigned).sign(sa.private_key, 'base64url');

  const res = await fetch(aud, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${signature}`,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error(`Google sign-in failed (${res.status}): ${data.error_description || data.error || 'unknown error'}`);
  }
  cached = { token: data.access_token, exp: now + (data.expires_in || 3600), email: sa.client_email };
  return cached.token;
}

async function call(url, body) {
  if (process.env.MOCK_EXTERNAL === '1') return mockGoogle(url, body);
  const token = await accessToken();
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.error?.message || `HTTP ${res.status}`;
    if (res.status === 403) {
      throw new Error(`${msg} — add ${serviceAccountEmail()} as a user of this property in Search Console (Settings → Users and permissions).`);
    }
    throw new Error(msg);
  }
  return data;
}

/** Search analytics query. property is "https://example.com/" or "sc-domain:example.com". */
export function searchAnalytics(property, body) {
  return call(
    `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(property)}/searchAnalytics/query`,
    { dataState: 'all', ...body },
  );
}

/** Index status of one URL (URL Inspection API, 2,000 calls per day per property). */
export async function inspectUrl(property, url) {
  const data = await call('https://searchconsole.googleapis.com/v1/urlInspection/index:inspect', {
    inspectionUrl: url,
    siteUrl: property,
    languageCode: 'en-US',
  });
  const r = data.inspectionResult?.indexStatusResult || {};
  return {
    url,
    verdict: r.verdict || 'UNKNOWN',
    coverage: r.coverageState || '',
    lastCrawl: r.lastCrawlTime || null,
    checkedAt: new Date().toISOString(),
  };
}
