# Pukytoon

Games made with Claude, Gemini or Kimi, in a feed you swipe through like videos.

- **Swipe** up and down: one game per screen, snapping like a video feed. The game shows live behind its cover.
- **Tap ▶ Play** and the game gets the whole screen and every touch. **‹** (or the phone's back button) takes
  you back to the feed; **↻** restarts the game.
- **Tap +** (or swipe to the end of the feed) to add a game: drop its **share link** or paste its **code**.
  Pukytoon works out which one it is, and what kind of code.

The feed starts with two games from [Happy-Fruit-merge](https://github.com/Sinadehesh/Happy-Fruit-merge):

- **Happy Animal Merge** (Egg → Chick → … → Unicorn), its Animals mode with its sprites and hitboxes, built into
  the app (works offline).
- **Zombie Bomber** (merge bombs, drop them on the zombies, 300 levels), loaded live from
  [its GitHub Pages address](https://sinadehesh.github.io/Happy-Fruit-merge/bomber/), so whatever you push to
  Happy-Fruit-merge shows up in Pukytoon without a new app build. It needs the internet.

## Adding your games

| You drop | What happens |
|---|---|
| A **Claude** link (`claude.ai/public/artifacts/…`, or Claude's embed code) | A card in the feed; **Play** opens the game full screen in the in-app browser. |
| A **Gemini** link (`gemini.google.com/share/…`, `g.co/gemini/share/…`) | The same. |
| A **Kimi** link (`kimi.com/…`) | The same. |
| Any other link (your own site, itch.io, GitHub Pages, …) | Plays right in the feed. If the site refuses to be shown inside another page, tap **↗** to open it. |
| **HTML** code (a whole page or just a bit of it) | Plays right in the feed. |
| **React** code (what Claude and Gemini artifacts usually are) | Plays right in the feed: React 18, Tailwind and every package it imports (`lucide-react`, `recharts`, `three`, …) come from a CDN; shadcn/ui imports (`@/components/ui/…`) get small look-alikes. TypeScript works too. |
| Plain **JavaScript** | Runs on an empty page. |

Links are the quickest, but Claude, Gemini and Kimi don't let other apps show their pages inside a frame
(their servers send `X-Frame-Options` / `frame-ancestors`), so a link game opens full screen instead of
playing in the feed. For a game that plays *inside* the feed, copy its code and paste that.

Code can come straight from the chat: the ```` ``` ```` fences and the sentences around them are dropped.
You can also pick a file (`.html`, `.jsx`, `.tsx`, `.js`).

Each code game runs in a sandboxed frame: it can't reach the app or the other games. Its `localStorage`
(high scores, progress) is kept by the app, so it survives restarts. If a game crashes, a red banner shows
the error; paste it into the AI that made the game to get it fixed.

Everything you add is saved on the phone (the app's own storage).

## Installing on Android

Every push builds the app on GitHub (Actions → *Build Android app*) and puts the newest build on the
[Releases page](https://github.com/Sinadehesh/pukytoon/releases/tag/test-build) as **Pukytoon test build**. On your phone, download
`Pukytoon.apk` from there and open it; Android asks once to allow installing apps from your browser.
Each new build installs over the last one and keeps your games (they're all signed with the same test key,
`app/android/app/debug.keystore`).

The website version: turn on **Settings → Pages → Source: GitHub Actions** once, and every push publishes the
feed to GitHub Pages too (Actions → *Publish the website*).

### Building it yourself

Java 21, Node 22 and the Android SDK (platform 36, build-tools 36.0.0), as in
[animal-farm-merge's app/README.md](https://github.com/Sinadehesh/animal-farm-merge/blob/main/app/README.md#1-one-time-setup-linux):

```bash
cd app
npm ci
echo "sdk.dir=$HOME/android-sdk" > android/local.properties
npm run apk   # android/app/build/outputs/apk/debug/app-debug.apk
```

`npm run apk` copies the site into `app/www/` (`build-web.mjs`), syncs it into the Android project and builds.
To try the feed in a browser, serve the repo root with any static server: `python3 -m http.server`.

**Google Play** needs a release build signed with your own upload key (never the test key in the repo) and
the app id `com.sinadehesh.pukytoon`, which can't change after the first upload. animal-farm-merge's
`build-aab.yml` workflow and app README cover that, and carry over to this app as they are.

## How it's built

```
index.html, css/pukytoon.css   the feed, the top bar and the add-a-game sheet
js/app.js                      the feed: slides, playing, adding and removing games, the back button
js/runtime.js                  what was dropped (link or code, which kind) and the page each code game runs in
js/store.js                    the saved games, likes and code games' saves (localStorage)
games/happy-animal-merge/      the built-in game (Matter.js physics, kept in vendor/ so it works offline)
app/                           the Android app (Capacitor 8): build-web.mjs, android/
```

- Only the game on screen and its neighbours are loaded; the rest are dropped to keep the phone fast.
- The feed tells games `{pukytoon: 'pause'}` when they leave the screen and `{pukytoon: 'resume'}` when they come
  back (with `postMessage`). Happy Animal Merge stops its physics; other games can listen for it too.
- On Android, link games open in the in-app browser (`@capacitor/browser`) and the back button is handled by
  `@capacitor/app`. `MainActivity` keeps game frames inside the feed (Capacitor would otherwise send any
  non-app page to the phone's browser).
- To add another built-in game, add it to `BUILTIN` at the top of `js/app.js`, with `src` set to its page in
  `games/<name>/` (part of the app, works offline) or to the address where it's published (loads live).

Code games need the internet the first time they load their libraries (React, Tailwind, packages);
Happy Animal Merge works offline.
