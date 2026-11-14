// Jump-up platformer (platformer family): the player bounces on every platform it lands on; hold the left or
// the right side of the screen to steer, and climb as high as you can. The screen's sides join up, so going
// off one edge comes back on the other. Some platforms crumble after one bounce, some slide; treats float
// above some, and a few have a hazard on them.
//
// Fair by construction: the platforms on the main way up are each placed where the bounce from the one before
// can reach, from the same gravity, bounce height and side speed the player has. Extra platforms are
// optional: only they carry hazards.

export const manifest = {
    key: 'platformer', version: '1.0.0', runtime: 1, family: 'platformer',
    name: 'Jump up', emoji: '🦘', short: 'Jump',
    summary: 'Bounce from platform to platform and climb as high as you can.',
    view: { width: 450, height: 800 },
    actions: {
        left: ['ArrowLeft', 'KeyA'],
        right: ['ArrowRight', 'KeyD']
    },
    params: {
        type: 'object',
        properties: {
            gravity: { type: 'number', minimum: 15, maximum: 50, default: 30, title: 'Gravity', 'x-step': 1 },
            jumpHeight: { type: 'number', minimum: 3, maximum: 7, default: 4.5, title: 'Bounce height (tiles)', 'x-step': 0.1 },
            moveSpeed: { type: 'number', minimum: 4, maximum: 10, default: 7, title: 'Side speed', 'x-step': 0.5 },
            gap: { type: 'number', minimum: 1.5, maximum: 4.5, default: 2.8, title: 'Space between platforms', 'x-step': 0.1 },
            crumbleChance: { type: 'number', minimum: 0, maximum: 0.5, default: 0.15, title: 'Crumbling platforms', 'x-step': 0.05, 'x-live': true },
            movingChance: { type: 'number', minimum: 0, maximum: 0.5, default: 0.15, title: 'Sliding platforms', 'x-step': 0.05, 'x-live': true },
            treatChance: { type: 'number', minimum: 0, maximum: 1, default: 0.4, title: 'Treats', 'x-step': 0.05, 'x-live': true },
            hazardChance: { type: 'number', minimum: 0, maximum: 0.4, default: 0.1, title: 'Hazards', 'x-step': 0.05, 'x-live': true },
            lives: { type: 'integer', minimum: 1, maximum: 5, default: 3, title: 'Lives' }
        }
    },
    slots: {
        player: { kind: 'sprite', role: 'player', title: 'Jumper' },
        collectible: { kind: 'sprite', role: 'collectible', title: 'Treat' },
        hazard: { kind: 'sprite', role: 'hazard', title: 'Hazard' },
        music: { kind: 'music', role: 'bgm', optional: true, title: 'Music' }
    },
    vars: ['score', 'time', 'height', 'treats', 'lives'],
    rules: { win: 'height >= 250', lose: 'lives <= 0' },
    rulePresets: {
        win: [
            { label: 'Climb 250 m', value: 'height >= 250' },
            { label: 'Climb 600 m', value: 'height >= 600' },
            { label: 'Collect 30 treats', value: 'treats >= 30' },
            { label: 'Endless', value: null }
        ],
        lose: [
            { label: 'Out of lives', value: 'lives <= 0' },
            { label: '90 seconds', value: 'time >= 90' }
        ]
    }
};

const W = 450, H = 800, TILE = 40, METRE = TILE / 2, START = 700, HALF = TILE * 0.42, THICK = 14;

