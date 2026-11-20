import crypto from 'node:crypto';
import { cmd, route, readBody } from './_store.js';
import { requireUser } from './_auth.js';

// The browser shrinks photos before uploading, so real uploads are well under this.
const MAX_BYTES = 1_500_000;

// POST /api/upload  { data: "data:image/jpeg;base64,..." }  -> { id }
export default route(async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const user = await requireUser(req, res);
  if (!user) return;

  const m = String(readBody(req).data || '').match(/^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=]+)$/);
  if (!m) return res.status(400).json({ error: 'Only JPEG, PNG, WebP or GIF images' });
  const [, type, b64] = m;
  if (b64.length * 0.75 > MAX_BYTES) return res.status(413).json({ error: 'Image too large (max 1.5 MB after compression)' });

  const id = crypto.randomBytes(12).toString('hex');
  await cmd('SET', `chat:img:${id}`, `${type};${b64}`);
  res.status(200).json({ id });
});
