// Tiny Redis client. In production it talks to Upstash over its REST API
// (no npm package needed). Without credentials, or with MEMORY_STORE=1, it
// falls back to an in-memory store so the app can run locally and in tests.

const URL_ENV = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '';
const TOKEN_ENV = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';

export function storeConfigured() {
  return Boolean(URL_ENV && TOKEN_ENV) || process.env.MEMORY_STORE === '1';
}

// ------------------------------------------------------------ memory store

const mem = globalThis.__memStore || (globalThis.__memStore = new Map());

function memExec([cmd, ...args]) {
  const c = String(cmd).toUpperCase();
  const get = (k, make) => {
    if (!mem.has(k) && make) mem.set(k, make());
    return mem.get(k);
  };
  switch (c) {
    case 'GET':
      return mem.has(args[0]) ? mem.get(args[0]) : null;
    case 'SET':
      mem.set(args[0], String(args[1]));
      return 'OK';
    case 'DEL':
      return args.reduce((n, k) => n + (mem.delete(k) ? 1 : 0), 0);
    case 'EXPIRE':
      return 1;
    case 'HSET': {
      const h = get(args[0], () => new Map());
      let added = 0;
      for (let i = 1; i < args.length; i += 2) {
        if (!h.has(args[i])) added++;
        h.set(args[i], String(args[i + 1]));
      }
      return added;
    }
    case 'HGET': {
      const h = get(args[0]);
      return h && h.has(args[1]) ? h.get(args[1]) : null;
    }
    case 'HDEL': {
      const h = get(args[0]);
      return h ? args.slice(1).reduce((n, f) => n + (h.delete(f) ? 1 : 0), 0) : 0;
    }
    case 'HEXISTS': {
      const h = get(args[0]);
      return h && h.has(args[1]) ? 1 : 0;
    }
    case 'HGETALL': {
      const h = get(args[0]);
      return h ? [...h.entries()].flat() : [];
    }
    case 'HKEYS': {
      const h = get(args[0]);
      return h ? [...h.keys()] : [];
    }
    case 'HINCRBY': {
      const h = get(args[0], () => new Map());
      const v = Number(h.get(args[1]) || 0) + Number(args[2]);
      h.set(args[1], String(v));
      return v;
    }
    case 'PFADD': {
      const s = get(args[0], () => new Set());
      const before = s.size;
      args.slice(1).forEach((x) => s.add(x));
      return s.size > before ? 1 : 0;
    }
    case 'PFCOUNT': {
      const all = new Set();
      args.forEach((k) => (get(k) || new Set()).forEach((x) => all.add(x)));
      return all.size;
    }
    case 'LPUSH': {
      const l = get(args[0], () => []);
      args.slice(1).forEach((x) => l.unshift(String(x)));
      return l.length;
    }
    case 'LTRIM': {
      const l = get(args[0]);
      if (!l) return 'OK';
      const start = Number(args[1]);
      const stop = Number(args[2]);
      mem.set(args[0], l.slice(start, stop === -1 ? undefined : stop + 1));
      return 'OK';
    }
    case 'LRANGE': {
      const l = get(args[0]) || [];
      const stop = Number(args[2]);
      return l.slice(Number(args[1]), stop === -1 ? undefined : stop + 1);
    }
    default:
      throw new Error(`memory store: unsupported command ${c}`);
  }
}

// ------------------------------------------------------------ public api

const useMemory = () => process.env.MEMORY_STORE === '1' || !(URL_ENV && TOKEN_ENV);

/** Run one command, e.g. cmd('HGET', 'sites', 'abc'). */
export async function cmd(...args) {
  const [res] = await pipeline([args]);
  return res;
}

/** Run several commands in one round trip. Returns their results in order. */
export async function pipeline(commands) {
  if (!commands.length) return [];
  const clean = commands.map((c) => c.map((x) => (typeof x === 'number' ? String(x) : x)));
  if (useMemory()) return clean.map(memExec);

  const res = await fetch(`${URL_ENV.replace(/\/$/, '')}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN_ENV}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(clean),
  });
  if (!res.ok) throw new Error(`Redis HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const out = await res.json();
  return out.map((r) => {
    if (r && r.error) throw new Error(`Redis: ${r.error}`);
    return r ? r.result : null;
  });
}

/** Redis returns HGETALL as [k1, v1, k2, v2...]; turn it into an object. */
export function toObject(flat) {
  const o = {};
  if (!Array.isArray(flat)) return flat || {};
  for (let i = 0; i < flat.length; i += 2) o[flat[i]] = flat[i + 1];
  return o;
}

export async function getJson(key) {
  const v = await cmd('GET', key);
  if (v == null) return null;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
}

export async function setJson(key, value) {
  return cmd('SET', key, JSON.stringify(value));
}

/** Only for tests. */
export function _resetMemory() {
  mem.clear();
}
