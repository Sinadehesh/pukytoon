// Pukytoon: swipe up and down through games, tap one to play it, add your own from a link or code, make one
// in the Creator Studio, and share them with everyone.

import { SOURCES, FORMAT_NAMES, detectInput, guessTitle, buildDocument } from './runtime.js';
import * as store from './store.js';
import * as bridge from './bridge.js';
import * as cloud from './cloud.js';
import { openStudio, closeStudio, isOpen as studioOpen } from './studio.js';
import { encodeSpec } from '../runtime/spec.js';

// Games that come with the app, always near the top of the feed. `src` is a page in games/, or a live
// address for a game that's published elsewhere (it then needs the internet, and updates by itself).
const BUILTIN = [{
    id: 'happy-animal-merge',
    kind: 'builtin',
    source: 'pukytoon',
    title: 'Happy Animal Merge',
    blurb: 'Drop two of the same animal to merge them. Egg → Chick → … → Unicorn!',
    src: 'games/happy-animal-merge/index.html'
}, {
    id: 'zombie-bomber',
    kind: 'builtin',
    source: 'pukytoon',
    title: 'Zombie Bomber',
    blurb: 'Merge bigger bombs, then drop them on the zombies before they reach your base. 300 levels!',
    src: 'https://sinadehesh.github.io/Happy-Fruit-merge/bomber/'
}];
const KEEP_LOADED = 1; // slides on each side of the one on screen that keep their game loaded
const EMOJIS = ['🎮', '🕹️', '👾', '🎲', '🧩', '🚀', '🐙', '🦄', '🐸', '🍄', '⭐', '🏁', '🎯', '🐉', '🪐', '🍩'];
const CODE_SANDBOX = 'allow-scripts allow-forms allow-pointer-lock allow-popups allow-modals allow-downloads';
const LINK_SANDBOX = 'allow-scripts allow-same-origin allow-forms allow-pointer-lock allow-popups allow-modals';
const AI_SOURCES = ['claude', 'gemini', 'kimi'];   // links that can be shared with everyone

// Running as the Android app (Capacitor) rather than the website
const cap = window.Capacitor;
const native = !!(cap && cap.isNativePlatform && cap.isNativePlatform());
const plugins = (cap && cap.Plugins) || {};

// Claude, Gemini and Kimi pages refuse to be shown inside another page, so their games can't sit in the
// feed. The app plays them full screen in its own web view (no browser, Back returns to the feed); the
// website can only open them in a new tab.
const playsInApp = native && !!plugins.InAppBrowser;
const IN_APP_VIEW = {
    showURL: false, showToolbar: true, closeButtonText: 'Back to feed', toolbarPosition: 0,
    showNavigationButtons: false, leftToRight: false, customWebViewUserAgent: null,
    clearCache: false, clearSessionCache: false, // keep the games' saves between plays
    mediaPlaybackRequiresUserAction: false,
    android: { allowZoom: false, hardwareBack: true, pauseMedia: true },
    iOS: { allowOverScroll: false, enableViewportScale: false, allowInLineMediaPlayback: true,
           surpressIncrementalRendering: false, viewStyle: 2, animationEffect: 2, // full screen, slides up
           allowsBackForwardNavigationGestures: false } // swipes belong to the game
};

const $ = id => document.getElementById(id);
const feed = $('feed');
const playTitle = $('play-title');
const sheet = $('sheet');
const form = $('add-form');
const drop = $('drop');
const detectEl = $('detect');
const madeWith = $('made-with');
const nameInput = $('name');
const saveBtn = $('btn-save');
const toastEl = $('toast');

let items = [];      // the games in feed order
let active = -1;     // index of the slide on screen
let playing = false;
// Games everyone shared: `first` is the one a shared link opened; the rest are pages, newest first
const online = { first: null, games: [], last: null, more: false, loading: false };

// --- Feed ---

// A shared link's game first, then the built-in games, yours, and everyone's (without the ones that are
// yours anyway, or by people you've hidden)
function composeItems() {
    const mine = store.listGames();
    const hidden = store.blocked();
    const seen = new Set(mine.map(g => g.cloudId).filter(Boolean));
    const others = [];
    for (const g of [online.first, ...online.games]) {
        if (!g || seen.has(g.cloudId) || hidden.has(g.ownerId)) continue;
        seen.add(g.cloudId);
        others.push(g);
    }
    const lead = online.first && others[0] === online.first ? others.splice(0, 1) : [];
    return [...lead, ...BUILTIN, ...mine, ...others];
}

