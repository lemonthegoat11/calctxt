import { pipeline, route, cleanChannel, parseList, ONLINE_WINDOW_MS } from './_store.js';
import { requireUser, userKey, publicUser } from './_auth.js';
import { parseChannel, canView, channelInfo, chanKey } from './_channels.js';

// GET /api/poll?channel=general&after=<ts>
// Returns new messages, the channels you can see, who is online, and profiles for everyone involved.
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
  const names = ['general', ...out[1].filter((c) => c !== 'general')];
  const online = out[4] || [];

  // Load every channel's settings and all needed profiles in one round trip.
  const metaRaws = (await pipeline([['MGET', ...names.map(chanKey)]]))[0];
  const chans = names.map((n, i) => parseChannel(n, metaRaws[i]));
  const visible = chans.filter((c) => canView(c, me));
  const current = chans.find((c) => c.name === channel);
  const allowed = !!current && canView(current, me);
  const recent = allowed ? parseList(out[0]) : [];

  const wanted = [...new Set([...recent.map((m) => m.user), ...online, ...visible.flatMap((c) => [c.owner, ...c.members])].filter(Boolean))];
  const users = {};
  if (wanted.length) {
    const raws = (await pipeline([['MGET', ...wanted.map(userKey)]]))[0];
    raws.forEach((r, i) => { if (r) try { users[wanted[i]] = publicUser(JSON.parse(r)); } catch {} });
  }

  res.status(200).json({
    channel,
    noAccess: !allowed,
    messages: recent.filter((m) => m.ts >= after),
    // ids of the latest messages, so clients can drop ones that were deleted
    ids: recent.map((m) => m.id),
    oldest: recent.length ? recent[0].ts : 0,
    channels: visible.map((c) => channelInfo(c, me)),
    online,
    users,
    now,
  });
});
