// Memory pairs (puzzle family): cards lie face down; turn two at a time and keep the pairs you find. Find them
// all to clear the board; with no win rule a new board is dealt, a round at a time.

export const manifest = {
    key: 'memory-pairs', version: '1.0.0', runtime: 1, family: 'puzzle',
    name: 'Memory pairs', emoji: '🃏', short: 'Pairs',
    summary: 'Turn the cards two at a time and find every pair.',
    view: { width: 450, height: 800 },
    actions: {},
    params: {
        type: 'object',
        properties: {
            pairs: { type: 'integer', enum: [6, 8, 10, 12], default: 8, title: 'Pairs' },
            peek: { type: 'number', minimum: 0, maximum: 3, default: 1, title: 'Look at them all first (s)', 'x-step': 0.5 },
            flipBack: { type: 'number', minimum: 0.4, maximum: 1.5, default: 0.8, title: 'Time to see a miss (s)', 'x-step': 0.1, 'x-live': true },
            shuffle: { type: 'boolean', default: false, title: 'Shuffle after 3 misses in a row', 'x-live': true }
        }
    },
    slots: {
        cards: { kind: 'sprite', role: 'chain', many: true, min: 4, title: 'Card pictures' },
        player: { kind: 'sprite', role: 'player', title: 'Extra card' },
        collectible: { kind: 'sprite', role: 'collectible', title: 'Extra card' },
        hazard: { kind: 'sprite', role: 'hazard', title: 'Extra card' },
        music: { kind: 'music', role: 'bgm', optional: true, title: 'Music' }
    },
    vars: ['score', 'time', 'moves', 'found', 'left', 'misses', 'round'],
    rules: { win: 'left <= 0', lose: null },
    rulePresets: {
        win: [
            { label: 'Find them all', value: 'left <= 0' },
            { label: 'Find 20 pairs', value: 'found >= 20' },
            { label: 'Endless', value: null }
        ],
        lose: [
            { label: 'No limit', value: null },
            { label: '10 misses', value: 'misses >= 10' },
            { label: '60 seconds', value: 'time >= 60' }
        ]
    }
};

const W = 450, TOP = 132, AREA = 620, GAP = 10, FLIP = 0.18;
const MARKS = ['#4f7cff', '#ff9f1c', '#2ec4b6', '#e71d36', '#9b5de5'];   // rings that tell repeated pictures apart