function render(focusId) {
    items = composeItems();
    feed.querySelectorAll('iframe').forEach(f => bridge.unregister(f));
    feed.replaceChildren(...items.map((game, i) => slide(game, i)), addSlide());
    active = -1;
    const i = focusId ? items.findIndex(g => g.id === focusId) : -1;
    if (i >= 0) feed.children[i].scrollIntoView({ block: 'start' });
    else feed.scrollTop = 0;
    feed.querySelectorAll('.slide').forEach(s => observer.observe(s));
}

// More of everyone's games, at the end of the feed
function appendOnline(games) {
    online.games.push(...games);
    const have = new Set(items.map(g => g.cloudId).filter(Boolean));
    const hidden = store.blocked();
    const addEl = feed.lastElementChild;
    for (const g of games) {
        if (have.has(g.cloudId) || hidden.has(g.ownerId)) continue;
        have.add(g.cloudId);
        items.push(g);
        const s = slide(g, items.length - 1);
        feed.insertBefore(s, addEl);
        observer.observe(s);
    }
    addEl.dataset.index = items.length;
    if (active >= 0) setActive(active, true);
}

const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
        if (entry.isIntersecting) setActive(Number(entry.target.dataset.index));
    }
}, { root: feed, threshold: 0.6 });

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
}

const fromEveryone = game => !!game.ownerId;                   // came from the online feed
const isLocal = game => game.kind !== 'builtin' && !game.ownerId;   // on this phone
const isMine = game => isLocal(game) || (fromEveryone(game) && game.ownerId === cloud.userId());
const canShare = game => isLocal(game) && (game.kind === 'studio' || (game.kind === 'link' && AI_SOURCES.includes(game.source)));

function slide(game, index) {
    const source = SOURCES[game.source] || SOURCES.other;
    const s = el('section', 'slide');
    s.dataset.index = index;
    s.style.setProperty('--c1', source.colors[0]);
    s.style.setProperty('--c2', source.colors[1]);

    const opensOutside = game.kind === 'link' && !game.embeddable;
    const cover = el('button', 'cover');
    cover.type = 'button';
    cover.setAttribute('aria-label', `Play ${game.title}`);
    cover.append(el('span', 'play-btn', '▶ Play'));
    if (opensOutside) cover.append(el('span', 'play-note', playsInApp ? 'Plays full screen' : 'Opens in a new tab'));
    cover.addEventListener('click', () => play(Number(s.dataset.index)));

    s.append(el('div', 'stage'), cover, caption(game), rail(game));
    if (index === 0) s.append(el('div', 'swipe-hint', '⌃ Swipe up for more'));
    return s;
}

function caption(game) {
    const source = SOURCES[game.source] || SOURCES.other;
    const box = el('div', 'caption');
    box.append(
        el('span', 'chip', game.kind === 'builtin' ? 'Pukytoon original' : game.kind === 'studio' ? 'Made in the Studio' : `Made with ${source.name}`),
        el('h2', '', game.title),
        el('p', '', blurb(game)));
    if (fromEveryone(game)) box.append(el('p', 'by', game.ownerId === cloud.userId() ? 'Shared by you' : `by ${game.by}${game.handle ? ` · @${game.handle}` : ''}`));
    else if (game.cloudId) box.append(el('p', 'by', 'Shared with everyone'));
    return box;
}

function rail(game) {
    const box = el('div', 'rail');
    const liked = game.cloudId ? cloud.likes(game.cloudId) : store.likes().has(game.id);
    const likeItem = el('div', 'rail-item');
    const like = railButton(liked ? '♥' : '♡', 'Like');
    like.classList.toggle('liked', liked);
    like.setAttribute('aria-pressed', liked);
    likeItem.append(like);
    if (game.likesCount != null) likeItem.append(el('span', 'count', shortNumber(game.likesCount)));
    like.addEventListener('click', () => toggleLike(game));
    box.append(likeItem);

    if (game.slug || canShare(game)) {
        const share = railButton('⤴', 'Share');
        share.addEventListener('click', () => shareGame(game));
        box.append(share);
    }
    if (game.kind === 'link') {
        const open = railButton('↗', 'Open in the browser');
        open.addEventListener('click', () => openInBrowser(game.url));
        box.append(open);
    }
    if (game.kind === 'studio' && isMine(game)) {
        const edit = railButton('✎', 'Edit in the Studio');
        edit.addEventListener('click', () => openCreate(game));
        box.append(edit);
    }
    if (fromEveryone(game)) {
        const more = railButton('⋯', 'More');
        more.addEventListener('click', () => moreMenu(game));
        box.append(more);
    } else if (isLocal(game)) {
        const del = railButton('🗑', 'Remove from the feed');
        del.addEventListener('click', () => remove(game));
        box.append(del);
    }
    return box;
}

// Likes, share buttons and names change when someone signs in or out, or shares a game
function refreshSlides() {
    items.forEach((game, i) => {
        const s = feed.children[i];
        if (!s) return;
        s.querySelector('.caption')?.replaceWith(caption(game));
        s.querySelector('.rail')?.replaceWith(rail(game));
    });
}

