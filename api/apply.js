import { cmd, route, readBody } from './_store.js';
import { requireUser, saveUser, statusOf, meView } from './_auth.js';

const clean = (s) => String(s || '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '').trim().slice(0, 500);

// POST /api/apply  { why, use, understand: true }
// The application new accounts fill out before they can use the app. Admins approve/deny it in the Admin Panel.
export default route(async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const user = await requireUser(req, res, { allowPending: true });
  if (!user) return;

  const status = statusOf(user);
  if (status === 'approved') return res.status(200).json({ user: meView(user) });
  if (status === 'denied') return res.status(403).json({ error: 'Your application was denied.' });
  if (user.application) return res.status(400).json({ error: 'You already sent an application. Hang tight!' });

  const b = readBody(req);
  const why = clean(b.why);
  const use = clean(b.use);
  if (why.length < 10) return res.status(400).json({ error: 'Tell us a bit more about why you want CalcTxt (at least 10 characters).' });
  if (use.length < 10) return res.status(400).json({ error: 'Tell us a bit more about what you will use it for (at least 10 characters).' });
  if (b.understand !== true) return res.status(400).json({ error: 'You have to agree not to leak CalcTxt to people who can\'t be trusted.' });

  user.application = { why, use, understand: true, ts: Date.now() };
  await saveUser(user);
  await cmd('SADD', 'chat:pending', user.username);
  res.status(200).json({ user: meView(user) });
});
