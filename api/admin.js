import { cmd, pipeline, route, readBody } from './_store.js';
import { requireUser, isStaff, userKey, cleanUsername, publicUser, saveUser, parseUser, userBanKeys, statusOf } from './_auth.js';

// GET  /api/admin  -> { users: [...], signupsOpen }
// POST /api/admin  { action: "ban" | "unban" | "promote" | "demote" | "approve" | "deny", username, mode?: "normal" | "device" }
//                  { action: "signups", open: true | false }
// Owner: everything. Admins: ban/unban regular members, open/close sign-ups.
export default route(async (req, res) => {
  const me = await requireUser(req, res);
  if (!me) return;
  if (!isStaff(me)) return res.status(403).json({ error: 'Admins only' });

  if (req.method === 'POST') {
    const b = readBody(req);

    if (b.action === 'signups') {
      await cmd('SET', 'chat:signups', b.open ? 'open' : 'closed');
    } else {
      const username = cleanUsername(b.username);
      const raw = username && (await cmd('GET', userKey(username)));
      if (!raw) return res.status(404).json({ error: 'No such user' });
      const target = parseUser(raw);
      if (target.username === me.username) return res.status(400).json({ error: "You can't do that to yourself" });
      if (target.role === 'owner') return res.status(403).json({ error: "The owner can't be changed" });

      if (b.action === 'ban' || b.action === 'unban') {
        if (target.role === 'admin' && me.role !== 'owner') return res.status(403).json({ error: 'Only the owner can ban admins' });
        // Lift any old IP/device ban first (only keys that still point at this user).
        const oldKeys = target.banKeys || [];
        if (oldKeys.length) {
          const owners = await cmd('MGET', ...oldKeys);
          const mine = oldKeys.filter((k, i) => owners[i] === target.username);
          if (mine.length) await cmd('DEL', ...mine);
        }
        target.banKeys = [];
        target.banType = null;
        target.banned = b.action === 'ban';
        if (target.banned) {
          target.role = null;
          await cmd('SREM', 'chat:pending', target.username);
          target.banType = 'normal';
          if (b.mode === 'device') {
            // Block every IP + device they've recently used, so new accounts from there are blocked too.
            const keys = userBanKeys(target);
            if (keys.length) await pipeline(keys.map((k) => ['SET', k, target.username]));
            target.banKeys = keys;
            target.banType = 'device';
          }
        }
      } else if (b.action === 'approve' || b.action === 'deny') {
        target.status = b.action === 'approve' ? 'approved' : 'denied';
        target.reviewedBy = me.username;
        await cmd('SREM', 'chat:pending', target.username);
      } else if (b.action === 'promote' || b.action === 'demote') {
        if (me.role !== 'owner') return res.status(403).json({ error: 'Only the owner can change admins' });
        if (target.banned) return res.status(400).json({ error: 'Unban them first' });
        target.role = b.action === 'promote' ? 'admin' : null;
        if (target.role) { target.status = 'approved'; await cmd('SREM', 'chat:pending', target.username); }
      } else {
        return res.status(400).json({ error: 'Unknown action' });
      }
      await saveUser(target);
    }
  }

  const [names, signups] = await pipeline([['LRANGE', 'chat:userlist', 0, -1], ['GET', 'chat:signups']]);
  const unique = [...new Set(names)];
  const raws = unique.length ? (await pipeline([['MGET', ...unique.map(userKey)]]))[0] : [];
  const users = raws.filter(Boolean).map((r) => {
    const u = parseUser(r);
    return {
      ...publicUser(u), banned: !!u.banned, banType: u.banned ? u.banType || 'normal' : null, created: u.created,
      status: statusOf(u), application: u.application || null,
    };
  });
  res.status(200).json({ users, signupsOpen: signups !== 'closed' });
});