function railButton(icon, label) {
    const b = el('button', '', icon);
    b.type = 'button';
    b.setAttribute('aria-label', label);
    b.title = label;
    return b;
}

function shortNumber(n) {
    return n >= 1e6 ? `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M` : n >= 1e4 ? `${Math.round(n / 1e3)}K` :
        n >= 1e3 ? `${(n / 1e3).toFixed(1).replace(/\.0$/, '')}K` : String(n);
}

function blurb(game) {
    if (game.kind === 'builtin' || game.kind === 'studio') return game.blurb;
    if (game.kind === 'code') return FORMAT_NAMES[game.format] || 'Game';
    return hostOf(game.url);
}

function hostOf(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return url; }
}

function addSlide() {
    const s = el('section', 'slide add-slide');
    s.dataset.index = items.length;
    const stage = el('div', 'stage');
    const button = el('button', 'big-add', '+');
    button.type = 'button';
    button.setAttribute('aria-label', 'Add a game');
    button.addEventListener('click', openSheet);
    const studio = el('button', 'studio-cta', '✦ Or make one in the Creator Studio');
    studio.type = 'button';
    studio.addEventListener('click', () => openCreate());
    stage.append(button, el('h2', '', 'Add your game'),
        el('p', '', 'Made a game with Claude, Gemini or Kimi? Drop its share link, or its code, and it joins your feed.'),
        studio);
    s.append(stage);
    return s;
}

// Games near the screen are loaded; the rest are dropped to keep the phone fast. Games run only while
// they're being played: in the feed they wait, paused, under their Play cover.
function setActive(index, again) {
    if (index === active && !again) return;
    active = index;
    [...feed.children].forEach((s, j) => {
        s.classList.toggle('active', j === index);
        if (j >= items.length) return; // the add screen
        if (Math.abs(j - index) <= KEEP_LOADED) mount(j);
        else unmount(j);
        if (!(again && playing && j === index)) tell(j, 'pause');
    });
    if (index > 0) feed.querySelector('.swipe-hint')?.remove();
    if (index >= items.length - 4) loadMore();
}

function mount(i) {
    const stage = feed.children[i].querySelector('.stage');
    const game = items[i];
    if (stage.firstChild) return;
    if (game.kind === 'link' && !game.embeddable) {
        stage.append(poster(game));
        return;
    }
    const frame = document.createElement('iframe');
    frame.title = game.title;
    frame.allow = 'fullscreen; gamepad; accelerometer; gyroscope; clipboard-write';
    if (game.kind === 'builtin') {
        frame.src = game.src;
    } else if (game.kind === 'studio') {
        frame.src = `studio/play.html#${encodeSpec(game.spec)}`;
    } else if (game.kind === 'link') {
        frame.setAttribute('sandbox', LINK_SANDBOX);
        frame.src = game.url;
    } else {
        frame.setAttribute('sandbox', CODE_SANDBOX);
        frame.srcdoc = buildDocument(game, store.loadSave(game.id));
    }
    // Messages sent before a page loads are lost, so tell it again once it has: wait, or play
    frame.addEventListener('load', () => {
        if (playing && i === active) startGame(i);
        else tell(i, 'pause');
    });
    stage.append(frame);
    bridge.register(frame, game.id, { embedded: true });
}

function unmount(i) {
    const stage = feed.children[i].querySelector('.stage');
    const frame = stage.querySelector('iframe');
    if (!frame) return;
    bridge.unregister(frame);
    stage.replaceChildren();
}

function remount(i) {
    unmount(i);
    mount(i);
}

function poster(game) {
    const p = el('div', 'poster');
    p.append(el('div', 'poster-emoji', emojiFor(game.id)), el('div', 'poster-host', hostOf(game.url)));
    return p;
}

function emojiFor(id) {
    let h = 0;
    for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return EMOJIS[h % EMOJIS.length];
}

// Through the bridge (sdk/pukytoon-sdk.js): pause, resume, start...
function tell(i, what) {
    const frame = feed.children[i]?.querySelector('iframe');
    if (frame) bridge.send(frame, what);
}

function startGame(i) {
    tell(i, 'resume');
    tell(i, 'start');
    const frame = feed.children[i]?.querySelector('iframe');
    if (frame) bridge.watch(frame, () => stuck(i));
}

// The game being played stopped answering the bridge's pings
function stuck(i) {
    const s = feed.children[i];
    if (!s || s.querySelector('.stuck')) return;
    const box = el('div', 'stuck');
    const reload = el('button', 'go', 'Reload');
    reload.type = 'button';
    reload.addEventListener('click', () => { box.remove(); remount(i); });
    const back = el('button', '', 'Back to feed');
    back.type = 'button';
    back.addEventListener('click', () => { box.remove(); exitPlay(); });
    const row = el('div', 'row');
    row.append(reload, back);
    box.append(el('h3', '', 'This game isn’t responding'), el('p', '', 'It may be stuck. Reload it to try again.'), row);
    s.append(box);
}

