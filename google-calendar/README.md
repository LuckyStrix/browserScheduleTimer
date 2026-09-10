# Browser Schedule Timer — Google Calendar

An alternate version of the schedule timer that replaces the manual weekly
editor with a live view of your real Google Calendar. Same countdown-header
concept as the original app, but driven by actual calendar events instead of
recurring weekly blocks.

Nothing here touches the original app in the repo root — this is a fully
separate copy of `index.html` / `style.css` / `script.js`.

Everything runs client-side: your OAuth token and calendar data go straight
from your browser to Google's API and back. Nothing is sent to, or stored
on, any server this project controls.

## Why you need to set up your own OAuth Client ID

Google Calendar access requires OAuth, and OAuth client IDs are tied to a
specific Google Cloud project and a specific set of allowed origins (the
URL the page is served from). There's no way to ship a working client ID
in this repo that would work for everyone visiting it — you need your own.

The good news: this is a five-minute, free, one-time setup.

## Setup

1. **Create/select a Google Cloud project** at
   [console.cloud.google.com](https://console.cloud.google.com/).
2. **Enable the Google Calendar API**: APIs & Services → Library → search
   "Google Calendar API" → Enable.
3. **Configure the OAuth consent screen** (APIs & Services → OAuth consent
   screen): choose "External", fill in an app name and your email. You can
   leave it in "Testing" mode and add your own Google account under "Test
   users" — no need to publish or get it verified for personal use.
4. **Create an OAuth Client ID** (APIs & Services → Credentials → Create
   Credentials → OAuth client ID):
   - Application type: **Web application**
   - Under **Authorized JavaScript origins**, add the exact origin you'll
     serve this page from, e.g. `http://localhost:5500` or your GitHub
     Pages URL (`https://<you>.github.io`). No path, no trailing slash.
5. Copy the generated Client ID (ends in `.apps.googleusercontent.com`).

## Sharing one Client ID across devices (e.g. over Tailscale)

If you serve this folder from one machine and open it from several devices
(phone, laptop, etc. over Tailscale), you don't have to paste the Client ID
into every device separately. Instead, drop it in a file next to this
README:

```bash
cp config.example.json config.json
# then edit config.json and paste your real Client ID in
```

`config.json` is gitignored (see the repo-root `.gitignore`) so it never
gets pushed to GitHub — it lives only on the machine serving the app. Every
device that loads the page over your tailnet fetches it automatically and
the **Connect** button is enabled immediately, no manual paste needed. The
manual input field still works and takes priority on any device where you
type a value into it (saved to that device's `localStorage`), so you can
still override it locally if you ever need to.

Note this only shares the Client ID (not a secret — it's fine to have on
disk on a machine only reachable over your tailnet). It does **not** share
a signed-in session: each device still has to click **Connect** once and
sign in with Google, since access tokens themselves are never persisted
(see Known limitations below).

## Running it

This page **must** be served over `http://` or `https://` — Google's
sign-in flow refuses to run from a `file://` URL. From this folder:

```bash
npx serve .
# or: python3 -m http.server 5500
```

Then open the served URL, paste your Client ID into the field, click
**Save**, then **Connect Google Calendar** and sign in.

## What it shows

- The header countdown works the same way as the original: time until your
  next event, or time left in the one happening now.
- A calendar picker lists every calendar in your account, with **All**/
  **None** shortcuts; it defaults to whatever's checked in your Google
  Calendar UI. Selections are remembered per-browser.
- Below it, a list of events over the next couple of days across your
  selected calendars.
- Events refresh automatically every 5 minutes while the tab is open, or
  on demand via **Refresh**.
- **Disconnect** revokes the token and clears the connection.

## Known limitations

- Read-only — you can't add/edit/delete events from this page.
- The OAuth access token isn't persisted across page reloads. Sign-in
  never happens silently — reopening the page always shows the connect
  screen, and you reconnect with an explicit click (**Connect** or
  **Reconnect**), so the app never pops a surprise Google prompt.
- Once a token expires mid-session, calls fail until you click
  **Reconnect** — it isn't renewed automatically.
