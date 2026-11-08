// What Pukytoon keeps on the phone: the games you added or made, the ones you liked, each code game's saves,
// and whose games you've hidden. Everything lives in the app's localStorage.

const GAMES_KEY = 'pukytoon.games.v1';
const LIKES_KEY = 'pukytoon.likes.v1';
const SAVE_PREFIX = 'pukytoon.save.';
const MAX_SAVE_CHARS = 1_000_000; // per game

function read(key, fallback) {
    try {
        const value = localStorage.getItem(key);
        return value ? JSON.parse(value) : fallback;
    } catch (e) {
        return fallback;
    }
}

// Throws when the phone's storage for the app is full, so the caller can say so
function write(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
}

// Newest first
export function listGames() {
    return read(GAMES_KEY, []);
}

export function addGame(game) {
    write(GAMES_KEY, [game, ...listGames()]);
}

export function updateGame(id, changes) {
    write(GAMES_KEY, listGames().map(g => (g.id === id ? { ...g, ...changes } : g)));
}

export function removeGame(id) {
    write(GAMES_KEY, listGames().filter(g => g.id !== id));
    try { localStorage.removeItem(SAVE_PREFIX + id); } catch (e) {}
    const liked = likes();
    if (liked.delete(id)) write(LIKES_KEY, [...liked]);
}

export function likes() {
    return new Set(read(LIKES_KEY, []));
}

export function toggleLike(id) {
    const liked = likes();
    if (!liked.delete(id)) liked.add(id);
    try { write(LIKES_KEY, [...liked]); } catch (e) {}
    return liked.has(id);
}

export function loadSave(id) {
    return read(SAVE_PREFIX + id, {});
}

export function writeSave(id, data) {
    try {
        const text = JSON.stringify(data);
        if (text.length <= MAX_SAVE_CHARS) localStorage.setItem(SAVE_PREFIX + id, text);
    } catch (e) {}
}

// People whose games they don't want to see (their user ids)
const BLOCKED_KEY = 'pukytoon.blocked.v1';
export function blocked() {
    return new Set(read(BLOCKED_KEY, []));
}

export function block(userId) {
    const set = blocked();
    set.add(userId);
    try { write(BLOCKED_KEY, [...set]); } catch (e) {}
}

export function newId() {
    return 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}