// --- Playing ---

// The feed stops scrolling and the game gets every touch, until Back
function play(i) {
    const game = items[i];
    if (!game) return;
    if (i !== active) { go(i); return; }
    if (game.kind === 'link' && !game.embeddable) { playOutsideFeed(game.url); return; }
    playing = true;
    document.body.classList.add('playing');
    playTitle.textContent = game.title;
    history.pushState({ pukytoonPlaying: true }, '');
    startGame(i);
    feed.children[i].querySelector('iframe')?.focus();
}

function exitPlay() {
    if (!playing) return;
    stopPlaying();
    if (history.state && history.state.pukytoonPlaying) history.back();
}

function stopPlaying() {
    playing = false;
    document.body.classList.remove('playing');
    bridge.unwatch();
    tell(active, 'pause');
    feed.children[active]?.querySelector('.stuck')?.remove();
}

// The browser's (and the phone's) back button leaves the game, or the Studio
window.addEventListener('popstate', () => {
    if (studioOpen()) {
        if (!closeStudio()) history.pushState({ pukytoonStudio: true }, '');   // kept, to save first
        return;
    }
    if (playing) stopPlaying();
});

function go(i) {
    feed.children[i]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// A quick flick always moves one game, even one too short for the browser's snapping to get there
let flick = null;
feed.addEventListener('touchstart', (e) => {
    flick = { y: e.touches[0].clientY, time: e.timeStamp, from: active };
}, { passive: true });
feed.addEventListener('touchend', (e) => {
    if (!flick || playing) return;
    const dy = flick.y - e.changedTouches[0].clientY;
    const quick = e.timeStamp - flick.time < 350 && Math.abs(dy) > 40;
    const from = flick.from;
    flick = null;
    if (quick) setTimeout(() => { if (active === from) go(from + Math.sign(dy)); }, 450);
}, { passive: true });

function playOutsideFeed(url) {
    if (playsInApp) plugins.InAppBrowser.openInWebView({ url, options: IN_APP_VIEW });
    else window.open(url, '_blank', 'noopener');
}

// The ↗ button: the page in the phone's own browser, for when someone wants it there
function openInBrowser(url) {
    if (playsInApp) plugins.InAppBrowser.openInExternalBrowser({ url });
    else window.open(url, '_blank', 'noopener');
}

// Redraws the feed without a game (or every game `gone` picks), staying where it was
function dropFromFeed(game, gone = g => g === game) {
    const i = items.indexOf(game);
    const neighbour = items.slice(i + 1).find(g => !gone(g)) || items.slice(0, i).reverse().find(g => !gone(g));
    render(neighbour && neighbour.id);
}

async function remove(game) {
    if (game.cloudId) {
        const where = await menu(`Remove “${game.title}”?`, 'You also shared it with everyone.', [
            { label: 'Remove it from this phone', value: 'here' },
            { label: 'Take it down for everyone too', value: 'everywhere', danger: true }]);
        if (!where) return;
        if (where === 'everywhere' && !(await takeDownOnline(game, { asked: true }))) return;
    } else if (!confirm(`Remove "${game.title}" from your feed?`)) {
        return;
    }
    store.removeGame(game.id);
    dropFromFeed(game);
}

$('btn-back').addEventListener('click', exitPlay);
$('btn-restart').addEventListener('click', () => {
    feed.children[active]?.querySelector('.stuck')?.remove();
    remount(active);
    feed.children[active].querySelector('iframe')?.focus();
});

// --- Likes, sharing, reports ---

async function toggleLike(game) {
    if (!game.cloudId) {
        store.toggleLike(game.id);
        refreshSlides();
        return;
    }
    if (!cloud.signedIn() || !cloud.me()) {
        await ensureAccount('Sign in to like games, and to share your own.');
        return;
    }
    const on = !cloud.likes(game.cloudId);
    if (game.likesCount != null) game.likesCount = Math.max(0, game.likesCount + (on ? 1 : -1));
    try {
        await cloud.setLike(game.cloudId, on);
    } catch (e) {
        if (game.likesCount != null) game.likesCount = Math.max(0, game.likesCount + (on ? -1 : 1));
        toast(e.message);
    }
    refreshSlides();
}

// Puts one of your games in everyone's feed (or its new version, if it's there already)
async function shareOnline(game) {
    if (!(await ensureAccount('Sign in to share your game with everyone.'))) {
        toast('Saved on this phone. Sign in to share it.');
        return false;
    }
    const publish = cloudId => game.kind === 'studio'
        ? cloud.publishStudio({ spec: game.spec, title: game.title, blurb: game.blurb, cloudId })
        : cloud.publishLink({ url: game.url, title: game.title });
    try {
        let r;
        try {
            r = await publish(game.cloudId);
        } catch (e) {
            if (!game.cloudId || !/not yours/.test(e.message)) throw e;
            r = await publish(null);   // the shared one is gone: share it again
        }
        store.updateGame(game.id, { cloudId: r.id, slug: r.slug });
        Object.assign(game, { cloudId: r.id, slug: r.slug });
        refreshSlides();
        toast('Shared with everyone');
        return true;
    } catch (e) {
        toast(e.message);
        return false;
    }
}

async function shareGame(game) {
    if (!game.slug) {
        const go = await menu(`Share “${game.title}”`, 'It goes in everyone’s Pukytoon feed, with your name on it. You can take it down any time.',
            [{ label: 'Share with everyone', value: true }]);
        if (!go || !(await shareOnline(game))) return;
    }
    const url = cloud.shareUrl(game.slug);
    if (native && plugins.Share) {   // the phone's own share sheet (the app's web view has no navigator.share)
        try {
            await plugins.Share.share({ title: game.title, text: `Play ${game.title} on Pukytoon`, url, dialogTitle: 'Share this game' });
        } catch (e) {
            // closed without sharing
        }
        return;
    }
    if (navigator.share) {
        try {
            await navigator.share({ title: game.title, text: `Play ${game.title} on Pukytoon`, url });
            return;
        } catch (e) {
            if (e.name === 'AbortError') return;
        }
    }
    try {
        await navigator.clipboard.writeText(url);
        toast('Link copied');
    } catch (e) {
        prompt('Copy this link:', url);
    }
}

async function moreMenu(game) {
    const mine = game.ownerId === cloud.userId();
    const options = [{ label: 'Copy the link', value: 'link' }];
    if (mine) {
        options.push({ label: 'Take it down', value: 'down', danger: true });
    } else {
        if (game.kind === 'studio') options.unshift({ label: '✦ Make your own version', value: 'remix' });
        options.push({ label: 'Report this game', value: 'report', danger: true },
                     { label: `Hide games by ${game.by}`, value: 'hide' });
    }
    const what = await menu(game.title, mine ? 'You shared this game.' : `by ${game.by}${game.handle ? ` · @${game.handle}` : ''}`, options);
    if (what === 'link') copyLink(game);
    else if (what === 'remix') openCreate(game, { remix: true });
    else if (what === 'report') reportGame(game);
    else if (what === 'hide') {
        store.block(game.ownerId);
        dropFromFeed(game, g => g.ownerId === game.ownerId);
        toast(`You won’t see games by ${game.by}`);
    } else if (what === 'down' && (await takeDownOnline(game))) {
        dropFromFeed(game);
    }
}

async function copyLink(game) {
    const url = cloud.shareUrl(game.slug);
    try {
        await navigator.clipboard.writeText(url);
        toast('Link copied');
    } catch (e) {
        prompt('Copy this link:', url);
    }
}

async function reportGame(game) {
    if (!(await ensureAccount('Sign in to report a game.'))) return;
    const reason = await menu('What’s wrong with it?', 'Games that several people report leave the feed until someone checks them.',
        cloud.REPORT_REASONS.map(([value, label]) => ({ label, value })));
    if (!reason) return;
    try {
        await cloud.report(game.cloudId, reason);
        toast('Thanks for telling us');
    } catch (e) {
        toast(e.message);
    }
}

// Out of everyone's feed; copies on this phone stay
async function takeDownOnline(game, { asked = false } = {}) {
    if (!(await ensureAccount('Sign in to take your game down.'))) return false;
    if (!asked && !(await menu(`Take down “${game.title}”?`, 'It leaves everyone’s feed, and its likes go. Copies on this phone stay.',
        [{ label: 'Take it down', value: true, danger: true }]))) return false;
    try {
        await cloud.unpublish(game.cloudId);
    } catch (e) {
        toast(e.message);
        return false;
    }
    forgetOnline(game.cloudId);
    toast('Taken down');
    return true;
}

function forgetOnline(cloudId) {
    online.games = online.games.filter(g => g.cloudId !== cloudId);
    if (online.first && online.first.cloudId === cloudId) online.first = null;
    for (const g of store.listGames()) {
        if (g.cloudId === cloudId) store.updateGame(g.id, { cloudId: null, slug: null });
    }
    for (const g of items) {
        if (g.cloudId === cloudId && isLocal(g)) Object.assign(g, { cloudId: null, slug: null });
    }
}

// A small sheet of choices; resolves with the value picked, or null
let menuDone = null;
function menu(title, text, options) {
    if (menuDone) menuDone();
    return new Promise(resolve => {
        const done = value => {
            $('menu').hidden = true;
            menuDone = null;
            resolve(value);
        };
        menuDone = () => done(null);
        $('menu-title').textContent = title;
        $('menu-text').textContent = text || '';
        $('menu-text').hidden = !text;
        $('menu-options').replaceChildren(...options.map(o => {
            const b = el('button', o.danger ? 'danger' : '', o.label);
            b.type = 'button';
            b.addEventListener('click', () => done(o.value));
            return b;
        }));
        $('menu').hidden = false;
        $('menu-options').firstChild?.focus();
    });
}
$('menu').querySelectorAll('[data-close]').forEach(n => n.addEventListener('click', () => menuDone && menuDone()));

// --- Account: an email code to sign in, then a name ---

const account = $('account');
let accountWaiting = null;   // resolves ensureAccount when the sheet closes
let accountEmail = '';
let accountStart = null;     // the step the sheet opened at: after signing in it closes, after a rename it goes back

function accountStep(step) {
    for (const id of ['acct-email', 'acct-code', 'acct-name', 'acct-me']) $(id).hidden = id !== `acct-${step}`;
    $('acct-error').textContent = '';
    if (step === 'me') {
        const p = cloud.me();
        $('acct-me-name').textContent = p.display_name;
        $('acct-me-detail').textContent = `@${p.handle} · ${cloud.email()}`;
    }
    if (step === 'name') {
        const p = cloud.me();
        $('acct-display').value = p ? p.display_name : '';
        $('acct-handle').value = p ? p.handle : '';
        $('acct-handle').dataset.edited = p ? '1' : '';
    }
    const focus = { email: 'acct-email-input', code: 'acct-code-input', name: 'acct-display' }[step];
    if (focus) setTimeout(() => $(focus).focus(), 50);
}

function openAccount(why) {
    $('acct-why').textContent = why || 'Share your games with everyone, and like theirs.';
    accountStart = cloud.signedIn() ? (cloud.me() ? 'me' : 'name') : 'email';
    accountStep(accountStart);
    account.hidden = false;
}

function closeAccount() {
    account.hidden = true;
    const waiting = accountWaiting;
    accountWaiting = null;
    if (waiting) waiting(cloud.signedIn() && !!cloud.me());
}

// Resolves true once someone is signed in with a name, false if they close the sheet instead
async function ensureAccount(why) {
    if (cloud.signedIn() && cloud.me()) return true;
    try {
        await cloud.start();
    } catch (e) {
        toast('No connection. Try again when you’re online.');
        return false;
    }
    if (cloud.signedIn() && cloud.me()) return true;
    if (accountWaiting) accountWaiting(false);
    return new Promise(resolve => {
        accountWaiting = resolve;
        openAccount(why);
    });
}

// Runs a step's request with its button busy; shows what went wrong
async function busy(formEl, work) {
    const button = formEl.querySelector('button[type=submit]');
    if (button) button.disabled = true;
    $('acct-error').textContent = '';
    try {
        await work();
    } catch (e) {
        $('acct-error').textContent = e.message;
    } finally {
        if (button) button.disabled = false;
    }
}

function handleFrom(name) {
    const h = name.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 20);
    return h.length >= 3 ? h : `player_${Math.floor(1000 + Math.random() * 9000)}`;
}

