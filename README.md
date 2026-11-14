# Pukytoon

Games made with Claude, Gemini or Kimi, or in Pukytoon's own Creator Studio, in a feed you swipe through like
videos.

- **Swipe** up and down: one game per screen, snapping like a video feed. Each game waits under its cover.
- **Tap ▶ Play** and the game gets the whole screen and every touch. **‹** (or the phone's back button) takes
  you back to the feed and pauses it; **↻** restarts the game.
- **Tap +** (or swipe to the end of the feed) to add a game: drop its **share link** or paste its **code**.
  Pukytoon works out which one it is, and what kind of code.
- **Tap ✦ Create** to make a game in the **Creator Studio**, no code needed.
- **Tap ☺** to sign in with your email (no password: a link each time), then **share** your games with everyone,
  **like** theirs, **save** them for later, **follow** the people who made them, and report anything that
  shouldn't be there.

The feed starts with three games from [Happy-Fruit-merge](https://github.com/Sinadehesh/Happy-Fruit-merge), all
part of the app, so they work offline:

- **Happy Animal Merge** (Egg → Chick → … → Unicorn), its Animals mode with its sprites and hitboxes.
- **Gem Jar** (drop gems, merge two of a kind, make the diamond): the whole game, with its 11 gem sets, Daily
  Challenge, Gem Rush, quests, levels and the Gem Mine.
- **Zombie Bomber** (merge bombs, drag them onto the zombies, 300 levels): the whole game, with its shop.

Gem Jar and Zombie Bomber are the games as they are in Happy-Fruit-merge, brought in unchanged (which version:
`games/<game>/SOURCE.txt`). Inside Pukytoon they show no ads. To take a newer version of either:

```bash
python3 tools/import-games.py ../Happy-Fruit-merge    # a checkout of the branch with the version you want
```

It packs each game with the game's own build script, so it needs what those need (Python 3 with Pillow).

## Creator Studio

Pick a game type and a look, tune it while a live preview plays, and publish it to the feed.

| Game type | You | Settings |
|---|---|---|
| **Drop and merge** | Drop items in a box; two of a kind merge into the next one (Happy Animal Merge's rules and physics) | Gravity, bounciness, kinds that drop, item size, danger line, reverse sizes |
| **Endless runner** | Tap to jump over obstacles and grab treats | Speed, speed-up, gravity, jump height, double jump, spacing, treats, lives |
| **Match-3** | Swap neighbours to line up three of a kind; chains score more | Kinds of tile, columns, rows, animation speed, hints |
| **Whack-a-mole** | Tap what pops up, but leave the bad one alone | Holes, time up, how often, bad ones, speed-up |
| **Snake** | Steer to the food and grow, without hitting a wall, a rock or yourself; swipe, arrow keys, or tap the side to turn to | Board size, speed, speed-up, growth, rocks, through the walls, lives |
| **Jump up** | Bounce from platform to platform and climb; hold the left or right of the screen to steer, and the sides join up | Gravity, bounce height, side speed, spacing, crumbling and sliding platforms, treats, hazards, lives |
| **Space shooter** | Drag your ship; it fires by itself. Shoot the enemies, dodge the rocks, catch power-ups for double shots | Fire rate, enemy speed, how often, toughness, rocks, power-ups, speed-up, lives |
| **Tap clicker** | Tap for coins, buy stronger taps and helpers, and evolve the picture up the look's chain (each doubles everything) | Coins a tap, helper rate, price growth, first evolution's price, golden bonuses |
| **Memory pairs** | Turn cards two at a time and find the pairs | Pairs (6 to 12), a look at them all first, time to see a miss, shuffle after 3 misses |
| **Picture quiz** | Questions made from the look's pictures: find it, what comes next in the chain, how many, which one is different | Kinds of question, answers to pick from, seconds per question, lives, streak bonus |

- **Six looks** (Barnyard, Pet Pals, Farm Fresh, Sweet Shop, Gem Mine, Pixel Treasure) from Happy-Fruit-merge's
  art, and any single picture can be swapped for any of the library's 74.
- **How to win and lose**: a preset for each game ("Make the top item", "Run 500 m", "25 moves"…) or your own rule
  such as `score >= 1000 || time >= 90`, checked as you type (only numbers, the game's own counts and
  operators, never code).
- **Music**: two tracks by Kevin MacLeod (CC BY 4.0, credited in the Studio and on the game's end screen).
- The settings marked live change the running preview as the slider moves; the rest restart it.
- **Publish** saves the game as a *GameSpec*: a few hundred bytes of data (mechanic, settings, look, rules,
  name) that `studio/play.html` turns back into the game. **✎** on its card opens it in the Studio again.

Studio games work offline: the runtime, the mechanics and the whole asset library are part of the app.

## Adding your games

| You drop | What happens |
|---|---|
| A **Claude** link (`claude.ai/public/artifacts/…`, or Claude's embed code) | A card in the feed; **Play** opens the game full screen inside the app, with **Back to feed** to return (on the website: a new tab). |
| A **Gemini** link (`gemini.google.com/share/…`, `g.co/gemini/share/…`) | The same. |
| A **Kimi** link (`kimi.com/…`) | The same. |
| Any other link (your own site, itch.io, GitHub Pages, …) | Plays right in the feed. If the site refuses to be shown inside another page, tap **↗** to open it. |
| **HTML** code (a whole page or just a bit of it) | Plays right in the feed. |
| **React** code (what Claude and Gemini artifacts usually are) | Plays right in the feed: React 18, Tailwind and every package it imports (`lucide-react`, `recharts`, `three`, …) come from a CDN; shadcn/ui imports (`@/components/ui/…`) get small look-alikes. TypeScript works too. |
| Plain **JavaScript** | Runs on an empty page. |

Links are the quickest, but Claude, Gemini and Kimi don't let other apps show their pages inside a frame
(their servers send `X-Frame-Options` / `frame-ancestors`), so a link game can't sit in the feed itself. The
app plays it full screen in its own web view instead (`@capacitor/inappbrowser`: no browser, no address bar,
**Back to feed** returns you where you were); a website has no such view, so there it opens in a new tab. For a
game that plays *inside* the feed, copy its code and paste that.

Code can come straight from the chat: the ```` ``` ```` fences and the sentences around them are dropped.
You can also pick a file (`.html`, `.jsx`, `.tsx`, `.js`).

Each code game runs in a sandboxed frame: it can't reach the app or the other games. Its `localStorage`
(high scores, progress) is kept by the app, so it survives restarts. If a game crashes, a red banner shows
the error; paste it into the AI that made the game to get it fixed.

Everything you add or make is saved on the phone (the app's own storage). Sharing it with everyone is a choice
(next section).

## Sharing with everyone

Pukytoon has accounts and a feed everyone shares, on [Supabase](https://supabase.com) (the project *pukytoon*).
You can watch and play without one.

- **Signing in**: ☺, your email, then tap the link in the email it gets, on the same phone: on the website it
  opens the website signed in, and from the Android app it opens the app (its own address,
  `com.sinadehesh.pukytoon://login`). Once the emails carry a code too (setup step 2), typing it works as well. New
  addresses get an account and pick a name and an @name, which go on the games they share.
- **What you can share**: Creator Studio games (when you publish, *Who can play it* → *Everyone*, the
  default) and Claude, Gemini and Kimi links (**⤴** on their card). Pasted code games stay on the phone for now:
  sharing those needs the safety checks from the plan first.
- **Share links**: **⤴** on a shared game hands its link (`…/?g=<name-code>`) to the phone's share sheet. Opening
  one puts that game first in the feed.
- **Likes** on shared games are counted online (signed in); likes on the phone's own games stay on the phone.
- **Saved for later**: the bookmark on someone else's game keeps it in your account (☺ → *Saved for later*),
  private to you; a tap there goes back to it in the feed.
- **Following**: *+ Follow* beside a maker's name. ☺ → *Following* lists their newest games.
- **Saves online**: what a shared game keeps (a Studio game's best score, or anything a game stores with
  `Pukytoon.save`) also goes online while you're signed in, a couple of seconds after the last change, and
  comes down when you sign in on another phone. The last save wins; one made on the phone and not sent yet
  (offline, or signed out) is the newest, so it goes up at the next sign-in instead of being replaced
  (`js/sync.js`).
- **⋯** on someone else's game: *Make your own version* (a Studio game, opened as a new one of yours), *Copy the
  link*, *Report this game* and *Hide games by …* (only for you). Games that several people report (adding up to
  3) leave the feed until someone looks at them.
- **Your games**: **✎** publishes a new version of a shared Studio game; **🗑** can take it down for everyone,
  or just remove it from the phone.
- **Your account**: ☺ → change your name, sign out, or *Delete my account*, which removes it with every game you
  shared (the copies on the phone stay). The website has the same, for anyone deleting from a browser.
- **Offline** the feed carries on with the games on the phone; everything online is optional.

## The online side (Supabase)

| | |
|---|---|
| Project | *pukytoon*, ref `zbrcasmayxrdgtjrnere`, Frankfurt (eu-central-1), free plan |
| API | `https://zbrcasmayxrdgtjrnere.supabase.co`, with the publishable key in `js/config.js` |
| Database | `supabase/migrations/`, checked by `supabase/tests/database.sql` |

The publishable key is meant to be in the app: what anyone can do with it is decided by the database's row
level security. People read what's public and write only their own things, and only the columns that are
theirs (never a game's status, a like count or a trust score). Games are created only through
`publish_studio_game` and `publish_link_game`, which check what's in them: a Studio game is only data (a
mechanic from the database's list, settings, a look, rules, at most 8 KB) and a link only goes to Claude,
Gemini or Kimi. `delete_my_account` removes an account and everything it shared. Reports are weighed by the
reporter's trust and open a moderation case. Saved-for-later lists and saves are private to each person;
follows are public, and a person follows only as themselves. The database stamps every save with its own
clock, so phones can tell a newer one. The tables for the rest of the plan (community mechanics and their
review, the asset library, test runs) are there too.

**Changing the database**: add a migration file, try it on a local Postgres with the checks, then apply it to
the project (Supabase dashboard → SQL, the Supabase CLI, or ask Claude):

```bash
psql -v ON_ERROR_STOP=1 -f supabase/tests/supabase-stub.sql $(for m in supabase/migrations/*.sql; do echo "-f $m"; done) -f supabase/tests/database.sql
```

When a core mechanic's manifest changes, `node tools/seed-mechanics.mjs > supabase/migrations/<time>_core_mechanics.sql`
makes the migration that updates the database's copy.

### One-time setup

1. **Supabase → Authentication → URL Configuration** (done, through the Management API):
   - *Site URL*: `https://sinadehesh.github.io/pukytoon/` (it forwards to pukytoon.sinadehesh.com once step 4 is done)
   - *Redirect URLs*: `https://sinadehesh.github.io/pukytoon/`, `https://pukytoon.sinadehesh.com/` (each also with
     `**`), and the app's own address `com.sinadehesh.pukytoon://login`
2. **The code in the emails** (waits for step 3: on the free plan, Supabase lets you change its emails only once
   they go out through your own sender; until then they carry just the link, which is enough to sign in).
   *Supabase → Authentication → Emails → Templates*: in *Magic link* and in *Confirm signup*, put the code in the
   email (it's 8 digits on this project):
   ```html
   <h2>Your Pukytoon code</h2>
   <p>Type this code in Pukytoon to sign in:</p>
   <p style="font-size:28px;font-weight:700;letter-spacing:6px">{{ .Token }}</p>
   <p>On the website you can tap this instead: <a href="{{ .ConfirmationURL }}">Sign in to Pukytoon</a></p>
   <p>If you didn't ask for this, ignore this email.</p>
   ```
   Subject for both: `Your Pukytoon code`.
3. **Email for everyone**: Supabase's own email only reaches the members of your Supabase organization (so,
   you) and only a few an hour. Before anyone else signs in, add an email sender: for example
   [Resend](https://resend.com), with the domain `pukytoon.sinadehesh.com` (it gives you DNS records to add in
   Cloudflare, under `send.pukytoon` and `resend._domainkey.pukytoon`), then *Supabase → Authentication → Emails →
   SMTP Settings*: host `smtp.resend.com`, port 465, user `resend`, password your Resend API key, sender
   `login@pukytoon.sinadehesh.com`, name `Pukytoon`.
4. **The website at pukytoon.sinadehesh.com**: sinadehesh.com's DNS is at Cloudflare (www stays on Vercel).
   - *Cloudflare → sinadehesh.com → DNS → Add record*: type `CNAME`, name `pukytoon`, target
     `sinadehesh.github.io`, proxy status *DNS only* (grey cloud).
   - *GitHub → Sinadehesh/pukytoon → Settings → Pages → Custom domain*: `pukytoon.sinadehesh.com`, Save, wait for
     the DNS check, then tick *Enforce HTTPS*. The old address forwards to the new one, so links already shared keep
     working.

Steps 3 and 4 are yours: they need accounts and dashboards only you can reach.

Later, when code games can be shared: those will be served from their own domain rather than another
sinadehesh.com subdomain, since pages on subdomains of one domain count as the same site to browsers (cookies,
for one, can be shared between them).

## Installing on Android

Every push builds the app on GitHub (Actions → *Build Android app*) and puts the newest build on the
[Releases page](https://github.com/Sinadehesh/pukytoon/releases/tag/test-build) as **Pukytoon test build**. On your phone, download
`Pukytoon.apk` from there and open it; Android asks once to allow installing apps from your browser.
Each new build installs over the last one and keeps your games (they're all signed with the same test key,
`app/android/app/debug.keystore`).

The website is at https://sinadehesh.github.io/pukytoon/; every push publishes it again (Actions → *Publish the
website*).

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

## Tests

Every push runs them on GitHub (Actions → *Test*), in headless Chromium on a phone-sized screen; the
screenshots are kept with each run. To run them yourself: `npm ci`, `npx playwright install chromium`, then:

```bash
npm test                        # everything
node tests/run.mjs mechanics    # or one of: mechanics, feed, studio, cloud
```

No test reaches the real Supabase project: each browser gets a stand-in for it (`tests/fake-cloud.mjs`) that
answers like it, a little slowly, as a phone's connection would.

- **mechanics**: the gate a Creator Studio mechanic must pass. Each one plays 60 s of random taps, drags and keys
  at its default settings, at every setting's minimum and maximum, in a dark theme and with every picture
  failing to load; it must boot in under 4 s, never crash, keep every count a number, fetch nothing from
  outside the site and draw a screen. The same seed and input must replay the same game. Bots then play it
  properly, through the same taps, drags and keys a player has:
  - the runner clears every obstacle at its easiest and hardest settings; match-3 always has a move that scores;
    whack-a-mole can be played without misses;
  - Snake eats 25 before losing a life, on every board (rocks never wall off food);
  - Jump up climbs 150 m in 60 s without a fall at the hardest and easiest settings (every platform on the way
    up is reachable);
  - the shooter survives 60 s at its default settings;
  - the clicker evolves twice in a minute, and still once in two at the steepest prices;
  - memory pairs, remembering only cards it has seen, clears 12 pairs in under 2.2 moves a pair;
  - every quiz question has the right number of different answers and exactly one right one.

  `MECHANIC=snake,quiz node tests/run.mjs mechanics` runs the gate for just those.
- **feed**: swiping, playing, the built-in games (Gem Jar and Zombie Bomber stand still and silent under the
  cover and after Back, and carry on with Play), every kind of pasted code, links, saves, likes and removing,
  and, as the Android app: link games, the share sheet, and the sign-in link opening the app (and an expired one).
- **studio**: making, tuning, publishing, playing and editing a game, and Back closing the Studio.
- **cloud**: everyone's games in the feed, signing in with a code (and a wrong one) or the email's link, picking a name, likes,
  sharing a Studio game and a Claude link, new versions, share links, reports, remixing, hiding someone, taking a
  game down, signing out and in, renaming, deleting the account, and carrying on offline; then saving a game
  for later and following its maker (and both lists), and a game's save going online and coming down on a
  second phone (two browser contexts on one stand-in cloud), where a save made signed out goes up later.
- **database** (a separate CI job, on Postgres 17): every migration on an empty database, then 92 checks of its
  rules as signed-out visitors, players, a developer, a moderator and the test runner meet them.

## How it's built

```
index.html, css/pukytoon.css   the feed, the top bar, the add-a-game sheet and the Creator Studio
js/app.js                      the feed: slides, playing, adding, making and removing games, the back button
js/runtime.js                  what was dropped (link or code, which kind) and the page each code game runs in
js/bridge.js                   the app's end of the bridge: which frame is which game, saves, the watchdog
js/studio.js                   the Creator Studio
js/store.js                    the saved games, likes, games' saves and hidden people (localStorage)
js/cloud.js, config.js         the online side: accounts, everyone's games, sharing, likes, saved for later,
                               follows, saves and reports (Supabase)
js/sync.js                     shared games' saves, kept online too so they follow the player
js/vendor/supabase.js          the Supabase client (2.118.0), kept here so the app needs no CDN
sdk/pukytoon-sdk.js            the game's end of the bridge, loaded into every game
sdk/pukytoon-embed.js          for games not written for Pukytoon: pauses them in the feed without changing their code
runtime/runtime.js             what Studio games run on: loop, input, drawing, sound, rules, title and end screens
runtime/rules.js, spec.js      win/lose rules (a small parser, never eval) and the GameSpec in a link
runtime/mechanics/             one module per game type, listed in index.js
studio/play.html, play.js      the page that plays a GameSpec
assets/library/                the asset library: sprites/, sfx/, music/, sprites.js, packs.js (the looks), CREDITS.md
games/happy-animal-merge/      a built-in game (Matter.js physics, kept in vendor/ so it works offline)
games/gem-jar/, zombie-bomber/ built-in games brought in from Happy-Fruit-merge by tools/import-games.py
tests/                         the tests (npm test), and fake-cloud.mjs, the stand-in for Supabase they use
tools/build-library.mjs        rebuilds assets/library/sprites.js after adding pictures (npm run library)
tools/seed-mechanics.mjs       writes the migration that gives the database the core mechanics' manifests
tools/import-games.py          brings a newer Gem Jar and Zombie Bomber into games/
supabase/                      the database: migrations/, and tests/ (a stand-in for Supabase's roles, and the checks)
app/                           the Android app (Capacitor 8): build-web.mjs, android/
```

- **The bridge.** Games and the app talk only through `postMessage`, as `{ pukytoon: 1, type, payload }`. The game
  says `hello` and `ready`, sends `save`, `score`, `event` and `error`; the app sends `init` (its saves), `start`,
  `pause`, `resume`, `mute`, `ping`, and `spec.update` to the Studio's preview. Games run only while they're being
  played; a game that stops answering pings for 6 s gets a *not responding* screen with Reload. The SDK and the
  Happy Animal Merge page show how a game uses it.
- Only the game on screen and its neighbours are loaded; the rest are dropped to keep the phone fast. The game
  on screen loads first, and its neighbours and the Studio's code only once it has (or after 8 s): on a slow
  4G connection the first game used to share its bandwidth with Gem Jar's 3.6 MB and took 19 s, now 7 s. The
  modules the first screen needs are all listed in `index.html` as `modulepreload`, so they arrive side by side
  (the cover shows after 1 s on slow 4G, from 2 s); the feed test fails if one is missing from the list.
- In the app, link games play in Pukytoon's own full-screen web view (`@capacitor/inappbrowser`, which needs
  Android 8.0 or newer), the back button is handled by `@capacitor/app`, and **⤴** opens the phone's own share
  sheet (`@capacitor/share`). `MainActivity` keeps game frames
  inside the feed (Capacitor would otherwise send any non-app page to the phone's browser).
- To add another built-in game, add it to `BUILTIN` at the top of `js/app.js`, with `src` set to its page in
  `games/<name>/` (part of the app, works offline) or to the address where it's published (loads live, but then
  it can't be paused from the feed).
- **A game that wasn't written for Pukytoon** needs two script tags before all its other scripts:
  `sdk/pukytoon-sdk.js` and `sdk/pukytoon-embed.js`. While the feed has it paused, its animation frames wait, its
  clock (`performance.now`) stands still, its sound is off and its page reads as hidden, so it carries on later
  exactly where it was; none of its own code changes. `tools/import-games.py` adds the two tags to Gem Jar and
  Zombie Bomber.

### Adding a mechanic or art

- **A mechanic**: a module in `runtime/mechanics/` exporting `manifest` (settings as JSON Schema, picture and
  music slots by role, the counts its rules can use, rule presets, input actions) and `create(ctx, params)`,
  which returns `start`, `update(dt, input)`, `render(gfx)`, and optionally `onParams`, `serialize` and
  `destroy`. It never loads files or reads raw input: it asks `ctx.slot(name)` for pictures and gets named
  actions. Add it to `runtime/mechanics/index.js`, then `npm test`: it joins the gate by itself. A setting
  with fixed choices can name them for the Studio (`'x-labels': { mixed: 'Mixed', … }`). For people to
  publish it, the database needs its manifest too: `node tools/seed-mechanics.mjs <key>` writes the migration.
- **Pictures**: put 256×256 PNGs in `assets/library/sprites/<set>/` (a numbered set is a ready-made merge
  chain) and run `npm run library`; give it Happy-Fruit-merge's `shapes.js` to bring their traced hitboxes:
  `node tools/build-library.mjs ../Happy-Fruit-merge/shapes.js`.
- **A look**: an entry in `PACKS` in `assets/library/packs.js`: its colours, and which pictures fill each role.

Code games need the internet the first time they load their libraries (React, Tailwind, packages);
Happy Animal Merge and Studio games work offline.
