// POST {password}            -> log in
// POST {password, setup:true} -> first visit: set the password, then log in
// DELETE                      -> log out
import { checkPassword, clearCookie, passwordConfigured, sessionCookie, setPassword } from '../lib/auth.js';
import { storeConfigured } from '../lib/store.js';
import { readBody, send } from '../lib/util.js';

export default async function handler(req, res) {
  if (req.method === 'DELETE') return send(res, 200, { ok: true }, { 'Set-Cookie': clearCookie(req) });
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
  if (!storeConfigured() && !process.env.DASHBOARD_PASSWORD) {
    return send(res, 503, { error: '数据库还没连接，连接后才能设置密码。' });
  }
  const { password, setup } = await readBody(req);

  if (setup) {
    try {
      await setPassword(password);
    } catch (err) {
      return send(res, 400, { error: err.message });
    }
    return send(res, 200, { ok: true }, { 'Set-Cookie': await sessionCookie(req) });
  }

  if (!(await passwordConfigured())) return send(res, 409, { error: '还没设置密码' });
  if (!(await checkPassword(password))) {
    await new Promise((r) => setTimeout(r, 600)); // slow down guessing
    return send(res, 401, { error: '密码不对' });
  }
  return send(res, 200, { ok: true }, { 'Set-Cookie': await sessionCookie(req) });
}
