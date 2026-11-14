// Pukytoon online (Supabase): accounts, the games everyone shares, likes, games saved for later, follows,
// saves and reports. All of it is optional: offline, or before anyone signs in, the feed carries on with
// the games on the phone.
// The database decides what each person may do (supabase/migrations/); this only asks.
import { SUPABASE_URL, SUPABASE_KEY, PUBLIC_URL } from './config.js';

export const PAGE = 24;   // games fetched at a time
const GAME_FIELDS = 'id, slug, title, description, source, source_url, made_with, likes_count, published_at, owner_id, ' +
    'owner:users!games_owner_id_fkey(handle, display_name), version:game_versions!games_current_version_fk(spec)';
const MADE_WITH = ['claude', 'gemini', 'kimi'];

const cap = window.Capacitor;
const native = !!(cap && cap.isNativePlatform && cap.isNativePlatform());

let client = null;
let starting = null;
let user = null;          // the signed-in account
let profile = null;       // their public name { id, handle, display_name }, once they've picked one
let profileKnown = false; // whether we managed to look it up (false offline)
let liked = new Set();    // ids of the games they like
let saved = new Set();    // ...and the ones they saved to play later
let followed = new Set(); // ids of the people they follow
let pending = null;       // the account being looked up
const listeners = new Set();

export class CloudError extends Error {}

// --- Starting ---

function loadScript(src) {
    return new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = src;
        s.onload = resolve;
        s.onerror = () => reject(new CloudError('Couldn’t load the sign-in code'));
        document.head.append(s);
    });
}

// Loads the Supabase client and whoever is signed in. Resolves once that's known, even offline.
export function start() {
    if (!starting) starting = (async () => {
        if (!window.supabase) await loadScript('js/vendor/supabase.js');
        client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
            auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit', storageKey: 'pukytoon.auth' }
        });
        // Supabase asks that nothing awaits inside this callback
        client.auth.onAuthStateChange((event, session) => {
            setTimeout(() => setUser(session ? session.user : null), 0);
        });
        const { data } = await client.auth.getSession();
        await setUser(data.session ? data.session.user : null);
    })();
    return starting;
}

async function setUser(next) {
    if ((next && next.id) === (user && user.id)) {
        user = next || user;
        return pending;
    }
    user = next;
    profile = null;
    profileKnown = false;
    liked = new Set();
    saved = new Set();
    followed = new Set();
    pending = next ? (async () => {
        const [p, l, f] = await Promise.all([
            client.from('users').select('id, handle, display_name').eq('id', next.id).limit(1),
            client.from('user_libraries').select('game_id, list').limit(2000),
            client.from('follows').select('followee_id').eq('follower_id', next.id).limit(1000)
        ]);
        if (!user || user.id !== next.id) return;   // signed out, or someone else, meanwhile
        profile = (p.data && p.data[0]) || null;
        profileKnown = !p.error;
        const lists = l.data || [];
        liked = new Set(lists.filter(r => r.list === 'favorite').map(r => r.game_id));
        saved = new Set(lists.filter(r => r.list === 'saved').map(r => r.game_id));
        followed = new Set((f.data || []).map(r => r.followee_id));
    })().catch(() => {}) : null;
    await pending;
    emit();
}

function emit() { listeners.forEach(fn => { try { fn(); } catch (e) { console.error(e); } }); }
export function onChange(fn) { listeners.add(fn); }

export const ready = () => !!client;
export const signedIn = () => !!user;
export const me = () => profile;                  // null until they've picked a name
export const needsName = () => !!user && profileKnown && !profile;
export const email = () => (user && user.email) || '';
export const userId = () => (user && user.id) || null;
export const likes = id => liked.has(id);
export const isSaved = id => saved.has(id);
export const follows = personId => followed.has(personId);
export const counts = () => ({ saved: saved.size, following: followed.size });

// --- Errors people can act on ---

function fail(error) {
    const m = (error && error.message) || String(error);
    const code = error && error.code;
    if (/Failed to fetch|NetworkError|Load failed|network/i.test(m)) return new CloudError('No connection. Try again when you’re online.');
    if (/expired or is invalid|invalid.*otp|otp.*invalid/i.test(m)) return new CloudError('That code didn’t work. Check it, or get a new one.');
    if (/JWT expired|invalid JWT|not authenticated/i.test(m)) return new CloudError('Please sign in again.');
    if (code === '23505' && /handle|users_handle/.test(m)) return new CloudError('That @name is taken. Try another one.');
    if (code === '23514' && /handle/.test(m)) return new CloudError('An @name has 3 to 24 small letters, numbers or _');
    if (code === '23505' && /report/.test(m)) return new CloudError('You’ve already reported this game. Thanks!');
    return new CloudError(m);
}

