import { cmd, pipeline, route, cleanChannel, readBody, isImageId, MAX_MESSAGES_PER_CHANNEL } from './_store.js';
import { requireUser } from './_auth.js';
import { getChannel, canView } from './_channels.js';
import { loadServer, chanListKey, msgsKey } from './_servers.js';

// POST /api/send  { server, channel, text, image? (id from /api/upload) }
export default route(async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const user = await requireUser(req, res);
  if (!user) return;

  const body = readBody(req);
  const server = await loadServer(res, body.server, user);
  if (!server) return;
  const channel = cleanChannel(body.channel) || 'general';
  const text = String(body.text || '').trim().slice(0, 2000);
  const image = isImageId(body.image) ? body.image : null;
  if (!text && !image) return res.status(400).json({ error: 'Empty message' });
  if (channel !== 'general' && !(await cmd('LRANGE', chanListKey(server.id), 0, -1)).includes(channel)) {
    return res.status(404).json({ error: 'That channel was deleted' });
  }
  if (!canView(await getChannel(server, channel), user, server)) return res.status(403).json({ error: "You're not in this channel" });

  const msg = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    user: user.username,
    text,
    image,
    ts: Date.now(),
  };
  const key = msgsKey(server.id, channel);
  await pipeline([
    ['RPUSH', key, JSON.stringify(msg)],
    ['LTRIM', key, -MAX_MESSAGES_PER_CHANNEL, -1],
  ]);
  res.status(200).json({ message: msg });
});
