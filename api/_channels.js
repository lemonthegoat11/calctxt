import { cmd } from './_store.js';
import { isStaff } from './_auth.js';
import { MAIN, chanKey } from './_servers.js';

export const MAX_CHANNEL_MEMBERS = 100;
export { chanKey };

// Channel settings. Channels made before this feature (and #general) have none: public, no owner.
export function parseChannel(name, raw) {
  let meta = {};
  try { meta = raw ? JSON.parse(raw) : {}; } catch {}
  return {
    name,
    owner: meta.owner || null,
    private: name !== 'general' && !!meta.private,
    members: Array.isArray(meta.members) ? meta.members : [],
    topic: meta.topic || '',
  };
}

export async function getChannel(server, name) {
  return parseChannel(name, await cmd('GET', chanKey(server.id, name)));
}

export async function saveChannel(server, ch) {
  await cmd('SET', chanKey(server.id, ch.name), JSON.stringify(ch));
}

// Who runs the server: Home = site owner/admins, other servers = their creator.
const serverBoss = (server, user) => (server.id === MAIN ? isStaff(user) : server.owner === user.username);

// (Membership of the server itself is checked before these are called.)
export function canView(ch, user, server) {
  return !ch.private || serverBoss(server, user) || ch.owner === user.username || ch.members.includes(user.username);
}

export function canManage(ch, user, server) {
  return serverBoss(server, user) || (!!ch.owner && ch.owner === user.username);
}

// What a client is allowed to see about a channel.
export function channelInfo(ch, user, server) {
  return {
    name: ch.name,
    owner: ch.owner,
    private: ch.private,
    topic: ch.topic,
    members: ch.private ? ch.members : [],
    canManage: canManage(ch, user, server),
  };
}
