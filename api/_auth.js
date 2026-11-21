import crypto from 'node:crypto';
import { cmd, pipeline } from './_store.js';

const SESSION_TTL = 60 * 60 * 24 * 30; // 30 days
const COLORS = ['#5865f2', '#eb459e', '#ed4245', '#f0b232', '#23a55a', '#00a8fc', '#9b59b6', '#e67e22', '#1abc9c'];

export const userKey = (username) => `chat:user:${username}`;

// OWNER_USERNAME (env var, set on Render/Vercel) always makes that account the owner,
// no matter who signed up first. When it's set, nobody else can be owner.
const OWNER = String(process.env.OWNER_USERNAME || '').trim().toLowerCase().replace(/^@/, '');

export function applyOwner(user) {
  if (!OWNER || !user) return user;
  if (user.username === OWNER) { user.role = 'owner'; user.banned = false; }
  else if (user.role === 'owner') user.role = null;
  return user;
}

export function parseUser(raw) {
  return applyOwner(JSON.parse(raw));
}

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
  return parseUser(raw);
}

export const BANNED_MSG = 'You have been banned from this server.';
export const isStaff = (u) => u && (u.role === 'owner' || u.role === 'admin');

/* ---------- device bans ----------
   Browsers can't read real hardware IDs, so a "device" is a random ID the page keeps in
   localStorage + a cookie and sends as X-Device. IP addresses are not used or stored. */
export function deviceId(req) {
  const d = String(req.headers['x-device'] || '').toLowerCase();
  return /^[a-f0-9]{32}$/.test(d) ? d : null;
}
const devKey = (d) => 'chat:bdev:' + d;

// True if this request comes from a device that's banned.
export async function isBlocked(req) {
  const d = deviceId(req);
  if (!d) return false;
  return !!(await cmd('GET', devKey(d)));
}

// Remember the last few devices a user used, so they can be device banned later.
export async function trackUser(user, req) {
  const d = deviceId(req);
  const devs = user.seenDevices || [];
  const hadIps = 'seenIps' in user; // left over from the old IP bans: drop it
  if ((!d || devs.includes(d)) && !hadIps) return;
  if (d && !devs.includes(d)) devs.unshift(d);
  user.seenDevices = devs.slice(0, 5);
  delete user.seenIps;
  await saveUser(user);
}

// Keys to write for a device ban of this user.
export function userBanKeys(user) {
  return (user.seenDevices || []).map(devKey);
}

/* ---------- applications ----------
   New accounts start "pending" and must fill out an application that an admin approves.
   Accounts from before this feature have no status and count as approved. Staff are always approved. */
export function statusOf(user) {
  if (isStaff(user)) return 'approved';
  return user.status || 'approved';
}

// What the logged-in user gets back about themselves.
export function meView(u) {
  return { ...fullProfile(u), status: statusOf(u), applied: !!u.application };
}

// Returns the logged-in user, or sends 401/403 and returns null.
// allowPending: let not-yet-approved users through (only for /api/me and /api/apply).
export async function requireUser(req, res, { allowPending = false } = {}) {
  const user = await getSessionUser(req);
  if (!user) { res.status(401).json({ error: 'Not logged in' }); return null; }
  if (user.banned) { res.status(403).json({ error: BANNED_MSG, banned: true }); return null; }
  // Staff are never locked out by a device ban (e.g. you shared a computer with someone you banned).
  if (!isStaff(user) && (await isBlocked(req))) { res.status(403).json({ error: BANNED_MSG, banned: true }); return null; }
  const status = statusOf(user);
  if (status !== 'approved' && !allowPending) {
    res.status(403).json({
      error: status === 'denied' ? 'Your application was denied.' : 'Your application is waiting for approval.',
      pending: true, status, applied: !!user.application,
    });
    return null;
  }
  await trackUser(user, req);
  return user;
}

export async function saveUser(user) {
  await cmd('SET', userKey(user.username), JSON.stringify(user));
}

export function publicUser(u) {
  return { username: u.username, displayName: u.displayName || u.username, color: u.color, avatar: u.avatar || null, role: u.role || null };
}

// What shows on someone's profile card (bio isn't sent with every poll to keep it small).
export function fullProfile(u) {
  return { ...publicUser(u), bio: u.bio || '', created: u.created || null };
}

export function cleanBio(s) {
  return String(s || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 190);
}

// Look up public profiles for a list of usernames.
export async function getProfiles(usernames) {
  const names = [...new Set(usernames.filter(Boolean))];
  if (!names.length) return {};
  const [raws] = await pipeline([['MGET', ...names.map(userKey)]]);
  const out = {};
  raws.forEach((raw, i) => {
    if (!raw) return;
    try { out[names[i]] = publicUser(parseUser(raw)); } catch {}
  });
  return out;
}
