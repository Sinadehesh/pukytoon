// Tap clicker (idle family): tap the big picture for coins, spend them on stronger taps and on helpers that
// earn by themselves, and evolve the picture up the look's chain, which doubles everything. Now and then a
// golden bonus floats by: tap it before it's gone.

export const manifest = {
    key: 'tap-clicker', version: '1.0.0', runtime: 1, family: 'idle',
    name: 'Tap clicker', emoji: '👆', short: 'Tap',
    summary: 'Tap for coins, buy helpers, and evolve your picture up the chain.',
    view: { width: 450, height: 800 },
    actions: {},
    params: {
        type: 'object',
        properties: {
            tapValue: { type: 'integer', minimum: 1, maximum: 10, default: 1, title: 'Coins a tap' },
            autoRate: { type: 'number', minimum: 0.2, maximum: 3, default: 1, title: 'Coins a second per helper', 'x-step': 0.1, 'x-live': true },
            costGrowth: { type: 'number', minimum: 1.07, maximum: 1.6, default: 1.18, title: 'Prices go up by (each buy)', 'x-step': 0.01 },
            evolveCost: { type: 'integer', minimum: 50, maximum: 2000, default: 150, title: 'First evolution costs', 'x-step': 10 },
            goldenChance: { type: 'number', minimum: 0, maximum: 0.2, default: 0.04, title: 'Golden bonuses', 'x-step': 0.01, 'x-live': true }
        }
    },
    slots: {
        chain: { kind: 'sprite', role: 'chain', many: true, min: 3, title: 'Evolutions' },
        player: { kind: 'sprite', role: 'player', title: 'Helper' },
        collectible: { kind: 'sprite', role: 'collectible', title: 'Golden bonus' },
        music: { kind: 'music', role: 'bgm', optional: true, title: 'Music' }
    },
    vars: ['score', 'time', 'coins', 'taps', 'level', 'helpers'],
    rules: { win: 'level >= 5', lose: null },
    rulePresets: {
        win: [
            { label: 'Evolve 5 times', value: 'level >= 5' },
            { label: 'Earn 10,000', value: 'score >= 10000' },
            { label: 'Endless', value: null }
        ],
        lose: [
            { label: 'Never', value: null },
            { label: '2 minutes', value: 'time >= 120' }
        ]
    }
};

const W = 450, CX = 225, CY = 360, BIG = 230, CARD_Y = 612, CARD_H = 156;

// 1234 -> 1.2K, so big numbers fit
export function short(n) {
    n = Math.floor(n);
    if (n < 1000) return String(n);
    const units = ['K', 'M', 'B', 'T'];
    let i = -1;
    while (n >= 1000 && i < units.length - 1) { n /= 1000; i++; }
    return `${n >= 100 ? Math.floor(n) : Math.floor(n * 10) / 10}${units[i]}`;
}