$('acct-email').addEventListener('submit', e => {
    e.preventDefault();
    busy(e.target, async () => {
        accountEmail = $('acct-email-input').value.trim();
        await cloud.sendCode(accountEmail);
        $('acct-email-shown').textContent = accountEmail;
        $('acct-code-input').value = '';
        accountStep('code');
    });
});
$('acct-code').addEventListener('submit', e => {
    e.preventDefault();
    busy(e.target, async () => {
        await cloud.verifyCode(accountEmail, $('acct-code-input').value);
        afterSignIn();
    });
});
$('acct-resend').addEventListener('click', () => busy($('acct-code'), async () => {
    await cloud.sendCode(accountEmail);
    toast('New code sent');
}));
$('acct-other').addEventListener('click', () => accountStep('email'));
$('acct-display').addEventListener('input', () => {
    if (!$('acct-handle').dataset.edited) $('acct-handle').value = handleFrom($('acct-display').value);
});
$('acct-handle').addEventListener('input', () => {
    const h = $('acct-handle');
    h.value = h.value.toLowerCase().replace(/[^a-z0-9_]/g, '');
    h.dataset.edited = '1';
});
$('acct-name').addEventListener('submit', e => {
    e.preventDefault();
    busy(e.target, async () => {
        const first = !cloud.me();
        await cloud.saveName({ display_name: $('acct-display').value.trim(), handle: $('acct-handle').value });
        if (first) toast(`Hi, ${cloud.me().display_name}!`);
        if (accountStart === 'me') accountStep('me');
        else closeAccount();
    });
});
$('acct-rename').addEventListener('click', () => accountStep('name'));
$('acct-signout').addEventListener('click', async () => {
    await cloud.signOut();
    closeAccount();
    toast('Signed out');
});
$('acct-delete').addEventListener('click', async () => {
    if (!confirm('Delete your Pukytoon account? Your name, and every game you shared, leave Pukytoon for good. ' +
                 'The games on this phone stay.')) return;
    try {
        const me = cloud.userId();
        const shared = store.listGames().filter(g => g.cloudId).map(g => g.cloudId);
        await cloud.deleteAccount();
        shared.forEach(forgetOnline);
        online.games = online.games.filter(g => g.ownerId !== me);
        if (online.first && online.first.ownerId === me) online.first = null;
        closeAccount();
        render(items[active] && items[active].id);
        toast('Your account is deleted');
    } catch (e) {
        $('acct-error').textContent = e.message;
    }
});
account.querySelectorAll('[data-close]').forEach(n => n.addEventListener('click', closeAccount));
$('btn-account').addEventListener('click', () => openAccount());

