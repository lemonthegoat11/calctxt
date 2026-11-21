import { cmd, pipeline, route, readBody, cleanDisplayName } from './_store.js';
import {
  cleanUsername, hashPassword, verifyPassword, randomColor, createSession,
  getToken, userKey, publicUser, saveUser, BANNED_MSG, parseUser, applyOwner,
  isBlocked, trackUser, isStaff, meView,
} from './_auth.js';

const MAX_FAILS = 10;           // failed logins per username...
const FAIL_WINDOW = 15 * 60;    // ...per 15 minutes

// POST /api/auth  { action: "register" | "login" | "logout", username, password, displayName }
export default route(async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const body = readBody(req);
  const action = body.action;

  if (action === 'logout') {
    const token = getToken(req);
    if (token) await cmd('DEL', `chat:sess:${token}`);
    return res.status(200).json({ ok: true });
  }

  const password = String(body.password || '');
  const rawName = String(body.username || '').trim();

  if (action === 'register') {
    if ((await cmd('GET', 'chat:signups')) === 'closed') {
      return res.status(403).json({ error: 'Sign-ups are closed. Ask an admin.' });
    }
    if (await isBlocked(req)) return res.status(403).json({ error: BANNED_MSG, banned: true });
    const username = cleanUsername(rawName);
    if (!username) return res.status(400).json({ error: 'Username must be 3-20 characters: letters, numbers, _ or .' });
    if (password.length < 6 || password.length > 100) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    const { salt, hash } = hashPassword(password);
    const user = {
      username,
      displayName: cleanDisplayName(body.displayName) || rawName.slice(0, 20),
      color: randomColor(),
      avatar: null,
      role: null,
      banned: false,
      status: 'pending', // must fill out an application (see /api/apply)
      application: null,
      salt, hash,
      created: Date.now(),
    };
    const ok = await cmd('SET', userKey(username), JSON.stringify(user), 'NX');
    if (!ok) return res.status(409).json({ error: 'That username is taken' });
    // The very first account on the server becomes the owner.
    const [isFirst] = await pipeline([['SET', 'chat:owner', username, 'NX'], ['RPUSH', 'chat:userlist', username]]);
    if (isFirst) { user.role = 'owner'; user.status = 'approved'; await saveUser(user); }
    applyOwner(user);
    await trackUser(user, req);
    const token = await createSession(username);
    return res.status(200).json({ token, user: meView(user) });
  }

  if (action === 'login') {
    const username = cleanUsername(rawName);
    const failKey = `chat:fail:${username}`;
    if (!username || !password) return res.status(401).json({ error: 'Wrong username or password' });
    const [raw, fails] = await pipeline([['GET', userKey(username)], ['GET', failKey]]);
    if (+fails >= MAX_FAILS) return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
    const user = raw ? parseUser(raw) : null;
    if (!user || !verifyPassword(password, user.salt, user.hash)) {
      await pipeline([['INCR', failKey], ['EXPIRE', failKey, FAIL_WINDOW]]);
      return res.status(401).json({ error: 'Wrong username or password' });
    }
    await cmd('DEL', failKey);
    if (user.banned) return res.status(403).json({ error: BANNED_MSG, banned: true });
    if (!isStaff(user) && (await isBlocked(req))) return res.status(403).json({ error: BANNED_MSG, banned: true });
    await trackUser(user, req);
    const token = await createSession(username);
    return res.status(200).json({ token, user: meView(user) });
  }

  res.status(400).json({ error: 'Unknown action' });
});
