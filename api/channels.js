import { cmd, pipeline, route, readBody, cleanChannel, MAX_CHANNELS } from './_store.js';
import { requireUser, cleanUsername, userKey, publicUser, parseUser } from './_auth.js';
import { getChannel, saveChannel, canManage, channelInfo, chanKey, MAX_CHANNEL_MEMBERS } from './_channels.js';

// GET  /api/channels -> { users } everyone you can add to a channel
// POST /api/channels
//   { action: "create", name, private }
//   { action: "update", name, private?, topic?, add?: [usernames], remove?: [usernames] }
//   { action: "delete", name }
// Whoever creates a channel manages it. Server owner/admins can manage every channel.
export default route(async (req, res) => {
  const me = await requireUser(req, res);
  if (!me) return;

  if (req.method === 'GET') {
    const names = [...new Set(await cmd('LRANGE', 'chat:userlist', 0, -1))];
    const raws = names.length ? await cmd('MGET', ...names.map(userKey)) : [];
    const users = raws.filter(Boolean).map(parseUser).filter((u) => !u.banned).map(publicUser);
    return res.status(200).json({ users });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'GET or POST only' });

  const b = readBody(req);
  const action = b.action || 'create';
  const name = cleanChannel(b.name);
  if (!name) return res.status(400).json({ error: 'Invalid channel name' });
  const existing = await cmd('LRANGE', 'chat:channels', 0, -1);
  const exists = name === 'general' || existing.includes(name);

  if (action === 'create') {
    if (exists) return res.status(409).json({ error: 'A channel with that name already exists' });
    if (existing.length >= MAX_CHANNELS) return res.status(400).json({ error: 'Too many channels' });
    const ch = { name, owner: me.username, private: !!b.private, members: [], topic: '' };
    await pipeline([['SET', chanKey(name), JSON.stringify(ch)], ['RPUSH', 'chat:channels', name]]);
    return res.status(200).json({ channel: channelInfo(ch, me) });
  }

  if (!exists) return res.status(404).json({ error: 'No such channel' });
  const ch = await getChannel(name);
  if (!canManage(ch, me)) return res.status(403).json({ error: "You don't manage this channel" });

  if (action === 'delete') {
    if (name === 'general') return res.status(400).json({ error: "#general can't be deleted" });
    await pipeline([['LREM', 'chat:channels', 0, name], ['DEL', chanKey(name)], ['DEL', `chat:msgs:${name}`]]);
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
      for (const u of add) if (!ch.members.includes(u) && u !== ch.owner) ch.members.push(u);
      if (ch.members.length > MAX_CHANNEL_MEMBERS) return res.status(400).json({ error: `Max ${MAX_CHANNEL_MEMBERS} members` });
    }
    const remove = new Set((Array.isArray(b.remove) ? b.remove : []).map(cleanUsername));
    ch.members = ch.members.filter((u) => !remove.has(u));

    await saveChannel(ch);
    return res.status(200).json({ channel: channelInfo(ch, me) });
  }

  res.status(400).json({ error: 'Unknown action' });
});
