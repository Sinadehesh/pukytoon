// Picture quiz (quiz family): questions made from the look's own pictures, so no writing is needed. "Tap the
// Strawberry", "What comes after the Egg?" (the merge chain's order), "How many?" (counting) and "Which one is
// different?". Answer before the time runs out; a wrong answer or running out of time costs a life.

export const manifest = {
    key: 'quiz', version: '1.0.0', runtime: 1, family: 'quiz',
    name: 'Picture quiz', emoji: '❓', short: 'Quiz',
    summary: 'Questions about the pictures: find it, what comes next, count them, spot the odd one out.',
    view: { width: 450, height: 800 },
    actions: {},
    params: {
        type: 'object',
        properties: {
            kinds: {
                type: 'string', enum: ['mixed', 'names', 'order', 'count', 'odd'], default: 'mixed', title: 'Questions',
                'x-labels': { mixed: 'Mixed', names: 'Find it', order: 'What comes next', count: 'Counting', odd: 'Odd one out' }
            },
            choices: { type: 'integer', enum: [2, 3, 4], default: 4, title: 'Answers to pick from' },
            timePerQuestion: { type: 'number', minimum: 3, maximum: 15, default: 8, title: 'Seconds per question', 'x-step': 0.5, 'x-live': true },
            lives: { type: 'integer', minimum: 1, maximum: 5, default: 3, title: 'Lives' },
            streakBonus: { type: 'boolean', default: true, title: 'Bonus for answers in a row', 'x-live': true }
        }
    },
    slots: {
        chain: { kind: 'sprite', role: 'chain', many: true, min: 4, title: 'Pictures (in order)' },
        player: { kind: 'sprite', role: 'player', title: 'Extra picture' },
        collectible: { kind: 'sprite', role: 'collectible', title: 'Extra picture' },
        hazard: { kind: 'sprite', role: 'hazard', title: 'Extra picture' },
        music: { kind: 'music', role: 'bgm', optional: true, title: 'Music' }
    },
    vars: ['score', 'time', 'correct', 'wrong', 'streak', 'lives', 'asked'],
    rules: { win: 'correct >= 12', lose: 'lives <= 0' },
    rulePresets: {
        win: [
            { label: '12 right', value: 'correct >= 12' },
            { label: '25 right', value: 'correct >= 25' },
            { label: 'Endless', value: null }
        ],
        lose: [
            { label: 'Out of lives', value: 'lives <= 0' },
            { label: '60 seconds', value: 'time >= 60' }
        ]
    }
};

const W = 450, ASK_Y = 156, SHOW = 0.95, KINDS = ['names', 'order', 'count', 'odd'];

