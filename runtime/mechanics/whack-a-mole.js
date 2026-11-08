// Whack-a-mole (timing family): things pop out of holes; tap them before they hide, but leave the bad one
// alone. Hits in a row are worth more, and it gets faster as time goes on.

export const manifest = {
    key: 'whack-a-mole', version: '1.0.0', runtime: 1, family: 'timing',
    name: 'Whack-a-mole', emoji: '🔨', short: 'Whack',
    summary: 'Tap them as they pop up, but leave the bad one alone.',
    view: { width: 450, height: 800 },
    actions: {},
    params: {
        type: 'object',
        properties: {
            holes: { type: 'integer', enum: [6, 9, 12], default: 9, title: 'Holes' },
            upTime: { type: 'number', minimum: 0.5, maximum: 2.5, default: 1.2, title: 'Time up (s)', 'x-step': 0.1, 'x-live': true },
            spawnEvery: { type: 'number', minimum: 0.3, maximum: 1.5, default: 0.75, title: 'A new one every (s)', 'x-step': 0.05, 'x-live': true },
            badChance: { type: 'number', minimum: 0, maximum: 0.4, default: 0.15, title: 'Bad ones', 'x-step': 0.05, 'x-live': true },
            speedUp: { type: 'number', minimum: 0, maximum: 0.3, default: 0.1, title: 'Faster every 15 s', 'x-step': 0.02, 'x-live': true }
        }
    },
    slots: {
        targets: { kind: 'sprite', role: 'chain', many: true, min: 3, title: 'Pop-ups' },
        hazard: { kind: 'sprite', role: 'hazard', title: 'Bad one' },
        music: { kind: 'music', role: 'bgm', optional: true, title: 'Music' }
    },
    vars: ['score', 'time', 'hits', 'misses', 'streak'],
    rules: { win: 'score >= 500', lose: 'misses >= 8' },
    rulePresets: {
        win: [
            { label: 'Score 500', value: 'score >= 500' },
            { label: 'Hit 60', value: 'hits >= 60' },
            { label: 'Endless', value: null }
        ],
        lose: [
            { label: '8 misses', value: 'misses >= 8' },
            { label: '60 seconds', value: 'time >= 60' },
            { label: '8 misses or 60 s', value: 'misses >= 8 || time >= 60' }
        ]
    }
};

const W = 450, TOP = 190, AREA = 570, RISE = 0.14, HIT = 0.35;