function afterSignIn() {
    if (!cloud.me()) {
        accountStep('name');
        return;
    }
    closeAccount();
    toast(`Signed in as ${cloud.me().display_name}`);
}

function updateAccountButton() {
    const b = $('btn-account');
    const p = cloud.me();
    b.textContent = p ? (Array.from(p.display_name.trim())[0] || '☺').toUpperCase() : '☺';
    b.classList.toggle('signed-in', !!p);
    b.setAttribute('aria-label', p ? `Your account (${p.display_name})` : 'Sign in');
}

cloud.onChange(() => {
    updateAccountButton();
    refreshSlides();
    // Signed in from the email's link on the website, with no name yet
    if (cloud.needsName() && account.hidden) openAccount();
    else if (!account.hidden && !$('acct-me').hidden && !cloud.signedIn()) closeAccount();
});

// --- Everyone's games ---

async function goOnline() {
    try {
        await cloud.start();
    } catch (e) {
        return; // offline: the games on the phone are enough
    }
    updateAccountButton();
    const slug = new URLSearchParams(location.search).get('g');
    const [first, page] = await Promise.all([
        slug ? cloud.bySlug(slug).catch(() => null) : null,
        cloud.feed().catch(() => null)
    ]);
    if (page) Object.assign(online, { last: page.last, more: page.more });
    if (slug && !first) toast('That game isn’t on Pukytoon any more');
    if (first && !playing) {
        online.first = first;
        online.games = page ? page.games : [];
        const local = store.listGames().find(g => g.cloudId === first.cloudId);
        render(local ? local.id : first.id);
    } else if (page) {
        appendOnline(page.games);
    }
    refreshSlides();
}

