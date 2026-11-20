import { cmd, isImageId } from './_store.js';

// GET /api/img?id=<24 hex chars>  -> the image bytes
// Ids are random and unguessable; images never change, so they cache forever.
export default async function handler(req, res) {
  try {
    const id = String(req.query.id || '');
    if (!isImageId(id)) { res.statusCode = 400; return res.end('Bad id'); }
    const raw = await cmd('GET', `chat:img:${id}`);
    if (!raw) { res.statusCode = 404; return res.end('Not found'); }
    const sep = raw.indexOf(';');
    const buf = Buffer.from(raw.slice(sep + 1), 'base64');
    res.statusCode = 200;
    res.setHeader('Content-Type', raw.slice(0, sep));
    res.setHeader('Content-Length', buf.length);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.end(buf);
  } catch (e) {
    res.statusCode = 500;
    res.end('Error');
  }
}
