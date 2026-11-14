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
    const only = process.env.MECHANIC ? process.env.MECHANIC.split(',') : null;   // MECHANIC=snake,quiz: just those
    for (const [key, load] of Object.entries(MECHANICS)) {
        if (only && !only.includes(key)) continue;
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
    // Goes for the food by the shortest way that leaves it room to move: if rocks ever walled food off, or
    // the snake couldn't come back after a crash, this loses lives or stops eating
    async snake({ browser, url, base, check }) {
        const settings = [
            { label: 'default settings', params: {} },
            { label: 'small board, 10 rocks, fastest', params: { grid: 10, rocks: 10, speed: 12, speedUp: 0.4 } },
            { label: 'large board, 10 rocks, through the walls', params: { grid: 18, rocks: 10, wrap: true } }
        ];
        for (const s of settings) {
            const g = await open(browser, url, { ...base, params: s.params, theme: { pack: 'farm' }, rules: { win: null, lose: null } }, { seed: 5 });
            const v = await g.page.evaluate(() => {
                const P = window.__puky;
                P.start();
                const wrap = P.params().wrap;
                const KEYS = { '0,-1': 'ArrowUp', '0,1': 'ArrowDown', '-1,0': 'ArrowLeft', '1,0': 'ArrowRight' };
                const STEPS = [[0, -1], [0, 1], [-1, 0], [1, 0]];
                function plan(st) {
                    const { cols, rows } = st;
                    const body = st.snake.split(' ').map(c => c.split(',').map(Number));
                    const rocks = new Set(st.rocks ? st.rocks.split(' ').map(Number) : []);
                    const meal = st.meal ? st.meal.split(',').map(Number) : null;
                    const blocked = new Set([...rocks, ...body.slice(0, -1).map(([x, y]) => y * cols + x)]);
                    const next = (x, y, [dx, dy]) => {
                        let nx = x + dx, ny = y + dy;
                        if (wrap) { nx = (nx + cols) % cols; ny = (ny + rows) % rows; }
                        return nx < 0 || ny < 0 || nx >= cols || ny >= rows || blocked.has(ny * cols + nx) ? null : [nx, ny];
                    };
                    const room = ([x, y]) => {   // open cells reachable from here
                        const seen = new Set([y * cols + x]), todo = [[x, y]];
                        while (todo.length) {
                            const [cx, cy] = todo.pop();
                            for (const d of STEPS) { const n = next(cx, cy, d); if (n && !seen.has(n[1] * cols + n[0])) { seen.add(n[1] * cols + n[0]); todo.push(n); } }
                        }
                        return seen.size;
                    };
                    const [hx, hy] = body[0];
                    const options = STEPS.map(d => ({ d, at: next(hx, hy, d) })).filter(o => o.at);
                    if (!options.length) return null;
                    let best = null;
                    if (meal) {   // breadth first from the head to the food
                        const from = new Map([[hy * cols + hx, null]]), todo = [[hx, hy]];
                        while (todo.length && !best) {
                            const [cx, cy] = todo.shift();
                            for (const d of STEPS) {
                                const n = next(cx, cy, d);
                                if (!n || from.has(n[1] * cols + n[0])) continue;
                                from.set(n[1] * cols + n[0], [cx, cy, d]);
                                if (n[0] === meal[0] && n[1] === meal[1]) {
                                    let k = n[1] * cols + n[0], step = from.get(k);
                                    while (step && (step[0] !== hx || step[1] !== hy)) { k = step[1] * cols + step[0]; step = from.get(k); }
                                    best = step[2];
                                    break;
                                }
                                todo.push(n);
                            }
                        }
                    }
                    const pick = best && options.find(o => o.d === best);
                    if (pick && room(pick.at) > body.length + 2) return pick.d.join(',');
                    options.sort((a, b) => room(b.at) - room(a.at));
                    return options[0].d.join(',');
                }
                let lastMoves = -1, beforeLoss = null;
                for (let i = 0; i < 3600; i++) {
                    const st = P.serialize();
                    if (beforeLoss === null && st.lives < P.params().lives) beforeLoss = st.eaten;
                    let events = [];
                    if (st.ready && st.moves !== lastMoves) {
                        lastMoves = st.moves;
                        const d = plan(st);
                        if (d && d !== st.dir) events = [{ at: 0, type: 'key', key: KEYS[d], down: true }, { at: 0, type: 'key', key: KEYS[d], down: false }];
                    }
                    P.step(1, events);
                }
                return { ...P.vars(), beforeLoss: beforeLoss === null ? P.vars().eaten : beforeLoss };
            });
            // A simple bot can still trap itself once the snake fills much of a small board: what counts is
            // that it eats plenty first
            check(v.beforeLoss >= 25, `snake bot, ${s.label}: ate ${v.beforeLoss} before losing a life (${v.eaten} in 60 s)`);
            await g.context.close();
        }
    },

    // Holds the side of the screen toward the next platform on the way up, as a player does; with hazards
    // off, a lost life would mean a jump on the way up that can't be made
    async platformer({ browser, url, base, check }) {
        const settings = [
            { label: 'default settings', params: { hazardChance: 0 } },
            { label: 'strongest gravity, lowest bounce, slowest, widest gaps', params: { gravity: 50, jumpHeight: 3, moveSpeed: 4, gap: 4.5, crumbleChance: 0.5, movingChance: 0.5, hazardChance: 0 } },
            { label: 'weakest gravity, highest bounce, fastest', params: { gravity: 15, jumpHeight: 7, moveSpeed: 10, gap: 1.5, movingChance: 0.5, hazardChance: 0 } }
        ];
        for (const s of settings) {
            const g = await open(browser, url, { ...base, params: s.params, theme: { pack: 'pets' }, rules: { win: null, lose: null } }, { seed: 9 });
            const v = await g.page.evaluate(() => {
                const P = window.__puky;
                P.start();
                const W = 450, ring = d => { d = ((d % W) + W) % W; return d > W / 2 ? d - W : d; };
                let side = 0;
                for (let i = 0; i < 3600; i++) {
                    const st = P.serialize();
                    const dx = st.next ? ring(st.next[0] - st.x) : 0;
                    const want = Math.abs(dx) > Math.abs(st.vx) / 9 + 5 ? Math.sign(dx) : 0;
                    const events = [];
                    if (want !== side) {
                        if (side) events.push({ at: 0, type: 'up', x: side < 0 ? 60 : 390, y: 600 });
                        if (want) events.push({ at: 0, type: 'down', x: want < 0 ? 60 : 390, y: 600 });
                        side = want;
                    }
                    P.step(1, events);
                }
                return { ...P.vars(), lives0: P.params().lives };
            });
            check(v.lives === v.lives0 && v.height >= 150, `platformer bot, ${s.label}: climbed ${v.height} m in 60 s, lives ${v.lives} of ${v.lives0}`);
            await g.context.close();
        }
    },

    // Stays under the lowest enemy and out of the way of rocks: at the default settings it should shoot
    // plenty and survive
    async 'space-shooter'({ browser, url, base, check }) {
        const g = await open(browser, url, { ...base, params: {}, theme: { pack: 'gems' }, rules: { win: null, lose: null } }, { seed: 12 });
        const v = await g.page.evaluate(() => {
            const P = window.__puky;
            P.start();
            let down = false;
            for (let i = 0; i < 3600; i++) {
                const st = P.serialize();
                // the lowest enemy it can hit: no rock in between to soak up the shots
                const shielded = e => st.rocks.some(([rx, ry]) => ry > e[1] && ry < 690 && Math.abs(rx - e[0]) < 34);
                const prey = st.enemies.filter(e => e[1] < 600 && !shielded(e)).sort((a, b) => b[1] - a[1])[0];
                let x = prey ? prey[0] : st.ship;
                // what is coming down over the ship's way there (rocks, and enemies already low): go round it
                const threats = [...st.rocks.filter(([, ry]) => ry > 380 && ry < 730), ...st.enemies.filter(([, ey]) => ey > 560 && ey < 730)];
                for (let pass = 0; pass < 3; pass++) {
                    for (const [tx] of threats) {
                        const lo = Math.min(st.ship, x) - 58, hi = Math.max(st.ship, x) + 58;
                        if (tx > lo && tx < hi) x = tx < 225 ? tx + 115 : tx - 115;
                    }
                }
                x = Math.max(30, Math.min(420, x));
                const events = down ? [{ at: 0, type: 'move', x, y: 650 }] : [{ at: 0, type: 'down', x, y: 650 }];
                down = true;
                P.step(1, events);
            }
            return { ...P.vars(), lives0: P.params().lives };
        });
        check(v.kills >= 25 && v.lives > 0, `space-shooter bot: ${v.kills} hits, ${v.escaped} got through, lives ${v.lives} of ${v.lives0} after 60 s`);
        await g.context.close();
    },

    // Taps about 7 times a second and buys greedily: evolving must stay within reach, even at the steepest prices
    async 'tap-clicker'({ browser, url, base, check }) {
        const settings = [
            { label: 'default settings', params: {}, seconds: 60, level: 2 },
            { label: 'steepest prices, weakest taps and helpers', params: { tapValue: 1, autoRate: 0.2, costGrowth: 1.6, evolveCost: 2000, goldenChance: 0 }, seconds: 120, level: 1 }
        ];
        for (const s of settings) {
            const g = await open(browser, url, { ...base, params: s.params, theme: { pack: 'sweets' }, rules: { win: null, lose: null } }, { seed: 3 });
            const v = await g.page.evaluate(({ seconds }) => {
                const P = window.__puky;
                P.start();
                const tap = (x, y) => [{ at: 0, type: 'down', x, y }, { at: 0, type: 'up', x, y }];
                const card = i => [14 + i * 144 + 67, 612 + 78];
                for (let i = 0; i < seconds * 60; i++) {
                    if (i % 8) { P.step(1); continue; }
                    const st = P.serialize();
                    let events = tap(225, 360);
                    if (st.coins >= st.costs[2]) events = tap(...card(2));
                    else {
                        const cheap = st.costs[0] <= st.costs[1] ? 0 : 1;
                        if (st.coins >= st.costs[cheap] && st.costs[cheap] < st.costs[2] / 3) events = tap(...card(cheap));
                    }
                    P.step(1, events);
                }
                return P.vars();
            }, s);
            check(v.level >= s.level, `tap-clicker bot, ${s.label}: level ${v.level + 1} after ${s.seconds} s (${v.taps} taps, ${v.helpers} helpers, ${Math.floor(v.score)} coins earned)`);
            await g.context.close();
        }
    },

    // Remembers every card it has seen face up (and nothing else), as a player with a perfect memory would:
    // it should clear the board in far fewer moves than guessing takes
    async 'memory-pairs'({ browser, url, base, check }) {
        const settings = [
            { label: 'default settings', params: {} },
            { label: '12 pairs, no look first', params: { pairs: 12, peek: 0 } },
            { label: '6 pairs, slowest turn back', params: { pairs: 6, peek: 0, flipBack: 1.5 } }
        ];
        for (const s of settings) {
            const g = await open(browser, url, { ...base, params: s.params, theme: { pack: 'pixel' }, rules: { win: null, lose: null } }, { seed: 4 });
            const v = await g.page.evaluate(() => {
                const P = window.__puky;
                P.start();
                const known = new Map();
                for (let i = 0; i < 3600; i++) {
                    const st = P.serialize();
                    const cards = st.cards.split(' ');
                    cards.forEach((c, k) => { if (c[0] === 'u') known.set(k, Number(c.slice(1))); else if (c === 'm') known.delete(k); });
                    if (st.left === 0) break;
                    const downs = cards.map((c, k) => (c === 'd' ? k : -1)).filter(k => k >= 0);
                    const ups = cards.map((c, k) => (c[0] === 'u' ? k : -1)).filter(k => k >= 0);
                    if (st.busy || ups.length > 1) { P.step(1); continue; }
                    let target = null;
                    if (ups.length === 1) {
                        const face = known.get(ups[0]);
                        target = downs.find(k => known.get(k) === face) ?? downs.find(k => !known.has(k)) ?? downs[0];
                    } else {
                        const byFace = new Map();
                        for (const k of downs) {
                            if (!known.has(k)) continue;
                            if (byFace.has(known.get(k))) { target = byFace.get(known.get(k)); break; }
                            byFace.set(known.get(k), k);
                        }
                        if (target == null) target = downs.find(k => !known.has(k)) ?? downs[0];
                    }
                    const x = st.x0 + (target % st.cols) * (st.cw + 10) + st.cw / 2, y = st.y0 + Math.floor(target / st.cols) * (st.ch + 10) + st.ch / 2;
                    P.step(1, [{ at: 0, type: 'down', x, y }, { at: 0, type: 'up', x, y }]);
                }
                return { ...P.vars(), pairs: P.params().pairs };
            });
            check(v.left === 0 && v.moves <= v.pairs * 2.2, `memory-pairs bot, ${s.label}: all ${v.pairs} pairs in ${v.moves} moves, ${v.time.toFixed(0)} s`);
            await g.context.close();
        }
    },

    // Checks every question as it comes (the right number of answers, all different, exactly one right one,
    // the count matching the pictures shown), answers the first one wrong and the rest right
    async quiz({ browser, url, base, check }) {
        const settings = [
            { label: 'mixed questions', params: {}, kinds: 4 },
            { label: 'counting, 2 answers, 3 s each', params: { kinds: 'count', choices: 2, timePerQuestion: 3 }, kinds: 1 },
            { label: 'find it, 3 answers', params: { kinds: 'names', choices: 3 }, kinds: 1 }
        ];
        for (const s of settings) {
            const g = await open(browser, url, { ...base, params: s.params, theme: { pack: 'farm' }, rules: { win: null, lose: null } }, { seed: 7 });
            const v = await g.page.evaluate(() => {
                const P = window.__puky;
                P.start();
                const n = P.params().choices, problems = [], kinds = new Set();
                let seen = 0, first = true;
                for (let i = 0; i < 3600; i++) {
                    const st = P.serialize();
                    if (st.phase !== 'ask' || P.vars().asked === seen) { P.step(1); continue; }
                    seen = P.vars().asked;
                    kinds.add(st.kind);
                    const opts = st.options, distinct = new Set(opts.map(String)).size;
                    if (opts.length !== n || st.answer < 0 || st.answer >= n) problems.push(`${st.kind}: ${opts.length} answers, right one ${st.answer}`);
                    else if (st.kind === 'odd') {
                        const odd = opts.filter(o => o !== opts[st.answer]);
                        if (odd.length !== n - 1 || new Set(odd).size !== 1) problems.push(`odd one out with ${distinct} kinds of answer`);
                    } else if (distinct !== n) problems.push(`${st.kind}: answers repeat (${opts.join(', ')})`);
                    else if (st.kind === 'names' && new Set(st.names.map(x => x.toLowerCase())).size !== n) problems.push('two answers share a name');
                    else if (st.kind === 'count' && opts[st.answer] !== st.count) problems.push(`count: ${st.count} shown, ${opts[st.answer]} marked right`);
                    const pick = first ? (st.answer + 1) % n : st.answer;
                    first = false;
                    const [x, y, w, h] = st.rects[pick];
                    P.step(1, [{ at: 0, type: 'down', x: x + w / 2, y: y + h / 2 }, { at: 0, type: 'up', x: x + w / 2, y: y + h / 2 }]);
                }
                return { ...P.vars(), lives0: P.params().lives, problems, kinds: [...kinds] };
            });
            check(!v.problems.length && v.kinds.length === s.kinds && v.correct >= 20 && v.wrong === 1 && v.lives === v.lives0 - 1,
                  `quiz bot, ${s.label}: ${v.asked} questions (${v.kinds.join(', ')}), ${v.correct} right, ${v.wrong} wrong, lives ${v.lives} of ${v.lives0}` +
                  (v.problems.length ? `; ${v.problems[0]}` : ''));
            await g.context.close();
        }
    },

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
