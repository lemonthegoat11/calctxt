import { pipeline, route, cleanChannel, parseList, ONLINE_WINDOW_MS } from './_store.js';
import { requireUser, getProfiles } from './_auth.js';

// GET /api/poll?channel=general&after=<ts>
// Returns new messages, the channel list, who is online, and profiles for everyone involved.
export default route(async (req, res) => {
  const me = await requireUser(req, res);
  if (!me) return;

  const channel = cleanChannel(req.query.channel) || 'general';
  const after = Number(req.query.after) || 0;
  const now = Date.now();

  const out = await pipeline([
    ['LRANGE', `chat:msgs:${channel}`, -100, -1],
    ['LRANGE', 'chat:channels', 0, -1],
    ['ZADD', 'chat:online', now, me.username],
    ['ZREMRANGEBYSCORE', 'chat:online', 0, now - ONLINE_WINDOW_MS],
    ['ZRANGEBYSCORE', 'chat:online', now - ONLINE_WINDOW_MS, '+inf'],
  ]);
  const recent = parseList(out[0]);
  const online = out[4] || [];
  const users = await getProfiles([...recent.map((m) => m.user), ...online]);

  res.status(200).json({
    messages: recent.filter((m) => m.ts >= after),
    channels: ['general', ...out[1].filter((c) => c !== 'general')],
    online,
    users,
    now,
  });
});
