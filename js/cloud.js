// Pukytoon online (Supabase): accounts, the games everyone shares, likes and reports. All of it is optional:
// offline, or before anyone signs in, the feed carries on with the games on the phone.
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
    pending = next ? (async () => {
        const [p, l] = await Promise.all([
            client.from('users').select('id, handle, display_name').eq('id', next.id).limit(1),
            client.from('user_libraries').select('game_id').eq('list', 'favorite').limit(1000)
        ]);
        if (!user || user.id !== next.id) return;   // signed out, or someone else, meanwhile
        profile = (p.data && p.data[0]) || null;
        profileKnown = !p.error;
        liked = new Set((l.data || []).map(r => r.game_id));
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

// --- Signing in: a code by email (the app types it in), or the link in the same email (the website) ---

export async function sendCode(address) {
    await start();
    const here = native ? PUBLIC_URL : new URL('.', location.href).href;
    await run(client.auth.signInWithOtp({ email: address, options: { shouldCreateUser: true, emailRedirectTo: here } }));
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

export async function setLike(cloudId, on) {
    needAccount();
    if (on) {
        try {
            await run(client.from('user_libraries').insert({ user_id: user.id, game_id: cloudId, list: 'favorite' }));
        } catch (e) {
            if (!/already/.test(e.message) && !/duplicate/.test(e.message)) throw e;
        }
        liked.add(cloudId);
    } else {
        await run(client.from('user_libraries').delete().eq('user_id', user.id).eq('game_id', cloudId).eq('list', 'favorite'));
        liked.delete(cloudId);
    }
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
