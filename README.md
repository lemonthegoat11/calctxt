# Calculator (secretly a chat app)

Opens as a normal working calculator. Type **14789325+33** and press **=** to unlock a
Discord-style group chat.

**Features:** accounts (username + password), profile pictures, display names and name colors,
photo attachments (button, paste or drag-and-drop), channels, an online list, and live messages.

- **Lock it again:** press **Esc**, or the red lock button at the bottom-left. The chat is wiped from the screen and the calculator comes back. You stay logged in, so next time 14789325+33 takes you straight back in.
- **Channel links:** every channel has its own address, like `/channels/<server>/<channel>`. Back/Forward
  move between channels, and opening a channel link takes you to that channel after you unlock.
- **Reloading** keeps you in the chat on the same channel (that tab only). Locking, logging out, a new tab or
  reopening the browser all go back to the calculator, and the address bar shows plain `/` while it's locked.
- **Log out / change password / bio:** click your name at the bottom-left.
- **See someone's profile:** click their name or picture on a message, or in the Online list. It shows their bio and when they joined.
- The tab title and icon always say "Calculator".

## Moderation

- **Set yourself as owner:** in Render → your service → **Environment**, add `OWNER_USERNAME` = your username
  (on Vercel: Settings → Environment Variables, then redeploy). That account is always the owner and can't be banned;
  nobody else can be owner while it's set. If you don't set it, the first account ever made becomes the owner.
- The owner and admins get a gold shield button on the left. It opens the **Admin Panel**:
  - **Ban / Unban** anyone. Banned people are kicked out within seconds and can't log back in. When you ban, pick:
    - **Normal ban**: only that account.
    - **IP + device ban**: also blocks the last 5 IPs and browsers they used, so they can't make new accounts or use
      other ones from there. Anyone else on that Wi-Fi is blocked too (owner/admins never are). A VPN plus a different
      browser gets around it; websites can't read real hardware IDs. Unban lifts it.
  - **Make admin / Remove admin** (owner only). Admins can ban regular members; only the owner can ban admins. Nobody can ban the owner.
  - **Allow new sign-ups** switch: turn it off so banned people can't just make a new account.
- Click someone's name, then **Admin Panel** on their profile, to jump to them in the Admin Panel.
- Hover a message for the trash button. Anyone can delete their own messages; channel managers and admins can delete any message in that channel.
- The owner/admin powers above are site-wide (bans work everywhere), but they **can't see inside other people's servers**.

## Servers

- **Home** (the top icon on the left) is the original chat. Everyone is in it.
- **Make a server:** click the green **+** on the left rail, type a name, **Create**. You get an invite link right away.
- **Invite people:** click the server name at the top of the channel list, then **Copy** the invite link
  (looks like `https://your-app.onrender.com/?invite=AbC123xy`). The link opens the calculator, so they still need the unlock code.
  After unlocking and logging in, they get a "Join server?" popup. They can also paste the link into **+** → **Join**.
- **You only see servers you're in.** Nobody else can see a server's channels, messages, or members, not even the site owner.
- **Server owners** (click the server name) can rename it, set an icon, reset the invite link (the old one stops working),
  **Kick** members (they can rejoin with the link) or **Ban** them (they can't rejoin), and delete the server.
  Only the server owner can make channels in their server. Members can **Leave**.
- Limits: own up to 10 servers, be in up to 100, 1,000 members per server.

## Channels

- In Home, anyone can create a channel with **+**. In other servers, only the server owner can. Tick **Private channel** to make it invite-only.
- Whoever creates a channel manages it: hover it and click the gear (or the gear in the top bar) to
  set a topic, add or remove people, switch private on/off, or delete it.
- Private channels are hidden from everyone who isn't in them, except whoever runs that server (Home: the site owner/admins).
- `#general` is always public and only whoever runs that server can change it.

## Deploy to Render

1. Put this folder in a GitHub repo.
2. On render.com: **New → Web Service**, connect the repo.
   - Runtime: **Node** · Build command: `npm install` · Start command: `npm start` · Instance type: **Free**
3. **Required for accounts to last:** sign up free at upstash.com, create a **Redis** database, then copy its
   **REST URL** and **REST token** into Render → your service → **Environment** as
   `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.
4. Deploy. You get a URL like `https://your-app.onrender.com`.

Without step 3, everything (accounts, messages, photos) is kept in memory and wiped whenever the server restarts.
Render's free tier sleeps after ~15 min with no visitors and takes ~30-60 s to wake up on the next visit.

## Deploy to Vercel

1. Import the repo on vercel.com with default settings.
2. **Storage** tab → **Create Database** → **Upstash for Redis** → connect it to the project.
3. Redeploy.

## Run locally

Requires Node 18+.

```bash
npm start
```

Open http://localhost:3000.

## Files

| File | What it does |
| --- | --- |
| `index.html` | Calculator disguise + login screen + the whole chat UI |
| `api/auth.js` | Register / log in / log out |
| `api/me.js` | Get or update your profile (name, color, picture, password) |
| `api/upload.js` | Uploads a photo (shrunk in the browser first) |
| `api/img.js` | Serves uploaded photos |
| `api/poll.js` | New messages, channels, who's online, profiles (polled every 2s) |
| `api/send.js` | Posts a message |
| `api/servers.js` | Create / join / leave / delete servers, invites, kick & ban |
| `api/_servers.js` | Server storage and who's in which server |
| `api/channels.js` | Create / update / delete channels, manage members |
| `api/admin.js` | Admin Panel: bans, admins, sign-up switch |
| `api/delete.js` | Deletes a message |
| `api/_channels.js` | Channel settings and who can see/manage them |
| `api/_auth.js` | Password hashing (scrypt) and login sessions |
| `api/_store.js` | Redis (Upstash REST) helper, with an in-memory fallback |
| `dev-server.js` | The server `npm start` runs (used locally and on Render) |

## Things to know

- **Changing the unlock code:** edit `const SECRET = '14789325+33'` in `index.html`.
- **The disguise isn't secret.** The unlock code is in the page source. Accounts protect the chat itself: you have to log in to read or post.
- **Anyone who finds the URL can make an account.** There's no invite system.
- **Photos:** shrunk to max 1600px before upload, avatars to 256px. Anyone with a photo's link can view it (links are random and unguessable). Upstash's free plan holds 256 MB, roughly 1,000+ photos.
- **Passwords** are hashed with scrypt. After 10 wrong attempts, logging in to that username is blocked for 15 minutes. There's no "forgot password", so don't forget it.
- Keeps the last 500 messages per channel and up to 50 channels.
