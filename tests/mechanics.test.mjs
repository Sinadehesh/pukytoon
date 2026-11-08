// The gate every Creator Studio mechanic must pass, run on every push. Each mechanic boots in the real
// player page (studio/play.html) in harness mode, where the test steps the game itself:
//   boot          ready within 4 s
//   stability     60 s of random taps, drags and keys: default settings, all minimums, all maximums,
//                 a dark theme, and a run where every picture fails to load. No errors, no crash.
//   numbers       every variable the rules can read is still a finite number
//   network       nothing is fetched from outside the site
//   screen        the canvas isn't blank
//   determinism   the same seed and the same input give the same game, twice
//   playability   bots: the runner clears every obstacle at the easiest and hardest settings, match-3
//                 always has a move that scores, whack-a-mole can be played well
import { encodeSpec, OUT } from './helpers.mjs';
import { MECHANICS } from '../runtime/mechanics/index.js';

const STEPS = 3600;   // 60 s of game time

async function open(browser, url, spec, { seed = 1, noPictures = false } = {}) {
    const context = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
    const page = await context.newPage();
    const errors = [], outside = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => {
        if (m.type() === 'error' && !(noPictures && /Failed to load resource/.test(m.text()))) errors.push(m.text());
    });
    page.on('request', r => {
        const u = r.url();
        if (!u.startsWith(url) && !u.startsWith('data:') && !u.startsWith('blob:')) outside.push(u);
    });
    if (noPictures) await page.route('**/assets/library/sprites/**', r => r.abort());
    const t0 = Date.now();
    await page.goto(`${url}studio/play.html?harness&seed=${seed}#${encodeSpec(spec)}`);
    await page.waitForFunction(() => window.__puky && window.__puky.ready, null, { timeout: 15000 });
    return { page, context, errors, outside, bootMs: Date.now() - t0 };
}

// Random input, the same every time for a seed: a press, sometimes a drag, a release; sometimes a key
function inputScript(seed, chunks) {
    let s = seed * 7919 + 1;
    const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
    const keys = ['Space', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'Enter'];
    return Array.from({ length: chunks }, () => {
        const x = 20 + rnd() * 410, y = 140 + rnd() * 640, dx = (rnd() - 0.5) * 160, dy = (rnd() - 0.5) * 160;
        const events = [{ at: 0, type: 'down', x, y }];
        if (rnd() < 0.5) events.push({ at: 3, type: 'move', x: x + dx, y: y + dy });
        events.push({ at: 6, type: 'up', x: x + dx, y: y + dy });
        if (rnd() < 0.15) { const key = keys[Math.floor(rnd() * keys.length)]; events.push({ at: 10, type: 'key', key, down: true }, { at: 14, type: 'key', key, down: false }); }
        return events;
    });
}

// Plays the whole script in the page; restarts after each game over
async function play(page, script) {
    return page.evaluate(script => {
        const P = window.__puky;
        P.start();
        let rounds = 1;
        for (const events of script) {
            if (P.step(30, events) === 'end') { rounds++; P.restart(); }
            if (P.crashed) break;
        }
        return { rounds, vars: P.vars(), crashed: P.crashed, state: JSON.stringify(P.serialize()) };
    }, script);
}

const drawnColours = page => page.evaluate(() => {
    const c = document.getElementById('game');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    const seen = new Set();
    for (let i = 0; i < d.length; i += 4 * 61) seen.add(((d[i] >> 4) << 8) | ((d[i + 1] >> 4) << 4) | (d[i + 2] >> 4));
    return seen.size;
});

function extremes(props, which) {
    return Object.fromEntries(Object.entries(props).map(([k, p]) => [k,
        p.enum ? (which === 'min' ? p.enum[0] : p.enum.at(-1)) :
        p.type === 'boolean' ? which === 'max' :
        which === 'min' ? p.minimum : p.maximum]));
}