async function loadMore() {
    if (online.loading || !online.more || !cloud.ready()) return;
    online.loading = true;
    try {
        const page = await cloud.feed(online.last);
        Object.assign(online, { last: page.last, more: page.more });
        appendOnline(page.games);
    } catch (e) {
        // try again on the next swipe
    } finally {
        online.loading = false;
    }
}

// --- Creator Studio ---

// game: a studio game to edit; remix: start a new game from someone else's
function openCreate(game, { remix = false } = {}) {
    if (!sheet.hidden) closeSheet();
    const editing = remix ? null : game || null;
    history.pushState({ pukytoonStudio: true }, '');
    openStudio(remix ? { spec: game.spec, title: `${game.title} remix`.slice(0, 60) } : editing, {
        share: editing && !editing.cloudId && isLocal(editing) ? 'me' : 'everyone',
        onClose: () => { if (history.state && history.state.pukytoonStudio) history.back(); },
        onPublish: result => publishFromStudio(result, editing)
    });
}

async function publishFromStudio(result, editing) {
    const fields = { title: result.title, spec: result.spec, blurb: result.blurb };
    let id = editing && store.listGames().some(g => g.id === editing.id) ? editing.id : null;
    if (id) {
        store.updateGame(id, fields);
    } else {
        const made = { id: store.newId(), kind: 'studio', source: 'studio', added: Date.now(), ...fields };
        // One of yours from everyone's feed, made on another phone: this phone keeps it from now on
        if (editing && editing.cloudId && editing.ownerId === cloud.userId()) Object.assign(made, { cloudId: editing.cloudId, slug: editing.slug });
        try {
            store.addGame(made);
        } catch (err) {
            toast('Out of space for games. Remove one and try again.');
            return;
        }
        id = made.id;
    }
    render(id);
    const game = items.find(g => g.id === id);
    if (result.share !== 'everyone') {
        toast(game.cloudId ? 'Saved on this phone. Everyone still sees the version you shared.' : editing ? 'Saved' : 'Published to your feed');
        return;
    }
    await shareOnline(game);
}

