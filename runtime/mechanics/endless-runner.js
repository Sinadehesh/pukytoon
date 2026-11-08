// Endless runner (runner family): tap to jump over obstacles and grab treats; the run speeds up as it goes.
// Obstacle heights adapt to the jump, so every combination of speed, gravity and jump height can be cleared.

export const manifest = {
    key: 'endless-runner', version: '1.0.0', runtime: 1, family: 'runner',
    name: 'Endless runner', emoji: '🏃', short: 'Dash',
    summary: 'Tap to jump over obstacles and grab treats. How far can you go?',
    view: { width: 450, height: 800 },
    actions: { jump: ['tap', 'Space', 'ArrowUp', 'KeyW'] },
    params: {
        type: 'object',
        properties: {
            speed: { type: 'number', minimum: 4, maximum: 12, default: 6, title: 'Run speed', 'x-step': 0.5, 'x-live': true },
            speedUp: { type: 'number', minimum: 0, maximum: 0.6, default: 0.25, title: 'Speed-up every 10 s', 'x-step': 0.05, 'x-live': true },
            gravity: { type: 'number', minimum: 20, maximum: 80, default: 45, title: 'Gravity', 'x-step': 1, 'x-live': true },
            jumpHeight: { type: 'number', minimum: 2, maximum: 5, default: 3, title: 'Jump height (tiles)', 'x-step': 0.1, 'x-live': true },
            doubleJump: { type: 'boolean', default: false, title: 'Double jump', 'x-live': true },
            gap: { type: 'number', minimum: 3, maximum: 10, default: 5.5, title: 'Space between obstacles', 'x-step': 0.5, 'x-live': true },
            treatChance: { type: 'number', minimum: 0, maximum: 1, default: 0.6, title: 'Treats', 'x-step': 0.05, 'x-live': true },
            lives: { type: 'integer', minimum: 1, maximum: 9, default: 3, title: 'Lives' }
        }
    },
    slots: {
        player: { kind: 'sprite', role: 'player', title: 'Runner' },
        hazard: { kind: 'sprite', role: 'hazard', title: 'Obstacle' },
        collectible: { kind: 'sprite', role: 'collectible', title: 'Treat' },
        music: { kind: 'music', role: 'bgm', optional: true, title: 'Music' }
    },
    vars: ['score', 'time', 'distance', 'treats', 'lives'],
    rules: { win: null, lose: 'lives <= 0' },
    rulePresets: {
        win: [
            { label: 'Endless', value: null },
            { label: 'Run 500 m', value: 'distance >= 500' },
            { label: 'Collect 25 treats', value: 'treats >= 25' }
        ],
        lose: [
            { label: 'Out of lives', value: 'lives <= 0' },
            { label: '60-second dash', value: 'lives <= 0 || time >= 60' }
        ]
    }
};

const W = 450, H = 800, GROUND = 640, TILE = 50, PX = 120;

