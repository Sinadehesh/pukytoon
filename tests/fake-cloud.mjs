// A stand-in for Pukytoon's Supabase project: just enough of its REST and sign-in APIs, kept in memory, so
// the tests never touch the real one. Every browser context the tests open gets one (tests/run.mjs), as
// context.cloud: tests put games and people in it, and look at what the app sent.
// What it answers follows what the real database does (supabase/migrations/, checked by supabase/tests/).
import { SUPABASE_URL, SUPABASE_KEY } from '../js/config.js';

const CORS = {
    'access-control-allow-origin': '*', 'access-control-allow-headers': '*',
    'access-control-allow-methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS', 'access-control-expose-headers': '*'
};
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
let ids = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`;

export async function fakeCloud(context) {
    const db = {
        users: [],      // profiles: { id, handle, display_name }
        accounts: {},   // email -> { id, email }
        games: [],      // { id, slug, title, description, source, source_url, made_with, owner_id, likes_count, published_at, visibility, status, spec }
        likes: [],      // { user_id, game_id }
        reports: [],    // { game_id, reporter_id, reason, details }
        codes: {},      // email -> the code "emailed"
        calls: [],      // "METHOD /path" of every request
        down: false,    // true: every request fails like a dropped connection
        latency: 150,   // ms before each answer, as over a phone's connection (races show up)

        // Helpers for the tests
        person(handle, display_name) {
            const id = uuid();
            this.accounts[`${handle}@test.invalid`] = { id, email: `${handle}@test.invalid` };
            this.users.push({ id, handle, display_name });
            return id;
        },
        studioGame(owner, title, spec, ago = 0) {
            return this.add({ owner_id: owner, title, source: 'studio', made_with: 'studio', spec, description: `${spec.mechanic.key} game` }, ago);
        },
        linkGame(owner, title, url, made_with, ago = 0) {
            return this.add({ owner_id: owner, title, source: 'link_card', source_url: url, made_with }, ago);
        },
        add(row, ago = 0) {
            const g = { id: uuid(), slug: `${row.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${String(ids).padStart(6, '0')}`,
                        description: null, likes_count: 0, visibility: 'public', status: 'published',
                        published_at: new Date(Date.now() - ago * 60000).toISOString(), ...row };
            this.games.push(g);
            return g;
        }
    };

    function session(account) {
        const now = Math.floor(Date.now() / 1000);
        const token = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: account.id, email: account.email, role: 'authenticated', aud: 'authenticated', exp: now + 3600, iat: now })}.fake`;
        return {
            access_token: token, token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: `refresh-${account.id}`,
            user: { id: account.id, aud: 'authenticated', role: 'authenticated', email: account.email, app_metadata: { provider: 'email' },
                    user_metadata: {}, identities: [], created_at: new Date().toISOString(), updated_at: new Date().toISOString() }
        };
    }

    // Who's asking: the user id in the bearer token, or null for the publishable key
    function caller(headers) {
        const auth = headers.authorization || '';
        const token = auth.replace(/^Bearer /i, '');
        if (!token || token === SUPABASE_KEY) return null;
        try { return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).sub; } catch (e) { return null; }
    }

    // Filters PostgREST style: column=eq.value, column=lt.value
    function matches(row, params) {
        for (const [k, v] of params) {
            if (['select', 'order', 'limit', 'on_conflict', 'offset'].includes(k)) continue;
            const [op, ...rest] = v.split('.');
            const want = rest.join('.');
            const have = row[k] == null ? '' : String(row[k]);
            if (op === 'eq' && have !== want) return false;
            if (op === 'lt' && !(have < want)) return false;
        }
        return true;
    }

    const asRow = g => {
        const owner = db.users.find(u => u.id === g.owner_id);
        return {
            id: g.id, slug: g.slug, title: g.title, description: g.description, source: g.source, source_url: g.source_url || null,
            made_with: g.made_with, likes_count: g.likes_count, published_at: g.published_at, owner_id: g.owner_id,
            owner: owner ? { handle: owner.handle, display_name: owner.display_name } : null,
            version: g.source === 'studio' ? { spec: g.spec } : null
        };
    };

    const err = (status, code, message) => ({ status, body: { code, message, details: null, hint: null } });

    function handle(method, path, params, headers, body) {
        const me = caller(headers);

        // --- Sign-in ---
        if (path === '/auth/v1/otp' && method === 'POST') {
            db.codes[body.email] = '424242';
            if (!db.accounts[body.email]) db.accounts[body.email] = { id: uuid(), email: body.email, fresh: true };
            return { status: 200, body: {} };
        }
        if (path === '/auth/v1/verify' && method === 'POST') {
            if (!body.email || db.codes[body.email] !== body.token) {
                return { status: 403, body: { code: 403, error_code: 'otp_expired', msg: 'Token has expired or is invalid' } };
            }
            delete db.codes[body.email];
            return { status: 200, body: session(db.accounts[body.email]) };
        }
        if (path === '/auth/v1/user' && method === 'GET') {
            const account = Object.values(db.accounts).find(a => a.id === me);
            return account ? { status: 200, body: session(account).user } : { status: 401, body: { msg: 'invalid JWT' } };
        }
        if (path === '/auth/v1/logout') return { status: 204 };
        if (path === '/auth/v1/token') {
            const account = Object.values(db.accounts).find(a => `refresh-${a.id}` === body.refresh_token);
            return account ? { status: 200, body: session(account) } : { status: 400, body: { msg: 'Invalid Refresh Token' } };
        }

        // --- Tables ---
        if (path === '/rest/v1/users') {
            if (method === 'GET') return { status: 200, body: db.users.filter(u => matches(u, params)).slice(0, Number(params.get('limit')) || 1000) };
            // Signed-in people may insert their own row and update their name columns; an upsert would also
            // write id, which they may not (the real API answers 42501, as here)
            if (method === 'POST' || method === 'PATCH') {
                if (!me) return err(401, '42501', 'permission denied for table users');
                if (params.get('on_conflict') || headers.prefer?.includes('resolution=')) return err(403, '42501', 'permission denied for table users');
                const mine = db.users.find(u => u.id === me);
                if (method === 'POST' && body.id !== me) return err(403, '42501', 'new row violates row-level security policy for table "users"');
                if (method === 'POST' && mine) return err(409, '23505', 'duplicate key value violates unique constraint "users_pkey"');
                if (method === 'PATCH' && (!mine || !matches(mine, params))) return { status: 204 };
                if (!/^[a-z0-9_]{3,24}$/.test(body.handle || '')) return err(400, '23514', 'new row for relation "users" violates check constraint "users_handle_check"');
                if (db.users.some(u => u.handle === body.handle && u.id !== me)) return err(409, '23505', 'duplicate key value violates unique constraint "users_handle_key"');
                if (mine) Object.assign(mine, { handle: body.handle, display_name: body.display_name });
                else db.users.push({ id: me, handle: body.handle, display_name: body.display_name });
                return { status: method === 'POST' ? 201 : 204 };
            }
        }
        if (path === '/rest/v1/games') {
            if (method === 'GET') {
                let rows = db.games.filter(g => (g.visibility !== 'private' && g.status === 'published') || g.owner_id === me).filter(g => matches(g, params));
                if ((params.get('order') || '').startsWith('published_at.desc')) rows.sort((a, b) => (a.published_at < b.published_at ? 1 : -1));
                return { status: 200, body: rows.slice(0, Number(params.get('limit')) || 1000).map(asRow) };
            }
            if (method === 'DELETE') {
                const gone = db.games.filter(g => g.owner_id === me && matches(g, params));
                db.games = db.games.filter(g => !gone.includes(g));
                return { status: 200, body: gone.map(g => ({ id: g.id })) };
            }
        }
        if (path === '/rest/v1/user_libraries') {
            if (!me) return err(401, '42501', 'permission denied for table user_libraries');
            if (method === 'GET') return { status: 200, body: db.likes.filter(l => l.user_id === me).map(l => ({ game_id: l.game_id })) };
            const game = db.games.find(g => g.id === (method === 'POST' ? body.game_id : (params.get('game_id') || '').slice(3)));
            if (method === 'POST') {
                if (db.likes.some(l => l.user_id === me && l.game_id === body.game_id)) return err(409, '23505', 'duplicate key value violates unique constraint "user_libraries_pkey"');
                db.likes.push({ user_id: me, game_id: body.game_id });
                if (game) game.likes_count++;
                return { status: 201 };
            }
            if (method === 'DELETE') {
                const before = db.likes.length;
                db.likes = db.likes.filter(l => !(l.user_id === me && game && l.game_id === game.id));
                if (game && db.likes.length < before) game.likes_count--;
                return { status: 204 };
            }
        }
        if (path === '/rest/v1/reviews_reports' && method === 'POST') {
            if (!me || body.reporter_id !== me) return err(403, '42501', 'new row violates row-level security policy for table "reviews_reports"');
            if (db.reports.some(r => r.reporter_id === me && r.game_id === body.game_id)) {
                return err(409, '23505', 'duplicate key value violates unique constraint "one_open_report_per_reporter"');
            }
            db.reports.push({ game_id: body.game_id, reporter_id: me, reason: body.reason, details: body.details });
            return { status: 201 };
        }

        // --- Functions ---
        if (path.startsWith('/rest/v1/rpc/')) {
            const fn = path.slice('/rest/v1/rpc/'.length);
            if (!me) return err(401, '42501', `permission denied for function ${fn}`);
            if (fn === 'delete_my_account') {
                db.users = db.users.filter(u => u.id !== me);
                db.games = db.games.filter(g => g.owner_id !== me);
                db.likes = db.likes.filter(l => l.user_id !== me);
                for (const [email, a] of Object.entries(db.accounts)) if (a.id === me) delete db.accounts[email];
                return { status: 204 };
            }
            if (!db.users.some(u => u.id === me)) return err(400, 'P0001', 'Pick a name before you publish');
            if (fn === 'publish_studio_game') {
                if (!body.spec || body.spec.spec !== 1) return err(400, 'P0001', 'That is not a Creator Studio game');
                if (body.game) {
                    const g = db.games.find(x => x.id === body.game && x.owner_id === me);
                    if (!g) return err(400, 'P0001', 'That game is not yours to change');
                    Object.assign(g, { spec: body.spec, title: body.name, description: body.blurb ?? g.description, version: (g.version || 1) + 1 });
                    return { status: 200, body: { id: g.id, slug: g.slug, version: g.version } };
                }
                const g = db.add({ owner_id: me, title: body.name, source: 'studio', made_with: 'studio', spec: body.spec, description: body.blurb });
                return { status: 200, body: { id: g.id, slug: g.slug, version: 1 } };
            }
            if (fn === 'publish_link_game') {
                const made_with = /claude\.ai/.test(body.url) ? 'claude' : /gemini|g\.co/.test(body.url) ? 'gemini' : /kimi/.test(body.url) ? 'kimi' : null;
                if (!made_with) return err(400, 'P0001', 'Only Claude, Gemini and Kimi links can be shared with everyone for now');
                const same = db.games.find(g => g.source_url === body.url);
                if (same && same.owner_id !== me) return err(400, 'P0001', 'Someone already shared this game: it’s in the feed');
                const g = same || db.add({ owner_id: me, title: body.name, source: 'link_card', source_url: body.url, made_with });
                return { status: 200, body: { id: g.id, slug: g.slug, version: 1 } };
            }
        }
        return { status: 404, body: { message: `fake cloud has no ${method} ${path}` } };
    }

    await context.route(`${SUPABASE_URL}/**`, async route => {
        const req = route.request();
        const u = new URL(req.url());
        if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
        db.calls.push(`${req.method()} ${u.pathname}`);
        if (db.down) return route.abort('internetdisconnected');
        let body = null;
        try { body = req.postData() ? JSON.parse(req.postData()) : null; } catch (e) {}
        const out = handle(req.method(), u.pathname, u.searchParams, req.headers(), body || {});
        await new Promise(r => setTimeout(r, db.latency));
        await route.fulfill({
            status: out.status, headers: { ...CORS, 'content-type': 'application/json' },
            body: out.body === undefined ? '' : JSON.stringify(out.body)
        });
    });
    return db;
}