export function create(ctx, params) {
    const p = { ...params };
    const pal = ctx.palette;
    const chain = ctx.slot('chain'), helperArt = ctx.slot('player'), goldArt = ctx.slot('collectible');
    let tapLevel = 0, clock = 0, squash = 0, pops = [], sparks = [], golden = null, nope = [0, 0, 0], glow = 0;
    const cards = [0, 1, 2].map(i => ({ x: 14 + i * 144, y: CARD_Y, w: 134, h: CARD_H }));

    const mult = () => 2 ** ctx.vars.level;
    const perTap = () => (p.tapValue + tapLevel) * mult();
    const perSecond = () => ctx.vars.helpers * p.autoRate * mult();
    const costs = () => [
        Math.round(10 * p.costGrowth ** tapLevel),
        Math.round(25 * p.costGrowth ** ctx.vars.helpers),
        Math.round(p.evolveCost * 4 ** ctx.vars.level)
    ];
    const picture = () => chain[Math.min(ctx.vars.level, chain.length - 1)];

    function earn(n, x, y) {
        ctx.vars.coins += n;
        ctx.vars.score += n;
        if (x != null) pops.push({ x, y, text: `+${short(n)}`, t: 0 });
    }

    function burst(x, y, n, color) {
        for (let i = 0; i < n; i++) {
            const a = ctx.rng.range(0, Math.PI * 2), v = ctx.rng.range(120, 320);
            sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 80, t: 0, life: ctx.rng.range(0.4, 0.8), color });
        }
    }

    function buy(i) {
        const cost = costs()[i];
        if (ctx.vars.coins < cost) { nope[i] = 0.3; ctx.sfx('miss', 0.3); return; }
        ctx.vars.coins -= cost;
        if (i === 0) tapLevel++;
        else if (i === 1) ctx.vars.helpers += 1;
        else {
            ctx.vars.level += 1;
            glow = 1.2;
            burst(CX, CY, 28, pal.accent);
            ctx.sfx('praise');
            ctx.haptic(40);
            ctx.emit('evolve', { level: ctx.vars.level });
            return;
        }
        ctx.sfx('collect', 0.6, 1 + i * 0.1);
        ctx.haptic(12);
    }

    return {
        start() {},

        update(dt, input) {
            clock += dt;
            squash = Math.max(0, squash - dt * 6);
            glow = Math.max(0, glow - dt);
            nope = nope.map(v => Math.max(0, v - dt));
            earn(perSecond() * dt);

            if (!golden && ctx.rng.chance(p.goldenChance * dt * 4)) {
                const fromLeft = ctx.rng.chance(0.5);
                golden = { x: fromLeft ? -30 : W + 30, y: ctx.rng.range(170, 520), vx: (fromLeft ? 1 : -1) * ctx.rng.range(90, 140), t: 0 };
            }
            if (golden) {
                golden.t += dt;
                golden.x += golden.vx * dt;
                if (golden.x < -60 || golden.x > W + 60) golden = null;
            }

            if (input.pointer.pressed) {
                const { x, y } = input.pointer;
                const g = golden && Math.hypot(x - golden.x, y - (golden.y + Math.sin(golden.t * 5) * 14)) < 44 ? golden : null;
                if (g) {
                    earn(Math.max(20 * perTap(), 10 * perSecond()), g.x, g.y);
                    burst(g.x, g.y, 18, '#ffd34d');
                    ctx.sfx('collect', 1, 1.25);
                    ctx.haptic(25);
                    golden = null;
                } else if (Math.hypot(x - CX, y - CY) < BIG * 0.48) {
                    ctx.vars.taps += 1;
                    earn(perTap(), x + ctx.rng.range(-18, 18), y - 30);
                    squash = 1;
                    if (ctx.rng.chance(0.5)) burst(x, y, 3, pal.accent);
                    ctx.sfx('tap', 0.5, ctx.rng.range(0.9, 1.25));
                    ctx.haptic(6);
                } else {
                    const i = cards.findIndex(c => x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h);
                    if (i >= 0) buy(i);
                }
            }
            for (const o of pops) o.t += dt;
            pops = pops.filter(o => o.t < 0.8);
            for (const s of sparks) { s.t += dt; s.x += s.vx * dt; s.y += s.vy * dt; s.vy += 500 * dt; }
            sparks = sparks.filter(s => s.t < s.life);
        },

        render(g) {
            const c = g.ctx;
            g.rect(0, 0, W, 800, g.gradient(0, 0, 0, 800, [[0, pal.board], [1, ctx.shade(pal.bg, -0.06)]]));
            // rays behind the picture, brighter just after an evolution
            c.save();
            c.translate(CX, CY);
            c.rotate(clock * 0.2);
            for (let i = 0; i < 12; i++) {
                c.rotate(Math.PI / 6);
                g.alpha(0.1 + glow * 0.25, () => { c.beginPath(); c.moveTo(0, 0); c.lineTo(-26, -240); c.lineTo(26, -240); c.closePath(); c.fillStyle = pal.accent; c.fill(); });
            }
            c.restore();
            g.circle(CX, CY, BIG * 0.5, ctx.shade(pal.board, -0.06));
            // helpers circling the picture
            const shown = Math.min(ctx.vars.helpers, 12);
            for (let i = 0; i < shown; i++) {
                const a = clock * 0.8 + (i / shown) * Math.PI * 2;
                g.sprite(helperArt, CX + Math.cos(a) * BIG * 0.66, CY + Math.sin(a) * BIG * 0.66 * 0.8, 40, 40);
            }
            const sq = 1 - squash * 0.12;
            g.sprite(picture(), CX, CY, BIG * 0.82, BIG * 0.82, { scaleX: 2 - sq, scaleY: sq });
            if (golden) {
                const gy = golden.y + Math.sin(golden.t * 5) * 14;
                g.circle(golden.x, gy, 34 + Math.sin(golden.t * 9) * 4, 'rgba(255, 211, 77, 0.45)');
                g.sprite(goldArt, golden.x, gy, 54, 54);
            }
            for (const s of sparks) g.alpha(1 - s.t / s.life, () => g.circle(s.x, s.y, 4, s.color));
            for (const o of pops) g.alpha(1 - o.t / 0.8, () => g.text(o.text, o.x, o.y - o.t * 70, { size: 26, weight: 800, color: pal.accent, outline: 'rgba(0,0,0,0.25)' }));

            g.text(`${short(ctx.vars.coins)} coins`, W / 2, 58, { size: 40, weight: 800, color: pal.text, maxWidth: W - 40 });
            g.text(`${short(perTap())} a tap · ${short(perSecond())} a second`, W / 2, 98, { size: 16, weight: 700, color: ctx.shade(pal.text, 0.3) });
            const next = chain[Math.min(ctx.vars.level + 1, chain.length - 1)];
            g.text(`Level ${ctx.vars.level + 1}: ${picture().name || ''}`, W / 2, CY + BIG * 0.62 + 18, { size: 18, weight: 800, color: pal.text, maxWidth: W - 40 });

            const cs = costs();
            const labels = [['Stronger taps', `+${short(mult())} a tap`], ['Helper', `+${short(p.autoRate * mult())}/s`], ['Evolve', 'x2 coins']];
            const icons = [goldArt, helperArt, next];
            cards.forEach((card, i) => {
                const can = ctx.vars.coins >= cs[i];
                const dx = nope[i] > 0 ? Math.sin(nope[i] * 60) * 5 : 0;
                g.rect(card.x + dx, card.y, card.w, card.h, can ? '#ffffff' : ctx.shade(pal.board, -0.08), 18);
                g.frame(card.x + dx, card.y, card.w, card.h, can ? pal.accent : 'rgba(0,0,0,0.12)', can ? 3 : 2, 18);
                g.alpha(can ? 1 : 0.45, () => g.sprite(icons[i], card.x + dx + card.w / 2, card.y + 40, 48, 48));
                g.text(labels[i][0], card.x + dx + card.w / 2, card.y + 82, { size: 15, weight: 800, color: pal.text, maxWidth: card.w - 12 });
                g.text(labels[i][1], card.x + dx + card.w / 2, card.y + 104, { size: 13, weight: 600, color: ctx.shade(pal.text, 0.3), maxWidth: card.w - 12 });
                g.text(short(cs[i]), card.x + dx + card.w / 2, card.y + 133, { size: 18, weight: 800, color: can ? pal.accent : ctx.shade(pal.text, 0.4) });
            });
        },

        onParams(changed) {
            Object.assign(p, changed);
            return true;
        },

        serialize() {
            return {
                coins: Math.floor(ctx.vars.coins), score: Math.floor(ctx.vars.score), taps: ctx.vars.taps, level: ctx.vars.level,
                helpers: ctx.vars.helpers, tapLevel, costs: costs(), golden: golden ? [Math.round(golden.x), Math.round(golden.y + Math.sin(golden.t * 5) * 14)] : null
            };
        }
    };
}
