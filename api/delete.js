import { cmd, route, readBody, cleanChannel } from './_store.js';
import { requireUser } from './_auth.js';
import { getChannel, canManage } from './_channels.js';
import { loadServer, msgsKey } from './_servers.js';

// POST /api/delete  { server, channel, id }
// Deletes a message: your own, or anyone's in a channel you manage (server owners manage all their channels).
export default route(async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const me = await requireUser(req, res);
  if (!me) return;

  const b = readBody(req);
  const server = await loadServer(res, b.server, me);
  if (!server) return;
  const name = cleanChannel(b.channel) || 'general';
  const key = msgsKey(server.id, name);
  const all = await cmd('LRANGE', key, 0, -1);
  const raw = all.find((s) => { try { return JSON.parse(s).id === b.id; } catch { return false; } });
  if (!raw) return res.status(404).json({ error: 'Message not found' });
  const msg = JSON.parse(raw);
  if (msg.user !== me.username && !canManage(await getChannel(server, name), me, server)) {
    return res.status(403).json({ error: "You can't delete that" });
  }
  await cmd('LREM', key, 1, raw);
  res.status(200).json({ ok: true });
});