async function run(query) {
    let result;
    try { result = await query; } catch (e) { throw fail(e); }
    if (result.error) throw fail(result.error);
    return result.data;
}

function needAccount() {
    if (!client || !user) throw new CloudError('Sign in first');
}

// --- Signing in: the link in an emailed message, or the code in it once the email template has one ---

// Where a sign-in email's link brings people back: the website, or in the Android app the app's own address
// (AndroidManifest.xml), so the link opens the app signed in. Both are allowed in Supabase's redirect URLs.
export const APP_LINK = 'com.sinadehesh.pukytoon://login';

export async function sendCode(address) {
    await start();
    const back = native ? APP_LINK : new URL('.', location.href).href;
    await run(client.auth.signInWithOtp({ email: address, options: { shouldCreateUser: true, emailRedirectTo: back } }));
}

// A sign-in link that opened the app: APP_LINK#access_token=…&refresh_token=…, or #error_description=… when
// it had expired or was used already. True when it signed someone in; anything else isn't a sign-in link.
export async function fromLink(url) {
    if (typeof url !== 'string' || !url.startsWith(APP_LINK)) return false;
    await start();
    const params = new URLSearchParams(url.split('#')[1] || url.split('?')[1] || '');
    if (params.get('error') || params.get('error_description')) {
        throw new CloudError('That sign-in link has expired or was used already. Ask for a new one.');
    }
    const access_token = params.get('access_token'), refresh_token = params.get('refresh_token');
    if (!access_token || !refresh_token) return false;
    const data = await run(client.auth.setSession({ access_token, refresh_token }));
    await setUser(data.user || (data.session && data.session.user) || null);
    return true;
}

export async function verifyCode(address, code) {
    await start();
    const data = await run(client.auth.verifyOtp({ email: address, token: code.replace(/\s+/g, ''), type: 'email' }));
    await setUser(data.user || (data.session && data.session.user) || null);
}

// A new name, or a change to theirs (signed-in people may write only these columns, so no upsert)
export async function saveName({ display_name, handle }) {
    needAccount();
    const change = () => run(client.from('users').update({ display_name, handle }).eq('id', user.id));
    if (profile) {
        await change();
    } else {
        const { error } = await client.from('users').insert({ id: user.id, display_name, handle });
        if (error && error.code === '23505' && /users_pkey/.test(error.message)) await change();   // made on another phone
        else if (error) throw fail(error);
    }
    profile = { id: user.id, display_name, handle };
    profileKnown = true;
    emit();
}

export async function signOut() {
    if (!client) return;
    const { error } = await client.auth.signOut();
    if (error) await client.auth.signOut({ scope: 'local' });
    await setUser(null);
}

// Takes their profile, games, likes and follows with it
export async function deleteAccount() {
    needAccount();
    await run(client.rpc('delete_my_account'));
    await client.auth.signOut({ scope: 'local' });
    await setUser(null);
}

// --- Games ---

// A database row as a feed game; null for anything the app can't play
function toGame(row) {
    const owner = row.owner || {};
    const base = {
        id: 'c-' + row.id, cloudId: row.id, slug: row.slug, title: row.title, ownerId: row.owner_id,
        by: owner.display_name || owner.handle || 'someone', handle: owner.handle || '', likesCount: row.likes_count || 0
    };
    if (row.source === 'studio' && row.version && row.version.spec && typeof row.version.spec === 'object') {
        return { ...base, kind: 'studio', source: 'studio', spec: row.version.spec, blurb: row.description || '' };
    }
    if (row.source === 'link_card' && /^https:\/\//.test(row.source_url || '')) {
        return { ...base, kind: 'link', source: MADE_WITH.includes(row.made_with) ? row.made_with : 'other', url: row.source_url, embeddable: false };
    }
    return null;
}

// The newest games everyone shared; `before` (a published_at) for the next page
export async function feed(before) {
    await start();
    let q = client.from('games').select(GAME_FIELDS).eq('visibility', 'public').eq('status', 'published')
        .order('published_at', { ascending: false }).limit(PAGE);
    if (before) q = q.lt('published_at', before);
    const rows = await run(q);
    return { games: rows.map(toGame).filter(Boolean), last: rows.length ? rows[rows.length - 1].published_at : null, more: rows.length === PAGE };
}

