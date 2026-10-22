// Login for the dashboard.
// The password is set on the first visit and stored as a scrypt hash in Redis
// (or taken from the DASHBOARD_PASSWORD environment variable if that is set).
// Sessions are HttpOnly cookies signed with a random secret kept in Redis.
import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { getJson, setJson, storeConfigured } from './store.js';

const COOKIE = 'sd_session';
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days
const KEY = 'auth';

let cache = null; // { salt, hash, secret }

async function authRecord() {
  if (cache) return cache;
  if (!storeConfigured()) return null;
  let rec = await getJson(KEY);
  if (!rec || !rec.secret) {
    rec = { ...(rec || {}), secret: randomBytes(32).toString('hex') };
    await setJson(KEY, rec);
  }
  if (rec.hash) cache = rec;
  return rec;
}

/** Stable random secret for signing cookies and salting visitor hashes. */
export async function appSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const rec = await authRecord();
  return rec?.secret || process.env.DASHBOARD_PASSWORD || 'site-dashboard';
}

export async function passwordConfigured() {
  if (process.env.DASHBOARD_PASSWORD) return true;
  const rec = await authRecord();
  return Boolean(rec?.hash);
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function checkPassword(input) {
  const pw = String(input || '');
  if (process.env.DASHBOARD_PASSWORD) {
    const h = (v) => createHash('sha256').update(v).digest('hex');
    return safeEqual(h(pw), h(process.env.DASHBOARD_PASSWORD));
  }
  const rec = await authRecord();
  if (!rec?.hash) return false;
  const hash = scryptSync(pw, Buffer.from(rec.salt, 'hex'), 32).toString('hex');
  return safeEqual(hash, rec.hash);
}

/** First-visit setup. Only works while no password exists. */
export async function setPassword(input) {
  const pw = String(input || '');
  if (pw.length < 8) throw new Error('密码至少 8 位');
  if (await passwordConfigured()) throw new Error('密码已经设置过了');
  const rec = (await getJson(KEY)) || {};
  const salt = randomBytes(16);
  const next = {
    secret: rec.secret || randomBytes(32).toString('hex'),
    salt: salt.toString('hex'),
    hash: scryptSync(pw, salt, 32).toString('hex'),
    createdAt: new Date().toISOString(),
  };
  await setJson(KEY, next);
  cache = next;
}

async function sign(payload) {
  const key = createHash('sha256').update(`${await appSecret()}:${process.env.DASHBOARD_PASSWORD || ''}`).digest();
  return createHmac('sha256', key).update(payload).digest('base64url');
}

function isLocal(req) {
  return /^(localhost|127\.0\.0\.1)(:|$)/.test(String(req.headers.host || ''));
}

export async function sessionCookie(req) {
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE;
  const payload = Buffer.from(String(exp)).toString('base64url');
  const secure = isLocal(req) ? '' : '; Secure';
  return `${COOKIE}=${payload}.${await sign(payload)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE}${secure}`;
}

export function clearCookie(req) {
  const secure = isLocal(req) ? '' : '; Secure';
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

function readCookie(req, name) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return '';
}

export async function isLoggedIn(req) {
  if (!(await passwordConfigured())) return false;
  const [payload, sig] = readCookie(req, COOKIE).split('.');
  if (!payload || !sig || !safeEqual(sig, await sign(payload))) return false;
  const exp = Number(Buffer.from(payload, 'base64url').toString());
  return Number.isFinite(exp) && exp > Date.now() / 1000;
}

/** Vercel Cron sends "Authorization: Bearer <CRON_SECRET>" when CRON_SECRET is set. */
export function isCron(req) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret) && safeEqual(String(req.headers.authorization || ''), `Bearer ${secret}`);
}

/** Only for tests. */
export function _resetAuthCache() {
  cache = null;
}
