// Vertical shooter (shooter family): drag to move your ship, which fires by itself. Enemies (the look's
// pictures, tougher further along) come down in waves; shoot them before they ram you. Rocks can't be shot
// down, only dodged. Some enemies drop a power-up: catch it for double shots.

export const manifest = {
    key: 'space-shooter', version: '1.0.0', runtime: 1, family: 'shooter',
    name: 'Space shooter', emoji: '🚀', short: 'Blast',
    summary: 'Drag to steer. Your ship fires by itself: shoot the enemies, dodge the rocks.',
    view: { width: 450, height: 800 },
    actions: {
        left: ['ArrowLeft', 'KeyA'],
        right: ['ArrowRight', 'KeyD']
    },
    params: {
        type: 'object',
        properties: {
            fireRate: { type: 'number', minimum: 2, maximum: 10, default: 5, title: 'Shots a second', 'x-step': 0.5, 'x-live': true },
            enemySpeed: { type: 'number', minimum: 1, maximum: 5, default: 2.2, title: 'Enemy speed', 'x-step': 0.1, 'x-live': true },
            spawnEvery: { type: 'number', minimum: 0.3, maximum: 2, default: 0.9, title: 'A new enemy every (s)', 'x-step': 0.05, 'x-live': true },
            toughness: { type: 'integer', minimum: 1, maximum: 4, default: 1, title: 'Enemy toughness' },
            rockChance: { type: 'number', minimum: 0, maximum: 0.4, default: 0.1, title: 'Rocks', 'x-step': 0.02, 'x-live': true },
            powerUps: { type: 'boolean', default: true, title: 'Power-ups', 'x-live': true },
            speedUp: { type: 'number', minimum: 0, maximum: 0.3, default: 0.1, title: 'Faster every 15 s', 'x-step': 0.02, 'x-live': true },
            lives: { type: 'integer', minimum: 1, maximum: 5, default: 3, title: 'Lives' }
        }
    },
    slots: {
        player: { kind: 'sprite', role: 'player', title: 'Ship' },
        enemies: { kind: 'sprite', role: 'chain', many: true, min: 3, title: 'Enemies' },
        hazard: { kind: 'sprite', role: 'hazard', title: 'Rock' },
        collectible: { kind: 'sprite', role: 'collectible', title: 'Power-up' },
        music: { kind: 'music', role: 'bgm', optional: true, title: 'Music' }
    },
    vars: ['score', 'time', 'kills', 'lives', 'escaped'],
    rules: { win: 'kills >= 40', lose: 'lives <= 0' },
    rulePresets: {
        win: [
            { label: 'Destroy 40', value: 'kills >= 40' },
            { label: 'Score 3,000', value: 'score >= 3000' },
            { label: 'Survive 90 s', value: 'time >= 90' },
            { label: 'Endless', value: null }
        ],
        lose: [
            { label: 'Out of lives', value: 'lives <= 0' },
            { label: 'Let 10 through', value: 'escaped >= 10' },
            { label: '60 seconds', value: 'time >= 60' }
        ]
    }
};

// The ship's hitbox is smaller than its picture, as shooters do, so a near miss is a miss
const W = 450, H = 800, TILE = 40, SHIP_Y = 690, SHIP_R = 14, SHOT_SPEED = 820, BAND = 104;

