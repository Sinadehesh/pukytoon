// Drop and merge (physics family): drop items into a box; two of the same merge into the next one up the
// chain, and the box mustn't overflow. Happy Animal Merge's rules and physics, with sizes, gravity and the
// danger line as parameters, so any theme's chain can be dropped.

export const manifest = {
    key: 'drop-merge', version: '1.0.0', runtime: 1, family: 'physics',
    name: 'Drop and merge', emoji: '🫧', short: 'Merge',
    summary: 'Drop items in the box. Two of a kind merge into the next one.',
    view: { width: 450, height: 800 },
    requires: ['matter'],
    actions: { drop: ['release', 'Space', 'Enter'], left: ['ArrowLeft', 'KeyA'], right: ['ArrowRight', 'KeyD'] },
    params: {
        type: 'object',
        properties: {
            gravity: { type: 'number', minimum: 0.4, maximum: 2, default: 1, title: 'Gravity', 'x-step': 0.1, 'x-live': true },
            bounce: { type: 'number', minimum: 0, maximum: 0.6, default: 0.15, title: 'Bounciness', 'x-step': 0.05 },
            dropKinds: { type: 'integer', minimum: 2, maximum: 6, default: 5, title: 'Kinds that drop', 'x-live': true },
            itemSize: { type: 'number', minimum: 0.7, maximum: 1.3, default: 1, title: 'Item size', 'x-step': 0.05 },
            lineHeight: { type: 'number', minimum: 0.12, maximum: 0.4, default: 0.22, title: 'Danger line', 'x-step': 0.01, 'x-live': true },
            reverse: { type: 'boolean', default: false, title: 'Reverse sizes (higher levels are smaller)' }
        }
    },
    slots: {
        chain: { kind: 'sprite', role: 'chain', many: true, min: 5, title: 'Merge chain' },
        music: { kind: 'music', role: 'bgm', optional: true, title: 'Music' }
    },
    vars: ['score', 'time', 'merges', 'level', 'levels', 'overflow'],
    rules: { win: null, lose: 'overflow >= 1' },
    rulePresets: {
        win: [
            { label: 'Endless', value: null },
            { label: 'Make the top item', value: 'level >= levels' },
            { label: 'Score 2,000', value: 'score >= 2000' }
        ],
        lose: [
            { label: 'The box overflows', value: 'overflow >= 1' },
            { label: 'Overflow or 3 minutes', value: 'overflow >= 1 || time >= 180' }
        ]
    }
};

const W = 450, H = 800, TOP = 116, FLOOR = 792;
const FIT = 1.08;                  // pictures drawn a little bigger than their hitbox, so the art touches
const ELEVEN = [20, 30, 40, 55, 70, 85, 100, 120, 145, 170, 200];
const TWELVE = [20, 28, 37, 48, 60, 73, 87, 102, 118, 136, 156, 178];

// The radius of each level. Reverse: level 1 is a normal drop size and each level shrinks by the same ratio.
function radii(n, size, reverse) {
    let r;
    if (reverse) r = Array.from({ length: n }, (_, i) => 80 * Math.pow(18 / 80, i / Math.max(1, n - 1)));
    else if (n === 11) r = ELEVEN;
    else if (n === 12) r = TWELVE;
    else r = Array.from({ length: n }, (_, i) => 20 * Math.pow(190 / 20, i / Math.max(1, n - 1)));
    return r.map(v => Math.round(v * size));
}

