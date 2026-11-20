# Calculator (secretly a chat app)

Opens as a normal working calculator. Type **111+111** and press **=** to unlock a
Discord-style group chat with channels, online list and live messages.

- **Lock it again:** press **Esc**, or the red lock button at the bottom-left. The chat is wiped from the screen and the calculator comes back.
- The tab title and icon always say "Calculator".

## Deploy to Render (no Vercel needed)

1. Put this folder in a GitHub repo.
2. On render.com: **New → Web Service**, connect the repo.
   - Runtime: **Node** · Build command: `npm install` · Start command: `npm start` · Instance type: **Free**
3. Deploy. You get a URL like `https://your-app.onrender.com`.
4. (Recommended) Make messages permanent: sign up free at upstash.com, create a **Redis** database, then copy its
   **REST URL** and **REST token** into Render → your service → **Environment** as
   `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`. Render redeploys automatically.

Without step 4 it still works, but messages are kept in memory and get wiped whenever the server restarts.
Render's free tier sleeps after ~15 min with no visitors and takes ~30-60 s to wake up on the next visit.

## Deploy to Vercel

1. Put this folder in a GitHub repo (or run `npx vercel` inside it).
2. On vercel.com: **Add New → Project**, import the repo, keep the default settings (no framework, no build command), deploy.
3. In the project, open the **Storage** tab → **Create Database** → pick **Upstash for Redis** (free tier works) → connect it to the project.
   This adds the `KV_REST_API_URL` / `KV_REST_API_TOKEN` env vars automatically.
4. **Redeploy** (Deployments → ⋯ → Redeploy) so the functions pick up the env vars.

Without step 3 the chat shows a red "Database not connected" banner.

## Run locally

Requires Node 18+.

```bash
npm run dev
```

Open http://localhost:3000. Locally, messages live in memory and are lost when the server stops.

## Files

| File | What it does |
| --- | --- |
| `index.html` | Calculator disguise + the whole chat UI |
| `api/poll.js` | Returns new messages, channel list, who's online (polled every 2s) |
| `api/send.js` | Posts a message |
| `api/channels.js` | Creates a channel |
| `api/_store.js` | Redis (Upstash REST) helper, with an in-memory fallback for local dev |

## Things to know

- **Changing the code:** edit `const SECRET = '111+111'` in `index.html`.
- **Not real security.** The unlock code is in the page source, and anyone who finds the URL can call the API. There are no accounts or passwords: anyone can pick any display name. Don't share anything truly sensitive.
- Keeps the last 500 messages per channel and up to 50 channels.