export function create(ctx, params) {
    const p = { ...params };
    const pal = ctx.palette;
    const shipArt = ctx.slot('player'), rockArt = ctx.slot('hazard'), powerArt = ctx.slot('collectible');
    // enemies never look like the power-up (in some looks it is also the first of the chain)
    const all = ctx.slot('enemies'), others = all.filter(a => a.id !== powerArt.id);
    const kinds = (others.length >= 3 ? others : all).slice(0, 6);
    const ship = { x: W / 2, hurt: 0, double: 0, tilt: 0 };
    let shots = [], enemies = [], rocks = [], powers = [], sparks = [], pops = [];
    let clock = 0, fire = 0, spawn = 1.2, combo = 0, shake = 0, flash = 0;
    // stars at fixed places, scrolling at three speeds
    const stars = Array.from({ length: 48 }, (_, i) => ({ x: (i * 137.5) % W, y: (i * 293.7) % H, z: 1 + (i % 3) }));

    const faster = () => 1 + p.speedUp * Math.floor(clock / 15);

    function spawnOne() {
        if (ctx.rng.chance(p.rockChance)) {
            rocks.push({ x: ctx.rng.range(30, W - 30), y: BAND - 30, r: 22, vy: p.enemySpeed * TILE * 0.8 * faster(), spin: ctx.rng.range(-2, 2), a: 0 });
            return;
        }
        const open = Math.min(kinds.length, 1 + Math.floor(clock / 12));
        const k = ctx.rng.int(0, open - 1);
        const size = 46 + k * 4;
        const pattern = ctx.rng.pick(k === 0 ? ['straight', 'wave'] : ['straight', 'wave', 'dive']);
        const x = ctx.rng.range(size / 2 + 6, W - size / 2 - 6);
        enemies.push({
            x, y: BAND - size / 2, base: x, k, size, r: size * 0.4, hp: p.toughness * (1 + Math.floor(k / 2)), hit: 0,
            vy: p.enemySpeed * TILE * faster() * ctx.rng.range(0.85, 1.15), pattern, t: 0,
            vx: pattern === 'dive' ? Math.sign(ship.x - x || 1) * ctx.rng.range(40, 90) : 0
        });
    }

    function burst(x, y, color, n = 10) {
        for (let i = 0; i < n; i++) {
            const a = ctx.rng.range(0, Math.PI * 2), v = ctx.rng.range(80, 260);
            sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t: 0, life: ctx.rng.range(0.3, 0.6), color });
        }
    }

    function hurt() {
        ctx.vars.lives = Math.max(0, ctx.vars.lives - 1);
        ship.hurt = 1.5;
        combo = 0;
        shake = 0.35; flash = 0.35;
        ctx.sfx('hit');
        ctx.haptic(70);
        burst(ship.x, SHIP_Y, pal.danger, 16);
    }

    return {
        start() {
            ctx.vars.lives = p.lives;
        },

        update(dt, input) {
            clock += dt;
            shake = Math.max(0, shake - dt);
            flash = Math.max(0, flash - dt);
            ship.hurt = Math.max(0, ship.hurt - dt);
            ship.double = Math.max(0, ship.double - dt);
            const alive = ctx.vars.lives > 0;

            // steering: the ship follows a dragging finger, or the arrow keys
            const was = ship.x;
            if (input.pointer.down) ship.x += (input.pointer.x - ship.x) * Math.min(1, 16 * dt);
            if (input.held.has('left')) ship.x -= 420 * dt;
            if (input.held.has('right')) ship.x += 420 * dt;
            ship.x = Math.max(24, Math.min(W - 24, ship.x));
            ship.tilt += ((ship.x - was) / Math.max(dt, 1e-3) / 900 - ship.tilt) * Math.min(1, 10 * dt);

            if (alive) {
                fire -= dt;
                if (fire <= 0) {
                    fire += 1 / p.fireRate;
                    if (ship.double > 0) shots.push({ x: ship.x - 12, y: SHIP_Y - 26 }, { x: ship.x + 12, y: SHIP_Y - 26 });
                    else shots.push({ x: ship.x, y: SHIP_Y - 28 });
                    ctx.sfx('tap', 0.12, 1.6);
                }
                spawn -= dt;
                if (spawn <= 0) {
                    spawnOne();
                    spawn = p.spawnEvery / Math.sqrt(faster()) * ctx.rng.range(0.7, 1.3);
                }
            }

            for (const s of shots) s.y -= SHOT_SPEED * dt;
            for (const e of enemies) {
                e.t += dt;
                e.hit = Math.max(0, e.hit - dt);
                e.y += e.vy * dt;
                if (e.pattern === 'wave') e.x = e.base + Math.sin(e.t * 2.4) * 46;
                else if (e.pattern === 'dive') { e.x += e.vx * dt; if (e.x < e.size / 2 || e.x > W - e.size / 2) e.vx = -e.vx; }
            }
            for (const r of rocks) { r.y += r.vy * dt; r.a += r.spin * dt; }
            for (const pw of powers) { pw.y += 120 * dt; pw.t += dt; }

            // shots against enemies and rocks
            for (const s of shots) {
                if (s.gone) continue;
                const rock = rocks.find(r => Math.hypot(r.x - s.x, r.y - s.y) < r.r + 4);
                if (rock) { s.gone = true; burst(s.x, s.y, 'rgba(255,255,255,0.8)', 3); continue; }
                const e = enemies.find(o => !o.dead && Math.hypot(o.x - s.x, o.y - s.y) < o.r + 5);
                if (!e) continue;
                s.gone = true;
                e.hp -= 1;
                e.hit = 0.08;
                if (e.hp <= 0) {
                    e.dead = true;
                    combo += 1;
                    ctx.vars.kills += 1;
                    const gain = 10 * (e.k + 1) * (1 + Math.floor(combo / 10));
                    ctx.vars.score += gain;
                    ctx.sfx('pop', 0.7, 1 + Math.min(combo, 20) * 0.02);
                    burst(e.x, e.y, pal.accent, 12);
                    pops.push({ x: e.x, y: e.y, text: `+${gain}`, t: 0 });
                    if (p.powerUps && ctx.rng.chance(0.12)) powers.push({ x: e.x, y: e.y, t: 0 });
                } else {
                    ctx.sfx('hit', 0.25, 1.5);
                }
            }

            // what reaches the ship
            if (alive && ship.hurt <= 0) {
                const e = enemies.find(o => !o.dead && Math.hypot(o.x - ship.x, o.y - SHIP_Y) < o.r * 0.85 + SHIP_R);
                if (e) { e.dead = true; burst(e.x, e.y, pal.accent, 10); hurt(); }
                else if (rocks.some(r => Math.hypot(r.x - ship.x, r.y - SHIP_Y) < r.r * 0.85 + SHIP_R)) hurt();
            }
            if (alive) {
                for (const pw of powers) {
                    if (pw.got || Math.hypot(pw.x - ship.x, pw.y - SHIP_Y) > 40) continue;
                    pw.got = true;
                    if (ship.double > 0) { ctx.vars.score += 50; pops.push({ x: pw.x, y: pw.y, text: '+50', t: 0 }); }
                    ship.double = 8;
                    ctx.sfx('collect');
                    ctx.haptic(20);
                }
            }
            for (const e of enemies) {
                if (!e.dead && e.y > H + e.size) { e.dead = true; ctx.vars.escaped += 1; combo = 0; }
            }

            shots = shots.filter(s => !s.gone && s.y > BAND);
            enemies = enemies.filter(e => !e.dead);
            rocks = rocks.filter(r => r.y < H + 40);
            powers = powers.filter(pw => !pw.got && pw.y < H + 30);
            for (const s of sparks) { s.t += dt; s.x += s.vx * dt; s.y += s.vy * dt; }
            sparks = sparks.filter(s => s.t < s.life);
            for (const o of pops) o.t += dt;
            pops = pops.filter(o => o.t < 0.7);
            for (const st of stars) st.y = (st.y + st.z * 40 * dt) % H;
        },

        render(g) {
            const c = g.ctx;
            g.rect(0, 0, W, H, g.gradient(0, 0, 0, H, [[0, ctx.shade(pal.sky, -0.72)], [1, ctx.shade(pal.sky, -0.45)]]));
            for (const st of stars) g.circle(st.x, st.y, st.z * 0.8, `rgba(255,255,255,${0.25 + st.z * 0.18})`);
            c.save();
            if (shake > 0) c.translate(Math.sin(clock * 80) * shake * 12, 0);
            for (const pw of powers) {
                g.circle(pw.x, pw.y, 22 + Math.sin(pw.t * 8) * 3, 'rgba(255,255,255,0.25)');
                g.sprite(powerArt, pw.x, pw.y, 34, 34);
            }
            for (const r of rocks) g.sprite(rockArt, r.x, r.y, r.r * 2.3, r.r * 2.3, { rotation: r.a });
            for (const e of enemies) {
                g.sprite(kinds[e.k] || kinds[0], e.x, e.y, e.size, e.size, { alpha: e.hit > 0 ? 0.55 : 1 });
                if (e.hp > 1) g.rect(e.x - e.size * 0.3, e.y - e.size * 0.62, e.size * 0.6 * Math.min(1, e.hp / (p.toughness * (1 + Math.floor(e.k / 2)))), 4, pal.danger, 2);
            }
            for (const s of shots) {
                g.rect(s.x - 3, s.y - 10, 6, 20, ship.double > 0 ? '#ffe27a' : '#ffffff', 3);
                g.rect(s.x - 1.5, s.y - 8, 3, 16, pal.accent, 2);
            }
            for (const s of sparks) g.alpha(1 - s.t / s.life, () => g.circle(s.x, s.y, 3, s.color));
            if (ctx.vars.lives > 0) {
                const blink = ship.hurt > 0 && Math.floor(ship.hurt * 12) % 2 === 0;
                g.alpha(blink ? 0.35 : 1, () => {
                    g.ellipse(ship.x, SHIP_Y + 30, 10, 16 + Math.sin(clock * 30) * 4, ship.double > 0 ? '#ffe27a' : pal.accent);
                    g.sprite(shipArt, ship.x, SHIP_Y, 62, 62, { rotation: Math.max(-0.35, Math.min(0.35, ship.tilt)) });
                });
            }
            for (const o of pops) g.alpha(1 - o.t / 0.7, () => g.text(o.text, o.x, o.y - o.t * 50, { size: 20, weight: 800, color: '#fff', outline: 'rgba(0,0,0,0.4)' }));
            c.restore();
            if (flash > 0) g.rect(0, 0, W, H, `rgba(231, 76, 60, ${flash * 0.4})`);

            g.rect(0, 0, W, BAND, 'rgba(10, 8, 24, 0.55)');
            g.text(String(ctx.vars.score), W / 2, 58, { size: 42, weight: 800, color: '#fff' });
            g.text('Hits', 56, 40, { size: 14, color: 'rgba(255,255,255,0.8)' });
            g.text(String(ctx.vars.kills), 56, 66, { size: 24, weight: 800, color: pal.accent });
            g.text('Lives', W - 56, 40, { size: 14, color: 'rgba(255,255,255,0.8)' });
            g.text('♥'.repeat(Math.min(5, ctx.vars.lives)) || '–', W - 56, 66, { size: 20, weight: 800, color: pal.danger, maxWidth: 100 });
            if (ship.double > 0) g.text(`Double shots ${Math.ceil(ship.double)}`, W / 2, BAND + 18, { size: 14, weight: 800, color: '#ffe27a' });
        },

        onParams(changed) {
            Object.assign(p, changed);
            return true;
        },

        serialize() {
            const r = v => Math.round(v * 10) / 10;
            return {
                ship: r(ship.x), hurt: r(ship.hurt),
                enemies: enemies.map(e => [r(e.x), r(e.y), e.k, e.hp]),
                rocks: rocks.map(o => [r(o.x), r(o.y)]),
                shots: shots.length, kills: ctx.vars.kills, lives: ctx.vars.lives, escaped: ctx.vars.escaped
            };
        }
    };
}