export function create(ctx, params) {
    const { Engine, Bodies, Body, Composite, Events, Vertices } = ctx.physics;
    const p = { ...params };
    const pal = ctx.palette;
    const chain = ctx.slot('chain');
    const n = chain.length;
    const R = radii(n, p.itemSize, p.reverse);

    // Extra solver passes so heavy piles don't sink into each other
    const engine = Engine.create({ positionIterations: 20, velocityIterations: 12 });
    engine.gravity.y = p.gravity;
    const ground = Bodies.rectangle(W / 2, FLOOR + 25, W, 50, { isStatic: true });
    Composite.add(engine.world, [
        ground,
        Bodies.rectangle(-25, H / 2, 50, H * 2, { isStatic: true }),
        Bodies.rectangle(W + 25, H / 2, 50, H * 2, { isStatic: true })
    ]);

    let current = 0, next = 0, dropX = W / 2, cooldown = 0, dangerTime = 0, flash = 0;
    const dropKinds = () => Math.min(p.dropKinds, n);
    const dangerY = () => TOP + p.lineHeight * (FLOOR - TOP);
    const spawnY = tier => TOP + R[tier] + 8;
    const clampX = (x, tier) => Math.max(R[tier], Math.min(W - R[tier], x));
    const items = () => Composite.allBodies(engine.world).filter(b => b.tier !== undefined);

    // Hitbox = the picture's own traced outline, so items rest where the art touches. Matter centres the
    // body on the outline's centroid; the picture is anchored at that point to match.
    function spawn(x, y, tier, merged) {
        const target = R[tier];
        const start = merged ? Math.max(target * 0.3, 10) : target;
        const s = chain[tier];
        const k = (start * 2 * FIT) / s.w;
        const opts = { restitution: p.bounce, friction: 0.5, density: 0.001 * (tier + 1), slop: 0.01 };
        let body;
        if (s.hitbox && s.hitbox.length >= 3) {
            const outline = s.hitbox.map(([px, py]) => ({ x: px, y: py }));
            const centre = Vertices.centre(outline);
            body = Bodies.fromVertices(x, y, [outline.map(q => ({ x: q.x * k, y: q.y * k }))], opts);
            body.anchor = { x: centre.x / s.w, y: centre.y / s.h };
        } else {
            body = Bodies.circle(x, y, start, opts);
            body.anchor = { x: 0.5, y: 0.5 };
        }
        Object.assign(body, { tier, current: start, target, growing: merged, dropping: !merged, age: 0 });
        if (merged) Body.setVelocity(body, { x: 0, y: 2 });
        Composite.add(engine.world, body);
    }

    // A drop lands on the floor or on an item already landed; only landed items merge, so fast drops
    // can't merge in mid-air at the top
    const landed = b => b === ground || (b.tier !== undefined && !b.dropping);
    function collide(event) {
        for (const pair of event.pairs) {
            const a = pair.bodyA, b = pair.bodyB;
            if (a.dropping && landed(b)) { a.dropping = false; ctx.sfx('land', 0.35); }
            if (b.dropping && landed(a)) { b.dropping = false; ctx.sfx('land', 0.35); }
            if (a.dropping || b.dropping) continue;
            if (a.tier === undefined || b.tier === undefined || a.tier !== b.tier || a.tier >= n - 1) continue;
            if (a.merging || b.merging) continue;
            a.merging = b.merging = true;
            const tier = a.tier + 1;
            ctx.vars.score += (tier * (tier + 1) / 2) * 10;
            ctx.vars.merges += 1;
            ctx.vars.level = Math.max(ctx.vars.level, tier + 1);
            ctx.sfx('merge', 0.8, 1.15 - tier * 0.03);
            if (tier === n - 1) { ctx.sfx('praise'); ctx.haptic(60); }
            Composite.remove(engine.world, [a, b]);
            spawn((a.position.x + b.position.x) / 2, (a.position.y + b.position.y) / 2, tier, true);
        }
    }
    // collisionActive too: two drops that met in mid-air may merge once they rest on the pile
    Events.on(engine, 'collisionStart', collide);
    Events.on(engine, 'collisionActive', collide);

    return {
        start() {
            current = ctx.rng.int(0, dropKinds() - 1);
            next = ctx.rng.int(0, dropKinds() - 1);
            ctx.vars.levels = n;
            ctx.vars.level = 0;
        },

        update(dt, input) {
            cooldown -= dt;
            flash += dt;
            const ptr = input.pointer;
            if (ptr.down || ptr.pressed || ptr.released) dropX = ptr.x;
            if (input.held.has('left')) dropX -= 320 * dt;
            if (input.held.has('right')) dropX += 320 * dt;
            dropX = clampX(dropX, current);
            if (input.pressed.has('drop') && cooldown <= 0) {
                spawn(dropX, spawnY(current), current, false);
                current = next;
                next = ctx.rng.int(0, dropKinds() - 1);
                dropX = clampX(dropX, current);
                cooldown = 0.3;
                ctx.sfx('drop', 0.6);
            }

            for (const body of items()) {
                if (body.growing) {
                    const grown = Math.min(body.target, body.current + body.target / 30);
                    const f = grown / body.current;
                    Body.scale(body, f, f);
                    body.current = grown;
                    if (grown >= body.target) body.growing = false;
                }
                // A drop wedged against a wall: after a second and once it stops, it counts as landed
                if (body.dropping && ++body.age > 60 && body.speed < 0.3) body.dropping = false;
            }
            Engine.update(engine, 1000 / 60);

            // Touching the line is fine; the box is full when a landed item sits wholly above it for 3 s
            const above = items().some(b => !b.growing && !b.dropping && b.bounds.max.y < dangerY() &&
                Math.abs(b.velocity.y) < 2 && Math.abs(b.velocity.x) < 2);
            dangerTime = above ? dangerTime + dt : 0;
            if (dangerTime > 3) ctx.vars.overflow = 1;
        },

        render(g, alpha, scene) {
            // Score, best and the next item
            g.text(String(Math.floor(ctx.vars.score)), W / 2, 58, { size: 46, weight: 800, color: pal.text });
            g.text('Best', 52, 40, { size: 14, weight: 700, color: pal.text });
            g.text(String(Math.max(ctx.best(), Math.floor(ctx.vars.score))), 52, 64, { size: 22, weight: 800, color: pal.accent });
            g.text('Next', W - 52, 30, { size: 14, weight: 700, color: pal.text });
            const ns = chain[next];
            g.sprite(ns, W - 52, 70, 50, 50 * ns.h / ns.w);

            g.rect(0, TOP, W, FLOOR - TOP + 12, pal.board, 18);
            g.frame(2, TOP + 2, W - 4, FLOOR - TOP + 8, pal.ui, 4, 16);
            const warn = dangerTime > 0 ? 0.5 + 0.5 * Math.abs(Math.sin(flash * 8)) : 0.55;
            g.alpha(warn, () => g.line(8, dangerY(), W - 8, dangerY(), pal.danger, 3, [10, 8]));

            if (scene !== 'end') {
                const s = chain[current], size = R[current] * 2 * FIT;
                g.alpha(0.16, () => g.line(dropX, spawnY(current) + R[current], dropX, FLOOR, pal.text, 2, [4, 10]));
                g.sprite(s, dropX, spawnY(current), size, size * s.h / s.w, { alpha: 0.6 });
            }
            for (const b of items()) {
                const s = chain[b.tier], size = b.current * 2 * FIT;
                g.sprite(s, b.position.x, b.position.y, size, size * s.h / s.w,
                    { rotation: b.angle, anchorX: b.anchor.x, anchorY: b.anchor.y });
            }
        },

        onParams(changed) {
            Object.assign(p, changed);
            engine.gravity.y = p.gravity;
            return true;
        },

        serialize() {
            const bodies = items().sort((a, b) => a.id - b.id).map(b =>
                [b.tier, Math.round(b.position.x * 10) / 10, Math.round(b.position.y * 10) / 10, Math.round(b.angle * 100) / 100]);
            return { current, next, score: ctx.vars.score, bodies };
        },

        destroy() {
            Events.off(engine);
            Composite.clear(engine.world, false);
            Engine.clear(engine);
        }
    };
}
