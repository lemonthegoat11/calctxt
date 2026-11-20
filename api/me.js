import { cmd, route, readBody, cleanDisplayName, cleanColor, isImageId } from './_store.js';
import {
  requireUser, saveUser, fullProfile, hashPassword, verifyPassword, cleanUsername, userKey, parseUser, cleanBio,
} from './_auth.js';

// GET  /api/me           -> your profile
// GET  /api/me?u=name    -> someone else's profile (name, picture, bio, member since)
// POST /api/me  { displayName?, color?, avatar? (image id or null), bio?, currentPassword?, newPassword? }
export default route(async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;

  if (req.method === 'GET' && req.query?.u) {
    const name = cleanUsername(req.query.u);
    const raw = name && (await cmd('GET', userKey(name)));
    if (!raw) return res.status(404).json({ error: 'No such user' });
    const other = parseUser(raw);
    return res.status(200).json({ user: { ...fullProfile(other), banned: !!other.banned } });
  }

  if (req.method === 'POST') {
    const b = readBody(req);
    if (b.displayName !== undefined) user.displayName = cleanDisplayName(b.displayName) || user.username;
    if (b.color !== undefined) user.color = cleanColor(b.color);
    if (b.avatar !== undefined) user.avatar = isImageId(b.avatar) ? b.avatar : null;
    if (b.bio !== undefined) user.bio = cleanBio(b.bio);
    if (b.newPassword !== undefined) {
      if (!verifyPassword(String(b.currentPassword || ''), user.salt, user.hash)) {
        return res.status(400).json({ error: 'Current password is wrong' });
      }
      const pw = String(b.newPassword);
      if (pw.length < 6 || pw.length > 100) return res.status(400).json({ error: 'New password must be at least 6 characters' });
      Object.assign(user, hashPassword(pw));
    }
    await saveUser(user);
  }

  res.status(200).json({ user: fullProfile(user) });
});
