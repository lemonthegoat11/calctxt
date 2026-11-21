import { pipeline, route, cleanChannel, parseList, ONLINE_WINDOW_MS } from './_store.js';
import { requireUser, userKey, publicUser, parseUser, isStaff } from './_auth.js';
import { parseChannel, canView, channelInfo } from './_channels.js';
import { MAIN, MAIN_SERVER, loadServer, chanListKey, chanKey, msgsKey, memKey, serverInfo, userServers } from './_servers.js';

// GET /api/poll?server=ID&channel=general&after=<ts>&rail=1
// Returns new messages, the channels you can see, who in this server is online, profiles,
// and (when rail=1) the list of servers you're in.
export default route(async (req, res) => {
  const me = await requireUser(req, res);
  if (!me) return;
  const server = await loadServer(res, req.query.server, me);
  if (!server) return;

  const channel = cleanChannel(req.query.channel) || 'general';
  const after = Number(req.query.after) || 0;
  const now = Date.now();

  const out = await pipeline([
    ['LRANGE', msgsKey(server.id, channel), -100, -1],
    ['LRANGE', chanListKey(server.id), 0, -1],
    ['ZADD', 'chat:online', now, me.username],
    ['ZREMRANGEBYSCORE', 'chat:online', 0, now - ONLINE_WINDOW_MS],
    ['ZRANGEBYSCORE', 'chat:online', now - ONLINE_WINDOW_MS, '+inf'],
  ]);
  const names = ['general', ...out[1].filter((c) => c !== 'general')];
  const onlineAll = out[4] || [];

  // Channel settings, and which online people are in this server, in one round trip.
  const second = [['MGET', ...names.map((n) => chanKey(server.id, n))]];
  if (server.id !== MAIN && onlineAll.length) second.push(['SMISMEMBER', memKey(server.id), ...onlineAll]);
  const [metaRaws, inServer] = await pipeline(second);
  const online = server.id === MAIN ? onlineAll : onlineAll.filter((_, i) => inServer && inServer[i]);

  const chans = names.map((n, i) => parseChannel(n, metaRaws[i]));
  const visible = chans.filter((c) => canView(c, me, server));
  const current = chans.find((c) => c.name === channel);
  const allowed = !!current && canView(current, me, server);
  const recent = allowed ? parseList(out[0]) : [];

  const wanted = [...new Set([...recent.map((m) => m.user), ...online, ...visible.flatMap((c) => [c.owner, ...c.members])].filter(Boolean))];
  const users = {};
  if (wanted.length) {
    const raws = (await pipeline([['MGET', ...wanted.map(userKey)]]))[0];
    raws.forEach((r, i) => { if (r) try { users[wanted[i]] = publicUser(parseUser(r)); } catch {} });
  }

  const body = {
    server: serverInfo(server, me),
    channel,
    noAccess: !allowed,
    messages: recent.filter((m) => m.ts >= after),
    // ids of the latest messages, so clients can drop ones that were deleted
    ids: recent.map((m) => m.id),
    oldest: recent.length ? recent[0].ts : 0,
    channels: visible.map((c) => channelInfo(c, me, server)),
    online,
    users,
    now,
  };
  if (isStaff(me)) body.pendingApps = (await pipeline([['SCARD', 'chat:pending']]))[0] || 0;
  if (req.query.rail) {
    body.servers = [serverInfo(MAIN_SERVER, me), ...(await userServers(me.username)).map((s) => serverInfo(s, me))];
  }
  res.status(200).json(body);
});
