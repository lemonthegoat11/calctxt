import { cmd } from './_store.js';
import { isStaff } from './_auth.js';

export const MAX_CHANNEL_MEMBERS = 100;
export const chanKey = (name) => `chat:chan:${name}`;

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

export async function getChannel(name) {
  return parseChannel(name, await cmd('GET', chanKey(name)));
}

export async function saveChannel(ch) {
  await cmd('SET', chanKey(ch.name), JSON.stringify(ch));
}

// Server owner/admins see every channel (for moderation).
export function canView(ch, user) {
  return !ch.private || isStaff(user) || ch.owner === user.username || ch.members.includes(user.username);
}

export function canManage(ch, user) {
  return isStaff(user) || (!!ch.owner && ch.owner === user.username);
}

// What a client is allowed to see about a channel.
export function channelInfo(ch, user) {
  return {
    name: ch.name,
    owner: ch.owner,
    private: ch.private,
    topic: ch.topic,
    members: ch.private ? ch.members : [],
    canManage: canManage(ch, user),
  };
}
