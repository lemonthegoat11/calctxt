import { cmd, pipeline, route, readBody, isImageId } from './_store.js';
import { requireUser, cleanUsername, userKey, publicUser, parseUser } from './_auth.js';
import {
  MAIN, MAX_SERVER_MEMBERS, MAX_OWNED_SERVERS, MAX_JOINED_SERVERS,
  cleanServerId, newServerId, newInvite, parseInvite, srvKey, memKey, userSrvKey, invKey,
  chanListKey, chanKey, msgsKey, getServer, saveServer, isMember, serverInfo, userServers, loadServer,
} from './_servers.js';

const cleanServerName = (s) => String(s || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 40);

async function serverByInvite(code) {
  const id = code && (await cmd('GET', invKey(code)));
  return id ? getServer(id) : null;
}

// GET  /api/servers?invite=CODE   -> preview of the server an invite points to
// GET  /api/servers?id=ID         -> member list (members only; bans for the owner)
// POST /api/servers
//   { action: "create", name, icon? }          { action: "join", invite }
//   { action: "leave", server }                { action: "update", server, name?, icon? }
//   { action: "resetInvite", server }          { action: "delete", server }
//   { action: "kick" | "ban" | "unban", server, username }
export default route(async (req, res) => {
  const me = await requireUser(req, res);
  if (!me) return;

  if (req.method === 'GET') {
    if (req.query.invite !== undefined) {
      const server = await serverByInvite(parseInvite(req.query.invite));
      if (!server) return res.status(404).json({ error: 'This invite is invalid or has been reset.' });
      const [count, joined] = await pipeline([['SCARD', memKey(server.id)], ['SISMEMBER', memKey(server.id), me.username]]);
      return res.status(200).json({ server: { id: server.id, name: server.name, icon: server.icon, members: count }, joined: joined === 1 });
    }
    const server = await loadServer(res, req.query.id, me);
    if (!server) return;
    if (server.id === MAIN) return res.status(200).json({ members: [], bans: [] });
    const names = await cmd('SMEMBERS', memKey(server.id));
    const isOwner = server.owner === me.username;
    const all = [...new Set([...names, ...(isOwner ? server.bans : [])])];
    const raws = all.length ? await cmd('MGET', ...all.map(userKey)) : [];
    const profiles = {};
    raws.forEach((r, i) => { if (r) profiles[all[i]] = publicUser(parseUser(r)); });
    const prof = (n) => profiles[n] || { username: n, displayName: n };
    return res.status(200).json({
      members: names.map(prof),
      bans: isOwner ? server.bans.map(prof) : [],
    });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'GET or POST only' });

  const b = readBody(req);

  if (b.action === 'create') {
    const name = cleanServerName(b.name);
    if (!name) return res.status(400).json({ error: 'Give your server a name' });
    const mine = await userServers(me.username);
    if (mine.filter((s) => s.owner === me.username).length >= MAX_OWNED_SERVERS) {
      return res.status(400).json({ error: `You can own up to ${MAX_OWNED_SERVERS} servers` });
    }
    if (mine.length >= MAX_JOINED_SERVERS) return res.status(400).json({ error: "You're in too many servers" });
    const server = { id: newServerId(), name, icon: isImageId(b.icon) ? b.icon : null, owner: me.username, invite: newInvite(), bans: [], created: Date.now() };
    await pipeline([
      ['SET', srvKey(server.id), JSON.stringify(server)],
      ['SET', invKey(server.invite), server.id],
      ['SADD', memKey(server.id), me.username],
      ['RPUSH', userSrvKey(me.username), server.id],
    ]);
    return res.status(200).json({ server: serverInfo(server, me) });
  }

  if (b.action === 'join') {
    const server = await serverByInvite(parseInvite(b.invite));
    if (!server) return res.status(404).json({ error: 'This invite is invalid or has been reset.' });
    if (server.bans.includes(me.username)) return res.status(403).json({ error: "You're banned from this server" });
    if (!(await isMember(server, me.username))) {
      const [count, joinedList] = await pipeline([['SCARD', memKey(server.id)], ['LRANGE', userSrvKey(me.username), 0, -1]]);
      if (count >= MAX_SERVER_MEMBERS) return res.status(400).json({ error: 'This server is full' });
      if (joinedList.length >= MAX_JOINED_SERVERS) return res.status(400).json({ error: "You're in too many servers. Leave one first." });
      await pipeline([
        ['SADD', memKey(server.id), me.username],
        ['LREM', userSrvKey(me.username), 0, server.id],
        ['RPUSH', userSrvKey(me.username), server.id],
      ]);
    }
    return res.status(200).json({ server: serverInfo(server, me) });
  }

  // Everything below acts on a server you're in.
  const id = cleanServerId(b.server);
  if (!id || id === MAIN) return res.status(400).json({ error: "You can't do that to the Home server" });
  const server = await loadServer(res, id, me);
  if (!server) return;
  const isOwner = server.owner === me.username;

  if (b.action === 'leave') {
    if (isOwner) return res.status(400).json({ error: "You own this server. Delete it instead, or it'd have no owner." });
    await pipeline([['SREM', memKey(id), me.username], ['LREM', userSrvKey(me.username), 0, id]]);
    return res.status(200).json({ ok: true });
  }

  if (!isOwner) return res.status(403).json({ error: 'Only the server owner can do that' });

  if (b.action === 'update') {
    if (b.name !== undefined) {
      const name = cleanServerName(b.name);
      if (!name) return res.status(400).json({ error: 'Give your server a name' });
      server.name = name;
    }
    if (b.icon !== undefined) server.icon = isImageId(b.icon) ? b.icon : null;
    await saveServer(server);
    return res.status(200).json({ server: serverInfo(server, me) });
  }

  if (b.action === 'resetInvite') {
    const old = server.invite;
    server.invite = newInvite();
    await pipeline([['DEL', invKey(old)], ['SET', invKey(server.invite), id], ['SET', srvKey(id), JSON.stringify(server)]]);
    return res.status(200).json({ server: serverInfo(server, me) });
  }

  if (b.action === 'delete') {
    const chans = ['general', ...(await cmd('LRANGE', chanListKey(id), 0, -1))];
    await pipeline([
      ['DEL', srvKey(id), invKey(server.invite), memKey(id), chanListKey(id)],
      ['DEL', ...chans.map((c) => chanKey(id, c)), ...chans.map((c) => msgsKey(id, c))],
      ['LREM', userSrvKey(me.username), 0, id],
    ]);
    return res.status(200).json({ ok: true });
  }

  if (b.action === 'kick' || b.action === 'ban' || b.action === 'unban') {
    const username = cleanUsername(b.username);
    if (!username) return res.status(400).json({ error: 'No such user' });
    if (username === me.username) return res.status(400).json({ error: "You can't do that to yourself" });
    if (b.action === 'unban') {
      server.bans = server.bans.filter((u) => u !== username);
      await saveServer(server);
    } else {
      if (b.action === 'ban' && !server.bans.includes(username)) {
        server.bans.push(username);
        await saveServer(server);
      }
      await pipeline([['SREM', memKey(id), username], ['LREM', userSrvKey(username), 0, id]]);
    }
    return res.status(200).json({ ok: true });
  }

  res.status(400).json({ error: 'Unknown action' });
});
