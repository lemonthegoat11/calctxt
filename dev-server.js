// Server for local testing AND for hosts like Render/Railway: `npm start`
// Serves index.html and runs the /api/*.js handlers (same files Vercel uses).
// Uses Upstash Redis if UPSTASH_REDIS_REST_URL / _TOKEN are set, otherwise memory.
import http from 'node:http';
import { readFile } from 'node:fs/promises';

const PORT = process.env.PORT || 3000;
const ROUTES = new Set(['poll', 'send', 'channels', 'auth', 'me', 'upload', 'img', 'admin', 'delete', 'servers', 'apply']);
const MAX_BODY = 5 * 1024 * 1024;

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const m = url.pathname.match(/^\/api\/([a-z]+)$/);
  if (m && ROUTES.has(m[1])) {
    let raw = '';
    for await (const chunk of req) {
      raw += chunk;
      if (raw.length > MAX_BODY) { res.statusCode = 413; return res.end('{"error":"Too large"}'); }
    }
    req.query = Object.fromEntries(url.searchParams);
    try { req.body = raw ? JSON.parse(raw) : {}; } catch { req.body = {}; }
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (o) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); };
    const { default: handler } = await import(`./api/${m[1]}.js`);
    return handler(req, res);
  }
  // /channels/<server>/<channel> links are handled by the page itself.
  if (url.pathname === '/' || url.pathname === '/index.html' || url.pathname.startsWith('/channels/')) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.end(await readFile(new URL('./index.html', import.meta.url)));
  }
  res.statusCode = 404;
  res.end('Not found');
}).listen(PORT, () => console.log(`Running at http://localhost:${PORT}`));