export function create(ctx, params) {
    const p = { ...params };
    const pal = ctx.palette;
    // distinct pictures: the chain, then the extra slots
    const seen = new Set(), pics = [];
    for (const a of [...ctx.slot('cards'), ctx.slot('player'), ctx.slot('collectible'), ctx.slot('hazard')]) {
        if (a && !seen.has(a.id)) { seen.add(a.id); pics.push(a); }
    }
    const faces = Array.from({ length: p.pairs }, (_, i) => ({ art: pics[i % pics.length], mark: Math.floor(i / pics.length) }));

    const cols = p.pairs <= 6 ? 3 : 4, rows = Math.ceil((p.pairs * 2) / cols);
    const cw = Math.floor(Math.min((W - 32 - (cols - 1) * GAP) / cols, ((AREA - (rows - 1) * GAP) / rows) * 0.8));
    const ch = Math.floor(cw / 0.8);
    const x0 = (W - (cols * cw + (cols - 1) * GAP)) / 2, y0 = TOP + (AREA - (rows * ch + (rows - 1) * GAP)) / 2;

    let cards = [], open = [], wait = 0, peek = 0, clock = 0, dealIn = 0, missRow = 0, streak = 0, pops = [], shuffled = 0;

    function deal() {
        const deck = [];
        for (let f = 0; f < p.pairs; f++) deck.push(f, f);
        for (let i = deck.length - 1; i > 0; i--) { const j = ctx.rng.int(0, i); [deck[i], deck[j]] = [deck[j], deck[i]]; }
        cards = deck.map((face, i) => ({ face, i, up: p.peek > 0, matched: false, f: p.peek > 0 ? 1 : 0, pop: 0 }));
        open = []; wait = 0; missRow = 0;
        peek = p.peek;
        ctx.vars.left = p.pairs;
    }

    const place = c => ({ x: x0 + (c.i % cols) * (cw + GAP), y: y0 + Math.floor(c.i / cols) * (ch + GAP) });

    function hideOpen() {
        for (const c of open) c.up = false;
        open = []; wait = 0;
    }

    function check() {
        const [a, b] = open;
        ctx.vars.moves += 1;
        if (a.face === b.face) {
            a.matched = b.matched = true;
            a.pop = b.pop = 1;
            open = [];
            streak += 1; missRow = 0;
            ctx.vars.found += 1;
            ctx.vars.left -= 1;
            const gain = 50 + 10 * (streak - 1);
            ctx.vars.score += gain;
            const pa = place(a);
            pops.push({ x: pa.x + cw / 2, y: pa.y, text: `+${gain}`, t: 0 });
            ctx.sfx('collect', 0.8, 1 + Math.min(streak, 10) * 0.04);
            ctx.haptic(15);
            if (ctx.vars.left <= 0) {
                ctx.vars.score += 100 * (ctx.vars.round + 1);
                ctx.sfx('praise');
                dealIn = 1.4;   // a new board, if the game goes on
            }
        } else {
            streak = 0; missRow += 1;
            ctx.vars.misses += 1;
            ctx.sfx('miss', 0.5);
            wait = p.flipBack;
            if (p.shuffle && missRow >= 3) shuffled = 1;
        }
    }

    // Shuffle the face-down cards among their places (after 3 misses in a row, if switched on)
    function shuffle() {
        const spots = cards.filter(c => !c.matched && !c.up).map(c => c.i);
        const order = spots.slice();
        for (let i = order.length - 1; i > 0; i--) { const j = ctx.rng.int(0, i); [order[i], order[j]] = [order[j], order[i]]; }
        cards.filter(c => !c.matched && !c.up).forEach((c, k) => { c.i = order[k]; });
        cards.sort((a, b) => a.i - b.i);
        missRow = 0;
    }

    return {
        start() { deal(); },

        update(dt, input) {
            clock += dt;
            for (const c of cards) {
                const target = c.up || c.matched ? 1 : 0;
                c.f += Math.sign(target - c.f) * Math.min(Math.abs(target - c.f), dt / FLIP);
                c.pop = Math.max(0, c.pop - dt * 2.5);
            }
            if (dealIn > 0) {
                dealIn -= dt;
                if (dealIn <= 0) { ctx.vars.round += 1; deal(); }
                return;
            }
            if (peek > 0) {
                peek -= dt;
                if (peek <= 0) cards.forEach(c => { c.up = false; });
                return;
            }
            if (wait > 0) {
                wait -= dt;
                if (wait <= 0) {
                    hideOpen();
                    if (shuffled) { shuffled = 0; shuffle(); }
                }
            }
            if (shuffled && wait <= 0 && !open.length) { shuffled = 0; shuffle(); }

            if (input.pointer.pressed) {
                const { x, y } = input.pointer;
                const c = cards.find(k => { const pl = place(k); return x >= pl.x && x <= pl.x + cw && y >= pl.y && y <= pl.y + ch; });
                if (c && !c.up && !c.matched) {
                    if (open.length >= 2) { hideOpen(); if (shuffled) return; }   // a third card: the missed pair turns back at once
                    c.up = true;
                    open.push(c);
                    ctx.sfx('tap', 0.4, 1.1);
                    if (open.length === 2) check();
                }
            }
            for (const o of pops) o.t += dt;
            pops = pops.filter(o => o.t < 0.8);
        },

        render(g) {
            g.rect(0, 0, W, 800, g.gradient(0, 0, 0, 800, [[0, pal.board], [1, ctx.shade(pal.bg, -0.05)]]));
            for (const c of cards) {
                const { x, y } = place(c);
                const turn = Math.abs(1 - 2 * c.f);          // the card's width while it turns
                const face = c.f > 0.5;
                const grow = 1 + c.pop * 0.08;
                const w = cw * turn * grow, h = ch * grow, cx = x + cw / 2, cy = y + ch / 2;
                if (w < 1) continue;
                g.rect(cx - w / 2 + 3, cy - h / 2 + 5, w, h, 'rgba(0,0,0,0.12)', 14);
                if (face) {
                    const fc = faces[c.face];
                    g.rect(cx - w / 2, cy - h / 2, w, h, c.matched ? ctx.shade(pal.board, 0.02) : '#ffffff', 14);
                    g.frame(cx - w / 2, cy - h / 2, w, h, c.matched ? pal.accent : 'rgba(0,0,0,0.1)', c.matched ? 4 : 2, 14);
                    if (fc.mark) g.frame(cx - w / 2 + 7, cy - h / 2 + 7, w - 14, h - 14, MARKS[(fc.mark - 1) % MARKS.length], 4, 10);
                    g.sprite(fc.art, cx, cy, Math.min(w, h) * 0.78, Math.min(w, h) * 0.78, { alpha: c.matched ? 0.85 : 1 });
                } else {
                    g.rect(cx - w / 2, cy - h / 2, w, h, g.gradient(0, cy - h / 2, 0, cy + h / 2, [[0, pal.accent], [1, ctx.shade(pal.accent, -0.25)]]), 14);
                    g.frame(cx - w / 2 + 6, cy - h / 2 + 6, w - 12, h - 12, 'rgba(255,255,255,0.5)', 2, 10);
                    g.text('?', cx, cy, { size: Math.min(w, h) * 0.38, weight: 800, color: 'rgba(255,255,255,0.85)' });
                }
            }
            for (const o of pops) g.alpha(1 - o.t / 0.8, () => g.text(o.text, o.x, o.y - o.t * 50, { size: 24, weight: 800, color: pal.accent, outline: 'rgba(0,0,0,0.2)' }));
            if (peek > 0) g.text('Remember them!', W / 2, TOP - 6, { size: 18, weight: 800, color: pal.text });
            if (dealIn > 0 && ctx.vars.left <= 0) g.text('All found!', W / 2, TOP - 6, { size: 20, weight: 800, color: pal.accent });

            g.text(String(ctx.vars.score), W / 2, 58, { size: 44, weight: 800, color: pal.text });
            g.text('Pairs', 56, 40, { size: 14, color: pal.text });
            g.text(`${p.pairs - ctx.vars.left}/${p.pairs}`, 56, 66, { size: 22, weight: 800, color: pal.accent });
            g.text('Moves', W - 56, 40, { size: 14, color: pal.text });
            g.text(String(ctx.vars.moves), W - 56, 66, { size: 22, weight: 800, color: pal.text });
        },

        onParams(changed) {
            Object.assign(p, changed);
            return true;
        },

        serialize() {
            // what a player can see: the picture only on cards that are face up
            return {
                cols, cw, ch, x0: Math.round(x0), y0: Math.round(y0),
                cards: cards.map(c => (c.matched ? 'm' : c.up && c.f > 0.5 ? `u${c.face}` : 'd')).join(' '),
                busy: peek > 0 || dealIn > 0 || wait > 0 || cards.some(c => c.f > 0 && c.f < 1),
                left: ctx.vars.left, moves: ctx.vars.moves, round: ctx.vars.round
            };
        }
    };
}