export function create(ctx, params) {
    const p = { ...params };
    const pal = ctx.palette;
    const art = ctx.slot('player'), treatArt = ctx.slot('collectible'), hazardArt = ctx.slot('hazard');
    const g = p.gravity * TILE;
    const lift = Math.sqrt(2 * g * p.jumpHeight * TILE);     // the bounce's speed
    const vmax = p.moveSpeed * TILE;
    const maxGap = Math.min(p.gap * TILE, 0.8 * p.jumpHeight * TILE), minGap = Math.max(TILE * 0.9, maxGap * 0.5);

    const me = { x: W / 2, y: START, vy: -lift, vx: 0, safe: 0, squash: 0, face: 1, best: START };
    let platforms = [], treats = [], hazards = [], camY = 0, clock = 0, flash = 0, pops = [], sequence = 0;
    let lastPath = null, landed = null, landedY = START, top = START;   // landedY: where it was when landed on (a crumbling one falls away)

    const ring = d => { d = ((d % W) + W) % W; return d > W / 2 ? d - W : d; };   // shortest way round the joined sides

    // How far sideways the player can get on a bounce that ends dy higher, with room for reaction and
    // speeding up
    function reach(dy) {
        const down = (lift + Math.sqrt(Math.max(0, lift * lift - 2 * g * dy))) / g;
        return vmax * down * 0.62;
    }

    function add(x, y, w, path) {
        const kind = path && ctx.rng.chance(p.crumbleChance) ? 'crumble' : ctx.rng.chance(p.movingChance) ? 'moving' : 'still';
        const pl = { id: sequence++, x, base: x, y, w, kind, path, broken: -1, range: 0, speed: 0, t: ctx.rng.range(0, 6) };
        if (kind === 'moving') { pl.range = path ? Math.min(TILE * 1.6, reach(maxGap) * 0.2) : TILE * 2; pl.speed = ctx.rng.range(0.8, 1.6); }
        platforms.push(pl);
        return pl;
    }

    // The main way up: each platform within reach of the one before, whatever either does
    function addPath() {
        const dy = ctx.rng.range(minGap, maxGap);
        const y = lastPath.y - dy;
        const w = ctx.rng.range(2.0, 2.8) * TILE;
        const slide = Math.min(TILE * 1.6, reach(maxGap) * 0.2);   // the most a sliding platform moves either way
        const r = reach(dy) - lastPath.range - slide;
        let x = lastPath.base;
        for (let i = 0; i < 12; i++) {
            const tryX = ctx.rng.range(w / 2, W - w / 2);
            if (Math.abs(ring(tryX - lastPath.base)) <= Math.max(TILE, r)) { x = tryX; break; }
        }
        const pl = add(x, y, w, true);
        if (ctx.rng.chance(p.treatChance)) treats.push({ x, y: y - TILE * 1.3, got: false });
        // now and then a spare one beside it, which may carry a hazard
        if (ctx.rng.chance(0.55)) {
            const sx = ((x + W / 2 + ctx.rng.range(-W / 4, W / 4)) % W + W) % W;
            const sw = ctx.rng.range(1.6, 2.4) * TILE;
            const spare = add(Math.min(W - sw / 2, Math.max(sw / 2, sx)), y + ctx.rng.range(-0.3, 0.3) * maxGap, sw, false);
            if (ctx.rng.chance(p.hazardChance * 2.5)) hazards.push({ on: spare.id, x: spare.x, y: spare.y - TILE * 0.55, hit: false });
            else if (ctx.rng.chance(p.treatChance * 0.6)) treats.push({ x: spare.x, y: spare.y - TILE * 1.3, got: false });
        }
        lastPath = pl;
        top = Math.min(top, y);
    }

    function fill() {
        while (top > camY - H * 0.5) addPath();
        platforms = platforms.filter(pl => pl.y < camY + H + 120 || pl === lastPath);
        treats = treats.filter(t => t.y < camY + H + 120);
        hazards = hazards.filter(h => h.y < camY + H + 120);
    }

    // After a fall: a wide platform just under the next one on the way up, so the climb goes on
    function rescue() {
        const ahead = platforms.filter(pl => pl.path && pl.broken < 0 && pl.y < camY + H - TILE * 2).sort((a, b) => b.y - a.y)[0];
        const y = ahead ? Math.min(ahead.y + maxGap * 0.6, camY + H - TILE * 1.5) : camY + H * 0.7;
        const x = ahead ? ahead.base : W / 2;
        const pl = { id: sequence++, x, base: x, y, w: TILE * 3.4, kind: 'still', path: true, broken: -1, range: 0, speed: 0, t: 0, rescue: true };
        platforms.push(pl);
        Object.assign(me, { x, y, vy: -lift, vx: 0, safe: 1.6 });
        landed = pl; landedY = y;
    }

    function lose() {
        ctx.vars.lives = Math.max(0, ctx.vars.lives - 1);
        ctx.sfx('hit');
        ctx.haptic(60);
        flash = 0.45;
        if (ctx.vars.lives > 0) rescue();
        else me.safe = 1e9;
    }

    return {
        start() {
            ctx.vars.lives = p.lives;
            lastPath = { id: sequence++, x: W / 2, base: W / 2, y: START, w: W, kind: 'still', path: true, broken: -1, range: 0, speed: 0, t: 0, floor: true };
            platforms.push(lastPath);
            landed = lastPath;
            fill();
        },

        update(dt, input) {
            clock += dt;
            flash = Math.max(0, flash - dt);
            if (ctx.vars.lives <= 0) return;
            me.safe = Math.max(0, me.safe - dt);
            me.squash = Math.max(0, me.squash - dt * 4);

            // Steering: hold a side of the screen (or an arrow key)
            const p0 = input.pointer;
            const left = input.held.has('left') || (p0.down && p0.x < W / 2);
            const right = input.held.has('right') || (p0.down && p0.x >= W / 2);
            if (left !== right) {
                me.vx += (right ? 1 : -1) * 2600 * dt;
                me.face = right ? 1 : -1;
            } else {
                me.vx *= Math.max(0, 1 - 9 * dt);
            }
            me.vx = Math.max(-vmax, Math.min(vmax, me.vx));
            me.x = ((me.x + me.vx * dt) % W + W) % W;

            for (const pl of platforms) {
                pl.t += dt;
                if (pl.kind === 'moving') pl.x = pl.base + Math.sin(pl.t * pl.speed) * pl.range;
                if (pl.broken >= 0) { pl.broken += dt; pl.y += pl.broken * 900 * dt; }
            }
            for (const hz of hazards) {
                const on = platforms.find(pl => pl.id === hz.on);
                if (on) { hz.x = on.x; hz.y = on.y - TILE * 0.55; }
            }

            const was = me.y;
            me.vy += g * dt;
            me.y += me.vy * dt;
            if (me.vy > 0) {
                for (const pl of platforms) {
                    if (pl.broken >= 0 || was > pl.y || me.y < pl.y) continue;
                    if (Math.abs(ring(me.x - pl.x)) > pl.w / 2 + HALF * 0.6) continue;
                    me.y = pl.y;
                    me.vy = -lift;
                    me.squash = 1;
                    landed = pl; landedY = pl.y;
                    ctx.sfx('jump', 0.45, 1 + Math.min(0.4, (START - me.y) / 20000));
                    if (pl.kind === 'crumble') { pl.broken = 0; ctx.sfx('hit', 0.3, 1.4); }
                    break;
                }
            }

            for (const t of treats) {
                if (!t.got && Math.abs(ring(t.x - me.x)) < TILE * 0.7 && Math.abs(t.y - (me.y - TILE * 0.6)) < TILE * 0.8) {
                    t.got = true;
                    ctx.vars.treats += 1;
                    ctx.sfx('collect', 0.7, 1 + Math.min(ctx.vars.treats, 20) * 0.02);
                    pops.push({ x: t.x, y: t.y, text: '+25', t: 0 });
                }
            }
            if (me.safe <= 0) {
                for (const hz of hazards) {
                    if (!hz.hit && Math.abs(ring(hz.x - me.x)) < TILE * 0.55 + HALF && Math.abs(hz.y - (me.y - TILE * 0.5)) < TILE * 0.75) {
                        hz.hit = true;
                        lose();
                        break;
                    }
                }
            }

            me.best = Math.min(me.best, me.y);
            camY = Math.min(camY, me.y - H * 0.45);
            if (me.y > camY + H + TILE) lose();
            fill();
            ctx.vars.height = Math.max(0, Math.floor((START - me.best) / METRE));
            ctx.vars.score = ctx.vars.height + ctx.vars.treats * 25;
            for (const o of pops) o.t += dt;
            pops = pops.filter(o => o.t < 0.8);
        },

        render(gr) {
            gr.rect(0, 0, W, H, gr.gradient(0, 0, 0, H, [[0, pal.sky], [1, ctx.shade(pal.board, -0.03)]]));
            // soft clouds, drifting slower than the platforms
            for (let i = 0; i < 6; i++) {
                const cy = ((i * 173 - camY * 0.3) % (H + 200) + H + 200) % (H + 200) - 100;
                const cx = (i * 97 + 40) % W;
                gr.alpha(0.55, () => { gr.ellipse(cx, cy, 70, 22, '#fff'); gr.ellipse(cx + 34, cy - 10, 40, 18, '#fff'); });
            }
            // a mark every 50 m
            const mark = 50 * METRE;
            for (let m = Math.ceil((START - (camY + H)) / mark) * mark; START - m >= camY - 20; m += mark) {
                const y = START - m - camY;
                if (m <= 0) continue;
                gr.line(0, y, W, y, 'rgba(0,0,0,0.12)', 2, [8, 10]);
                gr.text(`${Math.round(m / METRE)} m`, W - 34, y - 12, { size: 13, weight: 700, color: ctx.shade(pal.text, 0.3) });
            }

            const drawAt = (x, w, fn) => {   // across the joined sides, an object near an edge shows on both
                fn(x);
                if (x - w / 2 < 0) fn(x + W);
                if (x + w / 2 > W) fn(x - W);
            };
            for (const pl of platforms) {
                const y = pl.y - camY;
                if (y < -40 || y > H + 40) continue;
                const fade = pl.broken >= 0 ? Math.max(0, 1 - pl.broken * 2) : 1;
                if (fade <= 0) continue;
                gr.alpha(fade, () => drawAt(pl.x, pl.w, x => {
                    const base = pl.kind === 'crumble' ? ctx.shade(pal.ground, -0.35) : pl.kind === 'moving' ? pal.accent : pal.ground;
                    gr.rect(x - pl.w / 2, y, pl.w, THICK, ctx.shade(base, -0.25), 7);
                    gr.rect(x - pl.w / 2, y, pl.w, THICK * 0.55, ctx.shade(base, 0.15), 7);
                    if (pl.kind === 'crumble') {
                        gr.line(x - pl.w * 0.2, y + 2, x - pl.w * 0.1, y + THICK - 2, 'rgba(0,0,0,0.35)', 2);
                        gr.line(x + pl.w * 0.15, y + 2, x + pl.w * 0.25, y + THICK - 2, 'rgba(0,0,0,0.35)', 2);
                    }
                }));
            }
            for (const t of treats) {
                const y = t.y - camY;
                if (t.got || y < -40 || y > H + 40) continue;
                const bob = Math.sin(clock * 4 + t.x) * 4;
                drawAt(t.x, TILE, x => gr.sprite(treatArt, x, y + bob, TILE * 0.9, TILE * 0.9));
            }
            for (const hz of hazards) {
                const y = hz.y - camY;
                if (hz.hit || y < -40 || y > H + 40) continue;
                drawAt(hz.x, TILE, x => gr.sprite(hazardArt, x, y, TILE * 1.05, TILE * 1.05));
            }
            const blink = me.safe > 0 && me.safe < 1e8 && Math.floor(me.safe * 10) % 2 === 0;
            if (ctx.vars.lives > 0) {
                const sz = TILE * 1.35, sq = 1 - me.squash * 0.22;
                gr.alpha(blink ? 0.4 : 1, () => drawAt(me.x, sz, x =>
                    gr.sprite(art, x, me.y - camY - sz * sq / 2, sz, sz, { scaleX: 2 - sq, scaleY: sq, flipX: me.face < 0 })));
            }
            for (const o of pops) {
                gr.alpha(1 - o.t / 0.8, () => gr.text(o.text, o.x, o.y - camY - o.t * 50, { size: 22, weight: 800, color: pal.accent, outline: 'rgba(0,0,0,0.25)' }));
            }
            if (flash > 0) gr.rect(0, 0, W, H, `rgba(231, 76, 60, ${flash * 0.35})`);

            gr.rect(0, 0, W, 104, 'rgba(255,255,255,0.55)');
            gr.text(`${ctx.vars.height} m`, W / 2, 58, { size: 40, weight: 800, color: pal.text });
            gr.text('Treats', 56, 40, { size: 14, color: pal.text });
            gr.text(String(ctx.vars.treats), 56, 66, { size: 24, weight: 800, color: pal.accent });
            gr.text('Lives', W - 56, 40, { size: 14, color: pal.text });
            gr.text('♥'.repeat(Math.min(5, ctx.vars.lives)) || '–', W - 56, 66, { size: 20, weight: 800, color: pal.danger, maxWidth: 100 });
        },

        onParams(changed) {
            // only what shapes the platforms still to come; the physics stays as the climb began
            for (const k of ['crumbleChance', 'movingChance', 'treatChance', 'hazardChance']) if (k in changed) p[k] = changed[k];
            return true;
        },

        serialize() {
            const next = platforms.filter(pl => pl.path && pl.broken < 0 && pl.y < landedY - 1).sort((a, b) => b.y - a.y)[0];
            const r = v => Math.round(v * 10) / 10;
            return {
                x: r(me.x), y: r(me.y), vx: r(me.vx), vy: r(me.vy), camY: r(camY),
                landed: landed ? landed.id : -1, next: next ? [r(next.x), r(next.y), r(next.w)] : null,
                platforms: platforms.length, height: ctx.vars.height, treats: ctx.vars.treats, lives: ctx.vars.lives
            };
        }
    };
}