export async function run({ browser, url, check }) {
    for (const [key, load] of Object.entries(MECHANICS)) {
        const { manifest } = await load();
        const base = { spec: 1, mechanic: { key, version: manifest.version }, meta: { title: manifest.name } };
        const runs = [
            { label: 'defaults', params: {}, pack: 'barnyard', seed: 1 },
            { label: 'all minimums', params: extremes(manifest.params.properties, 'min'), pack: 'farm', seed: 1 },
            { label: 'all maximums', params: extremes(manifest.params.properties, 'max'), pack: 'sweets', seed: 1 },
            { label: 'dark theme', params: {}, pack: 'gems', seed: 2 },
            { label: 'every picture missing', params: {}, pack: 'pixel', seed: 3, noPictures: true }
        ];
        for (const r of runs) {
            const spec = { ...base, params: r.params, theme: { pack: r.pack } };
            const g = await open(browser, url, spec, r);
            const result = await play(g.page, inputScript(r.seed, STEPS / 30));
            const finite = Object.values(result.vars).every(Number.isFinite);
            const colours = await drawnColours(g.page);
            check(g.bootMs < 4000 && !result.crashed && !g.errors.length && finite && !g.outside.length && colours > 4,
                `${key} · ${r.label}: boots in ${g.bootMs} ms, 60 s of play over ${result.rounds} round(s), ` +
                (result.crashed || g.errors[0] || (!finite && 'a variable stopped being a number') ||
                 (g.outside.length && `fetched ${g.outside[0]}`) || (colours <= 4 && 'blank screen') || 'no problems'));
            if (r.label === 'defaults') await g.page.screenshot({ path: `${OUT}/mechanic-${key}.png` });
            await g.context.close();
        }

        // Determinism: two fresh pages, the same seed and input
        const spec = { ...base, params: {}, theme: { pack: 'barnyard' } };
        const script = inputScript(11, 40);
        const states = [];
        for (let i = 0; i < 2; i++) {
            const g = await open(browser, url, spec, { seed: 11 });
            states.push((await play(g.page, script)).state);
            await g.context.close();
        }
        check(states[0] === states[1], `${key} · the same seed and input give the same game`);

        const bot = BOTS[key];
        if (bot) await bot({ browser, url, base, check });
    }
}