$('btn-create').addEventListener('click', () => openCreate());
$('sheet-studio').addEventListener('click', () => openCreate());

// --- Add a game ---

function openSheet() {
    sheet.hidden = false;
    updateDetect();
    drop.focus();
}

function closeSheet() {
    sheet.hidden = true;
    drop.blur();
}

function updateDetect() {
    const info = detectInput(drop.value);
    saveBtn.disabled = !info;
    madeWith.hidden = !(info && info.kind === 'code');
    nameInput.placeholder = info ? `Name: ${guessTitle(info)}` : 'Name (optional)';
    if (!info) detectEl.textContent = '';
    else if (info.kind === 'link') {
        detectEl.textContent = `🔗 ${SOURCES[info.source].name} link · ` +
            (info.embeddable ? 'plays right in the feed'
                : playsInApp ? 'plays full screen in Pukytoon'
                : 'opens in a new tab here (paste its code to play it in the feed)');
    } else {
        detectEl.textContent = `</> ${FORMAT_NAMES[info.format]} · plays right in the feed`;
    }
}

form.addEventListener('submit', (e) => {
    e.preventDefault();
    const info = detectInput(drop.value);
    if (!info) return;
    const game = { id: store.newId(), kind: info.kind, title: nameInput.value.trim() || guessTitle(info), added: Date.now() };
    if (info.kind === 'link') Object.assign(game, { url: info.url, source: info.source, embeddable: info.embeddable });
    else Object.assign(game, { code: info.code, format: info.format, source: form.elements.source.value });
    try {
        store.addGame(game);
    } catch (err) {
        toast('Out of space for games. Remove one and try again.');
        return;
    }
    form.reset();
    closeSheet();
    render(game.id);
    toast(canShare(game) ? 'Added to your feed. Tap ⤴ to share it with everyone.' : 'Added to your feed');
});

async function loadFile(file) {
    if (!file) return;
    drop.value = await file.text();
    if (!nameInput.value) nameInput.value = file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ');
    updateDetect();
}

drop.addEventListener('input', updateDetect);
$('file').addEventListener('change', (e) => loadFile(e.target.files[0]));
sheet.addEventListener('dragover', (e) => e.preventDefault());
sheet.addEventListener('drop', (e) => {
    if (!e.dataTransfer.files.length) return; // dropped text lands in the box by itself
    e.preventDefault();
    loadFile(e.dataTransfer.files[0]);
});
sheet.querySelectorAll('[data-close]').forEach(n => n.addEventListener('click', closeSheet));
$('btn-add').addEventListener('click', openSheet);

let toastTimer;
function toast(text) {
    toastEl.textContent = text;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), Math.max(2200, text.length * 60));
}

// --- Keys and the phone's back button ---

// Closes whatever is on top; false when nothing was
function closeTop() {
    if (!$('menu').hidden) { menuDone && menuDone(); return true; }
    if (!account.hidden) { closeAccount(); return true; }
    if (studioOpen()) { closeStudio(); return true; }
    if (!sheet.hidden) { closeSheet(); return true; }
    if (playing) { exitPlay(); return true; }
    return false;
}

document.addEventListener('keydown', (e) => {
    const overlay = !$('menu').hidden || !account.hidden || studioOpen() || !sheet.hidden;
    if (overlay || playing) { if (e.key === 'Escape') closeTop(); return; }
    if (e.key === 'ArrowDown' || e.key === 'PageDown') { e.preventDefault(); go(active + 1); }
    if (e.key === 'ArrowUp' || e.key === 'PageUp') { e.preventDefault(); go(active - 1); }
});

// A sign-in email's link, tapped on this phone, opens the app with the account in it (cloud.APP_LINK)
async function signInFromLink(url) {
    try {
        if (!(await cloud.fromLink(url))) return;
    } catch (e) {
        toast(e.message);
        return;
    }
    if (!account.hidden && !$('acct-code').hidden) afterSignIn();   // they were waiting for the email
    else if (cloud.me()) toast(`Signed in as ${cloud.me().display_name}`);
    // with no name yet, the account sheet asks for one by itself (cloud.onChange)
}

if (native && plugins.App) {
    plugins.App.addListener('appUrlOpen', e => signInFromLink(e && e.url));
    if (plugins.App.getLaunchUrl) plugins.App.getLaunchUrl().then(r => r && signInFromLink(r.url)).catch(() => {});
    plugins.App.addListener('backButton', () => {
        if (!closeTop()) plugins.App.minimizeApp();
    });
}

render();
goOnline();
