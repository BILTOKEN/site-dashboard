// Which pieces are configured. Used by the login screen and the setup notes.
import { isLoggedIn, passwordConfigured } from '../lib/auth.js';
import { bingConfigured } from '../lib/bing.js';
import { googleConfigured, serviceAccountEmail } from '../lib/google.js';
import { storeConfigured } from '../lib/store.js';
import { send } from '../lib/util.js';

export default async function handler(req, res) {
  const store = storeConfigured();
  const password = store || process.env.DASHBOARD_PASSWORD ? await passwordConfigured() : false;
  const loggedIn = password ? await isLoggedIn(req) : false;
  return send(res, 200, {
    loggedIn,
    configured: { store, password, google: googleConfigured(), bing: bingConfigured() },
    serviceAccountEmail: loggedIn ? serviceAccountEmail() : undefined,
    memoryStore: loggedIn ? process.env.MEMORY_STORE === '1' || (!process.env.KV_REST_API_URL && !process.env.UPSTASH_REDIS_REST_URL) : undefined,
  });
}