export function create(ctx, params) {
    const p = { ...params };
    const pal = ctx.palette;
    // the chain in its order, and every distinct picture (by picture and by name, so a name means one picture)
    const chain = [];
    for (const a of ctx.slot('chain')) if (!chain.some(b => b.id === a.id)) chain.push(a);
    const pool = [];
    for (const a of [...chain, ctx.slot('player'), ctx.slot('collectible'), ctx.slot('hazard')]) {
        const name = (a && a.name || '').trim().toLowerCase();
        if (a && name && name !== '?' && !pool.some(b => b.id === a.id || b.name.trim().toLowerCase() === name)) pool.push(a);
    }
    const n = p.choices;
    const possible = {
        names: pool.length >= n,
        order: chain.length >= Math.max(3, n + 1),
        count: pool.length >= 1,
        odd: pool.length >= 2
    };
    const kinds = p.kinds === 'mixed' ? KINDS.filter(k => possible[k]) : [possible[p.kinds] ? p.kinds : 'count'];

    let q = null, phase = 'ask', left = 0, showFor = 0, picked = -1, clock = 0, rotation = ctx.rng.int(0, 99), pops = [];

    const shuffle = list => {
        const a = list.slice();
        for (let i = a.length - 1; i > 0; i--) { const j = ctx.rng.int(0, i); [a[i], a[j]] = [a[j], a[i]]; }
        return a;
    };
    const lower = s => (s || '').trim().toLowerCase();

    function ask() {
        const kind = kinds[rotation++ % kinds.length];
        let prompt = '', options = [], answer = 0, shown = null, count = 0;
        if (kind === 'names') {
            options = shuffle(pool).slice(0, n);
            answer = ctx.rng.int(0, n - 1);
            prompt = `Tap the ${lower(options[answer].name)}`;
        } else if (kind === 'order') {
            const i = ctx.rng.int(0, chain.length - 2);
            shown = chain[i];
            const right = chain[i + 1];
            options = shuffle([right, ...shuffle(chain.filter(a => a !== right && a !== shown)).slice(0, n - 1)]);
            answer = options.indexOf(right);
            prompt = `What comes after the ${lower(shown.name)}?`;
        } else if (kind === 'count') {
            shown = ctx.rng.pick(pool);
            count = ctx.rng.int(1, 9);
            const nums = new Set([count]);
            for (let d = 1; nums.size < n; d++) {
                for (const v of shuffle([count - d, count + d])) if (v >= 1 && v <= 12 && nums.size < n) nums.add(v);
            }
            options = shuffle([...nums]);
            answer = options.indexOf(count);
            prompt = 'How many are there?';
        } else {
            const [same, other] = shuffle(pool).slice(0, 2);
            answer = ctx.rng.int(0, n - 1);
            options = Array.from({ length: n }, (_, i) => (i === answer ? other : same));
            prompt = 'Which one is different?';
        }
        // where the pictures to count stand: spread on a grid, nudged a little
        const spots = shuffle(Array.from({ length: 12 }, (_, i) => i)).slice(0, count).map(i => ({
            x: 78 + (i % 4) * 98 + ctx.rng.range(-14, 14), y: 214 + Math.floor(i / 4) * 66 + ctx.rng.range(-8, 8)
        }));
        q = { kind, prompt, options, answer, shown, spots };
        phase = 'ask'; picked = -1;
        left = p.timePerQuestion;
        ctx.vars.asked += 1;
    }

    // The answer cards: two columns, centred
    function rects() {
        const rows = Math.ceil(n / 2), cw = 188, ch = rows > 1 ? 150 : 190, top = 430;
        return Array.from({ length: n }, (_, i) => {
            const r = Math.floor(i / 2), inRow = Math.min(2, n - r * 2), c = i % 2;
            const x = W / 2 - (inRow * cw + (inRow - 1) * 16) / 2 + c * (cw + 16);
            return { x, y: top + r * (ch + 16), w: cw, h: ch };
        });
    }

    function answerWith(i) {
        picked = i;
        phase = 'show'; showFor = SHOW;
        if (i === q.answer) {
            ctx.vars.correct += 1;
            ctx.vars.streak += 1;
            const gain = 100 + Math.ceil(left) * 10 + (p.streakBonus ? 20 * (ctx.vars.streak - 1) : 0);
            ctx.vars.score += gain;
            pops.push({ text: `+${gain}`, t: 0 });
            ctx.sfx('collect', 0.8, 1 + Math.min(ctx.vars.streak, 10) * 0.04);
            ctx.haptic(15);
        } else {
            ctx.vars.wrong += 1;
            ctx.vars.streak = 0;
            ctx.vars.lives = Math.max(0, ctx.vars.lives - 1);
            ctx.sfx('miss', 0.6);
            ctx.haptic(50);
        }
    }

    return {
        start() {
            ctx.vars.lives = p.lives;
            ask();
        },

        update(dt, input) {
            clock += dt;
            for (const o of pops) o.t += dt;
            pops = pops.filter(o => o.t < 0.9);
            if (ctx.vars.lives <= 0) return;
            if (phase === 'show') {
                showFor -= dt;
                if (showFor <= 0) ask();
                return;
            }
            left -= dt;
            if (left <= 0) { left = 0; answerWith(-1); return; }
            if (input.pointer.pressed) {
                const { x, y } = input.pointer;
                const i = rects().findIndex(r => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h);
                if (i >= 0) answerWith(i);
            }
        },

        render(g) {
            g.rect(0, 0, W, 800, g.gradient(0, 0, 0, 800, [[0, pal.board], [1, ctx.shade(pal.bg, -0.05)]]));
            g.text(String(ctx.vars.score), W / 2, 56, { size: 42, weight: 800, color: pal.text });
            g.text('Right', 56, 38, { size: 14, color: pal.text });
            g.text(String(ctx.vars.correct), 56, 64, { size: 22, weight: 800, color: pal.accent });
            g.text('Lives', W - 56, 38, { size: 14, color: pal.text });
            g.text('♥'.repeat(Math.min(5, ctx.vars.lives)) || '–', W - 56, 64, { size: 20, weight: 800, color: pal.danger, maxWidth: 100 });
            if (!q) return;

            // time left
            const share = phase === 'ask' ? left / p.timePerQuestion : 0;
            g.rect(24, 100, W - 48, 12, ctx.shade(pal.board, -0.1), 6);
            g.rect(24, 100, (W - 48) * share, 12, share < 0.3 ? pal.danger : pal.accent, 6);
            g.text(q.prompt, W / 2, ASK_Y, { size: 26, weight: 800, color: pal.text, maxWidth: W - 40 });

            if (q.kind === 'order') {
                g.sprite(q.shown, W / 2 - 70, 300, 130, 130);
                g.text('→', W / 2 + 36, 300, { size: 54, weight: 800, color: pal.accent });
                g.text('?', W / 2 + 104, 300, { size: 64, weight: 800, color: ctx.shade(pal.text, 0.35) });
            } else if (q.kind === 'count') {
                for (const s of q.spots) g.sprite(q.shown, s.x, s.y, 60, 60);
            } else if (q.kind === 'names') {
                g.text('?', W / 2, 300, { size: 120, weight: 800, color: ctx.shade(pal.board, -0.12) });
            } else {
                g.text('≠', W / 2, 300, { size: 120, weight: 800, color: ctx.shade(pal.board, -0.12) });
            }

            rects().forEach((r, i) => {
                const right = phase === 'show' && i === q.answer, wrong = phase === 'show' && i === picked && i !== q.answer;
                const bob = phase === 'show' && right ? Math.sin(clock * 18) * 3 : 0;
                g.rect(r.x + 3, r.y + 6, r.w, r.h, 'rgba(0,0,0,0.1)', 20);
                g.rect(r.x, r.y - bob, r.w, r.h, right ? '#d8f5e1' : wrong ? '#fde0dd' : '#ffffff', 20);
                g.frame(r.x, r.y - bob, r.w, r.h, right ? '#2ecc71' : wrong ? pal.danger : 'rgba(0,0,0,0.1)', right || wrong ? 5 : 2, 20);
                const o = q.options[i];
                if (typeof o === 'number') g.text(String(o), r.x + r.w / 2, r.y + r.h / 2 - bob, { size: 64, weight: 800, color: pal.text });
                else g.sprite(o, r.x + r.w / 2, r.y + r.h / 2 - bob, Math.min(r.w, r.h) * 0.72, Math.min(r.w, r.h) * 0.72);
            });
            for (const o of pops) g.alpha(1 - o.t / 0.9, () => g.text(o.text, W / 2, 392 - o.t * 50, { size: 30, weight: 800, color: '#2ecc71', outline: 'rgba(0,0,0,0.2)' }));
            if (phase === 'show' && picked === -1) g.text("Time's up!", W / 2, 392, { size: 24, weight: 800, color: pal.danger });
        },

        onParams(changed) {
            Object.assign(p, changed);
            return true;
        },

        serialize() {
            return {
                kind: q ? q.kind : '', prompt: q ? q.prompt : '', phase,
                options: q ? q.options.map(o => (typeof o === 'number' ? o : o.id)) : [],
                names: q ? q.options.map(o => (typeof o === 'number' ? String(o) : o.name)) : [],
                answer: q ? q.answer : -1, count: q && q.kind === 'count' ? q.spots.length : null,
                rects: rects().map(r => [r.x, r.y, r.w, r.h]),
                correct: ctx.vars.correct, lives: ctx.vars.lives
            };
        }
    };
}
