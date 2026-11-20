import { pipeline, route, cleanChannel, readBody, MAX_CHANNELS } from './_store.js';
import { requireUser } from './_auth.js';

// POST /api/channels  { name }  -> creates a channel
export default route(async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!(await requireUser(req, res))) return;

  const name = cleanChannel(readBody(req).name);
  if (!name) return res.status(400).json({ error: 'Invalid channel name' });
  const [existing] = await pipeline([['LRANGE', 'chat:channels', 0, -1]]);
  if (name !== 'general' && !existing.includes(name)) {
    if (existing.length >= MAX_CHANNELS) return res.status(400).json({ error: 'Too many channels' });
    await pipeline([['RPUSH', 'chat:channels', name]]);
  }
  res.status(200).json({ channel: name });
});
