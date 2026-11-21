import { cmd, pipeline, route, readBody, cleanChannel, MAX_CHANNELS } from './_store.js';
import { requireUser, cleanUsername, userKey, publicUser, parseUser, statusOf } from './_auth.js';
import { getChannel, saveChannel, canManage, channelInfo, MAX_CHANNEL_MEMBERS } from './_channels.js';
import { MAIN, loadServer, chanListKey, chanKey, msgsKey, memKey } from './_servers.js';

// GET  /api/channels?server=ID -> { users } everyone in the server (for adding people to channels)
// POST /api/channels  (all take server: ID, default "main" = Home)
//   { action: "create", name, private }
//   { action: "update", name, private?, topic?, add?: [usernames], remove?: [usernames] }
//   { action: "delete", name }
// Home: anyone can create channels. Other servers: only the server owner.
// Whoever creates a channel manages it; the server owner manages every channel in their server.
export default route(async (req, res) => {
  const me = await requireUser(req, res);
  if (!me) return;
  const b = req.method === 'POST' ? readBody(req) : {};
  const server = await loadServer(res, req.method === 'POST' ? b.server : req.query.server, me);
  if (!server) return;

  if (req.method === 'GET') {
    const names = server.id === MAIN
      ? [...new Set(await cmd('LRANGE', 'chat:userlist', 0, -1))]
      : await cmd('SMEMBERS', memKey(server.id));
    const raws = names.length ? await cmd('MGET', ...names.map(userKey)) : [];
    const users = raws.filter(Boolean).map(parseUser).filter((u) => !u.banned && statusOf(u) === 'approved').map(publicUser);
    return res.status(200).json({ users });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'GET or POST only' });

  const action = b.action || 'create';
  const name = cleanChannel(b.name);
  if (!name) return res.status(400).json({ error: 'Invalid channel name' });
  const listKey = chanListKey(server.id);
  const existing = await cmd('LRANGE', listKey, 0, -1);
  const exists = name === 'general' || existing.includes(name);

  if (action === 'create') {
    if (server.id !== MAIN && server.owner !== me.username) return res.status(403).json({ error: 'Only the server owner can make channels' });
    if (exists) return res.status(409).json({ error: 'A channel with that name already exists' });
    if (existing.length >= MAX_CHANNELS) return res.status(400).json({ error: 'Too many channels' });
    const ch = { name, owner: me.username, private: !!b.private, members: [], topic: '' };
    await pipeline([['SET', chanKey(server.id, name), JSON.stringify(ch)], ['RPUSH', listKey, name]]);
    return res.status(200).json({ channel: channelInfo(ch, me, server) });
  }

  if (!exists) return res.status(404).json({ error: 'No such channel' });
  const ch = await getChannel(server, name);
  if (!canManage(ch, me, server)) return res.status(403).json({ error: "You don't manage this channel" });

  if (action === 'delete') {
    if (name === 'general') return res.status(400).json({ error: "#general can't be deleted" });
    await pipeline([['LREM', listKey, 0, name], ['DEL', chanKey(server.id, name)], ['DEL', msgsKey(server.id, name)]]);
    return res.status(200).json({ ok: true });
  }

  if (action === 'update') {
    if (b.private !== undefined) {
      if (name === 'general' && b.private) return res.status(400).json({ error: '#general is always public' });
      ch.private = !!b.private;
    }
    if (b.topic !== undefined) ch.topic = String(b.topic).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 120);

    const add = (Array.isArray(b.add) ? b.add : []).map(cleanUsername).filter(Boolean);
    if (add.length) {
      const raws = await cmd('MGET', ...add.map(userKey));
      const missing = add.filter((u, i) => !raws[i]);
      if (missing.length) return res.status(404).json({ error: `No user called @${missing[0]}` });
      if (server.id !== MAIN) {
        const inServer = await cmd('SMISMEMBER', memKey(server.id), ...add);
        const outsider = add.find((u, i) => !inServer[i]);
        if (outsider) return res.status(400).json({ error: `@${outsider} isn't in this server. Send them the invite link first.` });
      }
      for (const u of add) if (!ch.members.includes(u) && u !== ch.owner) ch.members.push(u);
      if (ch.members.length > MAX_CHANNEL_MEMBERS) return res.status(400).json({ error: `Max ${MAX_CHANNEL_MEMBERS} members` });
    }
    const remove = new Set((Array.isArray(b.remove) ? b.remove : []).map(cleanUsername));
    ch.members = ch.members.filter((u) => !remove.has(u));

    await saveChannel(server, ch);
    return res.status(200).json({ channel: channelInfo(ch, me, server) });
  }

  res.status(400).json({ error: 'Unknown action' });
});
