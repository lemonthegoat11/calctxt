import crypto from 'node:crypto';
import { cmd, pipeline } from './_store.js';

const SESSION_TTL = 60 * 60 * 24 * 30; // 30 days
const COLORS = ['#5865f2', '#eb459e', '#ed4245', '#f0b232', '#23a55a', '#00a8fc', '#9b59b6', '#e67e22', '#1abc9c'];

export const userKey = (username) => `chat:user:${username}`;

export function cleanUsername(u) {
  const s = String(u || '').trim().toLowerCase();
  return /^[a-z0-9_.]{3,20}$/.test(s) ? s : null;
}

export function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: crypto.scryptSync(password, salt, 64).toString('hex') };
}

export function verifyPassword(password, salt, hash) {
  const a = crypto.scryptSync(password, salt, 64);
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function randomColor() {
  return COLORS[crypto.randomInt(COLORS.length)];
}

export async function createSession(username) {
  const token = crypto.randomBytes(32).toString('hex');
  await cmd('SET', `chat:sess:${token}`, username, 'EX', SESSION_TTL);
  return token;
}

export function getToken(req) {
  const m = String(req.headers.authorization || '').match(/^Bearer ([a-f0-9]{64})$/);
  return m ? m[1] : null;
}

export async function getSessionUser(req) {
  const token = getToken(req);
  if (!token) return null;
  const username = await cmd('GET', `chat:sess:${token}`);
  if (!username) return null;
  const raw = await cmd('GET', userKey(username));
  if (!raw) return null;
  return JSON.parse(raw);
}

// Returns the logged-in user, or sends 401 and returns null.
export async function requireUser(req, res) {
  const user = await getSessionUser(req);
  if (!user) { res.status(401).json({ error: 'Not logged in' }); return null; }
  return user;
}

export async function saveUser(user) {
  await cmd('SET', userKey(user.username), JSON.stringify(user));
}

export function publicUser(u) {
  return { username: u.username, displayName: u.displayName || u.username, color: u.color, avatar: u.avatar || null };
}

// Look up public profiles for a list of usernames.
export async function getProfiles(usernames) {
  const names = [...new Set(usernames.filter(Boolean))];
  if (!names.length) return {};
  const [raws] = await pipeline([['MGET', ...names.map(userKey)]]);
  const out = {};
  raws.forEach((raw, i) => {
    if (!raw) return;
    try { out[names[i]] = publicUser(JSON.parse(raw)); } catch {}
  });
  return out;
}
