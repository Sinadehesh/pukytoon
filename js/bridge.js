// The app's end of the Pukytoon bridge (sdk/pukytoon-sdk.js is the game's end): which frame is which game,
// checking and answering their messages, keeping their saves, and noticing a game that stops responding.
import * as store from './store.js';

const VERSION = 1;
const MAX_SAVE_CHARS = 262_144;   // 256 KB of saves per game
const MAX_PER_SECOND = 120;       // messages from one frame; the rest are dropped
const PING_EVERY = 2000;
const NOT_RESPONDING = 6000;      // no pong for this long while playing = "not responding"

const frames = new Map();         // a frame's window -> what we know about it
let watched = null;               // { frame, onUnresponsive, fired }

// persist: false for frames whose saves shouldn't be kept (the Studio's preview).
// embedded: the game sits under the feed's Play cover, so it needn't ask for a tap to start.
// onSave: told of each save once it's kept on the phone (the app also sends shared games' saves online).
export function register(frame, gameId, { persist = true, embedded = false, onReady, onError, onSave } = {}) {
    if (!frame.contentWindow) return;
    frames.set(frame.contentWindow, {
        frame, gameId, persist, embedded, onReady, onError, onSave,
        hello: false, ready: false, lastPong: 0, errors: 0, lastError: '',
        second: 0, count: 0
    });
}

export function unregister(frame) {
    if (frame.contentWindow) frames.delete(frame.contentWindow);
    if (watched && watched.frame === frame) watched = null;
}

export function info(frame) {
    return frame && frame.contentWindow ? frames.get(frame.contentWindow) || null : null;
}

// Sandboxed code games have no origin of their own ("null"), so they can only be reached with "*";
// they hold nothing but their own saves. Our own pages are reached by origin.
export function send(frame, type, payload) {
    const win = frame && frame.contentWindow;
    if (!win) return;
    const entry = frames.get(win);
    const target = !entry || entry.origin === 'null' || !entry.origin ? '*' : entry.origin;
    try { win.postMessage({ pukytoon: VERSION, type, payload: payload === undefined ? null : payload }, target); } catch (e) {}
}

export function broadcast(type, payload) {
    for (const entry of frames.values()) send(entry.frame, type, payload);
}

// The game being played: pinged every 2 s; onUnresponsive runs once if it stops answering
export function watch(frame, onUnresponsive) {
    const entry = info(frame);
    if (entry) entry.lastPong = Date.now();
    watched = { frame, onUnresponsive, fired: false };
}

export function unwatch() {
    watched = null;
}

function withinRate(entry) {
    const now = Math.floor(Date.now() / 1000);
    if (entry.second !== now) { entry.second = now; entry.count = 0; }
    return ++entry.count <= MAX_PER_SECOND;
}

function isPlainObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function jsonLength(v) {
    try { return JSON.stringify(v).length; } catch (e) { return Infinity; }
}

window.addEventListener('message', (e) => {
    const entry = frames.get(e.source);
    if (!entry) return;
    const d = e.data;
    if (!d || d.pukytoon !== VERSION || typeof d.type !== 'string') return;
    // Our pages answer from our origin; sandboxed code games from "null"
    if (e.origin !== location.origin && e.origin !== 'null') return;
    if (!withinRate(entry)) return;
    entry.origin = e.origin;

    switch (d.type) {
        case 'hello':
            entry.hello = true;
            entry.lastPong = Date.now();
            send(entry.frame, 'init', {
                save: entry.persist ? store.loadSave(entry.gameId) : {},
                embedded: entry.embedded
            });
            break;
        case 'ready':
            if (!entry.ready) {
                entry.ready = true;
                if (entry.onReady) entry.onReady();
            }
            break;
        case 'pong':
            entry.lastPong = Date.now();
            break;
        case 'save':
            if (entry.persist && isPlainObject(d.payload) && jsonLength(d.payload) <= MAX_SAVE_CHARS) {
                store.writeSave(entry.gameId, d.payload);
                if (entry.onSave) entry.onSave(d.payload);
            }
            break;
        case 'error':
            entry.errors++;
            entry.lastError = String((d.payload && d.payload.message) || 'Unknown error').slice(0, 2000);
            if (entry.onError) entry.onError(entry.lastError, entry.errors);
            break;
        case 'haptic':
            if (navigator.vibrate) navigator.vibrate(Math.max(1, Math.min(200, Number(d.payload && d.payload.ms) || 20)));
            break;
        // 'score' and 'event' are counted by the platform's telemetry once it has a server to send them to
    }
});

setInterval(() => {
    if (!watched || watched.fired || document.hidden) return;
    const entry = info(watched.frame);
    if (!entry || !entry.hello) return;   // only games that speak the bridge can be watched
    if (Date.now() - entry.lastPong > NOT_RESPONDING) {
        watched.fired = true;
        watched.onUnresponsive();
        return;
    }
    send(watched.frame, 'ping');
}, PING_EVERY);

// A paused phone shouldn't count as a frozen game: start counting again when the app comes back
document.addEventListener('visibilitychange', () => {
    if (document.hidden || !watched) return;
    const entry = info(watched.frame);
    if (entry) entry.lastPong = Date.now();
});