export async function bySlug(slug) {
    await start();
    const rows = await run(client.from('games').select(GAME_FIELDS).eq('slug', slug).limit(1));
    return rows.length ? toGame(rows[0]) : null;
}

// A Studio game to everyone, or a new version of one already shared (cloudId)
export async function publishStudio({ spec, title, blurb, cloudId }) {
    needAccount();
    return run(client.rpc('publish_studio_game', { spec, name: title, blurb: blurb || null, game: cloudId || null }));
}

// A Claude, Gemini or Kimi link to everyone
export async function publishLink({ url, title }) {
    needAccount();
    return run(client.rpc('publish_link_game', { url, name: title }));
}

export async function unpublish(cloudId) {
    needAccount();
    const rows = await run(client.from('games').delete().eq('id', cloudId).select('id'));
    if (!rows.length) throw new CloudError('That game isn’t yours to take down');
}

// A game in, or out of, one of their lists: 'favorite' (a like, counted on the game) or 'saved' (to play later)
async function setInList(list, set, cloudId, on) {
    needAccount();
    if (on) {
        try {
            await run(client.from('user_libraries').insert({ user_id: user.id, game_id: cloudId, list }));
        } catch (e) {
            if (!/already/.test(e.message) && !/duplicate/.test(e.message)) throw e;
        }
        set.add(cloudId);
    } else {
        await run(client.from('user_libraries').delete().eq('user_id', user.id).eq('game_id', cloudId).eq('list', list));
        set.delete(cloudId);
    }
}

export const setLike = (cloudId, on) => setInList('favorite', liked, cloudId, on);
export const setSaved = (cloudId, on) => setInList('saved', saved, cloudId, on);

// The games they saved to play later, the last one saved first (games taken down since drop out)
export async function savedGames() {
    needAccount();
    const rows = await run(client.from('user_libraries').select(`created_at, game:games(${GAME_FIELDS})`)
        .eq('list', 'saved').order('created_at', { ascending: false }).limit(100));
    return rows.map(r => r.game && toGame(r.game)).filter(Boolean);
}

export async function setFollow(personId, on) {
    needAccount();
    if (on) {
        try {
            await run(client.from('follows').insert({ follower_id: user.id, followee_id: personId }));
        } catch (e) {
            if (!/duplicate/.test(e.message)) throw e;
        }
        followed.add(personId);
    } else {
        await run(client.from('follows').delete().eq('follower_id', user.id).eq('followee_id', personId));
        followed.delete(personId);
    }
}

// The newest games by the people they follow
export async function followingGames() {
    needAccount();
    if (!followed.size) return [];
    const rows = await run(client.from('games').select(GAME_FIELDS).in('owner_id', [...followed].slice(0, 200))
        .eq('visibility', 'public').eq('status', 'published').order('published_at', { ascending: false }).limit(PAGE));
    return rows.map(toGame).filter(Boolean);
}

// --- Saves online: what games keep through Pukytoon.save, for the games everyone shares, so a player's
// progress and best scores follow them to another phone. The database stamps each write with its own clock.

export async function cloudSaves() {
    needAccount();
    return run(client.from('game_saves').select('game_id, data, updated_at').limit(1000));
}

// Returns when the database took it (its updated_at)
export async function putSave(cloudId, data) {
    needAccount();
    const rows = await run(client.from('game_saves').upsert({ user_id: user.id, game_id: cloudId, data }, { onConflict: 'user_id,game_id' })
        .select('updated_at'));
    return rows[0] ? rows[0].updated_at : null;
}

export const REPORT_REASONS = [
    ['broken', 'It doesn’t work'],
    ['offensive', 'Rude, hateful or violent'],
    ['phishing', 'A scam, or asks for passwords'],
    ['malicious', 'Harmful to phones or people'],
    ['ip_infringement', 'Copied from someone else'],
    ['spam', 'Spam'],
    ['other', 'Something else']
];

export async function report(cloudId, reason, details) {
    needAccount();
    await run(client.from('reviews_reports').insert({ kind: 'player_report', game_id: cloudId, reporter_id: user.id, reason, details: details || null }));
}

// The address that opens the feed at this game
export function shareUrl(slug) {
    const base = native || !/^https?:/.test(location.protocol) ? PUBLIC_URL : new URL('.', location.href).href;
    return `${base}?g=${encodeURIComponent(slug)}`;
}