export function create(ctx, params) {
    const p = { ...params };
    const pal = ctx.palette;
    const runner = ctx.slot('player'), block = ctx.slot('hazard'), treat = ctx.slot('collectible');
    const size = TILE * 1.4;
    const pw = size * 0.45, ph = size * 0.6;   // the runner's hitbox, forgiving on purpose
    const player = { y: GROUND, vy: 0, grounded: true, jumps: 0, hurt: 0, squash: 0 };
    let obstacles = [], treats = [], until = 0, travelled = 0, clock = 0, shake = 0;

    const gravity = () => p.gravity * TILE;
    const jumpSpeed = () => Math.sqrt(2 * gravity() * p.jumpHeight * TILE);
    const speed = () => (p.speed + p.speedUp * Math.floor(clock / 10)) * TILE;
    const airtime = () => (2 * jumpSpeed()) / gravity();

    // The tallest obstacle (of width w) the runner can still pass over at this speed: it must stay above
    // the obstacle's top for as long as it takes to cross it, with half as much room again so a person's
    // timing doesn't have to be perfect.
    function clearable(w) {
        const apex = p.jumpHeight * TILE;
        const above = (1.5 * (w + pw) + 10) / speed();
        return apex - (gravity() * above * above) / 8;
    }

    // At the hardest settings (slow, low jump, strong gravity) obstacles shrink to small bumps, never to
    // something that can't be cleared
    function spawnObstacle(x) {
        const tall = clock > 20 && ctx.rng.chance(Math.min(0.35, (clock - 20) / 120));
        let w = TILE * 0.8;
        let h = Math.min((tall ? 2 : 1) * TILE * 0.9, clearable(w) * 0.85);
        if (h < w) { w = Math.max(12, h); h = Math.max(12, Math.min(h, clearable(w) * 0.85)); }
        obstacles.push({ x, w, h, hit: false });
        if (ctx.rng.chance(p.treatChance)) {
            const count = ctx.rng.int(3, 5);
            const over = ctx.rng.chance(0.6);
            for (let i = 0; i < count; i++) {
                const t = i / (count - 1);
                treats.push(over
                    ? { x: x + w / 2 + (t - 0.5) * TILE * 2.6, y: GROUND - h - TILE * 0.7 - Math.sin(t * Math.PI) * Math.max(0, p.jumpHeight * TILE - h - TILE * 0.9), got: false }
                    : { x: x - TILE * (2.4 + i * 0.9), y: GROUND - TILE * 0.6, got: false });
            }
        }
        // Room to land and jump again before the next one
        until = Math.max(p.gap * TILE, speed() * airtime() + TILE * 2) + ctx.rng.range(0, TILE * 3);
    }

    return {
        start() {
            ctx.vars.lives = p.lives;
            until = TILE * 6;
        },

        update(dt, input) {
            clock += dt;
            const vx = speed();
            if (input.pressed.has('jump')) {
                if (player.grounded) {
                    player.vy = -jumpSpeed();
                    player.grounded = false;
                    player.jumps = 1;
                    ctx.sfx('jump', 0.6);
                } else if (p.doubleJump && player.jumps < 2) {
                    player.vy = -jumpSpeed() * 0.85;
                    player.jumps = 2;
                    ctx.sfx('jump', 0.6, 1.2);
                }
            }
            player.vy += gravity() * dt;
            player.y += player.vy * dt;
            if (player.y >= GROUND) {
                if (!player.grounded) player.squash = 1;
                player.y = GROUND; player.vy = 0; player.grounded = true; player.jumps = 0;
            }
            player.squash = Math.max(0, player.squash - dt * 5);
            player.hurt = Math.max(0, player.hurt - dt);
            shake = Math.max(0, shake - dt);

            travelled += vx * dt;
            for (const o of obstacles) o.x -= vx * dt;
            for (const t of treats) t.x -= vx * dt;
            until -= vx * dt;
            if (until <= 0) spawnObstacle(W + 30);

            const left = PX - pw / 2, right = PX + pw / 2, bottom = player.y - 4, topY = player.y - ph;
            for (const o of obstacles) {
                if (o.hit || player.hurt > 0) continue;
                if (right > o.x && left < o.x + o.w && bottom > GROUND - o.h && topY < GROUND) {
                    o.hit = true;
                    player.hurt = 1.2;
                    shake = 0.25;
                    ctx.vars.lives = Math.max(0, ctx.vars.lives - 1);
                    ctx.sfx('hit');
                    ctx.haptic(40);
                }
            }
            const cy = player.y - ph / 2;
            for (const t of treats) {
                if (!t.got && Math.abs(t.x - PX) < 30 && Math.abs(t.y - cy) < 38) {
                    t.got = true;
                    ctx.vars.treats += 1;
                    ctx.sfx('collect', 0.5, 1 + (ctx.vars.treats % 5) * 0.05);
                }
            }
            obstacles = obstacles.filter(o => o.x + o.w > -60);
            treats = treats.filter(t => t.x > -60 && !t.got);

            ctx.vars.distance = Math.floor(travelled / TILE);
            ctx.vars.score = ctx.vars.distance + ctx.vars.treats * 10;
        },

        render(g) {
            const c = g.ctx;
            c.save();
            if (shake > 0) c.translate(Math.sin(clock * 70) * shake * 14, 0);
            g.rect(-20, 0, W + 40, GROUND, g.gradient(0, 0, 0, GROUND, [[0, ctx.shade(pal.sky, -0.12)], [1, ctx.shade(pal.sky, 0.35)]]));
            // Far hills and clouds move slower than the ground
            const far = travelled * 0.25;
            c.fillStyle = ctx.shade(pal.ground, -0.18);
            c.beginPath();
            c.moveTo(-20, GROUND);
            for (let x = -20; x <= W + 20; x += 15) c.lineTo(x, GROUND - 70 - Math.sin((x + far) / 70) * 26 - Math.sin((x + far) / 31) * 10);
            c.lineTo(W + 20, GROUND);
            c.fill();
            for (let i = 0; i < 3; i++) {
                const x = ((i * 190 - travelled * 0.08) % (W + 200) + W + 200) % (W + 200) - 100, y = 140 + i * 70;
                g.alpha(0.7, () => { g.circle(x, y, 26, '#fff'); g.circle(x + 28, y + 6, 20, '#fff'); g.circle(x - 26, y + 8, 18, '#fff'); });
            }
            g.rect(-20, GROUND, W + 40, H - GROUND, pal.ground);
            g.rect(-20, GROUND, W + 40, 8, ctx.shade(pal.ground, -0.22));
            for (let x = -(travelled % 60); x < W + 60; x += 60) g.rect(x, GROUND + 30, 28, 6, ctx.shade(pal.ground, -0.1), 3);

            for (const o of obstacles) {
                if (o.h > o.w * 1.4) {
                    g.sprite(block, o.x + o.w / 2, GROUND - o.h * 0.25, o.w * 1.15, o.h * 0.5 * 1.15);
                    g.sprite(block, o.x + o.w / 2, GROUND - o.h * 0.75, o.w * 1.15, o.h * 0.5 * 1.15);
                } else {
                    g.sprite(block, o.x + o.w / 2, GROUND - o.h / 2, Math.max(o.w, o.h) * 1.15, o.h * 1.15);
                }
            }
            for (const t of treats) g.sprite(treat, t.x, t.y + Math.sin(clock * 5 + t.x / 40) * 4, 36, 36 * treat.h / treat.w);

            const bob = player.grounded ? -Math.abs(Math.sin(clock * speed() / TILE * 1.6)) * 5 : 0;
            const tilt = player.grounded ? 0 : Math.max(-0.35, Math.min(0.35, player.vy / 1600));
            const hidden = player.hurt > 0 && Math.floor(player.hurt * 12) % 2 === 0;
            g.sprite(runner, PX, player.y - size / 2 + bob, size, size * runner.h / runner.w, {
                rotation: tilt, alpha: hidden ? 0.35 : 1,
                scaleX: 1 + 0.12 * player.squash, scaleY: 1 - 0.18 * player.squash
            });
            c.restore();

            g.text(`${ctx.vars.distance} m`, W / 2, 64, { size: 40, weight: 800, color: pal.text });
            g.sprite(treat, 34, 64, 30, 30 * treat.h / treat.w);
            g.text(String(ctx.vars.treats), 56, 65, { size: 24, weight: 800, color: pal.text, align: 'left' });
            for (let i = 0; i < ctx.vars.lives && i < 9; i++) g.text('♥', W - 30 - i * 26, 64, { size: 26, color: pal.danger });
        },

        onParams(changed) {
            Object.assign(p, changed);
            return true;
        },

        serialize() {
            return {
                y: Math.round(player.y * 10) / 10, vy: Math.round(player.vy), travelled: Math.round(travelled),
                obstacles: obstacles.map(o => [Math.round(o.x), Math.round(o.h), Math.round(o.w)]), treats: ctx.vars.treats, lives: ctx.vars.lives
            };
        }
    };
}
