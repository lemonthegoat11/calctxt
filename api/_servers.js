import crypto from 'node:crypto';
import { cmd, pipeline } from './_store.js';
import { isStaff } from './_auth.js';

// "main" is the Home server everyone is in (the original chat, so its old Redis keys are kept).
// Every other server is invite-only: you only see it if you're in its member set.
export const MAIN = 'main';
export const MAIN_SERVER = { id: MAIN, name: 'Hideout', icon: null, owner: null, invite: null, bans: [] };
export const MAX_SERVER_MEMBERS = 1000;
export const MAX_OWNED_SERVERS = 10;
export const MAX_JOINED_SERVERS = 100;

export const cleanServerId = (s) => {
  const v = String(s || MAIN);
  return v === MAIN || /^[a-f0-9]{12}$/.test(v) ? v : null;
};
export const newServerId = () => crypto.randomBytes(6).toString('hex');
export const newInvite = () => {
  const abc = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(crypto.randomBytes(8), (b) => abc[b % abc.length]).join('');
};
// Accepts a code, or a whole link like https://site/?invite=CODE
export function parseInvite(s) {
  const str = String(s || '').trim();
  const m = str.match(/[?&]invite=([A-Za-z0-9]{6,16})/) || str.match(/^([A-Za-z0-9]{6,16})$/);
  return m ? m[1] : null;
}

export const srvKey = (id) => `chat:srv:${id}`;
export const memKey = (id) => `chat:srvmem:${id}`;
export const userSrvKey = (u) => `chat:usrv:${u}`;
export const invKey = (code) => `chat:inv:${code}`;
export const chanListKey = (sid) => (sid === MAIN ? 'chat:channels' : `chat:srvch:${sid}`);
export const chanKey = (sid, name) => (sid === MAIN ? `chat:chan:${name}` : `chat:chan:${sid}:${name}`);
export const msgsKey = (sid, name) => (sid === MAIN ? `chat:msgs:${name}` : `chat:msgs:${sid}:${name}`);

export function parseServer(raw) {
  if (!raw) return null;
  try {
    const s = JSON.parse(raw);
    return { bans: [], icon: null, ...s };
  } catch { return null; }
}

export async function getServer(id) {
  if (id === MAIN) return MAIN_SERVER;
  return parseServer(await cmd('GET', srvKey(id)));
}

export async function saveServer(s) {
  await cmd('SET', srvKey(s.id), JSON.stringify(s));
}

export async function isMember(server, username) {
  if (server.id === MAIN) return true;
  return (await cmd('SISMEMBER', memKey(server.id), username)) === 1;
}

// Home server: site owner/admins. Other servers: whoever made it.
export function ownsServer(server, user) {
  return server.id === MAIN ? isStaff(user) : server.owner === user.username;
}

// What a member's client gets to know about a server.
export function serverInfo(server, user) {
  return {
    id: server.id,
    name: server.name,
    icon: server.icon || null,
    owner: server.owner,
    invite: server.id === MAIN ? null : server.invite,
    isOwner: server.id !== MAIN && server.owner === user.username,
    canCreateChannels: server.id === MAIN || server.owner === user.username,
  };
}

// Loads ?server= for the logged-in user, or sends an error and returns null.
export async function loadServer(res, rawId, me) {
  const id = cleanServerId(rawId);
  if (!id) { res.status(400).json({ error: 'Invalid server' }); return null; }
  const server = await getServer(id);
  if (!server || !(await isMember(server, me.username))) {
    res.status(403).json({ error: 'That server was deleted or you were removed from it.', noServer: true });
    return null;
  }
  return server;
}

// The servers a user is in (for the left rail). Drops deleted/left ones from their list.
export async function userServers(username) {
  const ids = [...new Set(await cmd('LRANGE', userSrvKey(username), 0, -1))].filter((id) => cleanServerId(id) && id !== MAIN);
  if (!ids.length) return [];
  const out = await pipeline([['MGET', ...ids.map(srvKey)], ...ids.map((id) => ['SISMEMBER', memKey(id), username])]);
  const raws = out[0];
  const keep = [];
  const stale = [];
  ids.forEach((id, i) => {
    const s = parseServer(raws[i]);
    if (s && out[i + 1] === 1) keep.push(s); else stale.push(id);
  });
  if (stale.length) await pipeline(stale.map((id) => ['LREM', userSrvKey(username), 0, id]));
  return keep;
}