const BOTS = {
    // Jumps so each obstacle passes under the top of the jump: if obstacles were ever too tall or too close
    // to clear at some setting, this loses a life
    async 'endless-runner'({ browser, url, base, check }) {
        const settings = [
            { label: 'default settings', params: {} },
            { label: 'slowest, lowest jump, strongest gravity', params: { speed: 4, jumpHeight: 2, gravity: 80, gap: 3 } },
            { label: 'fastest, highest jump, weakest gravity', params: { speed: 12, speedUp: 0.6, jumpHeight: 5, gravity: 20, gap: 3 } }
        ];
        for (const s of settings) {
            const p = { speed: 6, speedUp: 0.25, jumpHeight: 3, gravity: 45, ...s.params };
            const g = await open(browser, url, { ...base, params: s.params, theme: { pack: 'pets' }, rules: { win: null, lose: null } }, { seed: 4 });
            const v = await g.page.evaluate(({ speed, speedUp, jumpHeight, gravity }) => {
                const P = window.__puky;
                P.start();
                const acc = gravity * 50, up = Math.sqrt(2 * acc * jumpHeight * 50), half = up / acc;
                for (let i = 0; i < 3600; i++) {
                    const st = P.serialize();
                    const vx = (speed + speedUp * Math.floor(P.vars().time / 10)) * 50;
                    const ahead = st.obstacles.find(([x, h, w]) => x + w > 100);
                    const jump = st.y >= 640 && ahead && ahead[0] + ahead[2] / 2 - 120 <= vx * half;
                    P.step(1, jump ? [{ at: 0, type: 'key', key: 'Space', down: true }, { at: 0, type: 'key', key: 'Space', down: false }] : []);
                }
                return P.vars();
            }, p);
            check(v.lives === (s.params.lives || 3) && v.distance > 100, `endless-runner bot, ${s.label}: ${v.distance} m, lives left ${v.lives} of ${s.params.lives || 3}`);
            await g.context.close();
        }
    },

    // Finds a swap that makes a line, swipes it, and waits for the board to settle; 20 times
    async 'match-3'({ browser, url, base, check }) {
        const g = await open(browser, url, { ...base, params: {}, theme: { pack: 'sweets' }, rules: { win: null, lose: null } }, { seed: 6 });
        const v = await g.page.evaluate(() => {
            const P = window.__puky;
            P.start();
            const { cols, rows } = P.params();
            const cell = Math.floor(Math.min((450 - 28) / cols, 590 / rows));
            const x0 = (450 - cell * cols) / 2, y0 = 150 + (590 - cell * rows) / 2;
            const centre = (r, c) => ({ x: x0 + (c + 0.5) * cell, y: y0 + (r + 0.5) * cell });
            const lines = g => {
                for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
                    const k = g[r][c];
                    if (c + 2 < cols && g[r][c + 1] === k && g[r][c + 2] === k) return true;
                    if (r + 2 < rows && g[r + 1][c] === k && g[r + 2][c] === k) return true;
                }
                return false;
            };
            for (let move = 0; move < 20; move++) {
                const g = P.serialize().kinds.split('/').map(row => row.split(''));
                let found = null;
                for (let r = 0; r < rows && !found; r++) for (let c = 0; c < cols && !found; c++) {
                    for (const [dr, dc] of [[0, 1], [1, 0]]) {
                        if (r + dr >= rows || c + dc >= cols) continue;
                        const t = g.map(row => row.slice());
                        [t[r][c], t[r + dr][c + dc]] = [t[r + dr][c + dc], t[r][c]];
                        if (lines(t)) { found = [{ r, c }, { r: r + dr, c: c + dc }]; break; }
                    }
                }
                if (!found) return { stuck: true, ...P.vars() };
                const a = centre(found[0].r, found[0].c), b = centre(found[1].r, found[1].c);
                P.step(4, [{ at: 0, type: 'down', ...a }, { at: 1, type: 'move', ...b }, { at: 2, type: 'up', ...b }]);
                for (let i = 0; i < 600 && P.serialize().phase !== 'idle'; i++) P.step(1);
            }
            return P.vars();
        });
        check(!v.stuck && v.moves === 20 && v.score > 0, `match-3 bot: 20 moves, every one scored (${v.score} points, best chain ${v.combo})`);
        await g.context.close();
    },

    // Taps every good pop-up and leaves the bad ones
    async 'whack-a-mole'({ browser, url, base, check }) {
        const g = await open(browser, url, { ...base, params: {}, theme: { pack: 'barnyard' }, rules: { win: null, lose: null } }, { seed: 8 });
        const v = await g.page.evaluate(() => {
            const P = window.__puky;
            P.start();
            const holes = P.params().holes, cols = holes === 6 ? 2 : 3, rows = holes / cols;
            const span = Math.min(450 / cols, 570 / rows), size = span * 0.62;
            const at = i => {
                const r = Math.floor(i / cols), c = i % cols;
                return { x: 225 + (c - (cols - 1) / 2) * span, y: 190 + (r + 0.5) * (570 / rows) + size * 0.25 - size * 0.45 };
            };
            for (let i = 0; i < 3600; i += 6) {
                const states = P.serialize().holes.match(/[a-z]b?/g);
                const target = states.findIndex(s => s === 'u');
                P.step(6, target >= 0 ? [{ at: 0, type: 'down', ...at(target) }, { at: 1, type: 'up', ...at(target) }] : []);
            }
            return P.vars();
        });
        check(v.hits >= 40 && v.misses <= 3, `whack-a-mole bot: ${v.hits} hits and ${v.misses} misses in 60 s`);
        await g.context.close();
    }
};