export function create(ctx, params) {
    const p = { ...params };
    const pal = ctx.palette;
    const good = ctx.slot('targets').slice(0, 6);
    const bad = ctx.slot('hazard');
    const cols = p.holes === 6 ? 2 : 3, rows = p.holes / cols;
    const span = Math.min(W / cols, AREA / rows);
    const size = span * 0.62;
    const holes = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        holes.push({
            x: W / 2 + (c - (cols - 1) / 2) * span, y: TOP + (r + 0.5) * (AREA / rows) + size * 0.25,
            state: 'down', t: 0, up: 0, bad: false, art: null
        });
    }
    let timer = 0.6, clock = 0, shake = 0, pops = [];
    const faster = () => 1 / (1 + p.speedUp * Math.floor(clock / 15));

    // How far out of its hole a pop-up is, 0 to 1
    function out(h) {
        if (h.state === 'rising') return Math.min(1, h.t / RISE);
        if (h.state === 'up' || h.state === 'hit') return 1;
        if (h.state === 'falling') return Math.max(0, 1 - h.t / RISE);
        return 0;
    }

    return {
        start() {},

        update(dt, input) {
            clock += dt;
            shake = Math.max(0, shake - dt);
            timer -= dt;
            if (timer <= 0) {
                const free = holes.filter(h => h.state === 'down');
                if (free.length) {
                    const h = ctx.rng.pick(free);
                    h.bad = ctx.rng.chance(p.badChance);
                    h.art = h.bad ? bad : ctx.rng.pick(good);
                    h.state = 'rising'; h.t = 0;
                    h.up = p.upTime * faster() * ctx.rng.range(0.85, 1.15);
                }
                timer = p.spawnEvery * faster() * ctx.rng.range(0.7, 1.3);
            }

            if (input.pointer.pressed) {
                const { x, y } = input.pointer;
                const h = holes.find(o => (o.state === 'rising' || o.state === 'up') && out(o) > 0.35 &&
                    Math.hypot(x - o.x, y - (o.y - size * 0.45)) < size * 0.62);
                if (h) {
                    h.state = 'hit'; h.t = 0;
                    if (h.bad) {
                        ctx.vars.misses += 2;
                        ctx.vars.streak = 0;
                        shake = 0.3;
                        ctx.sfx('hit');
                        ctx.haptic(50);
                        pops.push({ x: h.x, y: h.y - size, text: '✕', color: pal.danger, t: 0 });
                    } else {
                        ctx.vars.streak += 1;
                        ctx.vars.hits += 1;
                        const gain = 10 * (1 + Math.floor(ctx.vars.streak / 5));
                        ctx.vars.score += gain;
                        ctx.sfx('pop', 0.8, 1 + Math.min(ctx.vars.streak, 10) * 0.04);
                        pops.push({ x: h.x, y: h.y - size, text: `+${gain}`, color: pal.accent, t: 0 });
                    }
                }
            }

            for (const h of holes) {
                h.t += dt;
                if (h.state === 'rising' && h.t >= RISE) { h.state = 'up'; h.t = 0; }
                else if (h.state === 'up' && h.t >= h.up) {
                    h.state = 'falling'; h.t = 0;
                    if (!h.bad) { ctx.vars.misses += 1; ctx.vars.streak = 0; ctx.sfx('miss', 0.4); }
                } else if (h.state === 'hit' && h.t >= HIT) { h.state = 'falling'; h.t = RISE * 0.5; }
                else if (h.state === 'falling' && h.t >= RISE) { h.state = 'down'; h.t = 0; }
            }
            for (const pp of pops) pp.t += dt;
            pops = pops.filter(pp => pp.t < 0.7);
        },

        render(g) {
            const c = g.ctx;
            c.save();
            if (shake > 0) c.translate(Math.sin(clock * 80) * shake * 16, 0);
            g.rect(-20, 120, W + 40, 700, g.gradient(0, 120, 0, 800, [[0, ctx.shade(pal.ground, 0.15)], [1, ctx.shade(pal.ground, -0.12)]]), 28);
            for (const h of holes) {
                g.ellipse(h.x, h.y, size * 0.62, size * 0.22, ctx.shade(pal.ground, -0.55));
                const k = out(h);
                if (k > 0 && h.art) {
                    c.save();
                    c.beginPath(); c.rect(h.x - size, h.y - size * 2, size * 2, size * 2); c.clip();
                    const squash = h.state === 'hit' ? 1 - 0.25 * Math.sin(Math.min(1, h.t / HIT) * Math.PI) : 1;
                    const art = h.art, ah = size * art.h / art.w;
                    g.sprite(art, h.x, h.y + ah * 0.55 - k * ah * 1.05, size, ah,
                        { scaleX: 2 - squash, scaleY: squash, alpha: h.state === 'hit' && h.bad ? 0.7 : 1 });
                    c.restore();
                }
                c.save();
                c.beginPath(); c.rect(h.x - size, h.y, size * 2, size); c.clip();
                g.ellipse(h.x, h.y, size * 0.66, size * 0.26, ctx.shade(pal.ground, -0.28));
                c.restore();
            }
            for (const pp of pops) {
                g.alpha(1 - pp.t / 0.7, () => g.text(pp.text, pp.x, pp.y - pp.t * 60, { size: 30, weight: 800, color: pp.color, outline: 'rgba(0,0,0,0.25)' }));
            }
            c.restore();

            g.text(String(ctx.vars.score), W / 2, 62, { size: 46, weight: 800, color: pal.text });
            g.text('Misses', 56, 44, { size: 14, color: pal.text });
            g.text(String(ctx.vars.misses), 56, 70, { size: 24, weight: 800, color: pal.danger });
            g.text('Streak', W - 56, 44, { size: 14, color: pal.text });
            g.text(String(ctx.vars.streak), W - 56, 70, { size: 24, weight: 800, color: pal.accent });
        },

        onParams(changed) {
            Object.assign(p, changed);
            return true;
        },

        serialize() {
            return { holes: holes.map(h => `${h.state[0]}${h.bad ? 'b' : ''}`).join(''), score: ctx.vars.score, misses: ctx.vars.misses, hits: ctx.vars.hits };
        }
    };
}
