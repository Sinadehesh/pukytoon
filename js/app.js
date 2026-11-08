// Pukytoon: swipe up and down through games, tap one to play it, add your own from a link or code, or make
// one in the Creator Studio.

import { SOURCES, FORMAT_NAMES, detectInput, guessTitle, buildDocument } from './runtime.js';
import * as store from './store.js';
import * as bridge from './bridge.js';
import { openStudio, closeStudio, isOpen as studioOpen } from './studio.js';
import { encodeSpec } from '../runtime/spec.js';

// Games that come with the app, always at the top of the feed. `src` is a page in games/, or a live
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

const feed = document.getElementById('feed');
const playTitle = document.getElementById('play-title');
const sheet = document.getElementById('sheet');
const form = document.getElementById('add-form');
const drop = document.getElementById('drop');
const detectEl = document.getElementById('detect');
const madeWith = document.getElementById('made-with');
const nameInput = document.getElementById('name');
const saveBtn = document.getElementById('btn-save');
const toastEl = document.getElementById('toast');

let items = [];      // the games in feed order
let active = -1;     // index of the slide on screen
let playing = false;

// --- Feed ---

function render(focusId) {
    items = [...BUILTIN, ...store.listGames()];
    const liked = store.likes();
    feed.querySelectorAll('iframe').forEach(f => bridge.unregister(f));
    feed.replaceChildren(...items.map((game, i) => slide(game, i, liked.has(game.id))), addSlide());
    active = -1;
    const i = focusId ? items.findIndex(g => g.id === focusId) : -1;
    if (i >= 0) feed.children[i].scrollIntoView({ block: 'start' });
    else feed.scrollTop = 0;
    feed.querySelectorAll('.slide').forEach(s => observer.observe(s));
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

function slide(game, index, liked) {
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
    cover.addEventListener('click', () => play(index));

    const caption = el('div', 'caption');
    caption.append(
        el('span', 'chip', game.kind === 'builtin' ? 'Pukytoon original' : game.kind === 'studio' ? 'Made in the Studio' : `Made with ${source.name}`),
        el('h2', '', game.title),
        el('p', '', blurb(game))
    );

    const rail = el('div', 'rail');
    const like = railButton(liked ? '♥' : '♡', 'Like');
    like.classList.toggle('liked', liked);
    like.setAttribute('aria-pressed', liked);
    like.addEventListener('click', () => {
        const on = store.toggleLike(game.id);
        like.textContent = on ? '♥' : '♡';
        like.classList.toggle('liked', on);
        like.setAttribute('aria-pressed', on);
    });
    rail.append(like);
    if (game.kind === 'link') {
        const open = railButton('↗', 'Open in the browser');
        open.addEventListener('click', () => openInBrowser(game.url));
        rail.append(open);
    }
    if (game.kind === 'studio') {
        const edit = railButton('✎', 'Edit in the Studio');
        edit.addEventListener('click', () => openCreate(game));
        rail.append(edit);
    }
    if (game.kind !== 'builtin') {
        const del = railButton('🗑', 'Remove from the feed');
        del.addEventListener('click', () => remove(game));
        rail.append(del);
    }

    s.append(el('div', 'stage'), cover, caption, rail);
    if (index === 0) s.append(el('div', 'swipe-hint', '⌃ Swipe up for more'));
    return s;
}

function railButton(icon, label) {
    const b = el('button', '', icon);
    b.type = 'button';
    b.setAttribute('aria-label', label);
    b.title = label;
    return b;
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
function setActive(index) {
    if (index === active) return;
    active = index;
    [...feed.children].forEach((s, j) => {
        s.classList.toggle('active', j === index);
        if (j >= items.length) return; // the add screen
        if (Math.abs(j - index) <= KEEP_LOADED) mount(j);
        else unmount(j);
        tell(j, 'pause');
    });
    if (index > 0) feed.querySelector('.swipe-hint')?.remove();
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

function remove(game) {
    if (!confirm(`Remove "${game.title}" from your feed?`)) return;
    const i = items.indexOf(game);
    store.removeGame(game.id);
    const neighbour = items[i + 1] || items[i - 1];
    render(neighbour && neighbour.id);
}

document.getElementById('btn-back').addEventListener('click', exitPlay);
document.getElementById('btn-restart').addEventListener('click', () => {
    feed.children[active]?.querySelector('.stuck')?.remove();
    remount(active);
    feed.children[active].querySelector('iframe')?.focus();
});

// --- Creator Studio ---

// game: a studio game to edit, or nothing for a new one
function openCreate(game) {
    if (!sheet.hidden) closeSheet();
    history.pushState({ pukytoonStudio: true }, '');
    openStudio(game || null, {
        onClose: () => { if (history.state && history.state.pukytoonStudio) history.back(); },
        onPublish: result => {
            if (result.id) {
                store.updateGame(result.id, { title: result.title, spec: result.spec, blurb: result.blurb });
                render(result.id);
                toast('Saved');
                return;
            }
            const made = { id: store.newId(), kind: 'studio', source: 'studio', title: result.title, spec: result.spec, blurb: result.blurb, added: Date.now() };
            try {
                store.addGame(made);
            } catch (err) {
                toast('Out of space for games. Remove one and try again.');
                return;
            }
            render(made.id);
            toast('Published to your feed');
        }
    });
}

document.getElementById('btn-create').addEventListener('click', () => openCreate());
document.getElementById('sheet-studio').addEventListener('click', () => openCreate());

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
    toast('Added to your feed');
});

async function loadFile(file) {
    if (!file) return;
    drop.value = await file.text();
    if (!nameInput.value) nameInput.value = file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ');
    updateDetect();
}

drop.addEventListener('input', updateDetect);
document.getElementById('file').addEventListener('change', (e) => loadFile(e.target.files[0]));
sheet.addEventListener('dragover', (e) => e.preventDefault());
sheet.addEventListener('drop', (e) => {
    if (!e.dataTransfer.files.length) return; // dropped text lands in the box by itself
    e.preventDefault();
    loadFile(e.dataTransfer.files[0]);
});
sheet.querySelectorAll('[data-close]').forEach(n => n.addEventListener('click', closeSheet));
document.getElementById('btn-add').addEventListener('click', openSheet);

let toastTimer;
function toast(text) {
    toastEl.textContent = text;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2200);
}

// --- Keys and the phone's back button ---

document.addEventListener('keydown', (e) => {
    if (studioOpen()) { if (e.key === 'Escape') closeStudio(); return; }
    if (!sheet.hidden) { if (e.key === 'Escape') closeSheet(); return; }
    if (playing) { if (e.key === 'Escape') exitPlay(); return; }
    if (e.key === 'ArrowDown' || e.key === 'PageDown') { e.preventDefault(); go(active + 1); }
    if (e.key === 'ArrowUp' || e.key === 'PageUp') { e.preventDefault(); go(active - 1); }
});

if (native && plugins.App) {
    plugins.App.addListener('backButton', () => {
        if (studioOpen()) closeStudio();
        else if (!sheet.hidden) closeSheet();
        else if (playing) exitPlay();
        else plugins.App.minimizeApp();
    });
}

render();
