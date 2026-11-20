// Storage helper. Uses Upstash Redis (REST) when its env vars are present,
// otherwise an in-memory store for local development / testing.
// Files starting with "_" in /api are not exposed as routes on Vercel.

const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

export const MAX_MESSAGES_PER_CHANNEL = 500;
export const MAX_CHANNELS = 50;
export const ONLINE_WINDOW_MS = 30_000;

export async function pipeline(cmds) {
  if (REDIS_URL && REDIS_TOKEN) {
    const r = await fetch(`${REDIS_URL.replace(/\/$/, '')}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(cmds.map((c) => c.map(String))),
    });
    if (!r.ok) throw new Error(`Database error (${r.status})`);
    const out = await r.json();
    return out.map((x) => {
      if (x.error) throw new Error(x.error);
      return x.result;
    });
  }
  if (process.env.VERCEL) {
    throw new Error('Database not connected. Add an Upstash Redis store in your Vercel project (Storage tab) and redeploy.');
  }
  return cmds.map((c) => memExec(c.map(String)));
}

export async function cmd(...args) {
  return (await pipeline([args]))[0];
}

// ---------- in-memory fallback ----------
const mem = globalThis.__chatMem || (globalThis.__chatMem = { lists: {}, zsets: {}, sets: {}, strings: new Map(), expires: new Map() });
mem.sets ||= {};

function range(start, stop, len) {
  let s = +start, e = +stop;
  if (s < 0) s = Math.max(len + s, 0);
  if (e < 0) e = len + e;
  return [s, Math.min(e, len - 1) + 1];
}
function strGet(key) {
  const exp = mem.expires.get(key);
  if (exp && exp <= Date.now()) { mem.strings.delete(key); mem.expires.delete(key); }
  return mem.strings.has(key) ? mem.strings.get(key) : null;
}

function memExec([op, key, ...args]) {
  op = op.toUpperCase();
  const list = () => (mem.lists[key] ||= []);
  const zset = () => (mem.zsets[key] ||= new Map());
  const set = () => (mem.sets[key] ||= new Set());
  switch (op) {
    case 'GET': return strGet(key);
    case 'MGET': return [key, ...args].map(strGet);
    case 'SADD': { const s = set(); const n = s.size; args.forEach((a) => s.add(a)); return s.size - n; }
    case 'SREM': { const s = set(); return args.reduce((n, a) => n + (s.delete(a) ? 1 : 0), 0); }
    case 'SISMEMBER': return set().has(args[0]) ? 1 : 0;
    case 'SMISMEMBER': return args.map((a) => (set().has(a) ? 1 : 0));
    case 'SMEMBERS': return [...set()];
    case 'SCARD': return set().size;
    case 'SET': {
      const [val, ...opts] = args;
      const up = opts.map((o) => o.toUpperCase());
      if (up.includes('NX') && strGet(key) !== null) return null;
      mem.strings.set(key, val);
      const ex = up.indexOf('EX');
      if (ex >= 0) mem.expires.set(key, Date.now() + +opts[ex + 1] * 1000); else mem.expires.delete(key);
      return 'OK';
    }
    case 'DEL': return [key, ...args].reduce((n, k) => {
      let hit = mem.strings.delete(k);
      for (const t of [mem.lists, mem.sets, mem.zsets]) if (k in t) { delete t[k]; hit = true; }
      return n + (hit ? 1 : 0);
    }, 0);
    case 'INCR': { const v = (+strGet(key) || 0) + 1; mem.strings.set(key, String(v)); return v; }
    case 'EXPIRE': mem.expires.set(key, Date.now() + +args[0] * 1000); return 1;
    case 'RPUSH': list().push(...args); return list().length;
    case 'LRANGE': { const l = list(); const [s, e] = range(args[0], args[1], l.length); return e > s ? l.slice(s, e) : []; }
    case 'LREM': {
      const l = list(); let n = 0; const max = +args[0] || Infinity;
      mem.lists[key] = l.filter((v) => (v === args[1] && n < max ? (n++, false) : true));
      return n;
    }
    case 'LTRIM': { const l = list(); const [s, e] = range(args[0], args[1], l.length); mem.lists[key] = e > s ? l.slice(s, e) : []; return 'OK'; }
    case 'ZADD': zset().set(args[1], +args[0]); return 1;
    case 'ZREMRANGEBYSCORE': {
      const lo = +args[0], hi = args[1] === '+inf' ? Infinity : +args[1];
      for (const [m, s] of zset()) if (s >= lo && s <= hi) zset().delete(m);
      return 'OK';
    }
    case 'ZRANGEBYSCORE': {
      const lo = +args[0], hi = args[1] === '+inf' ? Infinity : +args[1];
      return [...zset()].filter(([, s]) => s >= lo && s <= hi).sort((a, b) => a[1] - b[1]).map(([m]) => m);
    }
    default: throw new Error(`Unsupported command ${op}`);
  }
}

// ---------- shared helpers ----------
export function cleanChannel(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24);
}
export function cleanDisplayName(name) {
  return String(name || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 32);
}
export function cleanColor(c) {
  return /^#[0-9a-f]{6}$/i.test(String(c)) ? String(c) : '#5865f2';
}
export const isImageId = (id) => /^[a-f0-9]{24}$/.test(String(id || ''));

export function parseList(arr) {
  return (arr || []).map((s) => { try { return JSON.parse(s); } catch { return null; } }).filter(Boolean);
}
export function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body || '{}'); } catch { return {}; }
}

// Wraps a handler with no-cache headers and error handling.
export function route(fn) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try { await fn(req, res); }
    catch (e) { res.status(500).json({ error: e.message || 'Server error' }); }
  };
}
